import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StatusBar,
  type StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  type ViewStyle,
  View,
} from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  Pressable,
  usePanGesture,
} from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlphaType,
  Canvas,
  ColorType,
  FilterMode,
  Image,
  MipmapMode,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';

import { doomEngine } from './src/doom/DoomEngine';
import { doomAudio } from './src/doom/DoomAudio';

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 200;
const FRAME_BYTES_PER_ROW = FRAME_WIDTH * 4;
const TARGET_RENDER_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_RENDER_FPS;
const STATUS_INTERVAL_MS = 500;
const STICK_SIZE = 136;
const STICK_KNOB_SIZE = 58;
const STICK_CENTER = STICK_SIZE / 2;
const STICK_MAX_OFFSET = 38;
const STICK_DEAD_ZONE = 17;
const LOOK_TURN_DEAD_ZONE = 4;
const LOOK_TURN_RELEASE_MS = 140;
const RELEASE_KEYS = [
  'up',
  'down',
  'left',
  'right',
  'strafe-left',
  'strafe-right',
  'fire',
  'use',
  'shift',
  'strafe',
  'enter',
  'escape',
];

const nowMs = () => Date.now();

type ControlScheme = 'current' | 'bethesda';
type PressKey = (key: string, pressed: boolean, sourceId?: string) => void;

function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <DoomScreen />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function DoomScreen() {
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isLandscape = viewportWidth > viewportHeight;
  const [image, setImage] = useState<SkImage | null>(null);
  const [status, setStatus] = useState('booting');
  const imageRef = useRef<SkImage | null>(null);
  const menuOpenedRef = useRef(false);
  const tickCountRef = useRef(0);
  const weaponSlotRef = useRef(1);
  const activePressSourcesRef = useRef<Map<string, Set<string>>>(new Map());
  const schemeRef = useRef<ControlScheme>('current');
  const [controlScheme, setControlScheme] =
    useState<ControlScheme>('current');
  const isBethesdaScheme = controlScheme === 'bethesda';
  const useCompactBethesdaControls =
    isBethesdaScheme && !isLandscape && viewportWidth <= 360;
  const controlsHorizontalInset = useCompactBethesdaControls ? 8 : 14;

  const portraitCanvasWidth = Math.min(viewportWidth, viewportHeight * 0.95);
  const portraitCanvasHeight = portraitCanvasWidth * (FRAME_HEIGHT / FRAME_WIDTH);
  const canvasWidth = isLandscape ? viewportWidth : portraitCanvasWidth;
  const canvasHeight = isLandscape ? viewportHeight : portraitCanvasHeight;
  const controlsTop = insets.top + portraitCanvasHeight + 18;
  const canvasFrameLayout = {
    height: canvasHeight,
    marginTop: isLandscape ? 0 : insets.top + 10,
    width: canvasWidth,
  };

  const updateImage = useCallback((bytes: Uint8Array) => {
    const data = Skia.Data.fromBytes(bytes);
    const nextImage = Skia.Image.MakeImage(
      {
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Opaque,
      },
      data,
      FRAME_BYTES_PER_ROW,
    );

    if (nextImage != null) {
      setImage(previousImage => {
        previousImage?.dispose();
        imageRef.current = nextImage;
        return nextImage;
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    let lastStatusTime = 0;
    let lastStatusRenderCount = 0;
    let renderCount = 0;

    const start = () => {
      try {
        const iwadPath = doomEngine.defaultIWadPath;
        console.log(`[Doom] DOOM1.WAD path: ${iwadPath}`);
        const startStatus = doomEngine.start(iwadPath);
        console.log(`[Doom] ${startStatus}`);
        setStatus(startStatus);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'failed to start Doom';
        console.error(`[Doom] ${message}`);
        setStatus(message);
        return;
      }

      const scheduleRender = (delayMs: number) => {
        renderTimer = setTimeout(render, delayMs);
      };

      const render = () => {
        if (cancelled) {
          return;
        }

        const startedAt = nowMs();

        try {
          const packet = doomEngine.tickAndGetFrameAudio();
          const frame = doomAudio.extractFrameAndPlayAudio(packet);
          tickCountRef.current += 1;

          if (!menuOpenedRef.current && tickCountRef.current > 12) {
            doomEngine.openMenu();
            menuOpenedRef.current = true;
            console.log('[Doom] queued main menu key event');
          }

          updateImage(frame);
          renderCount += 1;

          const timestamp = nowMs();
          if (timestamp - lastStatusTime >= STATUS_INTERVAL_MS) {
            const frameCount = doomEngine.frameCount;
            const elapsedSeconds = (timestamp - lastStatusTime) / 1000;
            const measuredFps =
              lastStatusTime === 0
                ? TARGET_RENDER_FPS
                : (renderCount - lastStatusRenderCount) / elapsedSeconds;

            lastStatusTime = timestamp;
            lastStatusRenderCount = renderCount;

            setStatus(
              `${doomEngine.windowTitle} frame ${Math.round(
                frameCount,
              )} render ${renderCount} ${Math.round(
                measuredFps,
              )}fps audio ${doomAudio.playedCount}`,
            );
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Doom frame failed';
          console.error(`[Doom] ${message}`);
          setStatus(message);
        }

        scheduleRender(Math.max(0, FRAME_INTERVAL_MS - (nowMs() - startedAt)));
      };

      scheduleRender(0);
    };

    start();

    return () => {
      cancelled = true;
      if (renderTimer != null) {
        clearTimeout(renderTimer);
      }
      imageRef.current?.dispose();
      imageRef.current = null;
    };
  }, [updateImage]);

  const pressKey = useCallback<PressKey>((key, pressed, sourceId = key) => {
    const activePressSources = activePressSourcesRef.current;
    let keySources = activePressSources.get(key);

    if (pressed) {
      if (keySources?.has(sourceId)) {
        return;
      }

      const wasPressed = keySources != null && keySources.size > 0;
      if (keySources == null) {
        keySources = new Set<string>();
        activePressSources.set(key, keySources);
      }

      keySources.add(sourceId);

      if (!wasPressed) {
        doomEngine.queueKey(key, true);
      }

      return;
    }

    if (keySources == null || !keySources.has(sourceId)) {
      return;
    }

    keySources.delete(sourceId);

    if (keySources.size === 0) {
      activePressSources.delete(key);
      doomEngine.queueKey(key, false);
    }
  }, []);

  const releaseGameplayKeys = useCallback(() => {
    activePressSourcesRef.current.clear();
    RELEASE_KEYS.forEach(key => {
      doomEngine.queueKey(key, false);
    });
  }, []);

  const tapKey = useCallback((key: string) => {
    doomEngine.queueKey(key, true);
    doomEngine.queueKey(key, false);
  }, []);

  const cycleWeapon = useCallback((direction: 1 | -1) => {
    const nextSlot = ((weaponSlotRef.current - 1 + direction + 8) % 8) + 1;
    weaponSlotRef.current = nextSlot;
    doomEngine.queueKey(String(nextSlot), true);
    doomEngine.queueKey(String(nextSlot), false);
  }, []);

  useEffect(() => {
    if (schemeRef.current === controlScheme) {
      return;
    }

    releaseGameplayKeys();
    schemeRef.current = controlScheme;
  }, [controlScheme, releaseGameplayKeys]);

  return (
    <View style={[styles.screen, isLandscape && styles.screenLandscape]}>
      <StatusBar barStyle="light-content" hidden={isLandscape} />

      <View
        style={[
          styles.canvasFrame,
          isLandscape && styles.canvasFrameLandscape,
          canvasFrameLayout,
        ]}>
        <Canvas style={styles.canvas}>
          {image != null && (
            <Image
              image={image}
              x={0}
              y={0}
              width={canvasWidth}
              height={canvasHeight}
              fit="fill"
              sampling={{
                filter: FilterMode.Nearest,
                mipmap: MipmapMode.None,
              }}
            />
          )}
        </Canvas>
      </View>

      <Text
        accessibilityRole="text"
        style={[
          styles.status,
          isLandscape
            ? {
                left: Math.max(insets.left + 10, 10),
                top: Math.max(insets.top + 8, 8),
              }
            : { top: controlsTop - 8 },
          isLandscape && styles.statusLandscape,
        ]}>
        {status}
      </Text>

      <ControlSchemeToggle
        scheme={controlScheme}
        onChange={setControlScheme}
        overlay={isLandscape}
        style={
          isLandscape
            ? {
                right: Math.max(insets.right + 10, 10),
                top: Math.max(insets.top + 8, 8),
              }
            : {
                right: 14,
                top: insets.top + 14,
              }
        }
      />

      {isBethesdaScheme && <LookTurnPad onPressKey={pressKey} />}

      <View
        pointerEvents="box-none"
        style={[
          styles.controls,
          isLandscape
            ? {
                bottom: Math.max(insets.bottom + 12, 12),
                left: Math.max(insets.left + 14, 14),
                right: Math.max(insets.right + 14, 14),
              }
            : {
                left: controlsHorizontalInset,
                right: controlsHorizontalInset,
                top: controlsTop + 26,
              },
          isLandscape && styles.controlsLandscape,
        ]}>
        <LeftControls
          scheme={controlScheme}
          onPressKey={pressKey}
          overlay={isLandscape}
        />

        {isBethesdaScheme ? (
          <BethesdaActions
            onPressKey={pressKey}
            onTapKey={tapKey}
            onCycleWeapon={cycleWeapon}
            overlay={isLandscape}
            compact={useCompactBethesdaControls}
          />
        ) : (
          <CurrentActions
            onPressKey={pressKey}
            onTapKey={tapKey}
            onCycleWeapon={cycleWeapon}
            overlay={isLandscape}
          />
        )}
      </View>
    </View>
  );
}

type ControlSchemeToggleProps = {
  scheme: ControlScheme;
  onChange: (scheme: ControlScheme) => void;
  overlay: boolean;
  style: StyleProp<ViewStyle>;
};

function ControlSchemeToggle({
  scheme,
  onChange,
  overlay,
  style,
}: ControlSchemeToggleProps) {
  const selectCurrent = useCallback(() => {
    onChange('current');
  }, [onChange]);

  const selectBethesda = useCallback(() => {
    onChange('bethesda');
  }, [onChange]);

  return (
    <View
      accessibilityLabel="Control scheme"
      style={[styles.schemeToggle, overlay && styles.schemeToggleOverlay, style]}>
      <Pressable
        testID="control-scheme-current"
        accessibilityRole="button"
        accessibilityLabel="Current controls"
        onPress={selectCurrent}
        style={[
          styles.schemeToggleOption,
          scheme === 'current' && styles.schemeToggleOptionActive,
        ]}>
        <Text
          style={[
            styles.schemeToggleLabel,
            scheme === 'current' && styles.schemeToggleLabelActive,
          ]}>
          OURS
        </Text>
      </Pressable>
      <Pressable
        testID="control-scheme-bethesda"
        accessibilityRole="button"
        accessibilityLabel="Bethesda-style controls"
        onPress={selectBethesda}
        style={[
          styles.schemeToggleOption,
          scheme === 'bethesda' && styles.schemeToggleOptionActive,
        ]}>
        <Text
          style={[
            styles.schemeToggleLabel,
            scheme === 'bethesda' && styles.schemeToggleLabelActive,
          ]}>
          BETH
        </Text>
      </Pressable>
    </View>
  );
}

type ControlActionsProps = {
  onPressKey: PressKey;
  onTapKey: (key: string) => void;
  onCycleWeapon: (direction: 1 | -1) => void;
  overlay: boolean;
  compact?: boolean;
};

function LeftControls({
  scheme,
  onPressKey,
  overlay,
}: {
  scheme: ControlScheme;
  onPressKey: PressKey;
  overlay: boolean;
}) {
  const isBethesdaScheme = scheme === 'bethesda';

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.leftControls,
        isBethesdaScheme && styles.leftControlsBethesda,
      ]}>
      {isBethesdaScheme && (
        <ControlButton
          label="FIRE"
          keyName="fire"
          onPressKey={onPressKey}
          overlay={overlay}
          variant="primary"
          size="wide"
          pressSourceId="bethesda-left-fire"
          testID="left-fire-button"
          accessibilityLabel="LEFT FIRE"
        />
      )}
      <VirtualStick
        onPressKey={onPressKey}
        overlay={overlay}
        horizontalMode={isBethesdaScheme ? 'strafe' : 'turn'}
      />
    </View>
  );
}

function CurrentActions({
  onPressKey,
  onTapKey,
  onCycleWeapon,
  overlay,
}: ControlActionsProps) {
  return (
    <View style={styles.actions}>
      <ControlButton
        label="FIRE"
        keyName="fire"
        onPressKey={onPressKey}
        overlay={overlay}
        variant="primary"
      />
      <ControlButton
        label="USE"
        keyName="use"
        onPressKey={onPressKey}
        overlay={overlay}
      />
      <ControlButton
        label="RUN"
        keyName="shift"
        onPressKey={onPressKey}
        overlay={overlay}
      />
      <ControlButton
        label="STRF"
        keyName="strafe"
        onPressKey={onPressKey}
        overlay={overlay}
        accessibilityLabel="STRAFE"
      />
      <ControlButton
        label="MAP"
        keyName="tab"
        onTapKey={onTapKey}
        overlay={overlay}
      />
      <ControlButton
        label="W+"
        keyName="weapon-next"
        onTap={() => onCycleWeapon(1)}
        overlay={overlay}
        accessibilityLabel="WEAPON NEXT"
      />
      <ControlButton
        label="W-"
        keyName="weapon-prev"
        onTap={() => onCycleWeapon(-1)}
        overlay={overlay}
        accessibilityLabel="WEAPON PREVIOUS"
      />
      <ControlButton
        label="OK"
        keyName="enter"
        onTapKey={onTapKey}
        overlay={overlay}
      />
      <ControlButton
        label="MENU"
        keyName="escape"
        onPressKey={onPressKey}
        overlay={overlay}
      />
    </View>
  );
}

function BethesdaActions({
  onPressKey,
  onTapKey,
  onCycleWeapon,
  overlay,
  compact = false,
}: ControlActionsProps) {
  return (
    <View style={[styles.bethesdaActions, compact && styles.bethesdaActionsCompact]}>
      <View
        style={[
          styles.bethesdaUtilityGrid,
          compact && styles.bethesdaUtilityGridCompact,
        ]}>
        <ControlButton
          label="USE"
          keyName="use"
          onPressKey={onPressKey}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
        />
        <ControlButton
          label="RUN"
          keyName="shift"
          onPressKey={onPressKey}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
        />
        <ControlButton
          label="STRF"
          keyName="strafe"
          onPressKey={onPressKey}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
          accessibilityLabel="STRAFE"
        />
        <ControlButton
          label="MAP"
          keyName="tab"
          onTapKey={onTapKey}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
        />
        <ControlButton
          label="W-"
          keyName="weapon-prev"
          onTap={() => onCycleWeapon(-1)}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
          accessibilityLabel="WEAPON PREVIOUS"
        />
        <ControlButton
          label="W+"
          keyName="weapon-next"
          onTap={() => onCycleWeapon(1)}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
          accessibilityLabel="WEAPON NEXT"
        />
        <ControlButton
          label="OK"
          keyName="enter"
          onTapKey={onTapKey}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
        />
        <ControlButton
          label="MENU"
          keyName="escape"
          onPressKey={onPressKey}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
        />
      </View>
      <ControlButton
        label="FIRE"
        keyName="fire"
        onPressKey={onPressKey}
        overlay={overlay}
        variant="primary"
        size={compact ? 'narrowLarge' : 'large'}
        pressSourceId="bethesda-right-fire"
      />
    </View>
  );
}

type TurnKey = 'left' | 'right';

function LookTurnPad({
  onPressKey,
}: {
  onPressKey: PressKey;
}) {
  const activeTurnKeyRef = useRef<TurnKey | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startXRef = useRef(0);

  const clearReleaseTimer = useCallback(() => {
    if (releaseTimerRef.current != null) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
  }, []);

  const setTurnKey = useCallback(
    (nextKey: TurnKey | null) => {
      const activeTurnKey = activeTurnKeyRef.current;

      if (activeTurnKey === nextKey) {
        return;
      }

      if (activeTurnKey != null) {
        onPressKey(activeTurnKey, false);
      }

      if (nextKey != null) {
        onPressKey(nextKey, true);
      }

      activeTurnKeyRef.current = nextKey;
    },
    [onPressKey],
  );

  const releaseTurnKey = useCallback(() => {
    clearReleaseTimer();
    setTurnKey(null);
  }, [clearReleaseTimer, setTurnKey]);

  const scheduleTurnRelease = useCallback(() => {
    clearReleaseTimer();
    releaseTimerRef.current = setTimeout(() => {
      setTurnKey(null);
    }, LOOK_TURN_RELEASE_MS);
  }, [clearReleaseTimer, setTurnKey]);

  useEffect(() => releaseTurnKey, [releaseTurnKey]);

  const lookGesture = usePanGesture({
    disableReanimated: true,
    minDistance: 0,
    shouldCancelWhenOutside: false,
    onBegin: event => {
      startXRef.current = event.x;
      releaseTurnKey();
    },
    onUpdate: event => {
      const dragX = event.x - startXRef.current;

      if (Math.abs(dragX) < LOOK_TURN_DEAD_ZONE) {
        setTurnKey(null);
        return;
      }

      setTurnKey(dragX > 0 ? 'right' : 'left');
      scheduleTurnRelease();
    },
    onFinalize: () => {
      releaseTurnKey();
    },
  });

  return (
    <GestureDetector gesture={lookGesture}>
      <View
        accessibilityLabel="Look turn area"
        collapsable={false}
        testID="look-turn-area"
        style={styles.lookTurnPad}
      />
    </GestureDetector>
  );
}

type ControlButtonProps = {
  label: string;
  keyName: string;
  onPressKey?: PressKey;
  onTapKey?: (key: string) => void;
  onTap?: () => void;
  overlay?: boolean;
  variant?: 'primary' | 'secondary';
  size?: 'normal' | 'compact' | 'tiny' | 'wide' | 'large' | 'narrowLarge';
  pressSourceId?: string;
  testID?: string;
  accessibilityLabel?: string;
};

function ControlButton({
  label,
  keyName,
  onPressKey,
  onTapKey,
  onTap,
  overlay = false,
  variant = 'secondary',
  size = 'normal',
  pressSourceId,
  testID,
  accessibilityLabel,
}: ControlButtonProps) {
  const handlePressIn = useCallback(() => {
    onPressKey?.(keyName, true, pressSourceId ?? keyName);
  }, [keyName, onPressKey, pressSourceId]);

  const handlePressOut = useCallback(() => {
    onPressKey?.(keyName, false, pressSourceId ?? keyName);
  }, [keyName, onPressKey, pressSourceId]);

  const handlePress = useCallback(() => {
    onTap?.();
    onTapKey?.(keyName);
  }, [keyName, onTap, onTapKey]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [
        styles.controlButton,
        size === 'compact' && styles.controlButtonCompact,
        size === 'tiny' && styles.controlButtonTiny,
        size === 'wide' && styles.controlButtonWide,
        size === 'large' && styles.controlButtonLarge,
        size === 'narrowLarge' && styles.controlButtonNarrowLarge,
        variant === 'primary' && styles.controlButtonPrimary,
        overlay && styles.controlButtonOverlay,
        pressed && styles.controlButtonPressed,
      ]}>
      <Text
        style={[
          styles.controlLabel,
          size === 'compact' && styles.controlLabelCompact,
          size === 'tiny' && styles.controlLabelTiny,
          size === 'large' && styles.controlLabelLarge,
          size === 'narrowLarge' && styles.controlLabelNarrowLarge,
          variant === 'primary' && styles.controlLabelPrimary,
          overlay && styles.controlLabelOverlay,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

type MovementKey = 'up' | 'down' | 'left' | 'right';
type StickInputKey = MovementKey | 'strafe-left' | 'strafe-right';
type StickHorizontalMode = 'turn' | 'strafe';

type VirtualStickProps = {
  onPressKey: PressKey;
  overlay?: boolean;
  horizontalMode?: StickHorizontalMode;
};

function VirtualStick({
  onPressKey,
  overlay = false,
  horizontalMode = 'turn',
}: VirtualStickProps) {
  const [stickOffset, setStickOffset] = useState({
    active: false,
    x: 0,
    y: 0,
  });
  const activeKeysRef = useRef<Set<StickInputKey>>(new Set());

  const setMovementKeys = useCallback(
    (nextKeys: StickInputKey[]) => {
      const nextKeySet = new Set(nextKeys);
      const activeKeys = activeKeysRef.current;

      activeKeys.forEach(key => {
        if (!nextKeySet.has(key)) {
          onPressKey(key, false);
        }
      });

      nextKeySet.forEach(key => {
        if (!activeKeys.has(key)) {
          onPressKey(key, true);
        }
      });

      activeKeysRef.current = nextKeySet;
    },
    [onPressKey],
  );

  const updateStickFromPoint = useCallback(
    (x: number, y: number) => {
      const rawX = x - STICK_CENTER;
      const rawY = y - STICK_CENTER;
      const distance = Math.hypot(rawX, rawY);
      const scale =
        distance > STICK_MAX_OFFSET ? STICK_MAX_OFFSET / distance : 1;
      const nextX = rawX * scale;
      const nextY = rawY * scale;
      const nextKeys: StickInputKey[] = [];
      let horizontalKey: MovementKey | null = null;

      if (nextY < -STICK_DEAD_ZONE) {
        nextKeys.push('up');
      } else if (nextY > STICK_DEAD_ZONE) {
        nextKeys.push('down');
      }

      if (nextX < -STICK_DEAD_ZONE) {
        horizontalKey = 'left';
      } else if (nextX > STICK_DEAD_ZONE) {
        horizontalKey = 'right';
      }

      if (horizontalKey != null) {
        nextKeys.push(
          horizontalMode === 'strafe'
            ? horizontalKey === 'left'
              ? 'strafe-left'
              : 'strafe-right'
            : horizontalKey,
        );
      }

      setStickOffset({
        active: nextKeys.length > 0,
        x: nextX,
        y: nextY,
      });
      setMovementKeys(nextKeys);
    },
    [horizontalMode, setMovementKeys],
  );

  const releaseStick = useCallback(() => {
    setStickOffset({ active: false, x: 0, y: 0 });
    setMovementKeys([]);
  }, [setMovementKeys]);

  useEffect(() => releaseStick, [releaseStick]);

  const stickGesture = usePanGesture({
    disableReanimated: true,
    minDistance: 0,
    shouldCancelWhenOutside: false,
    onBegin: event => {
      updateStickFromPoint(event.x, event.y);
    },
    onUpdate: event => {
      updateStickFromPoint(event.x, event.y);
    },
    onFinalize: () => {
      releaseStick();
    },
  });

  return (
    <GestureDetector gesture={stickGesture}>
      <View
        accessibilityLabel="Movement stick"
        accessibilityRole="adjustable"
        collapsable={false}
        style={[
          styles.stick,
          overlay && styles.stickOverlay,
          stickOffset.active && styles.stickActive,
        ]}>
        <View style={styles.stickNotchVertical} />
        <View style={styles.stickNotchHorizontal} />
        <View style={styles.stickInnerRing} />
        <View
          style={[
            styles.stickKnob,
            overlay && styles.stickKnobOverlay,
            {
              transform: [
                { translateX: stickOffset.x },
                { translateY: stickOffset.y },
              ],
            },
          ]}>
          <View style={styles.stickKnobCore} />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screen: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#050706',
  },
  screenLandscape: {
    alignItems: 'stretch',
    backgroundColor: '#000',
  },
  canvasFrame: {
    backgroundColor: '#000',
    borderColor: '#493d36',
    borderWidth: 1,
  },
  canvasFrameLandscape: {
    borderWidth: 0,
  },
  canvas: {
    flex: 1,
  },
  status: {
    position: 'absolute',
    color: '#d3c8b1',
    fontFamily: 'Menlo',
    fontSize: 12,
    letterSpacing: 0,
    zIndex: 3,
  },
  statusLandscape: {
    color: '#f0dfc0',
    fontSize: 11,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  controls: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
  },
  controlsLandscape: {
    alignItems: 'flex-end',
  },
  schemeToggle: {
    position: 'absolute',
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#675d51',
    backgroundColor: '#101312',
    zIndex: 4,
  },
  schemeToggleOverlay: {
    borderColor: 'rgba(240, 214, 170, 0.42)',
    backgroundColor: 'rgba(11, 13, 13, 0.62)',
  },
  schemeToggleOption: {
    width: 54,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  schemeToggleOptionActive: {
    backgroundColor: '#3b1712',
  },
  schemeToggleLabel: {
    color: '#b9ad93',
    fontFamily: 'Menlo',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
  },
  schemeToggleLabelActive: {
    color: '#fff0d2',
  },
  lookTurnPad: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    zIndex: 1,
  },
  leftControls: {
    minHeight: STICK_SIZE,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  leftControlsBethesda: {
    minHeight: STICK_SIZE + 52,
    gap: 8,
  },
  stick: {
    width: STICK_SIZE,
    height: STICK_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: STICK_SIZE / 2,
    borderWidth: 1,
    borderColor: '#7e7061',
    backgroundColor: '#111615',
    shadowColor: '#000',
    shadowOpacity: 0.42,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  stickOverlay: {
    borderColor: 'rgba(245, 218, 167, 0.42)',
    backgroundColor: 'rgba(12, 14, 13, 0.54)',
  },
  stickActive: {
    borderColor: '#d34a38',
  },
  stickInnerRing: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 1,
    borderColor: 'rgba(223, 196, 149, 0.32)',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  stickNotchVertical: {
    position: 'absolute',
    width: 2,
    height: 104,
    backgroundColor: 'rgba(201, 174, 132, 0.18)',
  },
  stickNotchHorizontal: {
    position: 'absolute',
    width: 104,
    height: 2,
    backgroundColor: 'rgba(201, 174, 132, 0.18)',
  },
  stickKnob: {
    position: 'absolute',
    left: (STICK_SIZE - STICK_KNOB_SIZE) / 2,
    top: (STICK_SIZE - STICK_KNOB_SIZE) / 2,
    width: STICK_KNOB_SIZE,
    height: STICK_KNOB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: STICK_KNOB_SIZE / 2,
    borderWidth: 1,
    borderColor: '#e0c48d',
    backgroundColor: '#2b302c',
  },
  stickKnobOverlay: {
    backgroundColor: 'rgba(43, 48, 44, 0.78)',
  },
  stickKnobCore: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#c83f32',
  },
  actions: {
    width: 152,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 7,
  },
  bethesdaActions: {
    width: 176,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 8,
  },
  bethesdaActionsCompact: {
    width: 146,
    gap: 6,
  },
  bethesdaUtilityGrid: {
    width: 94,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  bethesdaUtilityGridCompact: {
    width: 84,
  },
  controlButton: {
    width: 46,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderColor: '#756a5c',
    borderWidth: 1,
    backgroundColor: '#171b1a',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
  },
  controlButtonCompact: {
    width: 44,
    height: 40,
  },
  controlButtonTiny: {
    width: 39,
    height: 38,
  },
  controlButtonWide: {
    width: 74,
    height: 44,
  },
  controlButtonLarge: {
    width: 74,
    height: 86,
  },
  controlButtonNarrowLarge: {
    width: 56,
    height: 82,
  },
  controlButtonPrimary: {
    borderColor: '#d4513d',
    backgroundColor: '#401713',
  },
  controlButtonPressed: {
    backgroundColor: '#4c4437',
  },
  controlButtonOverlay: {
    backgroundColor: 'rgba(11, 13, 13, 0.58)',
    borderColor: 'rgba(240, 214, 170, 0.42)',
  },
  controlLabel: {
    color: '#f1e4c8',
    fontFamily: 'Menlo',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
  },
  controlLabelCompact: {
    fontSize: 10,
  },
  controlLabelTiny: {
    fontSize: 9,
  },
  controlLabelLarge: {
    fontSize: 12,
  },
  controlLabelNarrowLarge: {
    fontSize: 11,
  },
  controlLabelPrimary: {
    color: '#fff5df',
  },
  controlLabelOverlay: {
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

export default App;

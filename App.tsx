import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  StatusBar,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
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
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
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
import {
  FRAME_BYTES_PER_ROW,
  FRAME_HEIGHT,
  FRAME_WIDTH,
} from './src/doom/frameConstants';

const TARGET_RENDER_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_RENDER_FPS;
const MIN_FRAME_DELTA_MS = FRAME_INTERVAL_MS * 0.9;
const RETAINED_FRAME_COUNT = 8;
const STATUS_INTERVAL_MS = 500;
const STICK_SIZE = 136;
const STICK_KNOB_SIZE = 58;
const STICK_CENTER = STICK_SIZE / 2;
const STICK_MAX_OFFSET = 38;
const STICK_DEAD_ZONE = 17;
const LOOK_TURN_DELTA_THRESHOLD = 0.5;
const LOOK_TURN_RELEASE_MS = 48;
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

const STICK_KEY_SEPARATOR = '|';

const nowMs = () => Date.now();

type ControlScheme = 'current' | 'bethesda';
type PressKey = (key: string, pressed: boolean, sourceId?: string) => void;
type StatusTextHandle = {
  setStatus: (status: string) => void;
};

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
  const image = useSharedValue<SkImage | null>(null);
  const imageRef = useRef<SkImage | null>(null);
  const retainedImagesRef = useRef<SkImage[]>([]);
  const statusTextRef = useRef<StatusTextHandle>(null);
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
  const canvasFrameLayout = useMemo(
    () => ({
      height: canvasHeight,
      marginTop: isLandscape ? 0 : insets.top + 10,
      width: canvasWidth,
    }),
    [canvasHeight, canvasWidth, insets.top, isLandscape],
  );
  const statusTextStyle = useMemo<StyleProp<TextStyle>>(
    () => [
      styles.status,
      isLandscape
        ? {
            left: Math.max(insets.left + 10, 10),
            top: Math.max(insets.top + 8, 8),
          }
        : { top: controlsTop - 8 },
      isLandscape && styles.statusLandscape,
    ],
    [controlsTop, insets.left, insets.top, isLandscape],
  );
  const schemeToggleStyle = useMemo<StyleProp<ViewStyle>>(
    () =>
      isLandscape
        ? {
            right: Math.max(insets.right + 10, 10),
            top: Math.max(insets.top + 8, 8),
          }
        : [styles.schemeTogglePortrait, { top: insets.top + 14 }],
    [insets.right, insets.top, isLandscape],
  );
  const controlsStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
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
    ],
    [
      controlsHorizontalInset,
      controlsTop,
      insets.bottom,
      insets.left,
      insets.right,
      isLandscape,
    ],
  );

  const updateDebugStatus = useCallback((nextStatus: string) => {
    if (__DEV__) {
      statusTextRef.current?.setStatus(nextStatus);
    }
  }, []);

  const updateImage = useCallback((bytes: Uint8Array) => {
    const data = Skia.Data.fromBytes(bytes);
    let nextImage: SkImage | null = null;

    try {
      nextImage = Skia.Image.MakeImage(
        {
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          colorType: ColorType.RGBA_8888,
          alphaType: AlphaType.Opaque,
        },
        data,
        FRAME_BYTES_PER_ROW,
      );
    } finally {
      data.dispose();
    }

    if (nextImage != null) {
      const previousImage = imageRef.current;
      imageRef.current = nextImage;
      image.value = nextImage;

      if (previousImage != null) {
        const retainedImages = retainedImagesRef.current;
        retainedImages.push(previousImage);

        if (retainedImages.length > RETAINED_FRAME_COUNT) {
          retainedImages.shift()?.dispose();
        }
      }
    }
  }, [image]);

  useEffect(() => {
    let cancelled = false;
    let animationFrameId: number | undefined;
    let lastRenderTimestamp = 0;
    let lastStatusTime = 0;
    let lastStatusRenderCount = 0;
    let renderCount = 0;

    const start = () => {
      try {
        const iwadPath = doomEngine.defaultIWadPath;
        console.log(`[Doom] DOOM1.WAD path: ${iwadPath}`);
        const startStatus = doomEngine.start(iwadPath);
        console.log(`[Doom] ${startStatus}`);
        updateDebugStatus(startStatus);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'failed to start Doom';
        console.error(`[Doom] ${message}`);
        updateDebugStatus(message);
        return;
      }

      const scheduleRender = () => {
        animationFrameId = requestAnimationFrame(render);
      };

      const render = (timestamp: number) => {
        if (cancelled) {
          return;
        }

        if (
          lastRenderTimestamp !== 0 &&
          timestamp - lastRenderTimestamp < MIN_FRAME_DELTA_MS
        ) {
          scheduleRender();
          return;
        }

        lastRenderTimestamp = timestamp;

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

          const statusTimestamp = nowMs();
          if (
            __DEV__ &&
            statusTimestamp - lastStatusTime >= STATUS_INTERVAL_MS
          ) {
            const frameCount = doomEngine.frameCount;
            const elapsedSeconds = (statusTimestamp - lastStatusTime) / 1000;
            const measuredFps =
              (renderCount - lastStatusRenderCount) / elapsedSeconds;

            lastStatusTime = statusTimestamp;
            lastStatusRenderCount = renderCount;

            updateDebugStatus(
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
          updateDebugStatus(message);
        }

        scheduleRender();
      };

      lastStatusTime = nowMs();
      scheduleRender();
    };

    start();

    return () => {
      cancelled = true;
      if (animationFrameId != null) {
        cancelAnimationFrame(animationFrameId);
      }
      image.value = null;
      imageRef.current?.dispose();
      imageRef.current = null;
      retainedImagesRef.current.forEach(retainedImage => {
        retainedImage.dispose();
      });
      retainedImagesRef.current = [];
      doomAudio.close();
    };
  }, [image, updateDebugStatus, updateImage]);

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
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        doomAudio.suspend();
      }
    });

    return () => {
      subscription.remove();
    };
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
        </Canvas>
      </View>

      {__DEV__ && <StatusText ref={statusTextRef} style={statusTextStyle} />}

      <ControlSchemeToggle
        scheme={controlScheme}
        onChange={setControlScheme}
        overlay={isLandscape}
        style={schemeToggleStyle}
      />

      {isBethesdaScheme && <LookTurnPad onPressKey={pressKey} />}

      <View
        pointerEvents="box-none"
        style={controlsStyle}>
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

type StatusTextProps = {
  style: StyleProp<TextStyle>;
};

const StatusText = memo(
  forwardRef<StatusTextHandle, StatusTextProps>(function StatusTextComponent(
    { style },
    ref,
  ) {
    const [status, setStatus] = useState('booting');

    useImperativeHandle(ref, () => ({ setStatus }), []);

    return (
      <Text accessibilityRole="text" style={style}>
        {status}
      </Text>
    );
  }),
);

type ControlSchemeToggleProps = {
  scheme: ControlScheme;
  onChange: (scheme: ControlScheme) => void;
  overlay: boolean;
  style: StyleProp<ViewStyle>;
};

const ControlSchemeToggle = memo(function ControlSchemeToggleComponent({
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
});

type ControlActionsProps = {
  onPressKey: PressKey;
  onTapKey: (key: string) => void;
  onCycleWeapon: (direction: 1 | -1) => void;
  overlay: boolean;
  compact?: boolean;
};

const LeftControls = memo(function LeftControlsComponent({
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
});

const CurrentActions = memo(function CurrentActionsComponent({
  onPressKey,
  onTapKey,
  onCycleWeapon,
  overlay,
}: ControlActionsProps) {
  const selectPreviousWeapon = useCallback(() => {
    onCycleWeapon(-1);
  }, [onCycleWeapon]);
  const selectNextWeapon = useCallback(() => {
    onCycleWeapon(1);
  }, [onCycleWeapon]);

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
        onTap={selectNextWeapon}
        overlay={overlay}
        accessibilityLabel="WEAPON NEXT"
      />
      <ControlButton
        label="W-"
        keyName="weapon-prev"
        onTap={selectPreviousWeapon}
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
});

const BethesdaActions = memo(function BethesdaActionsComponent({
  onPressKey,
  onTapKey,
  onCycleWeapon,
  overlay,
  compact = false,
}: ControlActionsProps) {
  const selectPreviousWeapon = useCallback(() => {
    onCycleWeapon(-1);
  }, [onCycleWeapon]);
  const selectNextWeapon = useCallback(() => {
    onCycleWeapon(1);
  }, [onCycleWeapon]);

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
          onTap={selectPreviousWeapon}
          overlay={overlay}
          size={compact ? 'tiny' : 'compact'}
          accessibilityLabel="WEAPON PREVIOUS"
        />
        <ControlButton
          label="W+"
          keyName="weapon-next"
          onTap={selectNextWeapon}
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
});

type TurnKey = 'left' | 'right';

const LookTurnPad = memo(function LookTurnPadComponent({
  onPressKey,
}: {
  onPressKey: PressKey;
}) {
  const pendingLookDelta = useSharedValue(0);
  const activeTurnKeyRef = useRef<TurnKey | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const activateTurnKey = useCallback(
    (nextKey: TurnKey) => {
      setTurnKey(nextKey);
      scheduleTurnRelease();
    },
    [scheduleTurnRelease, setTurnKey],
  );

  useEffect(() => releaseTurnKey, [releaseTurnKey]);

  const lookGesture = usePanGesture({
    minDistance: 0,
    shouldCancelWhenOutside: false,
    onBegin: () => {
      pendingLookDelta.value = 0;
      scheduleOnRN(releaseTurnKey);
    },
    onUpdate: event => {
      pendingLookDelta.value += event.changeX;

      if (Math.abs(pendingLookDelta.value) < LOOK_TURN_DELTA_THRESHOLD) {
        return;
      }

      scheduleOnRN(
        activateTurnKey,
        pendingLookDelta.value > 0 ? 'right' : 'left',
      );
      pendingLookDelta.value = 0;
    },
    onFinalize: () => {
      pendingLookDelta.value = 0;
      scheduleOnRN(releaseTurnKey);
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
});

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

const ControlButton = memo(function ControlButtonComponent({
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
});

type MovementKey = 'up' | 'down' | 'left' | 'right';
type StickInputKey = MovementKey | 'strafe-left' | 'strafe-right';
type StickHorizontalMode = 'turn' | 'strafe';

function getStickStateFromPoint(
  x: number,
  y: number,
  horizontalMode: StickHorizontalMode,
) {
  'worklet';

  const rawX = x - STICK_CENTER;
  const rawY = y - STICK_CENTER;
  const distance = Math.hypot(rawX, rawY);
  const scale =
    distance > STICK_MAX_OFFSET ? STICK_MAX_OFFSET / distance : 1;
  const nextX = rawX * scale;
  const nextY = rawY * scale;
  let verticalKey: StickInputKey | '' = '';
  let horizontalKey: StickInputKey | '' = '';

  if (nextY < -STICK_DEAD_ZONE) {
    verticalKey = 'up';
  } else if (nextY > STICK_DEAD_ZONE) {
    verticalKey = 'down';
  }

  if (nextX < -STICK_DEAD_ZONE) {
    horizontalKey = horizontalMode === 'strafe' ? 'strafe-left' : 'left';
  } else if (nextX > STICK_DEAD_ZONE) {
    horizontalKey = horizontalMode === 'strafe' ? 'strafe-right' : 'right';
  }

  const keySignature =
    verticalKey === ''
      ? horizontalKey
      : horizontalKey === ''
        ? verticalKey
        : `${verticalKey}${STICK_KEY_SEPARATOR}${horizontalKey}`;

  return { keySignature, x: nextX, y: nextY };
}

type VirtualStickProps = {
  onPressKey: PressKey;
  overlay?: boolean;
  horizontalMode?: StickHorizontalMode;
};

const VirtualStick = memo(function VirtualStickComponent({
  onPressKey,
  overlay = false,
  horizontalMode = 'turn',
}: VirtualStickProps) {
  const stickActive = useSharedValue(false);
  const stickKeySignature = useSharedValue('');
  const stickX = useSharedValue(0);
  const stickY = useSharedValue(0);
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

  const setMovementKeySignature = useCallback(
    (nextKeySignature: string) => {
      setMovementKeys(
        nextKeySignature === ''
          ? []
          : (nextKeySignature.split(STICK_KEY_SEPARATOR) as StickInputKey[]),
      );
    },
    [setMovementKeys],
  );

  const releaseStick = useCallback(() => {
    stickActive.value = false;
    stickKeySignature.value = '';
    stickX.value = 0;
    stickY.value = 0;
    setMovementKeys([]);
  }, [setMovementKeys, stickActive, stickKeySignature, stickX, stickY]);

  useEffect(() => releaseStick, [releaseStick]);

  const stickAnimatedStyle = useAnimatedStyle(
    () => ({
      borderColor: stickActive.value
        ? '#d34a38'
        : overlay
          ? 'rgba(245, 218, 167, 0.42)'
          : '#7e7061',
    }),
    [overlay],
  );

  const stickKnobAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: stickX.value },
      { translateY: stickY.value },
    ],
  }));

  const applyStickState = (x: number, y: number) => {
    'worklet';

    const nextStickState = getStickStateFromPoint(x, y, horizontalMode);

    stickX.value = nextStickState.x;
    stickY.value = nextStickState.y;
    stickActive.value = nextStickState.keySignature !== '';

    if (stickKeySignature.value !== nextStickState.keySignature) {
      stickKeySignature.value = nextStickState.keySignature;
      scheduleOnRN(setMovementKeySignature, nextStickState.keySignature);
    }
  };

  const stickGesture = usePanGesture({
    minDistance: 0,
    shouldCancelWhenOutside: false,
    onBegin: event => {
      applyStickState(event.x, event.y);
    },
    onUpdate: event => {
      applyStickState(event.x, event.y);
    },
    onFinalize: () => {
      stickX.value = 0;
      stickY.value = 0;
      stickActive.value = false;

      if (stickKeySignature.value !== '') {
        stickKeySignature.value = '';
        scheduleOnRN(setMovementKeySignature, '');
      }
    },
  });

  return (
    <GestureDetector gesture={stickGesture}>
      <Animated.View
        accessibilityLabel="Movement stick"
        accessibilityRole="adjustable"
        collapsable={false}
        style={[
          styles.stick,
          overlay && styles.stickOverlay,
          stickAnimatedStyle,
        ]}>
        <View style={styles.stickNotchVertical} />
        <View style={styles.stickNotchHorizontal} />
        <View style={styles.stickInnerRing} />
        <Animated.View
          style={[
            styles.stickKnob,
            overlay && styles.stickKnobOverlay,
            stickKnobAnimatedStyle,
          ]}>
          <View style={styles.stickKnobCore} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

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
  schemeTogglePortrait: {
    right: 14,
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
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

const nowMs = () => Date.now();

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

  const pressKey = useCallback((key: string, pressed: boolean) => {
    doomEngine.queueKey(key, pressed);
  }, []);

  const tapKey = useCallback((key: string) => {
    doomEngine.queueKey(key, true);
    doomEngine.queueKey(key, false);
  }, []);

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

      <View
        style={[
          styles.controls,
          isLandscape
            ? {
                bottom: Math.max(insets.bottom + 12, 12),
                left: Math.max(insets.left + 14, 14),
                right: Math.max(insets.right + 14, 14),
              }
            : { top: controlsTop + 26 },
          isLandscape && styles.controlsLandscape,
        ]}>
        <VirtualStick onPressKey={pressKey} overlay={isLandscape} />

        <View style={styles.actions}>
          <ControlButton
            label="FIRE"
            keyName="fire"
            onPressKey={pressKey}
            overlay={isLandscape}
            variant="primary"
          />
          <ControlButton
            label="USE"
            keyName="use"
            onPressKey={pressKey}
            overlay={isLandscape}
          />
          <ControlButton
            label="OK"
            keyName="enter"
            onTapKey={tapKey}
            overlay={isLandscape}
          />
          <ControlButton
            label="MENU"
            keyName="escape"
            onPressKey={pressKey}
            overlay={isLandscape}
          />
        </View>
      </View>
    </View>
  );
}

type ControlButtonProps = {
  label: string;
  keyName: string;
  onPressKey?: (key: string, pressed: boolean) => void;
  onTapKey?: (key: string) => void;
  overlay?: boolean;
  variant?: 'primary' | 'secondary';
};

function ControlButton({
  label,
  keyName,
  onPressKey,
  onTapKey,
  overlay = false,
  variant = 'secondary',
}: ControlButtonProps) {
  const handlePressIn = useCallback(() => {
    onPressKey?.(keyName, true);
  }, [keyName, onPressKey]);

  const handlePressOut = useCallback(() => {
    onPressKey?.(keyName, false);
  }, [keyName, onPressKey]);

  const handlePress = useCallback(() => {
    onTapKey?.(keyName);
  }, [keyName, onTapKey]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [
        styles.controlButton,
        variant === 'primary' && styles.controlButtonPrimary,
        overlay && styles.controlButtonOverlay,
        pressed && styles.controlButtonPressed,
      ]}>
      <Text
        style={[
          styles.controlLabel,
          variant === 'primary' && styles.controlLabelPrimary,
          overlay && styles.controlLabelOverlay,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

type MovementKey = 'up' | 'down' | 'left' | 'right';

type VirtualStickProps = {
  onPressKey: (key: string, pressed: boolean) => void;
  overlay?: boolean;
};

function VirtualStick({ onPressKey, overlay = false }: VirtualStickProps) {
  const [stickOffset, setStickOffset] = useState({
    active: false,
    x: 0,
    y: 0,
  });
  const activeKeysRef = useRef<Set<MovementKey>>(new Set());

  const setMovementKeys = useCallback(
    (nextKeys: MovementKey[]) => {
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
      const nextKeys: MovementKey[] = [];

      if (nextY < -STICK_DEAD_ZONE) {
        nextKeys.push('up');
      } else if (nextY > STICK_DEAD_ZONE) {
        nextKeys.push('down');
      }

      if (nextX < -STICK_DEAD_ZONE) {
        nextKeys.push('left');
      } else if (nextX > STICK_DEAD_ZONE) {
        nextKeys.push('right');
      }

      setStickOffset({
        active: nextKeys.length > 0,
        x: nextX,
        y: nextY,
      });
      setMovementKeys(nextKeys);
    },
    [setMovementKeys],
  );

  const releaseStick = useCallback(() => {
    setStickOffset({ active: false, x: 0, y: 0 });
    setMovementKeys([]);
  }, [setMovementKeys]);

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
  },
  controlsLandscape: {
    alignItems: 'flex-end',
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
    gap: 8,
  },
  controlButton: {
    width: 72,
    height: 54,
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
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
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

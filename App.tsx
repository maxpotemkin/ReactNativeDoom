import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView, Pressable } from 'react-native-gesture-handler';
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

const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 200;
const FRAME_BYTES_PER_ROW = FRAME_WIDTH * 4;
const TARGET_RENDER_FPS = 60;
const FRAME_INTERVAL_MS = 1000 / TARGET_RENDER_FPS;
const STATUS_INTERVAL_MS = 500;

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

  const updateImage = useCallback((frame: ArrayBuffer) => {
    const bytes = new Uint8Array(frame);
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
          const frame = doomEngine.tickAndGetFrame();
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
              )} render ${renderCount} ${Math.round(measuredFps)}fps`,
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
        <View style={styles.dpad}>
          <ControlButton
            label="UP"
            keyName="up"
            onPressKey={pressKey}
            overlay={isLandscape}
          />
          <View style={styles.dpadRow}>
            <ControlButton
              label="LT"
              keyName="left"
              onPressKey={pressKey}
              overlay={isLandscape}
            />
            <ControlButton
              label="RT"
              keyName="right"
              onPressKey={pressKey}
              overlay={isLandscape}
            />
          </View>
          <ControlButton
            label="DN"
            keyName="down"
            onPressKey={pressKey}
            overlay={isLandscape}
          />
        </View>

        <View style={styles.actions}>
          <ControlButton
            label="FIRE"
            keyName="fire"
            onPressKey={pressKey}
            overlay={isLandscape}
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
};

function ControlButton({
  label,
  keyName,
  onPressKey,
  onTapKey,
  overlay = false,
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
        overlay && styles.controlButtonOverlay,
        pressed && styles.controlButtonPressed,
      ]}>
      <Text style={[styles.controlLabel, overlay && styles.controlLabelOverlay]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screen: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#080909',
  },
  screenLandscape: {
    alignItems: 'stretch',
    backgroundColor: '#000',
  },
  canvasFrame: {
    backgroundColor: '#000',
    borderColor: '#3d4542',
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
    color: '#b7c4bd',
    fontFamily: 'Menlo',
    fontSize: 12,
  },
  statusLandscape: {
    color: '#e0e7df',
    fontSize: 11,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  controls: {
    position: 'absolute',
    left: 18,
    right: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  controlsLandscape: {
    alignItems: 'flex-end',
  },
  dpad: {
    width: 156,
    alignItems: 'center',
    gap: 8,
  },
  dpadRow: {
    width: 156,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actions: {
    width: 176,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
  },
  controlButton: {
    width: 70,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#56635d',
    borderWidth: 1,
    backgroundColor: '#151918',
  },
  controlButtonPressed: {
    backgroundColor: '#38443d',
  },
  controlButtonOverlay: {
    backgroundColor: 'rgba(8, 10, 10, 0.48)',
    borderColor: 'rgba(220, 235, 220, 0.38)',
  },
  controlLabel: {
    color: '#f3f4e7',
    fontFamily: 'Menlo',
    fontSize: 13,
    fontWeight: '700',
  },
  controlLabelOverlay: {
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

export default App;

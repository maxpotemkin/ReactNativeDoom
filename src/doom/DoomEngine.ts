import { NitroModules, type HybridObject } from 'react-native-nitro-modules';

export interface DoomEngine extends HybridObject<{ ios: 'c++' }> {
  readonly defaultIWadPath: string;
  readonly loadedIWadPath: string;
  readonly lastStatus: string;
  readonly windowTitle: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly isStarted: boolean;

  start(iwadPath: string): string;
  tick(): boolean;
  tickAndGetFrame(): ArrayBuffer;
  tickAndGetFrameAudio(): ArrayBuffer;
  openMenu(): void;
  queueKey(key: string, pressed: boolean): void;
  getFrame(): ArrayBuffer;
}

export const doomEngine =
  NitroModules.createHybridObject<DoomEngine>('DoomEngine');

import { NitroModules, type HybridObject } from 'react-native-nitro-modules';

export interface DoomEngine extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  readonly defaultIWadPath: string;
  readonly windowTitle: string;
  readonly frameCount: number;

  start(iwadPath: string): string;
  tickAndGetFrameAudio(): ArrayBuffer;
  openMenu(): void;
  queueKey(key: string, pressed: boolean): void;
}

export const doomEngine =
  NitroModules.createHybridObject<DoomEngine>('DoomEngine');

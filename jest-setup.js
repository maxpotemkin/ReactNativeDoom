/* eslint-env jest */

jest.mock('react-native-worklets', () =>
  require('react-native-worklets/lib/module/mock'),
);

jest.mock('react-native-audio-api', () =>
  require('react-native-audio-api/lib/commonjs/mock'),
);

jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    AlphaType: { Opaque: 'Opaque' },
    Canvas: ({ children, ...props }) => React.createElement(View, props, children),
    ColorType: { RGBA_8888: 'RGBA_8888' },
    FilterMode: { Nearest: 'Nearest' },
    Image: () => null,
    MipmapMode: { None: 'None' },
    Skia: {
      Data: {
        fromBytes: bytes => bytes,
      },
      Image: {
        MakeImage: () => ({
          dispose: jest.fn(),
        }),
      },
    },
  };
});

jest.mock('./src/doom/DoomEngine', () => {
  const frame = new ArrayBuffer(320 * 200 * 4);

  return {
    doomEngine: {
      defaultIWadPath: 'mock/DOOM1.WAD',
      height: 400,
      isStarted: false,
      lastStatus: 'idle',
      loadedIWadPath: '',
      width: 640,
      windowTitle: 'DOOM Shareware',
      frameCount: 1,
      getFrame: jest.fn(() => frame),
      openMenu: jest.fn(),
      queueKey: jest.fn(),
      start: jest.fn(iwadPath => `loaded IWAD: ${iwadPath}`),
      tick: jest.fn(() => true),
      tickAndGetFrame: jest.fn(() => frame),
      tickAndGetFrameAudio: jest.fn(() => frame),
    },
  };
});

require('react-native-reanimated').setUpTests();

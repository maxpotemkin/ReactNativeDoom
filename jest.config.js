module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-gesture-handler|react-native-reanimated|react-native-worklets)/)',
  ],
  setupFiles: [
    './node_modules/@react-native/jest-preset/jest/setup.js',
    'react-native-gesture-handler/jestSetup.js',
  ],
  setupFilesAfterEnv: ['./jest-setup.js'],
};

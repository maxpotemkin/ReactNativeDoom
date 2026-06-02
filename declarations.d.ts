import type * as React from 'react';
import type { PressableProps } from 'react-native-gesture-handler/lib/typescript/components/Pressable';

declare module '*.wad' {
  const asset: number;
  export default asset;
}

declare module 'react-native-gesture-handler' {
  export const Pressable: (props: PressableProps) => React.JSX.Element;
}

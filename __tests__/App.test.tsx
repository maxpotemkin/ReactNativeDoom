/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { doomEngine } from '../src/doom/DoomEngine';

function countText(root: ReactTestRenderer.ReactTestInstance, text: string) {
  return root.findAll(
    node => node.type === Text && node.props.children === text,
  ).length;
}

function pressByText(root: ReactTestRenderer.ReactTestInstance, text: string) {
  const textNode = root.findAll(
    node => node.type === Text && node.props.children === text,
  )[0];
  let current: ReactTestRenderer.ReactTestInstance | null = textNode;

  while (current != null) {
    if (typeof current.props.onPress === 'function') {
      current.props.onPress();
      return;
    }

    current = current.parent;
  }

  throw new Error(`Unable to find pressable parent for ${text}`);
}

function findPressableParentsByText(
  root: ReactTestRenderer.ReactTestInstance,
  text: string,
) {
  return root
    .findAll(node => node.type === Text && node.props.children === text)
    .map(textNode => {
      let current: ReactTestRenderer.ReactTestInstance | null = textNode;

      while (current != null) {
        if (typeof current.props.onPressIn === 'function') {
          return current;
        }

        current = current.parent;
      }

      throw new Error(`Unable to find pressable parent for ${text}`);
    });
}

test('renders correctly', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(() => {
    renderer!.unmount();
  });
});

test('keeps fire held until both Bethesda fire buttons are released', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(() => {
    pressByText(renderer!.root, 'BETH');
  });

  const fireButtons = findPressableParentsByText(renderer!.root, 'FIRE');
  expect(fireButtons).toHaveLength(2);

  const queueKeyMock = doomEngine.queueKey as jest.Mock;
  queueKeyMock.mockClear();

  await ReactTestRenderer.act(() => {
    fireButtons[0].props.onPressIn();
  });
  await ReactTestRenderer.act(() => {
    fireButtons[1].props.onPressIn();
  });
  await ReactTestRenderer.act(() => {
    fireButtons[0].props.onPressOut();
  });

  expect(
    queueKeyMock.mock.calls.filter(([key]) => key === 'fire'),
  ).toEqual([['fire', true]]);

  await ReactTestRenderer.act(() => {
    fireButtons[1].props.onPressOut();
  });

  expect(
    queueKeyMock.mock.calls.filter(([key]) => key === 'fire'),
  ).toEqual([
    ['fire', true],
    ['fire', false],
  ]);

  await ReactTestRenderer.act(() => {
    renderer!.unmount();
  });
});

test('switches control schemes on the fly', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(countText(renderer!.root, 'FIRE')).toBe(1);

  await ReactTestRenderer.act(() => {
    pressByText(renderer!.root, 'BETH');
  });

  expect(countText(renderer!.root, 'FIRE')).toBe(2);

  await ReactTestRenderer.act(() => {
    pressByText(renderer!.root, 'OURS');
  });

  expect(countText(renderer!.root, 'FIRE')).toBe(1);

  await ReactTestRenderer.act(() => {
    renderer!.unmount();
  });
});

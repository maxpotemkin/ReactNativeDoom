# Repository Guidelines

## Project Structure & Module Organization

This is a React Native Doom port. The main UI lives in `App.tsx`, with JS-facing Doom bridge code in `src/doom/`. Native iOS bridge code is in `cpp/doom_engine/` and is packaged by `ReactNativeDoomEngine.podspec`. Local Doom engine sources belong in ignored `third_party/doomgeneric/`, and local IWAD files belong in ignored `assets/doom/*.WAD`. Tests are in `__tests__/`, with Jest setup in `jest-setup.js`.

## Build, Test, and Development Commands

- `npm start` starts Metro on the default port.
- `npm run check:doom-files` verifies local engine and IWAD files before iOS setup.
- `npm run ios` builds and launches iOS debug on an available simulator.
- `npm run android` builds and launches Android.
- `bundle exec pod install` from `ios/` refreshes CocoaPods after native dependency or podspec changes.
- `npm run lint` runs the React Native ESLint config.
- `npm test -- --runInBand --no-watchman` runs Jest in local agent sessions.
- `npx tsc --noEmit` checks TypeScript types.

## Coding Style & Naming Conventions

Use TypeScript for JS/RN code and C++/Objective-C++ for Nitro/native bridge code. Follow Prettier: single quotes, trailing commas, and omitted arrow parens where valid. Prefer descriptive camelCase names in TS and concise C++ names that match nearby bridge code. Keep native packet formats and constants explicit.

## Testing Guidelines

Use Jest with React Test Renderer for component smoke tests. Add tests under `__tests__/` using `*.test.tsx` naming. For native or bridge changes, run `tsc`, `lint`, `jest`, `pod install` when needed, and an iOS simulator build. For runtime checks, verify frame rendering plus FPS or audio counters.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Add Doom engine bridge and fullscreen landscape UI`; `chore:` prefixes are acceptable for maintenance work. Keep commits scoped to one feature or fix. PRs should include a summary, validation commands, simulator/device used, and screenshots for UI changes.

## Licensing & OSS Readiness

The repository's original code is MIT-licensed via root `LICENSE`. Do not commit Doom engine source trees or IWAD game data; both are local-only files controlled by their own terms. Keep setup docs generic and avoid embedding download links or checksums for game data.

## Agent-Specific Instructions

Preserve untracked or unrelated user files. Do not reset local Doom files, pods, or generated files unless required. When touching iOS native dependencies, update `ios/Podfile.lock` with `pod install` and verify the simulator build.

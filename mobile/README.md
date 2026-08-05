# Curio Garden mobile

This workspace is the native iOS and Android sidecar for Curio Garden. The
production Next.js application remains at the repository root.

## Foundation commands

Run installation from the repository root so npm uses the single lockfile:

```sh
npm ci
npm run mobile:check
npm run mobile:doctor
```

Start Metro for the development client:

```sh
npm run mobile:start
```

Generate and run a clean native development project when native configuration
changes:

```sh
npm run mobile:ios
npm run mobile:android
```

The platform folders are Continuous Native Generation output and are ignored.
Do not make durable edits inside `mobile/ios` or `mobile/android`; express them
through `app.config.ts` or a config plugin.

Expo Go may be useful for an occasional JavaScript-only smoke check, but it is
not part of the compatibility throughline. Development-client and signed EAS
builds are the acceptance artifacts.

Fraunces, DM Sans, and JetBrains Mono are embedded with the `expo-font` config
plugin so they are available before the first native frame. A fresh development
or signed build is required after changing that font manifest; Expo Go and an
older installed client are not representative typography checks.

## Local Android SDK

Expo and React Native honor `ANDROID_HOME`. When Android Studio does not add its
tools to the shell, set it to the local SDK and add `platform-tools` and
`emulator` to `PATH`. The project targets API 36 and supports API 24 or newer.

## Build profiles

Run EAS commands from this directory. Profiles are `development`, `preview`,
`e2e-test`, and `production`; each sets `APP_VARIANT` so its display name,
identifier, and URL scheme cannot silently cross environments.

```sh
cd mobile
npx --yes eas-cli@21.5.0 build --profile development --platform ios
npx --yes eas-cli@21.5.0 build --profile development --platform android
```

The documented EAS CLI command and the Doctor script use explicit tool
versions compatible with `eas.json`. EAS owns production build-number
increments remotely, so repeated TestFlight and Play uploads do not reuse an
already-published native build number.

Push notifications are intentionally disabled and not installed. Offline
downloads and offline article storage are outside the current implementation
scope.

## Accessibility verification

Native accessibility changes follow the
[physical-device test matrix](../docs/mobile-accessibility-test-matrix.md).
VoiceOver, TalkBack, maximum text and display sizes, orientation, appearance,
and reduced-motion results must be recorded against named hardware and a signed
build. Expo Go, Simulator, emulators, Jest, bundle checks, and accessibility
tree inspection are supplementary evidence only.

Reusable screens and controls follow the documented
[native accessibility conventions](../docs/native-accessibility-conventions.md),
including uncapped task text, 48-by-48 minimum targets, visible keyboard focus,
word-safe brand reflow, reduced-motion handling, and platform-appropriate status
announcements.

## Dependency note

Expo SDK 57's native configuration chain currently brings `xcode@3.0.1` and
`uuid@7.0.3`, which npm audit reports for
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), a
moderate buffer-bounds advisory in UUID v3/v5/v6 calls supplied with an output
buffer. The Xcode project library calls UUID v4 without an output buffer, so the
reported path is not exercised by Curio Garden and does not ship in the
application JavaScript bundle. Keep this visible until Expo's configuration
chain updates; do not apply a forced major downgrade of Expo to make the audit
output disappear.

The React 19.2.8 compatibility decision and required validation gates are
recorded in the [native sidecar ADR](../docs/architecture/0001-expo-native-sidecar.md).

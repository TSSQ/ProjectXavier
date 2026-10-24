# Expo SDK 54 → 58 upgrade (branch `claude/expo-sdk-58`)

Why: iPhone Duo. Apps built with the iOS 27.1 SDK are the only ones Apple calls
"optimized" (edge-to-edge inner display, vertical bars), and SDK 58 is the first
Expo release built for iOS 27: scene lifecycle by default, no `UIScreen.main` in
Expo modules, `expo-router/native-tabs` with `preferredPlacement="sidebar"`,
and `expo-hinge`. SDK 54 was never tested on Xcode 27. Background in
`docs/design/` is not needed to do this; the steps below are.

## Done in the cloud session (JS side, verified)

`npm run typecheck`, `npm run lint`, `npm test` (196 suites / 4283 tests) all
green on this branch.

- `npx expo install expo@^58 --fix`: expo 58.0.19, expo-router 58.0.26,
  React Native 0.88.0, React 19.3, reanimated 4.7.1, worklets 0.13,
  screens 4.30, safe-area-context 5.10, svg 15.16, keyboard-controller 1.22.7,
  datetimepicker 9.2.1, TypeScript 6.0.3, Jest 30, @types/react 19.3.
- Extra bumps: react-native-cloud-storage 3.3.0, @bacons/apple-targets 5.0.0.
- `@expo/vector-icons` added as an explicit dependency (SDK 56 stopped bundling
  it with `expo`; 43 files import it).
- `@expo/config-plugins@58.0.10` added as a devDependency ONLY because
  react-native-cloud-storage's config plugin still `require`s it by that name
  and npm no longer hoists it. `expo-doctor` flags this; its own text says it
  can be ignored when a plugin needs it. Remove once cloud-storage switches to
  `expo/config-plugins`.
- Code fixes for React Native 0.88's strict TypeScript API: component classes
  are no longer instance types, so refs use `TextInputInstance` /
  `ScrollViewInstance` (`app/(tabs)/index.tsx`, `src/components/ui/Input.tsx`,
  `src/components/ui/Composer.tsx`, `app/manage-payees.tsx`); FlatList's
  `ListHeaderComponent`/`ListEmptyComponent` take `undefined`, not `null`
  (`src/components/ui/Combobox.tsx`); `AppState.currentState` is now
  `string | null | undefined` (`app/_layout.tsx`).
- expo-file-system 58: `FileHandle.readBytes`/`writeBytes` are async; the
  corrections log uses the `*Sync` variants (`src/features/diagnostics/corrections.ts`).
- `app/(tabs)/_layout.tsx`: `expo-router/native-tabs` (stable path), with
  `NativeTabs.Trigger.Icon` / `NativeTabs.Trigger.Label`.
- `app.config.ts`: `newArchEnabled` removed (gone from the schema since SDK 55;
  the New Architecture is the only one).
- `tsconfig.json`: `baseUrl` dropped (deprecated in TS 6), `paths` made
  relative, and `"types": ["node", "jest"]` added because TS 6 no longer
  auto-includes `@types/*`.
- The `@react-native-ai/apple` 0.12.0 patch (`patches/`) still applies cleanly.

## To do on the Mac (native side) — this is the hand-off

Requirements: Xcode 27.1 release (not the 27.0 betas we used), Node ≥ 22.13.

1. `git fetch origin claude/expo-sdk-58 && git checkout claude/expo-sdk-58 && npm ci`
2. Regenerate the native project. `ios/` is gitignored and hand-maintained, so
   back up `ios/` first (the manual-signing state and anything not covered by
   `scripts/apply-beta-config.mjs` lives only there), then
   `npx expo prebuild -p ios --clean`.
   - SDK 58 generates `SceneDelegate.swift` and the `UIApplicationSceneManifest`
     itself. Do NOT re-apply `docs/native/ios-uiscene-adoption.md`; that hand-
     rolled delegate is superseded. In particular drop the manual
     `RCTLinkingManager` calls, or deep links (`projectxavier://?scan=1` from
     the widget) arrive twice.
   - Re-run `node scripts/apply-beta-config.mjs` for the two-target manual
     signing, and confirm the `useSQLCipher` pod flags and the
     `@bacons/apple-targets` widget target came through prebuild.
3. `npx pod-install`. Watch for: `@react-native-ai/apple` 0.12.0 compiling
   against RN 0.88 + the iOS 27.1 SDK (highest-risk pod, no newer release
   exists), `react-native-cloud-storage` 3.3.0 codegen, SQLCipher.
4. Build and run on the simulator (`npx expo run:ios`, Device Hub opens).
   Smoke test, in this order:
   - Cold start → Face ID gate (toggle it on in Settings first) → unlock.
   - Assistant: type "coffee 6.50 at toast box" → on-device parse (Apple FM)
     → draft card → confirm. This exercises the patched Swift module.
   - Scan a receipt from the photo library (OCR module).
   - Dashboard carousel swipes; Transactions search; a sheet (period picker).
   - Backups: write an iCloud backup and restore it (cloud-storage 3.3.0).
   - Widget: add the small widget, tap it → deep link opens the Assistant ONCE.
   - Kill and relaunch with the app locked: the lock cover must appear before
     any financial data.
5. iPhone Duo simulator (Xcode 27.1 → Device Hub → iPhone Duo): open/close the
   device on each tab, rotate while open, Split View. Just note what breaks;
   fixes belong to the Duo layout branches, not this one.
6. If the simulator pass is clean, `npm run typecheck && npm run lint && npm test`
   on the Mac too, commit any `ios/`-derived changes that belong in git (there
   should be none), push, and open the PR into `main`. Then a TestFlight build
   via `/build` is the first one stamped with the iOS 27.1 SDK.

## Known follow-ups (not blockers)

- NativeWind is 4.1.23 (4.2.7 is the latest v4; v5 is still an RC). It has no
  RN peer range, so it is unverified on RN 0.88 by its authors. If className
  styles stop applying, try 4.2.7 before anything else.
- `expo-router` 58 is a navigation-core rewrite. We import nothing from
  `@react-navigation/*` and use no `initialRouteName`/`navigationKey`, so no
  code changed, but verify back-navigation from Account → Transactions and the
  Protected-route gate behave the same.
- Hermes V1 is the default engine from SDK 56. Watch memory in the parse path
  (the SDK 56 regression was fixed in RN 0.86.2, which 0.88 includes).

## Mac-side results (2026-10-24, Xcode 27.1 27A9275, iOS 27.1 SDK)

Steps 1–3 done as written, with one fix: `scripts/apply-beta-config.mjs`
had the widget target's pbxproj ids hard-coded, and `@bacons/apple-targets`
5.0.0 mints different ones, so the script threw "Release config … not found".
It now looks the widget's configuration list up by target name. The app and
project ids are fixed by Expo's template and still match. After the script:
Beta on all three configuration lists, `com.projectxavier.beta(.widget)`,
`ProjectXavierBeta` scheme, Podfile `'Beta' => :release`. Prebuild carried
`expo.sqlite.useSQLCipher` and the widget target through, and generated
`SceneDelegate` as Expo's own `ExpoAppSceneDelegate` (no `RCTLinkingManager`).
`pod-install`: 128 pods, AppleLLM (patched) and cloud-storage 3.3.0 codegen
compiled clean.

Not covered by the script: Release's manual distribution signing lived only
in the old `ios/` (backup: `~/Documents/ProjectXavier/ios-backups/`). Redo it
before the first TestFlight build.

Smoke test (iPhone 17 Pro simulator, iOS 27.0 runtime, since the 27.1
runtime only supports iPhone Duo; the app is built with the 27.1 SDK):

| Step | Result |
|---|---|
| Face ID gate | Pass: lock cover on cold start and on return from background |
| On-device parse | Pass: "coffee 6.50 at toast box" → ON-DEVICE draft → saved |
| Receipt scan | Pass: picker → OCR → amount from the TOTAL line |
| Dashboard / search / sheet | Pass |
| iCloud backup round-trip | Not run: the simulator has no Apple ID; module reports "iCloud not available" correctly. Needs a device |
| Widget deep link | Pass, once, warm and cold (via the widget's URL; extension embedded and registered) |
| Lock cover on relaunch | Pass: no financial data before unlock |

iPhone Duo (Device Hub, iOS 27.1): the cover screen renders (closed); with the
device Partially Open or Open, the inner display stays black even on the iOS
home screen, so open/close, rotation and Split View could not be judged on
this Mac. Retry on another Mac or a device.

Seen, not caused by this upgrade (same on SDK 54 main):
- After sending, the composer re-fills with the keyboard's autocorrected text
  ("Coffee 6.50 at Toast Box"), and again after the field loses focus.
- A fresh install has no categories, so the on-device model files expenses
  under a new category literally named "expense".
- The receipt bubble says "Spent SGD 5.80" while the card shows the TOTAL-line
  10.68.

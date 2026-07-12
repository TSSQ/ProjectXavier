import { ExpoConfig } from 'expo/config';

/**
 * Expo app config. iOS-first; Android/web targets are kept ready so the same
 * codebase extends later (per the architecture plan).
 */
const config: ExpoConfig = {
  name: 'ProjectXavier',
  slug: 'projectxavier',
  scheme: 'projectxavier',
  version: '0.1.0',
  // Xavier's face (blue->violet gradient + two eyes), 1024x1024 opaque PNG.
  // Expo generates the iOS AppIcon set from this on prebuild.
  icon: './assets/icon.png',
  orientation: 'portrait',
  // 'automatic' lets the OS/JS layer (NativeWind colorScheme) drive
  // light/dark — Stage 2b's Appearance switch needs this; 'dark' hard-locks
  // UIUserInterfaceStyle in the native Info.plist and silently defeats any
  // runtime Appearance.setColorScheme() call.
  userInterfaceStyle: 'automatic',
  // Locks the native window background to the app's dark bg (#0E1116) so the
  // keyboard/transition animations never flash white behind the React tree.
  // NOTE: static — doesn't react to the in-app theme switch (native-level,
  // out of scope for this JS-only stage); a light-mode user may see a brief
  // dark flash during keyboard/transition animations. Tracked as a follow-up.
  backgroundColor: '#0E1116',
  newArchEnabled: true,
  // Keeps OTA updates compatible across dev/preview/production builds that
  // share the same app version.
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: 'com.projectxavier.app',
    // TestFlight rejects duplicate build numbers; bump per upload.
    buildNumber: '30',
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // onScan (assistant receipt scanning) needs the camera; the OCR debug
      // screen (app/debug-ocr.tsx) needs the photo library, since the camera
      // can't run on the simulator. Declared explicitly here rather than
      // relying on expo-image-picker's own config plugin (not registered in
      // `plugins` below), so a fresh `expo prebuild` can't silently drop them.
      NSCameraUsageDescription: 'ProjectXavier needs camera access to scan receipts.',
      NSPhotoLibraryUsageDescription: 'ProjectXavier needs photo library access to pick a receipt image.',
    },
    // Shared container for the home/lock-screen widget (targets/widget):
    // src/features/widget/summary.ts writes widget-summary.json here, the
    // widget reads it — the app group is the only thing they share.
    entitlements: {
      'com.apple.security.application-groups': ['group.com.projectxavier.app'],
    },
  },
  android: {
    package: 'com.projectxavier.app',
  },
  web: {
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-local-authentication',
    'expo-sqlite',
    '@react-native-community/datetimepicker',
    // Pin Kotlin to 1.9.25 — the Compose Compiler 1.5.15 used by SDK 52's
    // expo-modules-core requires it; the 1.9.24 default fails the Android build.
    // iOS deploymentTarget bumped to 26.0 for the Apple Foundation Models spike
    // (@react-native-ai/apple requires iOS 26 for on-device LLM inference).
    [
      'expo-build-properties',
      {
        android: { kotlinVersion: '1.9.25' },
        ios: { deploymentTarget: '26.0' },
      },
    ],
    // iCloud backup storage — requires an EAS/dev-client rebuild (not Expo Go).
    // The plugin adds NSUbiquitousContainers + the com.apple.developer.icloud-*
    // entitlements (container-identifiers, services=CloudDocuments, environment,
    // ubiquity-container) to the iOS build.
    // On RN 0.81 (Expo SDK 54) react-native-cloud-storage 3.x's TurboModule
    // codegen (CloudStorageSpec) builds cleanly, so this is no longer pinned
    // to the old-arch 2.3.0 release that RN 0.76's codegen required.
    [
      'react-native-cloud-storage',
      {
        iCloudContainerIdentifier: 'iCloud.com.projectxavier.app',
      },
    ],
    // Generates + links the XavierWidget target from targets/widget (widget
    // source lives outside ios/, so it survives `expo prebuild --clean`).
    '@bacons/apple-targets',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "249ec39a-e616-44a4-bca6-6f381d7e80a8"
    }
  }
};



export default config;

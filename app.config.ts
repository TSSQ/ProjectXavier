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
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  // Keeps OTA updates compatible across dev/preview/production builds that
  // share the same app version.
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    bundleIdentifier: 'com.projectxavier.app',
    supportsTablet: true,
    // Sign in with Apple is configured via the apple-authentication plugin.
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
    // Pin Kotlin to 1.9.25 — the Compose Compiler 1.5.15 used by SDK 52's
    // expo-modules-core requires it; the 1.9.24 default fails the Android build.
    ['expo-build-properties', { android: { kotlinVersion: '1.9.25' } }],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;

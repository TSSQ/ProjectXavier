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

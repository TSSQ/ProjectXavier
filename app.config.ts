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
};

export default config;

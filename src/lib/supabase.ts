/**
 * Supabase client (app runtime).
 *
 * The auth session (access + refresh tokens) is persisted in the device
 * Keychain via expo-secure-store — never plain AsyncStorage, never the bundle —
 * matching the security posture in docs/SECURITY.md. Token auto-refresh is tied
 * to app foreground/background so sessions stay valid without leaking work while
 * backgrounded.
 *
 * Configure with EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see
 * .env.example). The publishable key is RLS-protected and safe to ship in the client.
 */
import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const KEYCHAIN: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key, KEYCHAIN),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value, KEYCHAIN),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key, KEYCHAIN),
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !anonKey) {
  // Don't crash at import — let the sign-in screen surface a clear message.
  console.warn(
    'Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env'
  );
}

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
  {
    auth: {
      storage: SecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

// Refresh tokens only while the app is foregrounded.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

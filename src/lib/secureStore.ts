/**
 * Secure storage + biometric app-lock helpers (app runtime).
 *
 * - Session tokens and the E2E encryption key live in the device keychain via
 *   expo-secure-store (never in plain AsyncStorage, never in the JS bundle).
 * - The app can require Face ID / Touch ID before unlocking.
 */
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, KEYCHAIN_OPTIONS);
}

export async function getSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, KEYCHAIN_OPTIONS);
}

export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, KEYCHAIN_OPTIONS);
}

const SESSION_MARKER_KEY = 'session_active';

/** Mark that this device has authenticated before — persisted in the
 *  Keychain so an offline cold start (expired token, no network to refresh)
 *  can still be granted access after biometric unlock. See authGate.ts. */
export const markAuthed = () => setSecret(SESSION_MARKER_KEY, '1');

/** Whether this device has authenticated before (offline-grace check). */
export const hasAuthedBefore = async (): Promise<boolean> =>
  (await getSecret(SESSION_MARKER_KEY)) != null;

/** Clear the marker — only on an explicit sign-out (or server-rejected session). */
export const clearAuthed = () => deleteSecret(SESSION_MARKER_KEY);

/** Prompt for biometric (or device passcode) unlock. Returns success. */
export async function requireBiometricUnlock(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) return true; // fall back to app-level auth
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock ProjectXavier',
    fallbackLabel: 'Use passcode',
  });
  return result.success;
}

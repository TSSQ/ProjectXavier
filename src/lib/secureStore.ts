/**
 * Secure storage + biometric app-lock helpers (app runtime).
 *
 * - Generic secret get/set/delete, backed by the device Keychain via
 *   expo-secure-store (never plain AsyncStorage, never the JS bundle).
 * - The app can require Face ID / Touch ID before unlocking — the only gate
 *   in front of financial data now that there's no sign-in.
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

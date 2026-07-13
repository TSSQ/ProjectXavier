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

/** Prompt for biometric (or device passcode) unlock. Returns success.
 *
 * The `!hasHardware || !enrolled → return true` branch is an intentional
 * anti-lockout valve for the UNLOCK path only: if the lock is already ON but
 * biometrics later become unavailable (e.g. the user removed Face ID), this
 * is what stops a permanent lockout. It must NEVER be reused to decide
 * whether the lock may be turned ON in the first place — see
 * `authenticateToEnableLock` below, which requires a real successful auth. */
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

export type EnableAuthResult = 'unavailable' | 'failed' | 'success';

/** Verification for turning the Settings biometric-lock toggle ON. Unlike
 * `requireBiometricUnlock`, a device with no biometric hardware/enrolment
 * does NOT fall through to a silent pass — it reports `'unavailable'` so the
 * caller can refuse to enable the lock (and tell the user why), rather than
 * persisting a lock that would never actually gate the app. */
export async function authenticateToEnableLock(): Promise<EnableAuthResult> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !enrolled) return 'unavailable';
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Enable Face ID lock',
    fallbackLabel: 'Use passcode',
  });
  return result.success ? 'success' : 'failed';
}

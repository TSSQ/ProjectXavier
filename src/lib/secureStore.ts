/**
 * Secure storage + biometric app-lock helpers (app runtime).
 *
 * - Generic secret get/set/delete, backed by the device Keychain via
 *   expo-secure-store (never plain AsyncStorage, never the JS bundle). Used
 *   ONLY by src/features/ai/byokKey.ts (the BYOK API key) — grep-confirmed —
 *   so this does not affect the DB encryption key or the biometric lock.
 * - The app can require Face ID / Touch ID before unlocking — the only gate
 *   in front of financial data now that there's no sign-in.
 *
 * `keychainAccessible: AFTER_FIRST_UNLOCK` (docs/design/byok-keychain-persist-
 * spec.md): this used to be `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, which was
 * confirmed on a real device to silently fail to persist the BYOK key (every
 * real parse then fell back to on-device/heuristic). `AFTER_FIRST_UNLOCK`
 * matches src/db/encryptionKey.ts's SQLCipher key config, which is proven to
 * persist on the same device — readable once the device has been unlocked at
 * least once since boot. The BYOK key never touches the DB, the settings
 * table, or the JS bundle; it lives only in the Keychain. Note `AFTER_FIRST_
 * UNLOCK` (unlike the old `..._THIS_DEVICE_ONLY`) makes the Keychain item
 * eligible for the user's own encrypted device backup — the SAME posture as
 * the SQLCipher DB key (a more sensitive secret), and acceptable here since
 * this is the user's own API credential.
 */
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
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

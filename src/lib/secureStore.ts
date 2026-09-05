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
// The decisions live in src/domain (pure, Node-testable); this module only
// supplies them with what the native APIs report.
import { LockAuthOutcome, unlockGrants } from '../domain/biometricLock';

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

/**
 * Prompt for biometric (or device passcode) unlock. Returns success.
 *
 * This used to short-circuit to `true` — opening the app with NO
 * authentication — whenever `hasHardwareAsync`/`isEnrolledAsync` were false,
 * as an anti-lockout valve. The concern was real but solved far too broadly:
 * reproduced on iOS 26.5 by simply un-enrolling Face ID, and reachable in the
 * wild by declining the permission prompt, removing a face, or restoring to a
 * new device. In all of those the lock silently stopped gating while Settings
 * still showed it ON (guardrail #2).
 *
 * `authenticateAsync` already falls back to the DEVICE PASSCODE — expo uses
 * the `deviceOwnerAuthentication` policy unless `disableDeviceFallback` is
 * set — and a passcode works when biometrics don't. So "biometrics unusable"
 * was never a lockout, and we can simply ask. `unlockGrants` keeps the valve
 * open for the one genuine dead end (no passcode set at all).
 */
export async function requireBiometricUnlock(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock ProjectXavier',
    fallbackLabel: 'Use passcode',
  });
  return unlockGrants(result);
}

export type EnableAuthResult = LockAuthOutcome & string;

/**
 * Verification for turning the Settings biometric-lock toggle ON. Unlike
 * `requireBiometricUnlock`, an unusable biometric never falls through to a
 * silent pass — the caller refuses to enable a lock that could not gate the
 * app, and tells the user which of the three reasons applies.
 *
 * Distinguishing them needs no extra API surface; the values were always
 * there. Measured on iOS 26.5 (expo-local-authentication 17.0.8):
 *
 *   not enrolled    hasHardware TRUE,  enrolled false  (biometryNotEnrolled)
 *   no permission   hasHardware FALSE, enrolled false  (biometryNotAvailable)
 *   no hardware     hasHardware FALSE, enrolled false, and no supported types
 *
 * `supportedAuthenticationTypesAsync` is what separates the last two: it
 * reads `LAContext.biometryType`, which still reports the hardware even when
 * the policy evaluation fails — verified on-device, since that is the whole
 * basis for calling one of them "permission" and the other "hardware".
 */
export async function authenticateToEnableLock(): Promise<EnableAuthResult> {
  const [hasHardware, enrolled, supportedTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  if (!hasHardware || !enrolled) {
    if (supportedTypes.length === 0) return 'no_hardware';
    // Hardware exists but the policy check refused it outright — the app
    // isn't allowed to use it. Ordered before the enrolment case because
    // permission denial reports hasHardware false, enrolment does not.
    if (!hasHardware) return 'no_permission';
    return 'not_enrolled';
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Enable Face ID lock',
    fallbackLabel: 'Use passcode',
  });
  if (result.success) return 'success';
  // A first-run denial of the iOS permission prompt surfaces here, not in the
  // pre-checks above — those still read "available" until the refusal is
  // recorded. Classifying it by error code is what stops the very bug this
  // change exists to fix from simply moving one branch down.
  if (result.error === 'not_available') return 'no_permission';
  if (result.error === 'not_enrolled') return 'not_enrolled';
  return 'failed';
}

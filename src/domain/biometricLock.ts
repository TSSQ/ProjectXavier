/**
 * Pure resolution of the biometric-lock setting's stored string value into a
 * boolean. No React Native / Expo / DB imports — Node-testable.
 *
 * Opt-in: unset (`null`, no row written yet) resolves to `false` — a fresh
 * install never gates on Face ID until the user turns it on in Settings, and
 * turning it on is itself gated on a successful biometric check (see
 * app/(tabs)/settings.tsx). Existing rows are unaffected either way: `'1'`
 * stays on, `'0'` stays off.
 */
export function resolveBiometricLock(stored: string | null): boolean {
  return stored == null ? false : stored === '1';
}

/**
 * Outcome of the enable-path auth check (see `authenticateToEnableLock` in
 * src/lib/secureStore.ts). `null` is used for the turning-OFF case, where no
 * auth is attempted at all.
 *
 * These used to be a single `'unavailable'`, which produced a reported bug:
 * a user who declined the one-time iOS Face ID permission prompt was told
 * "Face ID isn't set up on this device". Face ID *was* set up — the app just
 * wasn't allowed to use it — so the message sent them to the one place in
 * Settings that showed nothing wrong. Measured on iOS 26.5, the three states
 * were always distinguishable:
 *
 *   not enrolled      canEvaluatePolicy -> biometryNotEnrolled(-7)
 *                     hasHardwareAsync TRUE, isEnrolledAsync false
 *   no permission     canEvaluatePolicy -> biometryNotAvailable(-6)
 *                     hasHardwareAsync FALSE, but biometryType still reports
 *                     the hardware (faceID)
 *   no hardware       as above, and biometryType reports none
 */
export type LockAuthOutcome =
  | 'success'
  | 'failed'
  | 'no_permission'
  | 'not_enrolled'
  | 'no_hardware'
  | null;

export interface LockToggleDecision {
  /** Value to persist via `setBiometricLock`, or `null` to persist nothing
   * (an enable attempt that didn't succeed must never write to the DB). */
  persist: boolean | null;
  /** Value the Settings switch should visually show afterwards. */
  uiOn: boolean;
  /** Inline note to show the user, or `null` to clear/hide it. */
  note: string | null;
  /** Whether the note is actionable in iOS Settings — true only when the
   * user can actually fix it there. Telling someone to open Settings when
   * their device has no biometric hardware is the same class of mistake this
   * whole change is fixing. */
  canOpenSettings: boolean;
}

const NOTE_FAILED = "Couldn't verify — Face ID not enabled";
const NOTE_NOT_ENROLLED =
  "Face ID isn't set up on this device — turn it on in iOS Settings first";
const NOTE_NO_PERMISSION =
  'ProjectXavier isn’t allowed to use Face ID — turn it on in iOS Settings › ProjectXavier';
const NOTE_NO_HARDWARE = "This device doesn't support Face ID or Touch ID";

/**
 * Pure decision for the Settings "Require Face ID on launch" toggle. No
 * React Native / Expo / DB imports — Node-testable.
 *
 * Turning the lock OFF never requires auth (the app is already unlocked, and
 * reducing protection needs no proof) and always persists immediately.
 * Turning it ON only ever persists — and only ever shows the toggle as ON —
 * when `auth` is `'success'`, i.e. a real biometric check just passed. Every
 * other outcome leaves the toggle OFF and persists nothing; they differ only
 * in what the user is told, and whether iOS Settings is where they can fix
 * it.
 */
export function decideLockToggle(
  requestedOn: boolean,
  auth: LockAuthOutcome
): LockToggleDecision {
  if (!requestedOn) {
    return { persist: false, uiOn: false, note: null, canOpenSettings: false };
  }
  if (auth === 'success') {
    return { persist: true, uiOn: true, note: null, canOpenSettings: false };
  }
  const refuse = (note: string, canOpenSettings: boolean): LockToggleDecision => ({
    persist: null,
    uiOn: false,
    note,
    canOpenSettings,
  });
  if (auth === 'no_permission') return refuse(NOTE_NO_PERMISSION, true);
  if (auth === 'not_enrolled') return refuse(NOTE_NOT_ENROLLED, true);
  if (auth === 'no_hardware') return refuse(NOTE_NO_HARDWARE, false);
  // auth === 'failed' (or, defensively, null on a requested-on with no auth
  // outcome supplied — should not happen from the caller, but fails closed).
  return refuse(NOTE_FAILED, false);
}

// ─── the unlock gate ────────────────────────────────────────────────────────

/** The shape `expo-local-authentication`'s `authenticateAsync` resolves to,
 *  narrowed to what the decision below reads. */
export interface UnlockAuthResult {
  success: boolean;
  error?: string | null;
}

/**
 * Whether an unlock attempt should let the user in.
 *
 * `requireBiometricUnlock` used to short-circuit to `true` — opening the app
 * with NO authentication — whenever biometrics were unusable for any reason,
 * while Settings still showed the lock as ON. Reproduced on iOS 26.5 by
 * simply un-enrolling Face ID, and reachable in the wild by declining the
 * permission prompt, removing a face, or restoring to a new device. That is
 * guardrail #2 failing silently: the user believes the app is locked.
 *
 * The anti-lockout concern behind it was real, but it was solved too
 * broadly. Authentication falls back to the DEVICE PASSCODE (expo uses
 * `deviceOwnerAuthentication` unless `disableDeviceFallback` is set), which
 * works even when biometrics don't — so "biometrics unusable" is not a
 * lockout. The only genuine dead end is a device with no passcode at all,
 * where there is nothing left to prove identity with; that, and only that,
 * keeps the valve open.
 */
export function unlockGrants(result: UnlockAuthResult): boolean {
  if (result.success) return true;
  return result.error === 'passcode_not_set';
}

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

/** Outcome of the enable-path auth check (see `authenticateToEnableLock` in
 * src/lib/secureStore.ts). `null` is used for the turning-OFF case, where no
 * auth is attempted at all. */
export type LockAuthOutcome = 'success' | 'failed' | 'unavailable' | null;

export interface LockToggleDecision {
  /** Value to persist via `setBiometricLock`, or `null` to persist nothing
   * (an enable attempt that didn't succeed must never write to the DB). */
  persist: boolean | null;
  /** Value the Settings switch should visually show afterwards. */
  uiOn: boolean;
  /** Inline note to show the user, or `null` to clear/hide it. */
  note: string | null;
}

const NOTE_FAILED = "Couldn't verify — Face ID not enabled";
const NOTE_UNAVAILABLE =
  "Face ID isn't set up on this device — turn it on in iOS Settings first";

/**
 * Pure decision for the Settings "Require Face ID on launch" toggle. No
 * React Native / Expo / DB imports — Node-testable.
 *
 * Turning the lock OFF never requires auth (the app is already unlocked, and
 * reducing protection needs no proof) and always persists immediately.
 * Turning it ON only ever persists — and only ever shows the toggle as ON —
 * when `auth` is `'success'`, i.e. a real biometric check just passed. Both
 * `'failed'` (the check ran and didn't pass) and `'unavailable'` (there was
 * no check to run at all — the anti-lockout valve, which must not be reused
 * to gate enabling) leave the toggle OFF and persist nothing, distinguished
 * only by which note is shown.
 */
export function decideLockToggle(
  requestedOn: boolean,
  auth: LockAuthOutcome
): LockToggleDecision {
  if (!requestedOn) {
    return { persist: false, uiOn: false, note: null };
  }
  if (auth === 'success') {
    return { persist: true, uiOn: true, note: null };
  }
  if (auth === 'unavailable') {
    return { persist: null, uiOn: false, note: NOTE_UNAVAILABLE };
  }
  // auth === 'failed' (or, defensively, null on a requested-on with no auth
  // outcome supplied — should not happen from the caller, but fails closed).
  return { persist: null, uiOn: false, note: NOTE_FAILED };
}

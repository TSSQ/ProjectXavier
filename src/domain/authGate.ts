/**
 * Auth gate — decides whether the app renders or falls back to SignIn, and
 * how the persisted "has an active session" marker should react to a
 * Supabase auth state change. Framework-free (no RN/Expo/supabase imports)
 * so it stays testable by the plain-Node BDD suite; the marker itself is
 * Keychain-persisted by src/lib/secureStore.ts.
 *
 * The linchpin: on an offline cold start with an expired access token,
 * supabase-js's network refresh fails and it returns a null session WITHOUT
 * emitting SIGNED_OUT (network errors are retryable, not a real sign-out).
 * Treating that null session as a sign-out would lock the user out of their
 * own local, on-device data. So the marker is only ever cleared on a real
 * SIGNED_OUT (explicit sign-out, or a server-rejected/invalidated session).
 */
export type AuthEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'
  | 'MFA_CHALLENGE_VERIFIED';

/** What to do to the persisted "has an active session" marker for a given
 *  auth state change. A null session from a NON-SIGNED_OUT event means
 *  no-network / couldn't refresh — the marker must be KEPT (offline grace). */
export function markerActionForEvent(
  event: AuthEvent,
  hasSession: boolean
): 'set' | 'clear' | 'none' {
  if (hasSession) return 'set';
  if (event === 'SIGNED_OUT') return 'clear';
  return 'none';
}

/** Whether to render the app (vs the SignIn screen). */
export function grantsAppAccess(hasSession: boolean, hasMarker: boolean): boolean {
  return hasSession || hasMarker;
}

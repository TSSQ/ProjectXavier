/**
 * Authentication (email OTP / magic-link via Supabase Auth).
 *
 * Email-first by design: no third-party credentials needed to ship. Apple and
 * Google providers slot in later behind the same session model. The app stores
 * only an email + auth-provider id (non-negotiable #5); financial data is never
 * sent to Supabase in plaintext.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { markAuthed, clearAuthed } from '../../lib/secureStore';
import { markerActionForEvent, AuthEvent } from '../../domain/authGate';

/** Send a 6-digit OTP (and magic link) to the given email. */
export async function requestEmailOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

/** Verify the emailed OTP and establish a session. */
export async function verifyEmailOtp(email: string, token: string): Promise<void> {
  const e = email.trim();
  const t = token.trim();
  // A returning user's OTP verifies as type 'email'; a brand-new signup (with
  // "Confirm email" enabled) verifies as 'signup'. Try the common case, then
  // fall back so first-time and returning users both work with one code field.
  const first = await supabase.auth.verifyOtp({ email: e, token: t, type: 'email' });
  if (!first.error) return;
  const second = await supabase.auth.verifyOtp({ email: e, token: t, type: 'signup' });
  if (second.error) throw second.error;
}

export async function signOut(): Promise<void> {
  // scope: 'local' removes the session from the device and emits SIGNED_OUT
  // without a server round-trip. The default 'global' calls the network first
  // and, when offline, returns early WITHOUT clearing the local session — so an
  // offline sign-out would silently no-op and leave the app in offline-grace
  // (see authGate / offline-grace). Local sign-out always works; the refresh
  // token is device-only Keychain (WHEN_UNLOCKED_THIS_DEVICE_ONLY) and is
  // removed here, which is the right "sign out on this device" semantic.
  await supabase.auth.signOut({ scope: 'local' });
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Current access token (JWT) for authorising AI-proxy calls, or null. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Subscribe to sign-in/sign-out; returns an unsubscribe function.
 *  Also maintains the offline-grace "has an active session" marker: set on
 *  any non-null session, cleared only on a real SIGNED_OUT (see authGate.ts —
 *  a null session from a non-SIGNED_OUT event, e.g. a failed offline token
 *  refresh, must never clear it). */
export function onAuthChange(
  cb: (session: Session | null, event: AuthChangeEvent) => void
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const action = markerActionForEvent(event as AuthEvent, !!session);
    if (action === 'set') void markAuthed();
    else if (action === 'clear') void clearAuthed();
    cb(session, event);
  });
  return () => data.subscription.unsubscribe();
}

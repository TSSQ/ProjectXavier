/**
 * Authentication (email OTP / magic-link via Supabase Auth).
 *
 * Email-first by design: no third-party credentials needed to ship. Apple and
 * Google providers slot in later behind the same session model. The app stores
 * only an email + auth-provider id (non-negotiable #5); financial data is never
 * sent to Supabase in plaintext.
 */
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

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
  await supabase.auth.signOut();
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

/** Subscribe to sign-in/sign-out; returns an unsubscribe function. */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session);
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Pure resolution of the `onboarding_complete` setting's stored string value
 * into a boolean. No React Native / Expo / DB imports — Node-testable.
 * Mirrors `resolveBiometricLock` (src/domain/biometricLock.ts): unset
 * (`null`, no row written yet) resolves to `false` — a fresh install with no
 * accounts yet has NOT completed onboarding, so (together with "no accounts
 * yet") the welcome carousel (app/welcome.tsx) shows. Any stored value other
 * than the literal `'1'` (including a corrupt one) also resolves to `false`,
 * the same fail-open-to-"not complete" shape.
 */
export function resolveOnboardingComplete(stored: string | null): boolean {
  return stored === '1';
}

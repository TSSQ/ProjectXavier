/**
 * First-run guided onboarding — the pure, framework-free brain behind
 * Xavier's tutorial. A brand-new user is walked through the REAL setup chain
 * (create an account, add a transaction) inside the existing assistant chat;
 * this module owns only the step sequence + copy (mirroring
 * accountAssistant.ts's shape). It does not create accounts or transactions
 * itself — the screen (app/(tabs)/index.tsx) drives the real account-Q&A and
 * parse/confirm flows and calls back in here with the resulting events, so
 * the whole sequence stays BDD-testable in plain Node.
 */

export type OnboardingStep = 'welcome' | 'account' | 'transaction' | 'done';

export interface OnboardingState {
  step: OnboardingStep;
}

/** What advances the guided sequence: the real account/transaction flows
 *  completing, or the user tapping "Skip tutorial" (allowed from any step). */
export type OnboardingEvent = 'accountCreated' | 'transactionSaved' | 'skipped';

/** Optional context threaded through a `transactionSaved` event so the
 *  wrap-up copy can call out the specific payee/category the REAL parse just
 *  captured — teaching those concepts on the user's own entry, not a canned
 *  example. Either may be null/omitted (e.g. a transfer has neither). */
export interface TransactionSavedContext {
  payeeName?: string | null;
  categoryName?: string | null;
}

export interface OnboardingResult {
  state: OnboardingState;
  /** What Xavier says at this point in the sequence. */
  message: string;
}

/**
 * Pure resolution of the `onboarding_complete` setting's stored string value
 * into a boolean — mirrors `resolveBiometricLock` (src/domain/biometricLock.ts).
 * Unset (`null`, no row written yet) resolves to `false`: a fresh install has
 * NOT completed onboarding, so (together with "no accounts yet") the tutorial
 * starts. Any stored value other than the literal '1' (including a corrupt
 * one) also resolves to `false`, same fail-open-to-"not complete" shape as
 * the biometric-lock resolver.
 */
export function resolveOnboardingComplete(stored: string | null): boolean {
  return stored === '1';
}

const WELCOME_MESSAGE =
  "Hi, I'm Xavier. Tell me what you spent and I track it — everything stays " +
  'on your phone. No account, no cloud.';

const TRANSACTION_PROMPT =
  "Nice, your account is set up! Now let's add your first transaction — " +
  'tell me something you spent, like "lunch 12.50 at Subway".';

const SKIP_MESSAGE = "No problem — skipped. I'm here whenever you want to add something.";

const ACCOUNT_STEP_FALLBACK = "Let's get your first account set up.";

const DONE_FALLBACK_MESSAGE = "You're all set.";

/** What Xavier is saying while sitting at `step`, generically — used only as
 *  the no-op fallback below (a mismatched state/event pair), so that path
 *  never blanks the screen even if a future call site forgets to guard it. */
function currentStepMessage(step: OnboardingStep): string {
  switch (step) {
    case 'welcome':
      return WELCOME_MESSAGE;
    case 'account':
      return ACCOUNT_STEP_FALLBACK;
    case 'transaction':
      return TRANSACTION_PROMPT;
    case 'done':
      return DONE_FALLBACK_MESSAGE;
  }
}

/** Wrap-up copy: the spec's four one-liners (totals/accounts, widget, Face
 *  ID, iCloud backup) plus a callout of the payee/category the real parse
 *  just captured, when known. */
function wrapMessage(context?: TransactionSavedContext): string {
  const payee = context?.payeeName;
  const category = context?.categoryName;
  const captured =
    payee && category
      ? `Saved! I picked up "${payee}" as the payee and tagged it "${category}" — that's how I'll learn your spending.\n\n`
      : payee
        ? `Saved! I picked up "${payee}" as the payee — that's how I'll learn your spending.\n\n`
        : category
          ? `Saved! I tagged that "${category}" — that's how I'll learn your spending.\n\n`
          : 'Saved!\n\n';
  return (
    captured +
    "You're all set. Find your totals and accounts on the other tabs. " +
    "The Home Screen widget shows this month's total (hidden while locked), " +
    'and you can turn on Face ID lock or iCloud backup any time in Settings.'
  );
}

/** Begin the guided tutorial — the welcome + privacy beat, shown once before
 *  the real account-creation Q&A (accountAssistant.ts) takes over. */
export function startOnboarding(): OnboardingResult {
  return { state: { step: 'welcome' }, message: WELCOME_MESSAGE };
}

/**
 * Moves from the welcome beat into step 1 (account creation). Unconditional
 * — there's nothing to wait for at 'welcome', so unlike `advanceOnboarding`
 * this isn't event-driven; the screen calls it right after showing the
 * welcome message and launches the real account Q&A alongside it.
 */
export function beginAccountStep(): OnboardingResult {
  return { state: { step: 'account' }, message: '' };
}

/**
 * Advance the sequence on a real-flow event. `skipped` always drops straight
 * to 'done' regardless of the current step — the tutorial is escapable at
 * every step (spec: "Always escapable"). `accountCreated` / `transactionSaved`
 * only advance from their matching step; any other combination is a no-op
 * (defensive — the screen only fires them at the right point, but this keeps
 * the function total rather than throwing). The no-op still returns the
 * current step's own message (not an empty string) so an un-guarded caller
 * can never blank the screen.
 */
export function advanceOnboarding(
  state: OnboardingState,
  event: OnboardingEvent,
  context?: TransactionSavedContext
): OnboardingResult {
  if (event === 'skipped') {
    return { state: { step: 'done' }, message: SKIP_MESSAGE };
  }
  if (state.step === 'account' && event === 'accountCreated') {
    return { state: { step: 'transaction' }, message: TRANSACTION_PROMPT };
  }
  if (state.step === 'transaction' && event === 'transactionSaved') {
    return { state: { step: 'done' }, message: wrapMessage(context) };
  }
  return { state, message: currentStepMessage(state.step) };
}

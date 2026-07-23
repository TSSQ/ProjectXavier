/**
 * Guided account-creation flow for the assistant — the pure, framework-free
 * brain behind the "/account" command. Typing "/account" starts a short Q&A
 * (name → type → starting balance); each user reply advances one step until a
 * complete account draft is ready for a confirm card. Currency isn't asked —
 * the app is single-currency (see src/features/settings), so the screen stamps
 * the app currency at creation time.
 *
 * SPIKE: deliberately simple, one-question-at-a-time. No AI — answers are read
 * deterministically. Kept side-effect-free so the whole conversation is
 * BDD-testable in plain Node; persistence (createAccount) lives in the screen.
 */

export type AccountFlowStep = 'name' | 'subtype' | 'opening' | 'confirm';

/** Partial account collected so far. `openingBalance` is minor units. */
export interface AccountDraft {
  name?: string;
  subtype?: string;
  openingBalance?: number;
}

export interface AccountFlowState {
  step: AccountFlowStep;
  draft: AccountDraft;
}

/** A completed draft, ready to hand to createAccount() (currency added later). */
export interface ReadyAccount {
  name: string;
  subtype?: string;
  openingBalance: number;
}

export interface AccountFlowResult {
  state: AccountFlowState;
  /** What the assistant says next (the next question, or the confirm summary). */
  message: string;
  /** Set once the flow has everything — the screen then shows a confirm card. */
  ready?: ReadyAccount;
}

/** Trigger words the assistant treats as "start creating an account". */
const ACCOUNT_COMMAND = /^\/account\b/i;
const TRANSACTION_COMMAND = /^\/transactions?\b/i;

export function isAccountCommand(text: string): boolean {
  return ACCOUNT_COMMAND.test(text.trim());
}

/** True for "/transactions" (explicit "make a transaction" trigger). Returns the
 *  remaining text after the command so the caller can parse it as an expense. */
export function transactionCommandBody(text: string): string | null {
  const t = text.trim();
  if (!TRANSACTION_COMMAND.test(t)) return null;
  return t.replace(TRANSACTION_COMMAND, '').trim();
}

/** Begin the /account Q&A. */
export function startAccountFlow(): AccountFlowResult {
  return {
    state: { step: 'name', draft: {} },
    message: "Let's set up an account. What should I call it?",
  };
}

const SUBTYPE_ALIASES: Record<string, string> = {
  'credit card': 'credit_card',
  credit: 'credit_card',
  card: 'credit_card',
  chequing: 'bank',
  checking: 'bank',
  current: 'bank',
  wallet: 'cash',
};
const SKIP_WORDS = new Set(['skip', 'none', 'no', 'n/a', 'na', '-', 'nothing']);

/** Tappable choices for the `subtype` question — same words `normalizeSubtype`
 *  already understands, so a chip tap and a typed answer land on the same
 *  state. "Skip" isn't listed here (the screen renders it separately using
 *  the literal "skip" answer, already a SKIP_WORDS member).
 *
 *  Loan and Investment were added (QA follow-up, an approved deviation from
 *  the original chat-creation spec's "reuse as-is") because the chat gate
 *  (src/domain/accountIntent.ts) legitimately produces `loan`/`investment`
 *  subtype hints ("create a car loan account", "set up a Fidelity investment
 *  account") — without a matching chip, the confirm card had no way to show
 *  (or let the user re-select) those two subtypes.
 *
 *  TODO(follow-up): subtype drift, reviewer nit (intentionally NOT fixed
 *  here — needs a product decision on one canonical subtype set). This chip
 *  persists the literal `'savings'`, but the chat gate's noun mapping
 *  (src/domain/accountIntent.ts's ACCOUNT_NOUNS, "savings" -> hint "bank")
 *  canonicalizes a savings account to `'bank'` instead — so a chat-created
 *  "add a DBS savings account" shows the Bank chip selected, not Savings,
 *  even though the /account Q&A's own Savings chip still writes `'savings'`.
 *  Pre-existing in the Q&A path; leave both subtype vocabularies as-is until
 *  someone decides whether "savings" should be its own subtype everywhere or
 *  folded into "bank" everywhere. */
export const ACCOUNT_SUBTYPE_CHOICES = [
  { label: 'Bank', value: 'bank' },
  { label: 'Cash', value: 'cash' },
  { label: 'Credit card', value: 'credit_card' },
  { label: 'Savings', value: 'savings' },
  { label: 'Loan', value: 'loan' },
  { label: 'Investment', value: 'investment' },
] as const;

/** Exported so both the /account Q&A above and the chat one-shot assembly
 *  below (`buildReadyAccountFromChat`) canonicalize a subtype word the exact
 *  same way. */
export function normalizeSubtype(answer: string): string | undefined {
  const a = answer.trim().toLowerCase();
  if (!a || SKIP_WORDS.has(a)) return undefined;
  return SUBTYPE_ALIASES[a] ?? a.replace(/\s+/g, '_');
}

/** Read a starting balance from free text: "500" / "$500" / "1,250.50" ->
 *  minor units; "none"/"0"/"skip" -> 0; a leading "-" (money owed, e.g. a card)
 *  is kept negative. Unparseable -> 0. */
export function parseOpeningBalance(answer: string): number {
  const a = answer.trim().toLowerCase();
  if (!a || SKIP_WORDS.has(a)) return 0;
  const neg = /^-|owe|owing|negative/.test(a);
  const cleaned = a.replace(/[^0-9.]/g, '');
  const major = Number(cleaned);
  if (!Number.isFinite(major)) return 0;
  const minor = Math.round(major * 100);
  return neg ? -minor : minor;
}

/** Advance the flow with the user's reply to the current question. */
export function advanceAccountFlow(
  state: AccountFlowState,
  answer: string
): AccountFlowResult {
  const a = answer.trim();

  switch (state.step) {
    case 'name': {
      if (!a) {
        return { state, message: "I didn't catch a name — what should I call the account?" };
      }
      const draft = { ...state.draft, name: a };
      return {
        state: { step: 'subtype', draft },
        message: `"${a}" — got it. What type is it? (bank, cash, credit card, savings…, or "skip")`,
      };
    }
    case 'subtype': {
      const draft = { ...state.draft, subtype: normalizeSubtype(a) };
      return {
        state: { step: 'opening', draft },
        message: "What's the starting balance? (a number, or \"none\")",
      };
    }
    case 'opening': {
      const openingBalance = parseOpeningBalance(a);
      const draft = { ...state.draft, openingBalance };
      const ready: ReadyAccount = {
        name: draft.name!,
        subtype: draft.subtype,
        openingBalance,
      };
      return {
        state: { step: 'confirm', draft },
        message: 'Here\'s the account — look right?',
        ready,
      };
    }
    case 'confirm':
      // The screen owns the confirm card (Create/Discard); nothing to advance.
      return { state, message: '' };
  }
}

// ─── chat one-shot assembly ─────────────────────────────────────────────────
// Everything below is the "accelerated" entry point (docs/design/
// account-chat-creation-spec.md §5.4): a natural-language one-liner that
// jumps straight to a confirm-ready draft instead of walking the Q&A above.
// The gate (src/domain/accountIntent.ts) and extraction ladder
// (app/(tabs)/index.tsx's runParse) feed this; it never talks to a model or
// the network itself.

/** Deterministic default account name when the extraction produced none (the
 *  model said nothing, or its name was discarded by the token-support guard
 *  in src/domain/accountParsePrompt.ts) — driven by the resolved subtype,
 *  never by the model's own (possibly hallucinated) name. */
export function defaultAccountName(subtype?: string): string {
  switch (subtype) {
    case 'cash':
      return 'Wallet';
    case 'bank':
      return 'Savings';
    case 'credit_card':
      return 'Credit card';
    case 'loan':
      return 'Loan';
    case 'investment':
      return 'Investment';
    default:
      return 'Account';
  }
}

/** What the extraction ladder hands back for a chat one-shot: the account
 *  contract's {name, subtype} (already token-support-guarded — see
 *  accountParsePrompt.ts's `normalizeAccountParseOutput`), or nothing at all
 *  when no engine ran (offline, no key, FM incapable — the "deterministic
 *  floor" case in spec §5.4 point 1). */
export interface ChatAccountExtraction {
  name: string | null;
  subtype: string;
}

/**
 * Build a confirm-ready account draft from a chat one-shot utterance and
 * whatever the extraction ladder produced (or `null`/an all-defaulted
 * extraction when no engine was available) — docs/design/account-chat-
 * creation-spec.md §5.4. Every gate hit reaches this and lands on the
 * confirm card, NEVER a question, so every field must be fully resolved
 * here:
 *   - `openingBalance` is ALWAYS `parseOpeningBalance(text)` — deterministic,
 *     read straight from the raw utterance, regardless of anything a model
 *     returned (accountParseSchema doesn't even have a balance field).
 *   - `subtype` is the extraction's subtype (already canonicalized through
 *     `normalizeSubtype` as a defensive re-pass), unless it's "unknown" —
 *     left unset then, same as an unanswered/skipped Q&A question.
 *   - `name` is the extraction's name if it survived the token-support
 *     guard, else the subtype-driven default above.
 */
export function buildReadyAccountFromChat(
  text: string,
  extracted: ChatAccountExtraction | null
): ReadyAccount {
  const rawSubtype = extracted && extracted.subtype !== 'unknown' ? extracted.subtype : undefined;
  const subtype = rawSubtype ? normalizeSubtype(rawSubtype) : undefined;
  const name = extracted?.name?.trim() || defaultAccountName(subtype);
  return {
    name,
    subtype,
    openingBalance: parseOpeningBalance(text),
  };
}

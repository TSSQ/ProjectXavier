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
 *  the literal "skip" answer, already a SKIP_WORDS member). */
export const ACCOUNT_SUBTYPE_CHOICES = [
  { label: 'Bank', value: 'bank' },
  { label: 'Cash', value: 'cash' },
  { label: 'Credit card', value: 'credit_card' },
  { label: 'Savings', value: 'savings' },
] as const;

function normalizeSubtype(answer: string): string | undefined {
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

/**
 * Learned payee defaults — the pure rules behind "use what I chose last time
 * for this payee". Framework-free and side-effect-free so every rule is
 * BDD-tested in plain Node (tests/__features__/learned-defaults.feature);
 * persistence lives in src/features/payees and the save sequence
 * (src/features/ai/saveDraftSequence.ts).
 *
 * Why this exists: every parse engine ALWAYS fills `category` (it is a
 * required schema field), so the save sequence's old "use the payee's learned
 * default only when the draft has no category" never applied to a known
 * payee — the engine's guess always won, and only a brand-new payee ever
 * learned anything. Two jobs here close that loop:
 *
 *  1. `applyLearnedDefaults` — a post-step after `interpret()` (which stays
 *     pure and knows nothing about payees): when the draft's payee is an
 *     EXACT known payee, prefer that payee's remembered category over the
 *     engine's proposal, unless the user actually typed the proposed
 *     category themselves (a fact check on their own words, via
 *     `mentionedInText`, never a judgement about context). The same for the
 *     remembered account, but only when the engine named no account at all
 *     (`defaulted.account`) and the user's words mention none. Each
 *     replacement is flagged on the draft (`learnedCategory` /
 *     `learnedAccount`) carrying exactly what to restore, so the draft card
 *     can say "Using <X> as last time" with a one-tap revert.
 *
 *  2. `payeeDefaultsPatch` — what to write back after a save/edit: the
 *     user's confirmed category/account become the payee's new defaults
 *     whenever they differ from what it remembers ("last confirmed wins").
 *     Silent by design — it is the user's own choice, never a model's.
 */
import { TransactionDraft } from './assistant';
import { Account, Category, Payee } from './types';
import { findPayeeMatch } from './payees';
import { normalizeName } from './textMatch';
import { mentionedInText } from './deviceParsePrompt';

export interface LearnedDefaultsContext {
  payees: Payee[];
  categories: Category[];
  accounts: Account[];
  /** The user's own words. Empty when unknown — then nothing counts as
   *  typed, so a learned category still wins over the engine's proposal. */
  text: string;
}

/** The exact known payee the draft names, if any — the only payee whose
 *  defaults are ever applied (a fuzzy "did you mean…?" is an offer the user
 *  hasn't accepted yet, so its defaults are never borrowed). */
function exactPayee(draft: TransactionDraft, payees: Payee[]): Payee | undefined {
  if (!draft.payeeName) return undefined;
  return findPayeeMatch(draft.payeeName, payees).exact;
}

/**
 * Prefer the payee's remembered category over the engine's proposal.
 * Returns the draft unchanged (same object) when nothing applies:
 *  - transfers carry no category/payee at all;
 *  - no exact known payee, or it remembers no category;
 *  - the remembered category no longer exists or is of another kind (an
 *    expense default never lands on an income draft);
 *  - the engine's proposal IS the remembered category already;
 *  - the user typed the engine's proposal themselves — typed wins.
 */
export function applyLearnedCategory(
  draft: TransactionDraft,
  ctx: LearnedDefaultsContext
): TransactionDraft {
  if (draft.type === 'transfer') return draft;
  const payee = exactPayee(draft, ctx.payees);
  if (!payee?.defaultCategoryId) return draft;
  const learned = ctx.categories.find((c) => c.id === payee.defaultCategoryId);
  if (!learned || learned.kind !== draft.type) return draft;
  const proposal = draft.categoryName;
  if (proposal && normalizeName(proposal) === normalizeName(learned.name)) return draft;
  if (proposal && ctx.text && mentionedInText(proposal, ctx.text)) return draft;
  return {
    ...draft,
    categoryName: learned.name,
    defaulted: { ...draft.defaulted, category: false },
    learnedCategory: {
      engineCategoryName: proposal,
      engineDefaulted: draft.defaulted.category,
    },
  };
}

/**
 * Prefer the payee's remembered account when the engine named none.
 * Returns the draft unchanged when:
 *  - it is a transfer (its accounts come from the user's own text only);
 *  - the engine DID name an account (`defaulted.account` false), or the
 *    user's words named one that didn't resolve (`unmatchedAccountName` /
 *    `ambiguousAccountNames` / `accountSuggestion` — the card already
 *    handles those, and a remembered account must never paper over them);
 *  - no exact known payee, or it remembers no account, or that account is
 *    gone/archived, or it is the account the draft already sits on;
 *  - the currencies disagree. `interpret()` already forced `currency` to the
 *    draft account's own and recorded any conflict with what the user typed
 *    in `mismatchedCurrency`; the typed currency itself isn't carried, so a
 *    switch is only ever made when it cannot create a conflict this step
 *    can't see: same currency as the draft, or exactly the currency the
 *    user typed (which then resolves the conflict instead of hiding it).
 */
export function applyLearnedAccount(
  draft: TransactionDraft,
  ctx: LearnedDefaultsContext
): TransactionDraft {
  if (draft.type === 'transfer') return draft;
  if (!draft.defaulted.account) return draft;
  if (draft.unmatchedAccountName || draft.ambiguousAccountNames?.length || draft.accountSuggestion) {
    return draft;
  }
  const payee = exactPayee(draft, ctx.payees);
  if (!payee?.defaultAccountId || payee.defaultAccountId === draft.accountId) return draft;
  const learned = ctx.accounts.find((a) => a.id === payee.defaultAccountId && !a.archived);
  if (!learned) return draft;
  const heard = draft.mismatchedCurrency ?? null;
  const resolvesConflict = heard !== null && learned.currency === heard;
  if (!resolvesConflict && learned.currency !== draft.currency) return draft;
  const next: TransactionDraft = {
    ...draft,
    accountId: learned.id,
    currency: learned.currency,
    defaulted: { ...draft.defaulted, account: false },
    learnedAccount: {
      engineAccountId: draft.accountId,
      engineCurrency: draft.currency,
      engineMismatchedCurrency: heard,
    },
  };
  if (resolvesConflict) delete next.mismatchedCurrency;
  return next;
}

/** Both rules, category then account. */
export function applyLearnedDefaults(
  draft: TransactionDraft,
  ctx: LearnedDefaultsContext
): TransactionDraft {
  return applyLearnedAccount(applyLearnedCategory(draft, ctx), ctx);
}

/** "Use <engine's proposal> instead" — put the engine's category back. */
export function revertLearnedCategory(draft: TransactionDraft): TransactionDraft {
  const l = draft.learnedCategory;
  if (!l) return draft;
  const next: TransactionDraft = {
    ...draft,
    categoryName: l.engineCategoryName,
    defaulted: { ...draft.defaulted, category: l.engineDefaulted },
  };
  delete next.learnedCategory;
  return next;
}

/** "Use <engine's account> instead" — put the draft back on the account the
 *  engine (or the default) chose, with the currency conflict it had then. */
export function revertLearnedAccount(draft: TransactionDraft): TransactionDraft {
  const l = draft.learnedAccount;
  if (!l) return draft;
  const next: TransactionDraft = {
    ...draft,
    accountId: l.engineAccountId,
    currency: l.engineCurrency,
    defaulted: { ...draft.defaulted, account: true },
  };
  delete next.learnedAccount;
  if (l.engineMismatchedCurrency) next.mismatchedCurrency = l.engineMismatchedCurrency;
  else delete next.mismatchedCurrency;
  return next;
}

/** Drop the category flag without reverting — for when something else
 *  (e.g. an afford "Log it" budget preset) overrides the category after the
 *  learned one was applied, so the card doesn't claim a category it no
 *  longer shows was "last time's". */
export function clearLearnedCategoryFlag(draft: TransactionDraft): TransactionDraft {
  if (!draft.learnedCategory) return draft;
  const next: TransactionDraft = { ...draft };
  delete next.learnedCategory;
  return next;
}

/** What `rememberPayeeDefaults` should write for `payee` after the user
 *  confirmed `chosen` — only the fields that actually changed, so a save
 *  that confirms what the payee already remembers writes nothing. */
export interface PayeeDefaultsPatch {
  defaultCategoryId?: string;
  defaultAccountId?: string;
}

/**
 * "Last confirmed wins": the category and account the user just saved an
 * AI transaction with become the payee's defaults when they differ from
 * what it remembers. A missing category (null) never clears a remembered
 * one — the user chose no category, not "forget it". Returns null when
 * there is nothing to write.
 */
export function payeeDefaultsPatch(
  payee: Pick<Payee, 'defaultCategoryId' | 'defaultAccountId'>,
  chosen: { categoryId: string | null; accountId: string | null }
): PayeeDefaultsPatch | null {
  const patch: PayeeDefaultsPatch = {};
  if (chosen.categoryId && chosen.categoryId !== (payee.defaultCategoryId ?? null)) {
    patch.defaultCategoryId = chosen.categoryId;
  }
  if (chosen.accountId && chosen.accountId !== (payee.defaultAccountId ?? null)) {
    patch.defaultAccountId = chosen.accountId;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

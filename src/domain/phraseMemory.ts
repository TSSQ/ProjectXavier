/**
 * Phrase memory — the per-user correction loop for the parse pipeline. Pure,
 * framework-free and side-effect-free, so every rule is BDD-tested in plain
 * Node (tests/__features__/phrase-memory.feature); persistence lives in
 * src/features/phraseMemory, the reads in the chat screen's `runParse`
 * (app/(tabs)/index.tsx) and the writes in the save sequence, the "Log
 * anyway" / discard / revert handlers and the transaction editors.
 *
 * Why this exists: people phrase things differently, and fixed word lists
 * (the not-a-transaction cues, the transaction affirmation's vocabulary in
 * ./fmRefusal) can only ever be a seed. What a user corrected last time for
 * the same words is the better evidence, so it overrides them:
 *
 *  - the KEY is the user's words with what code already reads removed — the
 *    amount with its currency marks (`readAmounts`), the date phrase
 *    (`typedDateSpan`) and punctuation — lowercased, whitespace collapsed:
 *    "12 on lunch", "12 on lunch?" and "$15 on lunch yesterday" share
 *    "on lunch" (`phraseKey`);
 *  - a VERDICT ('log' | 'not_log') overrides the log-or-refuse decision:
 *    "Log anyway" on a refusal stores 'log' (the next refusal of those words
 *    is overridden), discarding a draft code affirmed stores 'not_log' (the
 *    next affirmation of those words is not made);
 *  - the FIELDS (type, category, payee, account the user confirmed) are
 *    applied to the next draft for those words (`applyMemory`). Precedence:
 *    a field the user typed in the text > phrase memory > the payee's
 *    learned default (./learnedDefaults) > the engine's proposal. Each
 *    applied field is flagged on the draft with the SAME "as last time" /
 *    revert mechanism the payee defaults use (`learnedCategory`,
 *    `learnedAccount`, plus `learnedType` / `learnedPayee`), marked
 *    `source: 'phrase'`;
 *  - a memory the user reverted twice is forgotten (`revertPatch`), and the
 *    store is capped (`PHRASE_MEMORY_CAP`), least recently used first out.
 *
 * Content: a key is the user's own words (minus amount and date), so it is
 * user data like `transactions.source_text`: kept on the device, included
 * in the user's own backups, never written to a log or a parse metric.
 */
import { TransactionDraft } from './assistant';
import { Account, Category, Payee, TransactionType } from './types';
import { normalizeName, isWholeWordVariant } from './textMatch';
import { mentionedInText, typedDateSpan } from './deviceParsePrompt';
import { readAmounts } from './amountCandidates';
import { readSign } from './signReader';

export type PhraseVerdict = 'log' | 'not_log';

/** One remembered phrase — the `phrase_memory` row, camelCased. */
export interface PhraseMemoryRow {
  key: string;
  verdict: PhraseVerdict | null;
  type: TransactionType | null;
  categoryId: string | null;
  payeeId: string | null;
  accountId: string | null;
  /** Times the user confirmed or re-confirmed these words. */
  hits: number;
  /** Times the user reverted a field this memory applied. */
  reverts: number;
  lastUsedAt: number;
  updatedAt: number;
}

/** At most this many phrases are kept; the least recently used go first. */
export const PHRASE_MEMORY_CAP = 2000;
/** Only short phrases are remembered: a key of more words than this (a
 *  receipt's OCR text, a long sentence) is '' — never stored or looked up. */
export const PHRASE_MEMORY_MAX_KEY_WORDS = 8;
/** A memory reverted this many times is deleted. */
export const PHRASE_MEMORY_MAX_REVERTS = 2;

/** A currency mark next to an amount (before or after it): part of the amount. */
const CURRENCY_BEFORE = /(?:[$€£¥]|\bs\$|\b(?:sgd|usd|rm|myr|eur|gbp|aud))\s*$/i;
const CURRENCY_AFTER = /^\s*(?:[$€£¥]|(?:sgd|usd|rm|myr|eur|gbp|aud|dollars?|bucks|cents?)\b)/i;

/**
 * The memory key for `text`: the words with every amount (and the currency
 * marks beside it) and the date phrase code reads removed, lowercased,
 * punctuation stripped, whitespace collapsed. '' when nothing is left (a
 * bare "12") or more than `PHRASE_MEMORY_MAX_KEY_WORDS` words are left (a
 * receipt's OCR text); '' is never stored or looked up. `now` dates the text the
 * way the pipeline does, so the date phrase removed is the one it reads.
 */
export function phraseKey(text: string, now: number): string {
  const cuts: Array<{ index: number; end: number }> = [];
  for (const a of readAmounts(text).offered) {
    let index = a.index;
    let end = a.index + a.text.length;
    const before = CURRENCY_BEFORE.exec(text.slice(0, index));
    if (before) index -= before[0].length;
    const after = CURRENCY_AFTER.exec(text.slice(end));
    if (after) end += after[0].length;
    cuts.push({ index, end });
  }
  const date = typedDateSpan(text, now);
  if (date) cuts.push(date);
  let rest = text;
  for (const c of cuts.sort((x, y) => y.index - x.index)) {
    rest = rest.slice(0, c.index) + ' ' + rest.slice(c.end);
  }
  const key = normalizeName(
    rest
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[^\p{L}\p{N}'&\s]+/gu, ' ')
      .replace(/(^|\s)'+|'+(?=\s|$)/g, ' ')
  );
  return key.split(' ').length > PHRASE_MEMORY_MAX_KEY_WORDS ? '' : key;
}

/**
 * The memory for `key`: the row with exactly that key, else the ONE row whose
 * key is a whole-word variant of it (`isWholeWordVariant`: "on lunch" vs
 * "lunch", "kopi" vs "kopi o"), else null. Two or more variants are
 * ambiguous and none is used.
 */
export function lookup(key: string, rows: readonly PhraseMemoryRow[]): PhraseMemoryRow | null {
  if (!key) return null;
  const exact = rows.find((r) => r.key === key);
  if (exact) return exact;
  const variants = rows.filter((r) => isWholeWordVariant(key, r.key));
  return variants.length === 1 ? variants[0]! : null;
}

/** Memory says to log these words even when the model refused them. */
export function memoryForcesLog(hit: PhraseMemoryRow | null): boolean {
  return hit?.verdict === 'log';
}

/** Memory says code's affirmation of these words was wrong: keep the
 *  model's refusal. Only an affirmation code made (`affirmed`), never the
 *  model's own "this is a transaction". */
export function memoryKeepsRefusal(hit: PhraseMemoryRow | null, affirmedByCode: boolean): boolean {
  return affirmedByCode && hit?.verdict === 'not_log';
}

export interface ApplyMemoryContext {
  categories: readonly Category[];
  payees: readonly Payee[];
  accounts: readonly Account[];
  /** The user's own words, for the typed-wins checks. */
  text: string;
}

/**
 * Apply `hit`'s remembered fields to `draft`. A field is left alone when the
 * user typed it: the type when the user's words decide it (`readSign`), the
 * category or payee when the draft's value appears in the text
 * (`mentionedInText`), the account when the engine named one (it only
 * names one the user typed). Transfers are never touched (their accounts
 * come from the user's words), and memory never turns a draft into one.
 * A remembered id that no longer exists, or a category of the other kind,
 * is ignored. Returns the same object when nothing applies.
 */
export function applyMemory(
  draft: TransactionDraft,
  hit: PhraseMemoryRow | null,
  ctx: ApplyMemoryContext
): TransactionDraft {
  if (!hit || draft.type === 'transfer') return draft;
  let next = draft;
  const typed = (value: string | null | undefined) => !!value && !!ctx.text && mentionedInText(value, ctx.text);

  // Type, only together with a category of that kind (or none on the draft),
  // so the draft never carries a category name of the other kind.
  const rememberedCategory = hit.categoryId ? ctx.categories.find((c) => c.id === hit.categoryId) : undefined;
  if (
    hit.type &&
    hit.type !== 'transfer' &&
    hit.type !== next.type &&
    readSign(ctx.text) == null &&
    (rememberedCategory?.kind === hit.type || !next.categoryName)
  ) {
    next = { ...next, type: hit.type, learnedType: { engineType: next.type, source: 'phrase' } };
  }

  if (
    rememberedCategory &&
    rememberedCategory.kind === next.type &&
    !typed(next.categoryName) &&
    normalizeName(next.categoryName ?? '') !== normalizeName(rememberedCategory.name)
  ) {
    next = {
      ...next,
      categoryName: rememberedCategory.name,
      defaulted: { ...next.defaulted, category: false },
      learnedCategory: {
        engineCategoryName: next.categoryName,
        engineDefaulted: next.defaulted.category,
        source: 'phrase',
      },
    };
  } else if (next.learnedType && next.categoryName) {
    // The type changed but no category of the new kind is remembered: the
    // engine's category belongs to the old kind, so it is dropped.
    next = { ...next, categoryName: null, defaulted: { ...next.defaulted, category: true } };
  }

  const rememberedPayee = hit.payeeId ? ctx.payees.find((p) => p.id === hit.payeeId) : undefined;
  if (
    rememberedPayee &&
    !typed(next.payeeName) &&
    normalizeName(next.payeeName ?? '') !== normalizeName(rememberedPayee.name)
  ) {
    next = {
      ...next,
      payeeName: rememberedPayee.name,
      defaulted: { ...next.defaulted, payee: false },
      learnedPayee: { enginePayeeName: next.payeeName, engineDefaulted: next.defaulted.payee, source: 'phrase' },
    };
  }

  const rememberedAccount = hit.accountId
    ? ctx.accounts.find((a) => a.id === hit.accountId && !a.archived)
    : undefined;
  if (
    rememberedAccount &&
    next.defaulted.account &&
    rememberedAccount.id !== next.accountId &&
    !next.unmatchedAccountName &&
    !next.ambiguousAccountNames?.length &&
    !next.accountSuggestion
  ) {
    // Same currency rule as the payee's learned account: switch only when it
    // cannot create a conflict this step can't see.
    const heard = next.mismatchedCurrency ?? null;
    const resolvesConflict = heard !== null && rememberedAccount.currency === heard;
    if (resolvesConflict || rememberedAccount.currency === next.currency) {
      const moved: TransactionDraft = {
        ...next,
        accountId: rememberedAccount.id,
        currency: rememberedAccount.currency,
        defaulted: { ...next.defaulted, account: false },
        learnedAccount: {
          engineAccountId: next.accountId,
          engineCurrency: next.currency,
          engineMismatchedCurrency: heard,
          source: 'phrase',
        },
      };
      if (resolvesConflict) delete moved.mismatchedCurrency;
      next = moved;
    }
  }

  if (next === draft) return draft;
  return { ...next, phraseMemoryKey: hit.key };
}

/** "Use <engine's type> instead" — undo a remembered type. A category the
 *  memory set with it is reverted too (it belongs to the remembered kind). */
export function revertLearnedType(draft: TransactionDraft): TransactionDraft {
  const l = draft.learnedType;
  if (!l) return draft;
  const next: TransactionDraft = { ...draft, type: l.engineType };
  delete next.learnedType;
  if (next.learnedCategory?.source === 'phrase') {
    next.categoryName = next.learnedCategory.engineCategoryName;
    next.defaulted = { ...next.defaulted, category: next.learnedCategory.engineDefaulted };
    delete next.learnedCategory;
  }
  return next;
}

/** "Use <engine's payee> instead" — undo a remembered payee. */
export function revertLearnedPayee(draft: TransactionDraft): TransactionDraft {
  const l = draft.learnedPayee;
  if (!l) return draft;
  const next: TransactionDraft = {
    ...draft,
    payeeName: l.enginePayeeName,
    defaulted: { ...draft.defaulted, payee: l.engineDefaulted },
  };
  delete next.learnedPayee;
  return next;
}

/** True when any field on the draft came from phrase memory. */
export function memoryApplied(draft: TransactionDraft): boolean {
  return (
    draft.learnedType?.source === 'phrase' ||
    draft.learnedPayee?.source === 'phrase' ||
    draft.learnedCategory?.source === 'phrase' ||
    draft.learnedAccount?.source === 'phrase'
  );
}

/** The fields a confirmed transaction teaches. */
export interface ConfirmedFields {
  type: TransactionType;
  categoryId: string | null;
  payeeId: string | null;
  accountId: string | null;
}

const fresh = (key: string, now: number): PhraseMemoryRow => ({
  key,
  verdict: null,
  type: null,
  categoryId: null,
  payeeId: null,
  accountId: null,
  hits: 0,
  reverts: 0,
  lastUsedAt: now,
  updatedAt: now,
});

/**
 * The row to store after the user confirmed (saved, or edited a saved AI
 * transaction) `fields` for `key`: the confirmed fields replace what was
 * remembered ("last confirmed wins"; a null never clears a remembered
 * category, payee or account — the user chose none, not "forget it"), hits
 * goes up, and a 'not_log' verdict becomes 'log' (the user did log these
 * words). Transfers teach nothing (their accounts come from the words).
 * Null when there is nothing to store.
 */
export function memoryPatch(
  key: string,
  fields: ConfirmedFields,
  previous: PhraseMemoryRow | null,
  now: number
): PhraseMemoryRow | null {
  if (!key || fields.type === 'transfer') return null;
  const base = previous ?? fresh(key, now);
  return {
    ...base,
    key,
    verdict: base.verdict === 'not_log' ? 'log' : base.verdict,
    type: fields.type,
    categoryId: fields.categoryId ?? base.categoryId,
    payeeId: fields.payeeId ?? base.payeeId,
    accountId: fields.accountId ?? base.accountId,
    hits: base.hits + 1,
    lastUsedAt: now,
    updatedAt: now,
  };
}

/** The row to store after "Log anyway" ('log') or after discarding a draft
 *  code affirmed ('not_log'). Null for an empty key. */
export function verdictPatch(
  key: string,
  verdict: PhraseVerdict,
  previous: PhraseMemoryRow | null,
  now: number
): PhraseMemoryRow | null {
  if (!key) return null;
  return { ...(previous ?? fresh(key, now)), key, verdict, lastUsedAt: now, updatedAt: now };
}

/** After the user reverted a field this memory applied: the row with one
 *  more revert, or 'delete' once it reaches `PHRASE_MEMORY_MAX_REVERTS`. */
export function revertPatch(previous: PhraseMemoryRow, now: number): PhraseMemoryRow | 'delete' {
  const reverts = previous.reverts + 1;
  if (reverts >= PHRASE_MEMORY_MAX_REVERTS) return 'delete';
  return { ...previous, reverts, updatedAt: now };
}

/** Keys to delete so at most `cap` rows remain: the least recently used
 *  first (oldest `lastUsedAt`, then oldest `updatedAt`, then key order). */
export function evictionKeys(rows: readonly PhraseMemoryRow[], cap: number = PHRASE_MEMORY_CAP): string[] {
  if (rows.length <= cap) return [];
  return [...rows]
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.updatedAt - b.updatedAt || a.key.localeCompare(b.key))
    .slice(0, rows.length - cap)
    .map((r) => r.key);
}

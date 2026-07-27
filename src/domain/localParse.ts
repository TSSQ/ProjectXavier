/**
 * On-device heuristic parse — the deterministic fallback floor for the
 * assistant input. When Apple Foundation Models is unavailable or couldn't
 * produce a usable parse, we still want to extract *something* useful
 * (amount + type reliably; category/payee conservatively) instead of erroring
 * out. The result is shaped exactly like an AiParsedExpense so it flows
 * through the EXISTING interpret()/draft-card/save path unchanged.
 *
 * Framework-free and side-effect-free (no RN/Expo imports, no Date.now())
 * so it can be exhaustively BDD-tested in plain Node alongside the rest of
 * src/domain.
 *
 * Deliberately conservative:
 *  - category: EXACT normalized match against the user's existing categories
 *    only — never a semantic guess ("pizza" never maps to "Food").
 *  - payee: only extracted from an explicit anchor ("at X" / "from X") —
 *    never inferred from an arbitrary noun in the sentence.
 */
import { Category, Payee, TransactionType } from './types';
import { AiParsedExpense } from '../lib/validation';
import { findPayeeMatch } from './payees';
import { findCategoryMatch } from './categories';
import { normalizeName } from './textMatch';
import { toMinorUnits } from './money';

export interface LocalParseContext {
  categories: Category[];
  payees: Payee[];
  /** Injected clock — never call Date.now() inside this module. */
  now: number;
  /** The app's current single-currency setting (`getCurrency()`) — the
   *  extracted amount is scaled to THIS currency's exponent (review F1 / M7),
   *  so a JPY "coffee 500" extracts 500 minor units, not 50000. Defaults to
   *  'USD' (2-decimal) so existing callers/tests are unaffected. */
  currency?: string;
}

// ─── amount ─────────────────────────────────────────────────────────────

/** Money token: optional currency symbol, digits with optional ',' thousands
 *  separators and a '.' decimal, optional 'k'/'K' suffix (×1000). The
 *  trailing negative lookahead keeps us from matching into a following word
 *  (e.g. the "3" in "3rd").
 *
 *  KNOWN LIMITATION (deliberate, no guard added): a bare 4-digit year like
 *  "2026" parses as an amount ($2,026.00) — a year-guard would risk rejecting
 *  legitimate amounts in that same numeric range. */
const MONEY_RE =
  /([$€£¥])?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)([kK])?(?![a-zA-Z])/g;

/** Words that, immediately adjacent to a number, mark it as "the" amount when
 *  several numbers are present (priority 2 of the amount-selection rule). */
const ADJACENT_AMOUNT_RE =
  /^(spent|spend|paid|pay|cost|received|refunded?|earned|deposit(?:ed)?|transfer(?:red)?|moved?|salary|income|got)$/i;

interface AmountCandidate {
  minor: number;
  currencyAnchored: boolean;
  verbAdjacent: boolean;
}

function extractAmountCandidates(text: string, currency: string): AmountCandidate[] {
  const words = [...text.matchAll(/\S+/g)];
  const candidates: AmountCandidate[] = [];

  for (const m of text.matchAll(MONEY_RE)) {
    const numStr = m[2];
    if (!numStr) continue;
    let value = parseFloat(numStr.replace(/,/g, ''));
    if (Number.isNaN(value)) continue;
    if (m[3]) value *= 1000; // k/K suffix
    const minor = toMinorUnits(value, currency);

    const start = m.index ?? 0;
    const wordIdx = words.findIndex(
      (w) => w.index !== undefined && w.index <= start && start < w.index + w[0].length
    );
    const prevWord = wordIdx > 0 ? words[wordIdx - 1]![0] : '';
    const nextWord =
      wordIdx >= 0 && wordIdx + 1 < words.length ? words[wordIdx + 1]![0] : '';
    const strip = (w: string) => w.replace(/[^a-zA-Z]/g, '');
    const verbAdjacent =
      ADJACENT_AMOUNT_RE.test(strip(prevWord)) || ADJACENT_AMOUNT_RE.test(strip(nextWord));

    candidates.push({ minor, currencyAnchored: !!m[1], verbAdjacent });
  }
  return candidates;
}

/**
 * Select the amount from all money tokens found in the text:
 *   1. a currency-symbol-anchored number ("$100"), else
 *   2. a number adjacent to a spend/income verb ("spent 45"), else
 *   3. the largest number present.
 * null when no number was found at all.
 */
function selectAmount(text: string, currency: string): number | null {
  const candidates = extractAmountCandidates(text, currency);
  if (candidates.length === 0) return null;

  const currencyAnchored = candidates.filter((c) => c.currencyAnchored);
  if (currencyAnchored.length > 0) return currencyAnchored[0]!.minor;

  const verbAdjacent = candidates.filter((c) => c.verbAdjacent);
  if (verbAdjacent.length > 0) return verbAdjacent[0]!.minor;

  return candidates.reduce((best, c) => (c.minor > best.minor ? c : best)).minor;
}

// ─── type ───────────────────────────────────────────────────────────────

const INCOME_RE =
  /\b(received|refunded?|salary|deposit(?:ed)?|income|earned|got\s+paid)\b/i;
const TRANSFER_RE = /\b(transfer(?:red)?|moved?)\b/i;

function inferType(text: string): TransactionType {
  if (INCOME_RE.test(text)) return 'income';
  if (TRANSFER_RE.test(text)) return 'transfer';
  return 'expense';
}

// ─── category ───────────────────────────────────────────────────────────

/**
 * Try every word/phrase (n-gram, longest first) in the text against the
 * user's existing categories of the inferred kind, accepting ONLY an exact
 * normalized match (findCategoryMatch's `.exact`, never `.suggestion`).
 * Never invents a category — no semantic mapping.
 */
function findExistingCategory(
  text: string,
  type: TransactionType,
  categories: Category[]
): string | null {
  const words = normalizeName(text).split(' ').filter(Boolean);
  if (words.length === 0 || categories.length === 0) return null;

  const maxN = Math.min(4, words.length);
  for (let n = maxN; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      const { exact } = findCategoryMatch(phrase, type, categories);
      if (exact) return exact.name;
    }
  }
  return null;
}

// ─── payee ──────────────────────────────────────────────────────────────

/** Words that end a payee capture rather than being part of it — the
 *  spend/income/transfer verbs, common prepositions, and the anchor words
 *  themselves (in case of "at X from Y" style phrasing). Case-insensitive. */
const PAYEE_STOP_WORDS =
  '(?:spent|spend|paid|pay|cost|received|refunded?|earned|deposit(?:ed)?|' +
  'transfer(?:red)?|moved?|salary|income|got|and|but|on|in|for|with|of|' +
  'the|a|an|at|from|to)';

/** A single payee-name token: a word that isn't one of the stop words above. */
const PAYEE_TOKEN_RE = `(?!\\b${PAYEE_STOP_WORDS}\\b)[A-Za-z][A-Za-z0-9&'-]*`;

/** "at X" / "from X" — X is 1-3 tokens, case-insensitive (matches the common
 *  lowercase mobile-typing case), stopping at a number, a verb, a comma, or a
 *  common preposition so it can't run away with the rest of the sentence.
 *  "to" is deliberately NOT an anchor: it's usually an infinitive ("to buy")
 *  or a direction ("drove to work"), too low-precision to trust as a payee.
 *  No anchor present → no payee. */
const PAYEE_ANCHOR_RE = new RegExp(
  `\\b(?:at|from)\\s+(${PAYEE_TOKEN_RE}(?:\\s+${PAYEE_TOKEN_RE}){0,2})`,
  'i'
);

/** Hard cap on the captured payee text length (schema allows up to 100). */
const PAYEE_MAX_LEN = 40;

function extractPayee(text: string, payees: Payee[]): string | null {
  const m = PAYEE_ANCHOR_RE.exec(text);
  if (!m) return null;
  let extracted = m[1]!.trim();
  if (!extracted) return null;
  if (extracted.length > PAYEE_MAX_LEN) {
    extracted = extracted.slice(0, PAYEE_MAX_LEN).trim();
  }

  // Only an EXACT normalized match adopts the existing payee's canonical
  // name. A fuzzy (near-typo) match or no match at all returns the raw
  // extracted text as-is — the caller's own findPayeeMatch reconcile (same
  // helper) is what surfaces the "did you mean…?" chip, matching the FM
  // parse's UX instead of silently merging behind the user's back.
  const { exact } = findPayeeMatch(extracted, payees);
  if (exact) return exact.name;
  return extracted; // new-payee candidate (or a fuzzy-suggestion case)
}

// ─── entry point ────────────────────────────────────────────────────────

export function localParse(text: string, ctx: LocalParseContext): AiParsedExpense {
  const rawAmount = selectAmount(text, ctx.currency ?? 'USD');
  // aiParsedExpenseSchema requires a positive amount — treat 0 as "no amount
  // found" rather than a confirmable $0.00 draft that would dead-end at save.
  const amount = rawAmount === 0 ? null : rawAmount;
  const type = inferType(text);
  const category = findExistingCategory(text, type, ctx.categories);
  const payee = extractPayee(text, ctx.payees);

  return {
    amount,
    currency: null, // interpret() fills this from the resolved account.
    type,
    category,
    payee,
    account: null,
    note: null,
    occurredAt: ctx.now,
    confidence: amount != null ? 0.9 : 0,
    // The heuristic tier has no notion of an explicit pending marker — only
    // the FM tier's guarded textHasPendingMarker proposes this.
    pending: false,
  };
}

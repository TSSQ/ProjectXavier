/**
 * Deterministic account target-matcher — `findAccountMatch` resolves a free-
 * text reference ("DBS Savings", "my savings", "the card") to a real account
 * row, for chat-driven UPDATE/DELETE (docs/design/account-chat-crud-spec.md
 * §5.1). Mirrors `findPayeeMatch`/`findCategoryMatch` (payees.ts/categories.ts)
 * — exact → case-insensitive → token/substring → fuzzy — plus one capability
 * those don't need: resolving by SUBTYPE CUE ("the card" → the credit_card
 * account, "my savings" → a bank account) so semantic references the user
 * never typed verbatim still resolve without a model.
 *
 * This is the deterministic PRIMARY resolver (spec §6.2 verdict): the model
 * may propose a target string, but it is ALWAYS re-resolved through this
 * function — never trusted as an account id on its own (a model can't
 * invent/return a real id, only a string, and this is what turns that string
 * into a real `Account` or a clear "ambiguous"/"no match" signal instead).
 *
 * Framework-free (no RN/Expo imports) — BDD-testable in plain Node.
 */
import { Account } from './types';
import { normalizeName, editDistance, fuzzyThreshold, boundedNamePattern } from './textMatch';

export interface AccountMatch {
  /** A confidently resolved account — the caller may act on this directly. */
  account?: Account;
  /** Rough confidence signal for `account`/`suggestion` (0-1). Informational
   *  only, never gated on (the probe found confidence numbers noisy/near-
   *  useless on-device — spec §6.1/§6.2 — so this is a coarse "how did we
   *  get here" label, not a threshold). */
  confidence: number;
  /** A near-miss (typo-distance) match — NOT auto-resolved, since a wrong
   *  guess here risks silently targeting a different real account. */
  suggestion?: Account;
  /** Set when 2+ accounts are equally plausible at the level that matched —
   *  the caller must ask "which account?" rather than silently picking one. */
  ambiguous?: Account[];
}

/** Cue phrase → canonical subtype, checked when no name-based match resolves
 *  anything — lets "the card"/"my savings"/"my current account" resolve by
 *  MEANING rather than literal name. Order matters: longer/more specific
 *  phrases first, same convention as accountIntent.ts's ACCOUNT_NOUNS. */
const SUBTYPE_CUES: ReadonlyArray<{ phrase: string; subtype: string }> = [
  { phrase: 'credit card', subtype: 'credit_card' },
  { phrase: 'debit card', subtype: 'credit_card' },
  { phrase: 'checking', subtype: 'bank' },
  { phrase: 'chequing', subtype: 'bank' },
  { phrase: 'current', subtype: 'bank' },
  { phrase: 'savings', subtype: 'bank' },
  { phrase: 'brokerage', subtype: 'investment' },
  { phrase: 'investment', subtype: 'investment' },
  { phrase: 'mortgage', subtype: 'loan' },
  { phrase: 'loan', subtype: 'loan' },
  { phrase: 'wallet', subtype: 'cash' },
  { phrase: 'cash', subtype: 'cash' },
  { phrase: 'debit', subtype: 'credit_card' },
  { phrase: 'credit', subtype: 'credit_card' },
  { phrase: 'card', subtype: 'credit_card' },
];

/**
 * Cue phrases that are essentially the SUBTYPE's own generic descriptor
 * rather than a genuine sub-category distinguisher (QA MAJOR follow-up).
 * "the card" doesn't tell you WHICH credit-card account any more than "the
 * account" would tell you which bank account — practically ANY credit-card
 * account could plausibly be named "...Card" ("Chase Card", "Amex Card",
 * "Travel Card"), so a name containing "card" is not a real disambiguator
 * between two credit_card accounts, unlike "savings" vs "current" (real
 * sub-flavors distinguishing WITHIN the coarse "bank" subtype — "DBS
 * Savings" vs "OCBC Current" legitimately differ by which one is actually a
 * savings account). Excluded from the same-subtype name-token
 * disambiguation below; a generic cue with 2+ same-subtype candidates always
 * falls through to `ambiguous`.
 */
const GENERIC_CUE_PHRASES = new Set(['credit card', 'debit card', 'card', 'cash', 'loan', 'investment']);

/** Exported so `accountUpdateAssistant.ts` can reuse the exact same cue
 *  vocabulary to detect "does this text mention a new account TYPE at all"
 *  (its rename-vs-retype classifier), without duplicating the list. */
export function detectSubtypeCue(text: string): string | null {
  return subtypeCueFrom(normalizeName(text))?.subtype ?? null;
}

/**
 * True when `target` and `accountName` reference each other as a whole
 * word/phrase in either direction ("dbs" ⊂ "dbs savings", "amex" ⊂ "my
 * amex"). Deliberately has NO length-ratio cutoff (unlike payees.ts's
 * `isWholeWordVariant`, tuned for open-ended user-typed payee names where a
 * short common word matching everything is a real risk) — the account list
 * is small and curated, so a short real abbreviation ("DBS") confidently
 * referencing its one matching account is exactly the capability this needs,
 * not a false-positive risk worth guarding against.
 */
function isAccountNameReference(target: string, accountName: string): boolean {
  if (!target || !accountName) return false;
  if (new RegExp(boundedNamePattern(target), 'i').test(accountName)) return true;
  return new RegExp(boundedNamePattern(accountName), 'i').test(target);
}

/** First (phrase, subtype) whose phrase appears as a whole word in `target`,
 *  or null. Returns the phrase too (not just the subtype) so callers can use
 *  the phrase itself to disambiguate same-subtype accounts (see below). */
function subtypeCueFrom(target: string): { phrase: string; subtype: string } | null {
  for (const cue of SUBTYPE_CUES) {
    if (new RegExp(`\\b${cue.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(target)) {
      return cue;
    }
  }
  return null;
}

/**
 * Resolve `text` (a model-proposed target string, or the raw utterance as a
 * deterministic-floor fallback) against `accounts`. Ladder, each level tried
 * in order, stopping at the first level that produces ANY candidate(s):
 *
 *  1. Exact (normalized — trim/collapse-whitespace/lowercase) name match.
 *  2. Token/substring containment ("DBS" → "DBS Savings", "wallet" → "Cash
 *     Wallet") — the same whole-word-variant check payees.ts uses for "the
 *     kopitiam" vs "kopitiam".
 *  3. Subtype cue ("the card" → the credit_card account, "my savings" → a
 *     bank account). When 2+ accounts share that subtype (e.g. both a
 *     checking and a savings account are subtype "bank"), the cue PHRASE
 *     itself is tried as a literal token in the account's own name first
 *     ("savings" narrows "DBS Savings" out of a same-subtype "OCBC Current")
 *     before giving up and reporting ambiguous.
 *  4. Fuzzy edit-distance (typo tolerance) — offered only as `suggestion`,
 *     never auto-resolved (an account-name typo genuinely risks matching the
 *     wrong real account, unlike a payee/category "did you mean").
 *
 * Returns `null` when nothing at any level matched at all.
 */
export function findAccountMatch(text: string, accounts: Account[]): AccountMatch | null {
  const target = normalizeName(text);
  if (!target || accounts.length === 0) return null;

  // 1. Exact / case-insensitive.
  const exact = accounts.filter((a) => normalizeName(a.name) === target);
  if (exact.length === 1) return { account: exact[0], confidence: 1 };
  if (exact.length > 1) return { confidence: 0, ambiguous: exact };

  // 2. Token/substring containment.
  const contained = accounts.filter((a) => isAccountNameReference(target, normalizeName(a.name)));
  if (contained.length === 1) return { account: contained[0], confidence: 0.85 };
  if (contained.length > 1) return { confidence: 0, ambiguous: contained };

  // 3. Subtype cue, with same-subtype disambiguation by the cue word itself
  //    — but NEVER when the cue word is merely the subtype's own generic
  //    descriptor (GENERIC_CUE_PHRASES — see its header): "the card" with
  //    two credit_card accounts must ask, not confidently guess whichever
  //    one happens to literally contain "card".
  const cue = subtypeCueFrom(target);
  if (cue) {
    const bySubtype = accounts.filter((a) => a.subtype === cue.subtype);
    if (bySubtype.length === 1) return { account: bySubtype[0], confidence: 0.7 };
    if (bySubtype.length > 1) {
      if (!GENERIC_CUE_PHRASES.has(cue.phrase)) {
        const byCueWord = bySubtype.filter((a) => normalizeName(a.name).includes(cue.phrase));
        if (byCueWord.length === 1) return { account: byCueWord[0], confidence: 0.75 };
      }
      return { confidence: 0, ambiguous: bySubtype };
    }
  }

  // 4. Fuzzy edit-distance — a suggestion only.
  let best: Account | undefined;
  let bestDistance = Infinity;
  let bestThreshold = 0;
  for (const a of accounts) {
    const candidate = normalizeName(a.name);
    const distance = editDistance(target, candidate);
    if (distance < bestDistance) {
      best = a;
      bestDistance = distance;
      bestThreshold = fuzzyThreshold(Math.max(target.length, candidate.length));
    }
  }
  if (best && bestDistance > 0 && bestDistance <= bestThreshold) {
    return { confidence: 0.4, suggestion: best };
  }

  return null;
}

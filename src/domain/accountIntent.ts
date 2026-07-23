/**
 * Deterministic account-creation intent gate (chat-driven account creation —
 * docs/design/account-chat-creation-spec.md §5.1). Runs in `runParse`
 * (app/(tabs)/index.tsx) BEFORE the expense parse ladder, alongside the
 * existing `isAccountCommand`/`transactionCommandBody` checks — an explicit
 * "/account" always wins outright (handled earlier, in onSend).
 *
 * Probe finding #1 (spec §3): intent classification is unreliable when left
 * to a model — "paid mum 50" and "add 500 to groceries" were both wrongly
 * flagged as account creation by Apple's on-device model. So this gate is a
 * pure, deterministic function; the model NEVER decides intent, only this
 * code does. It is the single most important piece to get right (spec §11.1)
 * — a false positive here hijacks an ordinary expense into the account flow.
 *
 * A hit requires BOTH a creation verb and an account noun, with the noun
 * occurring after the verb. The hard part is telling "create a thing" apart
 * from "add money to an existing thing" — QA found the first cut of this
 * (checking only the text between one candidate verb and the noun) had two
 * real bypasses:
 *   - "new" is itself a creation verb AND a common adjective right before an
 *     account noun ("add 20 to my new wallet") — pairing the noun with the
 *     nearby "new" instead of the real "add ... to" skipped the exclusion.
 *   - a possessive/article between the preposition and the noun ("add money
 *     to my account") wasn't "immediately before the noun", so an
 *     immediately-adjacent-preposition check alone missed it.
 *
 * The fix (the "government" rule): whether the noun is a DESTINATION is a
 * property of the noun itself, checked ONCE per occurrence, independent of
 * which verb ends up paired with it — not a property of one particular
 * (verb, noun) pairing. A directional preposition (to/into/onto/from)
 * GOVERNS the noun when, scanning backward from the noun, only determiner/
 * possessive/subtype-adjective words appear before reaching it, with NO verb
 * (or anything else) in between; a verb in between BLOCKS the preposition
 * from governing across it (see `isGovernedByPreposition`) — this is what
 * keeps "I want TO add a savings account" (the infinitive "to add", not "to
 * savings") from being wrongly excluded while still excluding "add 20 TO my
 * new wallet" and "add money TO my account".
 *
 * Two more guards close the remaining gaps:
 *   - Position anchor for bare "new" only (QA follow-up): unlike every other
 *     creation verb (add/create/open/make/set up/start(tracking)), "new" is
 *     ALSO an ordinary adjective, so it reads exactly like a real hit even
 *     when it's merely REFERENCING an already-owned thing. A genuine "new …"
 *     creation command always OPENS the utterance ("new wallet", "new
 *     savings account"); a reference to an existing thing never does
 *     ("thanks for the new wallet", "lost my new wallet", "my new savings
 *     account is empty" — in every one of these "new" sits mid-sentence,
 *     describing something the user already has). So bare "new" only counts
 *     as a creation trigger when it is the FIRST token of the (trimmed,
 *     lowercased) text — see `firstTokenStart` below. This is scoped to bare
 *     "new" alone; every other creation verb is unambiguous and stays
 *     unanchored ("I want to create a wallet" still hits via "create").
 *   - Forward guard, for EVERY creation verb (reviewer follow-up — this used
 *     to be wired to bare "new" only, which meant "make a credit card
 *     PAYMENT 200" and "open a savings GOAL" hit via the unrestricted verbs,
 *     hijacking real expenses): the text right after the matched noun phrase
 *     must not continue with another content noun ("credit card PAYMENT",
 *     "savings GOAL", "new card GAME") — that's an ATTRIBUTIVE use of the
 *     account noun modifying a different head noun, not "create a thing".
 *     Checked once per noun occurrence, independent of the verb — see
 *     `isAllowedTrailingAfterNoun`.
 */
import { escapeRegExp } from './textMatch';

/** A gate hit — `subtypeHint` is the canonical subtype the matched noun
 *  implies (one of accountParseSchema's known subtypes), or undefined for a
 *  generic noun ("account") that implies no particular type. */
export interface AccountIntent {
  subtypeHint?: string;
}

/** "start tracking" is kept alongside bare "start" (both listed independently
 *  — a redundant double-match on "start tracking ..." text is harmless) so
 *  "start a savings/brokerage account" hits without requiring "tracking". */
const CREATION_VERBS = [
  'create',
  'add',
  'open',
  'new',
  'set up',
  'start tracking',
  'make',
  'start',
];

/** Account noun -> canonical subtype hint (undefined = generic, no hint).
 *  Order matters: longer/more specific phrases are checked before the
 *  shorter words they contain ("current account"/"credit card" before
 *  "account"/"card") so the more specific hint wins. Mirrors the aliasing
 *  intent of accountAssistant.ts's `normalizeSubtype` (savings/checking-style
 *  words -> "bank", "wallet" -> "cash", card words -> "credit_card", ...) —
 *  see docs/design/account-chat-creation-spec.md §5.1/§6 for the exact
 *  mapping this reproduces. */
const ACCOUNT_NOUNS: ReadonlyArray<{ phrase: string; subtypeHint?: string }> = [
  { phrase: 'current account', subtypeHint: 'bank' },
  { phrase: 'credit card', subtypeHint: 'credit_card' },
  { phrase: 'checking', subtypeHint: 'bank' },
  { phrase: 'chequing', subtypeHint: 'bank' },
  { phrase: 'savings', subtypeHint: 'bank' },
  { phrase: 'brokerage', subtypeHint: 'investment' },
  { phrase: 'investment', subtypeHint: 'investment' },
  { phrase: 'mortgage', subtypeHint: 'loan' },
  { phrase: 'loan', subtypeHint: 'loan' },
  { phrase: 'wallet', subtypeHint: 'cash' },
  { phrase: 'debit', subtypeHint: 'credit_card' },
  { phrase: 'card', subtypeHint: 'credit_card' },
  { phrase: 'account', subtypeHint: undefined },
];

/** An amount ("500", "$1,250.50") anywhere between the verb and the noun —
 *  the "add money to a thing" shape, not "create a thing". Kept as an
 *  independent check alongside the preposition-government rule below (spec
 *  §5.1 lists the amount-between and the preposition as two separate
 *  exclusion reasons). */
const AMOUNT_BETWEEN_RE = /[$£€]?\d[\d,]*(?:\.\d+)?/;

/** Directional prepositions that make an account noun a DESTINATION rather
 *  than the thing being created. */
const DIRECTIONAL_PREPOSITIONS = new Set(['to', 'into', 'onto', 'from']);

/** Determiners/possessives/subtype-adjectives that may sit between a
 *  governing preposition and the noun without breaking the government (QA
 *  follow-up): "the|a|an|my|your|our|their|his|her|new|existing|old" plus
 *  the subtype-adjective words that legitimately precede "account"/another
 *  noun ("my new SAVINGS account", "to my CREDIT card"). */
const GOVERNOR_WORDS = new Set([
  'the', 'a', 'an', 'my', 'your', 'our', 'their', 'his', 'her',
  'new', 'existing', 'old',
  'savings', 'checking', 'chequing', 'current', 'credit', 'debit',
  'loan', 'mortgage', 'investment', 'brokerage', 'cash', 'wallet', 'card',
]);

/** Words that may naturally follow a just-created account noun without
 *  turning it into an ATTRIBUTIVE modifier of a different head noun — used
 *  for every creation verb (reviewer follow-up: "make a credit card PAYMENT
 *  200", "open a savings GOAL", "open a credit card STATEMENT" all have an
 *  unrestricted verb, not just bare "new", so this can't be scoped to "new"
 *  alone). See `isAllowedTrailingAfterNoun`.
 *
 *  "named"/"called"/"ending" (reviewer recall follow-up) are unambiguously
 *  introducing the account's own name/description ("a wallet NAMED travel",
 *  "a credit card ENDING 1234") — never a different head noun — so they carry
 *  near-zero false-positive re-open risk. Deliberately NOT added:
 *  "at"/"in"/"of" — those DO carry real re-open risk ("add a card AT
 *  starbucks" is an expense, not creation), so those utterances are an
 *  accepted MISS instead (see the feature file's "accepted MISS" scenario) —
 *  safer to fall through to "please rephrase" than risk a money-hijack false
 *  positive. */
const ALLOWED_TRAILING_WORDS = new Set([
  'account', 'accounts', 'for', 'with', 'please', 'named', 'called', 'ending',
]);

interface WordToken {
  word: string;
  start: number;
}

/** Tokenize into lowercase word tokens with their character offsets — the
 *  unit both the preposition-government scan and the trailing-word check
 *  walk over. */
function wordTokens(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /[a-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tokens.push({ word: m[0], start: m.index });
  return tokens;
}

/**
 * True when a directional preposition GOVERNS the noun starting at
 * `nounStart` — walking backward from (just before) the noun, only
 * `GOVERNOR_WORDS` appear before a directional preposition is reached, with
 * NO verb (or anything else) in between. Checked ONCE per noun occurrence,
 * independent of any particular verb — see the module header.
 */
function isGovernedByPreposition(nounStart: number, tokens: WordToken[]): boolean {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i]!;
    if (tok.start >= nounStart) continue; // part of the noun phrase itself, or after it
    if (DIRECTIONAL_PREPOSITIONS.has(tok.word)) return true;
    if (!GOVERNOR_WORDS.has(tok.word)) return false; // blocked — a real verb or other word
  }
  return false;
}

/** Gate applied to every noun occurrence, regardless of which creation verb
 *  might pair with it: the text immediately after the matched noun phrase
 *  must be empty (end of input), start with a colon (a "New account: DBS"-
 *  style label), start with a digit, or continue with one of
 *  `ALLOWED_TRAILING_WORDS` — otherwise the noun is ATTRIBUTIVELY modifying a
 *  different head noun ("credit card PAYMENT", "savings GOAL", "new card
 *  GAME") rather than being the thing created. */
function isAllowedTrailingAfterNoun(text: string, nounEnd: number): boolean {
  const after = text.slice(nounEnd).replace(/^\s+/, '');
  if (!after) return true;
  if (after.startsWith(':') || /^\d/.test(after)) return true;
  const m = /^[a-z0-9]+/.exec(after);
  return !!m && ALLOWED_TRAILING_WORDS.has(m[0]);
}

function wordPositions(phrase: string, text: string): number[] {
  const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'g');
  const hits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) hits.push(m.index);
  return hits;
}

/**
 * Deterministic account-creation intent gate. Returns `{ subtypeHint }` on a
 * hit (subtypeHint may be undefined for a generic "account" noun), or `null`
 * when the text isn't recognised as account creation — including the
 * "add/transfer money to an existing account" shape, which must fall
 * through to the expense ladder instead.
 */
export function detectAccountIntent(text: string): AccountIntent | null {
  const t = text.toLowerCase();
  const tokens = wordTokens(t);
  // Bare "new" only counts as a creation trigger when it's the very first
  // word of the utterance (see the module header's position-anchor note) —
  // computed once so every "new" occurrence can be checked against it below.
  const firstTokenStart = tokens.length ? tokens[0]!.start : -1;

  const verbMatches: Array<{ end: number; verb: string }> = [];
  for (const verb of CREATION_VERBS) {
    for (const start of wordPositions(verb, t)) {
      if (verb === 'new' && start !== firstTokenStart) continue;
      verbMatches.push({ end: start + verb.length, verb });
    }
  }
  if (!verbMatches.length) return null;

  for (const noun of ACCOUNT_NOUNS) {
    for (const nounStart of wordPositions(noun.phrase, t)) {
      // A noun governed by a directional preposition is a DESTINATION
      // ("... to my new wallet", "... to my account") — never the thing
      // being created, regardless of which verb might otherwise pair with
      // it. Checked once per occurrence, before considering any verb.
      if (isGovernedByPreposition(nounStart, tokens)) continue;

      // An attributive use ("credit card PAYMENT", "savings GOAL") is never
      // the thing being created, regardless of which verb precedes it —
      // checked once per occurrence, same as the government check above.
      const nounEnd = nounStart + noun.phrase.length;
      if (!isAllowedTrailingAfterNoun(t, nounEnd)) continue;

      for (const { end: verbEnd } of verbMatches) {
        if (verbEnd > nounStart) continue; // the noun must follow the verb
        const between = t.slice(verbEnd, nounStart);
        if (AMOUNT_BETWEEN_RE.test(between)) continue;
        return { subtypeHint: noun.subtypeHint };
      }
    }
  }
  return null;
}

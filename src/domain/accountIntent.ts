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
 *
 * ── Op discrimination (docs/design/account-chat-crud-spec.md §4) ──────────
 * Extended from "account-creation or null" to a discriminated `{ op,
 * subtypeHint }`, where `op` is 'create' | 'update' | 'delete'. The model
 * NEVER decides `op` — same discipline as the subtype hint above; only this
 * pure, synchronous function does. The noun-side rules above (government,
 * attributive/trailing guard, "new" position-anchor) are IDENTICAL for every
 * op — whether a piece of text even REFERS to an account at all is one
 * question, answered once per noun occurrence; which verb governs that
 * occurrence (create/update/delete) is a separate, independent question,
 * answered by which verb-category list precedes the noun with nothing
 * disqualifying between them (same "amount between"/government rules as
 * before, just applied per category instead of one fixed list).
 *
 * Three verb categories:
 *  - CREATE_VERBS — unchanged from the original create-only gate.
 *  - UPDATE_VERBS — rename/change/update/edit/rebalance: unambiguous edit
 *    verbs with no create meaning. Deliberately EXCLUDES bare "set" (spec §4
 *    lists it, but "set" is also the first word of "set up", already a
 *    CREATE_VERBS phrase — "set up a wallet" would otherwise ALSO match as
 *    an update-verb occurrence for the exact same "set" substring, a
 *    needless collision for a verb whose update use ("set OCBC balance to
 *    5000") never has an ACCOUNT_NOUN word next to it anyway, so the gate
 *    can't reach it either way — see the accepted-miss note below).
 *  - DELETE_VERBS — delete/remove/close/"get rid of". "remove"/"close" read
 *    exactly like ordinary expense/unrelated words UNLESS an account noun
 *    follows ungoverned — "remove 50 from savings" is excluded by the
 *    EXISTING preposition-government rule (unchanged, "from" governs
 *    "savings" here) before op-category is ever considered; "close the app"
 *    is excluded because "app" isn't an ACCOUNT_NOUN at all.
 *
 * "make" is special: it is BOTH a create verb ("make a wallet") and, per
 * spec §4, an update verb when it means "make X an existing Y a Z"
 * ("make my cash wallet a bank account", "make the card Amex Platinum").
 * Disambiguated per occurrence by the single word immediately following
 * "make": a possessive/definite word ("my"/"your"/"our"/"their"/"his"/
 * "her"/"the") means the user is re-typing something they already own
 * (UPDATE); an indefinite article or anything else ("a"/"an"/"new"/absent)
 * means they're introducing a new one (CREATE, unchanged from today) — see
 * `isRetypeMake`.
 *
 * Accepted miss (documented, not fixed — matches this file's existing
 * "safer to fall through than risk a hijack" philosophy): an update/delete
 * utterance with NO ACCOUNT_NOUN word at all ("set OCBC balance to 5000",
 * "close it") is not detected by this gate — it has no noun to anchor the
 * government/attributive rules to. Real utterances almost always carry one
 * ("account", a subtype word, "card", "wallet", …); `findAccountMatch`
 * (src/domain/accountMatch.ts) is what actually resolves WHICH account,
 * using the real account list this gate never sees.
 */
import { escapeRegExp } from './textMatch';

export type AccountOp = 'create' | 'update' | 'delete';

/** A gate hit — `op` is which account operation the text describes;
 *  `subtypeHint` is the canonical subtype the matched noun implies (one of
 *  accountParseSchema's known subtypes), or undefined for a generic noun
 *  ("account") that implies no particular type. */
export interface AccountIntent {
  op: AccountOp;
  subtypeHint?: string;
}

/** "start tracking" is kept alongside bare "start" (both listed independently
 *  — a redundant double-match on "start tracking ..." text is harmless) so
 *  "start a savings/brokerage account" hits without requiring "tracking". */
const CREATE_VERBS = [
  'create',
  'add',
  'open',
  'new',
  'set up',
  'start tracking',
  'make',
  'start',
];

/** Unambiguous edit verbs — see the module header for why bare "set" isn't
 *  here (collides with "set up", a CREATE_VERBS phrase). */
const UPDATE_VERBS = ['rename', 'change', 'update', 'edit', 'rebalance'];

/** Unambiguous delete/close verbs. Multi-word "get rid of" mirrors how
 *  CREATE_VERBS already carries multi-word phrases ("set up", "start
 *  tracking") — `wordPositions` matches a literal phrase with `\b...\b`
 *  regardless of word count. */
const DELETE_VERBS = ['delete', 'remove', 'close', 'get rid of'];

/** Possessive/definite words that, immediately after "make", signal the user
 *  is re-typing something they already own ("make MY wallet a credit card")
 *  rather than introducing a new one ("make A wallet") — see `isRetypeMake`. */
const RETYPE_DETERMINERS = new Set(['my', 'your', 'our', 'their', 'his', 'her', 'the']);

/** True when the word immediately following a "make" occurrence (ending at
 *  `makeEnd`) is a possessive/definite determiner — the "make X a Y" retype
 *  shape (spec §4), as opposed to "make a/an/new X" (create, unchanged). */
function isRetypeMake(makeEnd: number, tokens: WordToken[]): boolean {
  let next: WordToken | undefined;
  for (const tok of tokens) {
    if (tok.start < makeEnd) continue;
    if (!next || tok.start < next.start) next = tok;
  }
  return !!next && RETYPE_DETERMINERS.has(next.word);
}

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

/** Non-directional "this is a MENTION, not the target" prepositions (QA
 *  MAJOR follow-up) — "change my mind ABOUT the wallet" is not an update,
 *  "remove the notification ABOUT my credit card" is not a delete: the
 *  account noun is the object of an unrelated topical clause, not the
 *  operation's actual target. Same government idea as
 *  DIRECTIONAL_PREPOSITIONS (only GOVERNOR_WORDS may sit between the
 *  preposition and the noun), generalized to these.
 *
 *  Deliberately does NOT include "of", despite being the most obvious
 *  "about a topic" preposition ("the subject of my wallet"): "of" is also
 *  the tail particle of the DELETE_VERBS phrase "get rid OF my wallet" —
 *  treating every "of" as a clause-boundary would wrongly exclude that
 *  verb's own object and break the existing "get rid of my wallet" -> delete
 *  hit. Telling the two apart would need to know the verb phrase during this
 *  noun-only scan, which the government check doesn't have (see the module
 *  header — noun-side rules are checked independently of any verb). Accepted
 *  gap: "the story of my wallet" mis-hitting is a MUCH lower-frequency
 *  collision than "get rid of" wrongly missing, so this stays out.
 *
 *  Also deliberately does NOT include "on" (QA recall-regression follow-up):
 *  "on" is overloaded — it idiomatically means "belonging to" at least as
 *  often as "regarding a topic", and the "belonging to" sense is exactly the
 *  operation's REAL target, not a mention of it — "change the balance ON my
 *  savings", "update the balance ON my card", "change my card ON FILE to
 *  Amex" are all common, legitimate finance phrasing that must still HIT.
 *  Unlike "of" (a narrow, single verb-phrase carve-out), "on" would have
 *  silently missed this whole common class, so it's excluded outright rather
 *  than special-cased.
 *
 *  Pre-existing limitation this shares with DIRECTIONAL_PREPOSITIONS (not
 *  introduced by this set): GOVERNOR_WORDS is a closed vocabulary of
 *  determiners/possessives/subtype-adjectives, so a PROPER NOUN sitting
 *  between the preposition and the account noun ("regarding my DBS
 *  account") breaks the backward scan before it ever reaches the
 *  preposition, same as it always has for "to"/"from" ("add 500 to my DBS
 *  account" is likewise not governed today) — an accepted miss, not a new
 *  gap from this change. */
const CLAUSE_PREPOSITIONS = new Set(['about', 'regarding', 're']);

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
 *  positive.
 *
 *  "to" (spec §4/crud-spec addition) is different in kind from "at"/"in"/
 *  "of": English never forms a noun-noun attributive compound with "to"
 *  ("credit card to" isn't a thing the way "credit card payment" is) — "to"
 *  after the noun is always either a genuine destination preposition
 *  (already separately excluded by `isGovernedByPreposition`, which looks
 *  BEFORE the noun) or an infinitive ("to save", "to build credit") or,
 *  the case this was added for, introducing the update's own new value
 *  ("rename my DBS account TO Rainy Day", "change the card TO Amex
 *  Platinum") — so allowing it here carries none of "at"/"in"/"of"'s
 *  re-open risk.
 *
 *  "on" (QA recall-regression follow-up) is safe for the SAME reason as
 *  "to": it's a preposition, so it can't form a noun-noun attributive
 *  compound either ("credit card on" isn't a thing the way "credit card
 *  payment" is) — needed for "change my card ON FILE to Amex", an extremely
 *  common real finance idiom. Its BACKWARD (government) use is deliberately
 *  NOT re-added to CLAUSE_PREPOSITIONS (see that set's header — "on" means
 *  "belonging to" too often), which does leave one narrow, accepted,
 *  pre-existing gap this trailing-word addition doesn't touch either way:
 *  "make a payment ON my credit card" (the noun preceded, not followed, by
 *  "on") still reads as a hit rather than the expense it actually is — the
 *  same shape "of" already accepts for "get rid of", scoped narrower here
 *  than fixing it would require reworking the whole government scan to
 *  understand verb phrases, out of scope for this fix. */
const ALLOWED_TRAILING_WORDS = new Set([
  'account', 'accounts', 'for', 'with', 'please', 'named', 'called', 'ending', 'to', 'on',
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
 * True when a directional OR clause preposition GOVERNS the noun starting at
 * `nounStart` — walking backward from (just before) the noun, only
 * `GOVERNOR_WORDS` appear before a `DIRECTIONAL_PREPOSITIONS`/
 * `CLAUSE_PREPOSITIONS` member is reached, with NO verb (or anything else) in
 * between. Checked ONCE per noun occurrence, independent of any particular
 * verb — see the module header.
 */
function isGovernedByPreposition(nounStart: number, tokens: WordToken[]): boolean {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i]!;
    if (tok.start >= nounStart) continue; // part of the noun phrase itself, or after it
    if (DIRECTIONAL_PREPOSITIONS.has(tok.word) || CLAUSE_PREPOSITIONS.has(tok.word)) return true;
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
 * Deterministic account-intent gate. Returns `{ op, subtypeHint }` on a hit
 * (subtypeHint may be undefined for a generic "account" noun), or `null` when
 * the text isn't recognised as any account operation — including the
 * "add/transfer money to an existing account" shape, which must fall through
 * to the expense ladder instead. See the module header for the op-
 * discrimination design (§4).
 */
export function detectAccountIntent(text: string): AccountIntent | null {
  const t = text.toLowerCase();
  const tokens = wordTokens(t);
  // Bare "new" only counts as a creation trigger when it's the very first
  // word of the utterance (see the module header's position-anchor note) —
  // computed once so every "new" occurrence can be checked against it below.
  const firstTokenStart = tokens.length ? tokens[0]!.start : -1;

  const createVerbMatches: Array<{ end: number }> = [];
  const updateVerbMatches: Array<{ end: number }> = [];
  const deleteVerbMatches: Array<{ end: number }> = [];

  for (const verb of CREATE_VERBS) {
    for (const start of wordPositions(verb, t)) {
      if (verb === 'new' && start !== firstTokenStart) continue;
      const end = start + verb.length;
      // "make" alone is ambiguous between create and update — see
      // `isRetypeMake` / the module header.
      if (verb === 'make' && isRetypeMake(end, tokens)) {
        updateVerbMatches.push({ end });
        continue;
      }
      createVerbMatches.push({ end });
    }
  }
  for (const verb of UPDATE_VERBS) {
    for (const start of wordPositions(verb, t)) {
      updateVerbMatches.push({ end: start + verb.length });
    }
  }
  for (const verb of DELETE_VERBS) {
    for (const start of wordPositions(verb, t)) {
      deleteVerbMatches.push({ end: start + verb.length });
    }
  }
  if (!createVerbMatches.length && !updateVerbMatches.length && !deleteVerbMatches.length) {
    return null;
  }

  // Checked in this order per noun occurrence when more than one category
  // has a qualifying verb for the SAME occurrence (rare/adversarial — no
  // test exercises this) — destructive/edit intent should not be silently
  // downgraded to a create by verb-ordering accidents.
  const categories: Array<{ op: AccountOp; matches: Array<{ end: number }> }> = [
    { op: 'delete', matches: deleteVerbMatches },
    { op: 'update', matches: updateVerbMatches },
    { op: 'create', matches: createVerbMatches },
  ];

  for (const noun of ACCOUNT_NOUNS) {
    for (const nounStart of wordPositions(noun.phrase, t)) {
      // A noun governed by a directional preposition is a DESTINATION
      // ("... to my new wallet", "... to my account", "remove 50 from
      // savings") — never the thing being operated on, regardless of which
      // verb might otherwise pair with it. Checked once per occurrence,
      // before considering any verb or op category.
      if (isGovernedByPreposition(nounStart, tokens)) continue;

      // An attributive use ("credit card PAYMENT", "savings GOAL") is never
      // the thing being operated on, regardless of which verb precedes it —
      // checked once per occurrence, same as the government check above.
      const nounEnd = nounStart + noun.phrase.length;
      if (!isAllowedTrailingAfterNoun(t, nounEnd)) continue;

      for (const { op, matches } of categories) {
        for (const { end: verbEnd } of matches) {
          if (verbEnd > nounStart) continue; // the noun must follow the verb
          const between = t.slice(verbEnd, nounStart);
          if (AMOUNT_BETWEEN_RE.test(between)) continue;
          return { op, subtypeHint: noun.subtypeHint };
        }
      }
    }
  }
  return null;
}

// ─── Account-reference fragment extraction (QA MAJOR follow-up) ───────────
// `findAccountMatch` (src/domain/accountMatch.ts) expects an account
// REFERENCE FRAGMENT ("DBS", "my amex", "the card") — not a full sentence.
// The update flow usually feeds it the model's own `targetName`, but the
// chat DELETE flow never calls a model at all (spec §5.3 — "no extraction
// call at all, purely deterministic"), and BOTH flows fall back to the raw
// utterance when no engine is available. Without stripping, "delete my DBS
// account" fed whole to findAccountMatch fails every ladder (containment,
// subtype cue, fuzzy) because the noise words ("delete", "my", the generic
// "account") swamp the one real signal ("DBS") — a false "which account?"
// for an unambiguous, clearly-resolvable sentence.
//
// `extractAccountReferenceFragment` is a deterministic, verb-list-driven
// strip (reuses CREATE_VERBS/UPDATE_VERBS/DELETE_VERBS, already defined
// above — no new vocabulary): (1) strip ONE leading verb phrase (longest
// match first, so multi-word "get rid of"/"set up" win over any
// single-word overlap), (2) strip leading determiner/possessive words ("my
// DBS account" -> "DBS account"), (3) strip a TRAILING *generic* "account"/
// "accounts" word ONLY when something remains before it — a subtype-
// specific word ("wallet", "savings", "card") is NEVER stripped even though
// it's the last word, because it's itself a valid `findAccountMatch`
// subtype-cue fragment ("wallet" alone must still resolve to a cash
// account). The model is never involved — numbers/ids still never come
// from it.
const LEADING_VERB_PHRASES: readonly string[] = [...CREATE_VERBS, ...UPDATE_VERBS, ...DELETE_VERBS]
  .slice()
  .sort((a, b) => b.length - a.length);

const LEADING_DETERMINERS = ['my', 'your', 'our', 'their', 'his', 'her', 'the', 'an', 'a'];

const GENERIC_TRAILING_NOUNS = new Set(['account', 'accounts']);

export function extractAccountReferenceFragment(text: string): string {
  let t = text.trim().toLowerCase();

  // 1. Strip ONE leading verb phrase, if the text actually starts with one.
  for (const verb of LEADING_VERB_PHRASES) {
    const re = new RegExp(`^${escapeRegExp(verb)}\\b`);
    if (re.test(t)) {
      t = t.replace(re, '').trim();
      break;
    }
  }

  // 2. Strip leading determiners/possessives — looped since more than one
  //    could in principle stack, though real utterances rarely do.
  for (let guard = 0; guard < 4; guard++) {
    let strippedAny = false;
    for (const word of LEADING_DETERMINERS) {
      const re = new RegExp(`^${word}\\b`);
      if (re.test(t)) {
        t = t.replace(re, '').trim();
        strippedAny = true;
      }
    }
    if (!strippedAny) break;
  }

  // 3. Strip a trailing GENERIC "account"/"accounts" only when something
  //    remains before it — never strip a subtype-specific last word.
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 1 && GENERIC_TRAILING_NOUNS.has(words[words.length - 1]!)) {
    words.pop();
  }
  return words.join(' ');
}

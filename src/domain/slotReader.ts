/**
 * Deterministic slot reader — who gave money to whom, and what for — read
 * from the sentence's structure before the model runs, the same way code
 * already reads the amount (./amountCandidates) and the date
 * (`typedDateSpan`, ./deviceParsePrompt). Step 3's rule: code decides where it
 * can.
 *
 * The measured defect it fixes (evals/README.md, "Slot reader"): the sign
 * reader (./signReader) sees words, not roles. "Brother returned me 6.9 for
 * mcd" and "got 30 from dad for taxi" came out as expenses because "for"
 * reads as a spend, and the model's own (correct) answer was overridden.
 *
 * With the amount(s) and the date phrase masked, a small grammar reads one
 * clause at a time:
 *
 *   <person> give|send|pay|return|transfer|lend me|us [back] <amount>  -> to_me
 *   [I|we] give|send|pay|return|transfer|lend <person> [back] <amount> -> from_me
 *   [I|we] pay back <person> <amount>                                  -> from_me
 *   [I|we] give|send|pay|return|transfer|lend <amount> [back] to <person> -> from_me
 *   [I|we] get|receive [back] <amount> [cashback|refund|...] from <person> -> to_me
 *   [I|we] borrow <amount> from <person>                               -> to_me
 *   <person> borrow <amount> from me                                   -> from_me
 *
 * and stands aside (`direction: null`, the model decides) whenever the words
 * do not say it: no clear subject or object ("Sam paid 40 for dinner" is
 * someone else's payment; "mum paid sis 20" involves neither the user), two
 * clauses that disagree ("mum gave me 50 and I gave sis 20"), or a debt
 * ("owe", "owes": no money moved; the cue check refuses those).
 *
 * The person slot holds a kin word or short form (mum, dad, bro, sis, ah ma,
 * hubby, bf, colleague, boss, ...; "my"/"the" dropped), a Capitalised name of
 * up to three words ("Priya", "Uncle Tan", "Grab": a merchant the user paid
 * is the payee too), or a lowercase word that is one of the user's own payee
 * names. Never one of the user's own accounts or an account-type word
 * ("got 50 from ATM", "sent 100 to savings": transfers stay the transfer
 * rules' job), never a pronoun, never an all-caps token that is not a known
 * payee ("paid GST 5"). After a transfer verb a bare Capitalised word counts
 * only when the user's account list is known ("transferred 500 to OCBC" with
 * no accounts could be one of them).
 *
 * The purpose is the `for|on <phrase>` tail of the clause that gave the
 * direction, in the user's own spelling, without the amount and the date
 * ("lunch", "my birthday", "the ride").
 *
 * Framework-free (no RN imports): the plain-node BDD suite
 * (tests/__features__/slot-reader.feature), `localParse.ts`, the sign reader
 * and the eval harness import the exact module the app ships.
 */
import { readAmounts } from './amountCandidates';
import { typedDateSpan } from './deviceParsePrompt';
import { normalizeName } from './textMatch';

export type SlotDirection = 'to_me' | 'from_me';

export interface Slots {
  /** Money moved to the user (income) or from the user (expense); null when
   *  the words do not say, or say both. */
  direction: SlotDirection | null;
  /** The other party in the user's own spelling ("bro", "Priya", "ah ma"),
   *  or null. Set only together with a direction. */
  person: string | null;
  /** The `for|on` tail of the deciding clause, user's spelling, without the
   *  amount and date. Set only together with a direction. */
  purpose: string | null;
  /** 0..1: how sure the reading is (a kin word or known payee is surer than
   *  a Capitalised word). 0 when there is no reading. */
  confidence: number;
  /** The text with the deciding clause and the purpose blanked out: what is
   *  left to contradict the reading (the sign reader's competing check). */
  outside: string;
}

export interface SlotContext {
  /** The device clock, for the date phrase to mask. Without it no date is
   *  masked (the direction never depends on it). */
  now?: number;
  /** The user's payee names: a lowercase word that is one of them is a
   *  person ("paid priya 20"). */
  payees?: readonly string[];
  /** The user's account names: never a person. */
  accounts?: readonly string[];
}

const NONE: Omit<Slots, 'outside'> = { direction: null, person: null, purpose: null, confidence: 0 };

// ─── lexicon ────────────────────────────────────────────────────────────────

/** Kin words, short forms and roles that name a person on their own. Each
 *  group is one person under different spellings (`kinVariants`). */
const KIN_GROUPS: readonly (readonly string[])[] = [
  ['mum', 'mom', 'mother', 'mummy', 'mommy', 'mama', 'ma', 'mumsy'],
  ['dad', 'father', 'daddy', 'papa', 'pa'],
  ['bro', 'brother'],
  ['sis', 'sister'],
  ['hubby', 'husband'],
  ['wife', 'wifey'],
  ['bf', 'boyfriend'],
  ['gf', 'girlfriend'],
  ['auntie', 'aunty', 'aunt'],
  ['uncle'],
  ['grandma', 'granny', 'nana', 'ah ma', 'ahma', 'ah mah'],
  ['grandpa', 'ah gong', 'ahgong', 'ah kong'],
  ['colleague', 'coworker', 'co-worker'],
  ['boss'],
  ['son'],
  ['daughter'],
  ['cousin'],
  ['niece'],
  ['nephew'],
  ['friend', 'bestie', 'buddy'],
  ['roommate', 'housemate', 'flatmate'],
  ['partner'],
  ['landlord', 'landlady'],
  ['tutor'],
  ['helper'],
];
const KIN = new Set(KIN_GROUPS.flat());
const KIN_MAX_WORDS = 2;

/** The other spellings of a kin word ("mom" -> mum, mother, ...), never the
 *  word itself; empty for anything else. */
export function kinVariants(word: string): string[] {
  const w = normalizeName(word);
  const group = KIN_GROUPS.find((g) => g.includes(w));
  return group ? group.filter((x) => x !== w) : [];
}

/** True when `word` is a kin word or short form (case-insensitive). */
export function isKinWord(word: string): boolean {
  return KIN.has(normalizeName(word));
}

/** Money leaves the subject for the object. */
const OUT_VERBS = new Set([
  'gave', 'give', 'gives', 'giving', 'sent', 'send', 'sends', 'paid', 'pay', 'pays', 'returned', 'return', 'returns',
  'transferred', 'transfer', 'transfers', 'transfered', 'lent', 'lend', 'lends', 'loaned', "paynow'd", 'paynowed',
]);
/** Of `OUT_VERBS`, the ones that also move money between the user's own
 *  accounts: a bare Capitalised object counts only with the account list. */
const TRANSFER_VERBS = new Set(['transferred', 'transfer', 'transfers', 'transfered', 'sent', 'send', 'sends']);
/** Money comes to the subject. */
const GET_VERBS = new Set(['got', 'get', 'gets', 'received', 'receive', 'receives', 'recieved', 'collected']);
const BORROW_VERBS = new Set(['borrowed', 'borrow', 'borrows']);
/** A debt: no money moved. The whole text stands aside. */
const OWE_VERBS = new Set(['owe', 'owes', 'owed', 'owing']);

const ME = new Set(['me', 'us']);
const I_SUBJECT = new Set(['i', 'we']);
const PRONOUN = new Set(['he', 'she', 'they', 'him', 'her', 'them', 'you', 'someone', 'somebody', 'everyone']);
const DETERMINER = new Set(['my', 'our', 'the', 'his', 'her', 'their']);
/** Words between the amount and "from" that keep the reading: what came in. */
const GET_FILLER = new Set([
  'back', 'cashback', 'refund', 'rebate', 'reimbursement', 'salary', 'allowance', 'bonus', 'money', 'cash',
  'transfer', 'gift', 'ang', 'bao', 'pao', 'angbao', 'angpao', 'dollars', 'bucks', 'sgd',
]);
/** Ends a clause: each clause is read on its own. */
const CLAUSE_WORDS = new Set(['and', 'but', 'then', 'so', 'while', 'also', 'plus']);
/** Never a person even when Capitalised: account-type words, calendar words. */
const NOT_PERSON = new Set([
  'savings', 'saving', 'checking', 'chequing', 'account', 'acct', 'acc', 'card', 'wallet', 'cash', 'bank', 'atm',
  'fd', 'deposit', 'investment', 'investments', 'brokerage', 'mortgage', 'loan', 'credit', 'debit',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'today', 'yesterday',
  'i', 'me', 'us', 'we', 'for', 'on', 'to', 'from', 'back', 'at', 'in', 'with',
]);

/** A currency mark beside an amount belongs to the amount. */
const CURRENCY_BEFORE = /(?:[$€£¥+]|\bs\$|\b(?:sgd|usd|rm|myr|eur|gbp|aud))\s*$/i;
const CURRENCY_AFTER = /^\s*(?:[$€£¥]|(?:sgd|usd|rm|myr|eur|gbp|aud|dollars?|bucks|cents?)\b)/i;

// ─── tokens ─────────────────────────────────────────────────────────────────

type TokenKind = 'word' | 'amount' | 'date' | 'stop';

interface Token {
  kind: TokenKind;
  /** The user's own spelling (words only). */
  raw: string;
  /** Lowercase form (words only). */
  low: string;
  index: number;
  end: number;
}

interface Span {
  index: number;
  end: number;
}

/** The amount spans (with their currency marks) and the date phrase. */
function maskedSpans(text: string, now: number | undefined): { amounts: Span[]; date: Span | null } {
  const amounts: Span[] = [];
  for (const a of readAmounts(text).offered) {
    let index = a.index;
    let end = a.index + a.text.length;
    const before = CURRENCY_BEFORE.exec(text.slice(0, index));
    if (before) index -= before[0].length;
    const after = CURRENCY_AFTER.exec(text.slice(end));
    if (after) end += after[0].length;
    amounts.push({ index, end });
  }
  return { amounts, date: now == null ? null : typedDateSpan(text, now) };
}

function tokenize(text: string, now: number | undefined): Token[] {
  const { amounts, date } = maskedSpans(text, now);
  const masks: Array<Span & { kind: TokenKind }> = [
    ...amounts.map((s) => ({ ...s, kind: 'amount' as const })),
    ...(date ? [{ ...date, kind: 'date' as const }] : []),
  ].sort((a, b) => a.index - b.index);
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’&.-]*|[,.;:!?()]/gu;
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    const mask = masks.find((s) => index < s.end && end > s.index);
    if (mask) {
      const last = tokens[tokens.length - 1];
      if (!last || last.index !== mask.index) tokens.push({ kind: mask.kind, raw: '', low: '', index: mask.index, end: mask.end });
      continue;
    }
    if (/^[,.;:!?()]$/.test(m[0])) {
      tokens.push({ kind: 'stop', raw: m[0], low: m[0], index, end });
      continue;
    }
    const raw = m[0].replace(/’/g, "'").replace(/[.'-]+$/, '');
    if (!raw) continue;
    tokens.push({ kind: 'word', raw, low: raw.toLowerCase(), index, end: index + raw.length });
  }
  // A mask with no word inside it ("$5" has no letter run before the digits
  // in some forms) still has to be a token.
  for (const s of masks) {
    if (!tokens.some((t) => t.index === s.index && t.kind === s.kind)) {
      tokens.push({ kind: s.kind, raw: '', low: '', index: s.index, end: s.end });
    }
  }
  return tokens.sort((a, b) => a.index - b.index);
}

/** Splits the tokens into clauses at punctuation and joining words. Date
 *  tokens are dropped (the date is not part of the grammar). */
function clauses(tokens: Token[]): Token[][] {
  const out: Token[][] = [[]];
  for (const t of tokens) {
    if (t.kind === 'date') continue;
    if (t.kind === 'stop' || (t.kind === 'word' && CLAUSE_WORDS.has(t.low))) {
      if (out[out.length - 1]!.length) out.push([]);
      continue;
    }
    out[out.length - 1]!.push(t);
  }
  return out.filter((c) => c.length > 0);
}

// ─── the person slot ────────────────────────────────────────────────────────

interface PersonHit {
  /** The words, in the user's spelling, determiner dropped. */
  name: string;
  start: number;
  /** One past the last token. */
  end: number;
  confidence: number;
}

interface PersonRules {
  payees: Set<string>;
  payeeFirstWords: Set<string>;
  accounts: Set<string>;
  /** After a transfer verb with no account list: no bare Capitalised word. */
  strict: boolean;
}

/** A verb or pronoun word: never part of a name, even Capitalised ("Mum Gave
 *  Me 50", "Priya Transferred me 45"). */
const isVerbish = (low: string): boolean =>
  OUT_VERBS.has(low) || GET_VERBS.has(low) || BORROW_VERBS.has(low) || OWE_VERBS.has(low) || ME.has(low) || PRONOUN.has(low);
const isCapitalised = (raw: string): boolean => /^\p{Lu}/u.test(raw);
const isAllCaps = (raw: string): boolean => /^\p{Lu}[\p{Lu}\p{N}&]*$/u.test(raw) && raw.length > 1;

/** The person phrase starting at `i`, or null. */
function personAt(c: Token[], i: number, rules: PersonRules): PersonHit | null {
  let s = i;
  if (c[s]?.kind === 'word' && DETERMINER.has(c[s]!.low) && c[s + 1]?.kind === 'word') s += 1;
  const at = (k: number): Token | null => (c[k]?.kind === 'word' ? c[k]! : null);
  const first = at(s);
  if (!first) return null;
  const text = (from: number, to: number) => c.slice(from, to).map((t) => t.raw).join(' ');
  const isAccount = (from: number, to: number) => {
    const n = normalizeName(text(from, to));
    return rules.accounts.has(n) || c.slice(from, to).some((t) => NOT_PERSON.has(t.low));
  };

  // A kin word (one or two words), optionally followed by a Capitalised name
  // ("Uncle Tan", "auntie Mei").
  for (let n = KIN_MAX_WORDS; n >= 1; n--) {
    const words = c.slice(s, s + n);
    if (words.length < n || words.some((t) => t.kind !== 'word')) continue;
    if (!KIN.has(words.map((t) => t.low).join(' '))) continue;
    let end = s + n;
    const next = at(end);
    if (next && isCapitalised(next.raw) && !isAllCaps(next.raw) && !NOT_PERSON.has(next.low) && !isVerbish(next.low)) end += 1;
    return { name: text(s, end), start: i, end, confidence: 0.9 };
  }

  // One of the user's own payee names, any case (whole name, up to three words).
  for (let n = 3; n >= 1; n--) {
    const words = c.slice(s, s + n);
    if (words.length < n || words.some((t) => t.kind !== 'word')) continue;
    const name = normalizeName(text(s, s + n));
    if (rules.payees.has(name) && !isAccount(s, s + n)) {
      return { name: text(s, s + n), start: i, end: s + n, confidence: 0.9 };
    }
  }
  if (rules.payeeFirstWords.has(first.low) && !isAccount(s, s + 1) && !NOT_PERSON.has(first.low)) {
    return { name: first.raw, start: i, end: s + 1, confidence: 0.85 };
  }

  // A Capitalised run of up to three words ("Priya", "Mary Jane", "SP Group").
  if (rules.strict || !isCapitalised(first.raw) || NOT_PERSON.has(first.low) || isVerbish(first.low)) return null;
  if (isAllCaps(first.raw) && first.raw.length <= 4) return null;
  let end = s + 1;
  while (end < s + 3) {
    const next = at(end);
    if (!next || !isCapitalised(next.raw) || NOT_PERSON.has(next.low) || isVerbish(next.low)) break;
    end += 1;
  }
  if (isAccount(s, end)) return null;
  return { name: text(s, end), start: i, end, confidence: 0.8 };
}

/** The person phrase that ends exactly at `k` (the subject before a verb),
 *  the longest one. */
function personEndingAt(c: Token[], k: number, rules: PersonRules): PersonHit | null {
  for (let s = Math.max(0, k - 4); s < k; s++) {
    const hit = personAt(c, s, rules);
    if (hit && hit.end === k) return hit;
  }
  return null;
}

// ─── the grammar ────────────────────────────────────────────────────────────

interface Reading {
  direction: SlotDirection;
  person: PersonHit | null;
  /** Clause token index one past the reading (where a purpose may start). */
  after: number;
  /** Clause token index the reading starts at. */
  from: number;
  confidence: number;
}

type ClauseResult = Reading | 'owe' | null;

type Subject = { kind: 'me' } | { kind: 'person'; hit: PersonHit } | { kind: 'other' };

function subjectOf(c: Token[], k: number, rules: PersonRules): Subject {
  if (k === 0) return { kind: 'me' };
  const prev = c[k - 1]!;
  if (prev.kind === 'word' && I_SUBJECT.has(prev.low)) return { kind: 'me' };
  const hit = personEndingAt(c, k, { ...rules, strict: false });
  return hit ? { kind: 'person', hit } : { kind: 'other' };
}

const isWord = (t: Token | undefined, set: Set<string>): boolean => !!t && t.kind === 'word' && set.has(t.low);
const isAmount = (t: Token | undefined): boolean => !!t && t.kind === 'amount';
const isLow = (t: Token | undefined, w: string): boolean => !!t && t.kind === 'word' && t.low === w;

/** The first reading of one clause. */
function readClause(c: Token[], rules: PersonRules): ClauseResult {
  if (c.some((t) => isWord(t, OWE_VERBS))) return 'owe';
  const k = c.findIndex((t) => isWord(t, OUT_VERBS) || isWord(t, GET_VERBS) || isWord(t, BORROW_VERBS));
  if (k < 0) return null;
  const verb = c[k]!.low;
  const subject = subjectOf(c, k, rules);
  const objectRules: PersonRules = { ...rules, strict: TRANSFER_VERBS.has(verb) && rules.accounts.size === 0 };
  const subjectPerson = subject.kind === 'person' ? subject.hit : null;
  const from = subjectPerson ? subjectPerson.start : k;
  let j = k + 1;

  if (OUT_VERBS.has(verb)) {
    // "<someone> gave me [back] 50": to the user.
    if (isWord(c[j], ME)) {
      // "I gave me" is no reading; a verb opening the text ("returned me 8
      // for kopi") has an unnamed giver.
      if (subject.kind === 'me' && k > 0) return null;
      j += 1;
      if (isLow(c[j], 'back')) j += 1;
      if (!isAmount(c[j])) return null;
      return { direction: 'to_me', person: subjectPerson, from, after: j + 1, confidence: subjectPerson?.confidence ?? 0.7 };
    }
    if (subject.kind !== 'me') {
      // "Priya sent 50 to me".
      if (isAmount(c[j]) && isLow(c[j + 1], 'to') && isWord(c[j + 2], ME)) {
        return { direction: 'to_me', person: subjectPerson, from, after: j + 3, confidence: subjectPerson?.confidence ?? 0.7 };
      }
      // Someone else paid, or paid someone else: the words do not say.
      return null;
    }
    // "paid back Priya 60" / "paid back 60 to Priya".
    if (isLow(c[j], 'back')) j += 1;
    const object = personAt(c, j, objectRules);
    if (object) {
      let a = object.end;
      if (isLow(c[a], 'back')) a += 1;
      if (!isAmount(c[a])) return null;
      return { direction: 'from_me', person: object, from, after: a + 1, confidence: object.confidence };
    }
    if (isAmount(c[j])) {
      let t = j + 1;
      if (isLow(c[t], 'back')) t += 1;
      if (!isLow(c[t], 'to')) return null;
      const to = personAt(c, t + 1, objectRules);
      if (!to) return null;
      return { direction: 'from_me', person: to, from, after: to.end, confidence: to.confidence };
    }
    return null;
  }

  if (GET_VERBS.has(verb) || BORROW_VERBS.has(verb)) {
    if (subject.kind !== 'me') {
      // "sis borrowed 50 from me": money left the user.
      if (BORROW_VERBS.has(verb) && isAmount(c[j]) && isLow(c[j + 1], 'from') && isWord(c[j + 2], ME)) {
        return { direction: 'from_me', person: subjectPerson, from, after: j + 3, confidence: subjectPerson?.confidence ?? 0.7 };
      }
      return null;
    }
    if (isLow(c[j], 'back')) j += 1;
    if (!isAmount(c[j])) return null;
    j += 1;
    let fillers = 0;
    while (fillers < 2 && c[j]?.kind === 'word' && GET_FILLER.has(c[j]!.low)) {
      j += 1;
      fillers += 1;
    }
    if (!isLow(c[j], 'from')) return null;
    const giver = personAt(c, j + 1, { ...rules, strict: false });
    if (!giver) return null;
    return { direction: 'to_me', person: giver, from, after: giver.end, confidence: giver.confidence };
  }
  return null;
}

/** Words a purpose made only of these says nothing. */
const PURPOSE_EMPTY = new Set(['the', 'a', 'an', 'my', 'our', 'her', 'his', 'their', 'it', 'this', 'that', 'me', 'us']);

/** The `for|on <phrase>` tail after the reading, to the clause end. */
function purposeOf(c: Token[], after: number, text: string): { purpose: string | null; span: Span | null } {
  const at = c.findIndex((t, i) => i >= after && t.kind === 'word' && (t.low === 'for' || t.low === 'on'));
  if (at < 0) return { purpose: null, span: null };
  const words = c.slice(at + 1).filter((t) => t.kind === 'word');
  if (!words.length || words.every((t) => PURPOSE_EMPTY.has(t.low) || /^\p{N}+$/u.test(t.low))) {
    return { purpose: null, span: null };
  }
  // The user's own spelling between the first and last word, with any masked
  // amount inside it cut out.
  const first = words[0]!;
  const last = words[words.length - 1]!;
  let s = text.slice(first.index, last.end);
  for (const t of c.slice(at + 1).filter((x) => x.kind !== 'word').reverse()) {
    if (t.index >= first.index && t.end <= last.end) {
      s = s.slice(0, t.index - first.index) + ' ' + s.slice(t.end - first.index);
    }
  }
  const purpose = s.replace(/\s+/g, ' ').trim();
  return { purpose: purpose || null, span: { index: c[at]!.index, end: last.end } };
}

/**
 * Reads the direction, the person and the purpose from `text` (see the module
 * header). Pure; never throws.
 */
export function readSlots(text: string, ctx: SlotContext = {}): Slots {
  const rules: PersonRules = {
    payees: new Set((ctx.payees ?? []).map(normalizeName).filter(Boolean)),
    payeeFirstWords: new Set(
      (ctx.payees ?? [])
        .map((p) => normalizeName(p).split(' ')[0] ?? '')
        .filter((w) => w.length >= 3 && !KIN.has(w))
    ),
    accounts: new Set((ctx.accounts ?? []).map(normalizeName).filter(Boolean)),
    strict: false,
  };
  const none = { ...NONE, outside: text };
  if (!text.trim()) return none;
  const results = clauses(tokenize(text, ctx.now)).map((c) => ({ c, r: readClause(c, rules) }));
  if (results.some((x) => x.r === 'owe')) return none;
  const readings = results.filter((x): x is { c: Token[]; r: Reading } => x.r != null && x.r !== 'owe');
  if (!readings.length) return none;
  if (new Set(readings.map((x) => x.r.direction)).size > 1) return none;

  const { c, r } = readings[0]!;
  const { purpose, span } = purposeOf(c, r.after, text);
  const used: Span[] = [{ index: c[r.from]!.index, end: c[Math.min(r.after, c.length) - 1]!.end }];
  if (span) used.push(span);
  let outside = text;
  for (const u of used.sort((a, b) => b.index - a.index)) {
    outside = outside.slice(0, u.index) + ' ' + outside.slice(u.end);
  }
  return {
    direction: r.direction,
    person: r.person?.name ?? null,
    purpose,
    confidence: r.confidence,
    outside: outside.replace(/\s+/g, ' ').trim(),
  };
}

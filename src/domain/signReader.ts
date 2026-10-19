/**
 * Deterministic sign (transaction TYPE) reader for the parse pipeline — step
 * 3's rule applied to `type`: code decides where it can, the model only what
 * code cannot read.
 *
 * Measured on the dev split (evals/README.md, package B review 2026-10-10),
 * the on-device model gets `type` wrong where the words are unambiguous:
 * "paid back Sam 20" -> income, "owed tax paid 300" -> income, "found 20 on
 * the street" -> expense, "returned shoes +59" -> transfer, "courts furniture
 * 450" -> transfer. Each of those is decided by a word the user wrote (or did
 * not write), so the pipeline reads it here and keeps the model's answer only
 * where the words leave it open.
 *
 * CONSERVATIVE BY DESIGN. A verdict is returned only when the evidence is
 * unambiguous; otherwise `null` and the caller keeps the model's type:
 *  - strong income words (refund, reimbursed, cashback, payday, salary,
 *    received, "paid me", "gave me", red packet/ang bao, found <amount>, ...)
 *    and strong expense verbs (paid, bought, spent, gave, cost, charged, a
 *    future "will pay me back") cancel each other: both present -> null;
 *  - a leading `+` on the only amount is income, unless an expense verb says
 *    otherwise ("returned shoes +59", "+3200 payday");
 *  - a transfer verb (transferred, moved, topped up, withdrew, put into, ...)
 *    is a transfer only WITH an own-account reference — "between accounts",
 *    "to/from" + one of the user's account names (the same matcher
 *    `resolveTransferAccounts` uses) or an account-type word (savings,
 *    checking, fixed deposit, wallet, credit card, atm, ...; a bare "card" is
 *    not one: "top up 20 to ezlink card") — never on the verb alone:
 *    "transferred 150 to mum" is a payment to a person (README, "Transfers and
 *    refunds"); an own account named only as the SOURCE ("transferred 200 to
 *    Sam from DBS Savings") is a payment to someone too;
 *  - paying one of the user's own accounts ("paid Citi Card bill 500") is a
 *    transfer only when the source account is named too, else the model's;
 *  - someone else paying ("Sam paid 40 for dinner") is the model's call, and so
 *    is a `+` after a plain item ("coffee +2"); "income tax", "interest
 *    charge", "refund processing fee" and "received the ... bill" are never
 *    income;
 *  - weak nouns decide only when nothing contradicts them: "fee", "bill",
 *    "fare", "gift" (without "from") are spends; "deposit", "dividend",
 *    "interest", "sold", "freelance" are income.
 *
 * `resolveSign` adds the one rule that needs the model's own answer: the app's
 * `transfer` type REQUIRES a second own account (`interpretTransfer` asks for
 * one), so a model `transfer` on text with no transfer verb and no account
 * reference ("courts furniture 450") cannot be right and becomes an expense (or
 * income when an income word is present). Everything else stays the model's.
 *
 * Framework-free (no RN imports): the plain-node BDD suite, `localParse.ts`
 * and the eval harness import the exact module the app ships.
 */
import { Account, TransactionType } from './types';
import { boundedNamePattern, normalizeName } from './textMatch';
import { findAccountMatch } from './accountMatch';
import { readAmounts } from './amountCandidates';
import { prepareCueText } from './notTransactionCues';

/** Why a verdict was reached — for the debug screen and the eval replay. */
export type SignRule =
  | 'plus-sign'
  | 'income-word'
  | 'expense-verb'
  | 'expense-word'
  | 'transfer'
  | 'payment-to-someone'
  | 'not-a-transfer';

export interface SignVerdict {
  type: TransactionType;
  rule: SignRule;
}

const rx = (src: string, flags = ''): RegExp => new RegExp(src, flags);

// ─── income ─────────────────────────────────────────────────────────────────

/** After "income" or "interest", a word that makes it a charge the user pays
 *  ("income tax 300", "interest charge 30", "interest payment 120"). */
const NOT_INCOME_AFTER = '(?:tax(?:es)?|charges?|fees?|payments?|repayments?|due)\\b';

/** Words that say money came TO the user, whatever else the text says. */
const INCOME_STRONG = rx(
  '\\b(?:refund(?:s|ed)?(?! (?:processing |admin |handling |service )?(?:fees?|charges?))|reimburse(?:d|ment)|cash ?back|money back|payday|salar(?:y|ies)|wages|pay ?check|payslip|' +
    'got paid|paid (?:me|us)\\b|repaid(?: (?:me|us))?\\b|gave (?:me|us)\\b|owed (?:me|us)\\b|' +
    'red packet|ang ?(?:bao|pao|pow)|hong ?bao|' +
    'received(?! (?:the |a |my |an |your |our )?(?:[a-z]+ ){0,2}(?:bill|invoice|fine|ticket|summons|quote|notice|letter|statement)s?\\b)|' +
    'rebate|winnings|prize money|lottery|jackpot|found \\$?\\d+|credited|came in|my pay\\b|earn(?:ed|ings)\\b|income(?! ' + NOT_INCOME_AFTER + '))\\b'
);
/** Words that usually mean income but also appear in a spend ("paid 100
 *  deposit", "paid loan interest 30"): they decide only unopposed. */
const INCOME_WEAK = rx(
  '\\b(?:(?<!fixed )deposit|dividends?|interest(?![ -]free| ' + NOT_INCOME_AFTER + ')|bonus|sold|freelance|gig|commission|royalt(?:y|ies)|allowance|stipend|' +
    '(?:gift|present|money|cash|payment|paynow|transfer|allowance) from)\\b'
);

// ─── expense ────────────────────────────────────────────────────────────────

/** "paid" is the user's payment unless someone else is the subject ("job paid
 *  350", "client paid") or the user is the object ("paid me back"). */
const PAID_OUT = rx(
  '(?<!\\b(?:got|get|getting|job|client|company|work|boss|employer|gig|customer|insurance|they|he|she|who|someone|everyone|bank|' +
    'mum|mom|dad|mother|father|wife|husband|partner|bf|gf|friend|friends|sister|brother|bro|sis|colleague|roommate|parents) )' +
    '\\bpaid\\b(?! (?:me|us)\\b)'
);
const GAVE_OUT = rx('\\bgave\\b(?! (?:me|us)\\b)');
/** A past spend, or a promise that someone will pay the USER back for one
 *  ("lunch 40 Sam will pay me back" is the user's spend with an IOU attached). */
const EXPENSE_STRONG = rx(
  '\\b(?:bought|spent|purchased|cost|charged|ordered|treated|donated|tipped|' +
    "(?:will|'ll|gonna|going to|to|should|promised to) pay (?:me|us) back)\\b"
);
/** Nouns that name a spend when nothing says the money came in. "gift"/
 *  "present" + "from" is a gift received (INCOME_WEAK), so excluded here. */
const EXPENSE_WEAK = rx(
  '\\b(?:fees?|bill|fare|premium|subscription|membership|permit|fine|tuition|toll|donation|' +
    '(?:gift|present)(?! from)|for (?!(?:me|us)\\b)[a-z]+)\\b'
);

// ─── transfer ───────────────────────────────────────────────────────────────

const TRANSFER_VERB = rx(
  '\\b(?:transfer(?:red|s|ring)?|mov(?:e|ed|ing)|top(?:ped)?[ -]?up|withdr(?:ew|aw|awal|awn)|deposited|' +
    "put (?:[$€£]?[\\d.,k]+ )?(?:into|in|to)|added (?:[$€£]?[\\d.,k]+ )?to|sent (?:[$€£]?[\\d.,k]+ )?to)\\b"
);
/** Account-type words that name one of the user's own accounts without a name:
 *  the subtype cues `findAccountMatch` resolves by, plus the forms a transfer
 *  text uses ("fixed deposit", "atm", "my account"). */
const OWN_ACCOUNT_WORDS =
  '(?:credit card|debit card|checking|chequing|current account|savings?(?: acc(?:oun)?t)?|brokerage|investments?|' +
    'mortgage|wallet|cash|fixed deposit|fd|atm|bank|(?:my|our) (?:own )?acc(?:oun)?t|own acc(?:oun)?t)';
const BETWEEN_ACCOUNTS = rx('\\bbetween (?:my |our )?(?:own )?(?:two )?acc(?:oun)?ts\\b');
const TO_OWN_ACCOUNT_WORD = rx('\\b(?:to|from|into|in|onto)\\s+(?:my |our |the )?(?:own )?' + OWN_ACCOUNT_WORDS + '\\b');
/** The account word right after the verb, no preposition: "topped up wallet 50",
 *  "withdrew cash 200". */
const VERB_OWN_ACCOUNT_WORD = rx('\\b(?:up|withdrew|withdraw|moved|transferred)\\s+(?:my |our |the )?' + OWN_ACCOUNT_WORDS + '\\b');
/** The words after "to": a destination the user named. Stops at the next
 *  connective, an amount or the end (mirrors assistant.ts's transferFragment). */
const DESTINATION = rx(
  "\\bto\\s+(.+?)(?=\\s+(?:to|from|for|on|at|via|yesterday|today|tomorrow|last|next|this)\\b|\\s+[$€£]?\\d|[.,;!?]|$)"
);

/** True when the text names one of `accounts` after to/from/into (full name, or
 *  a fragment `findAccountMatch` resolves or finds ambiguous), or an account-type
 *  word, or "between accounts". */
function namesOwnAccount(t: string, accounts: readonly Account[]): boolean {
  if (BETWEEN_ACCOUNTS.test(t) || TO_OWN_ACCOUNT_WORD.test(t) || VERB_OWN_ACCOUNT_WORD.test(t)) return true;
  for (const account of accounts) {
    const name = normalizeName(account.name);
    if (name && rx('\\b(?:to|from|into|in|onto)\\s+(?:my |our |the )?' + boundedNamePattern(name)).test(t)) return true;
  }
  const fragment = DESTINATION.exec(t)?.[1]?.trim();
  if (fragment && accounts.length > 0) {
    const match = findAccountMatch(fragment.replace(/^(?:my|our|the) /, ''), [...accounts]);
    if (match?.account || match?.ambiguous?.length) return true;
  }
  return false;
}

/** Words that say an item came back, so a `+` after it is money in
 *  ("returned shoes +59", "sold bike +200"). */
const CAME_BACK = rx('\\b(?:return(?:ed|s)?|sold|got back|back|resold|cashed out)\\b');

/** A `+` opening the text ("+3200 payday"), or glued to the only amount after a
 *  word that says something came back ("returned shoes +59"): the user's own
 *  income sign. "lunch 12 +2 tip" has two amounts and is not one, and a `+` after
 *  a plain item ("coffee +2") is left to the model: it reads as "two more" as
 *  often as money in. */
function hasPlusSign(text: string): boolean {
  const t = text.trim();
  if (/^\+\s?(?:[$€£¥]|s\$|rm|usd|sgd)?\s?\d/i.test(t)) return true;
  if (!/(?:^|[\s([])\+\s?(?:[$€£¥]|s\$|rm|usd|sgd)?\s?\d/i.test(t)) return false;
  return readAmounts(text).offered.length === 1 && CAME_BACK.test(prepareCueText(text));
}

/** Someone other than the user paid: a Capitalised name right before "paid"
 *  ("Sam paid 40 for dinner"; "I" is the user). Then the text says nothing
 *  about the user's own money unless it says "paid me". */
const OTHER_PAYER = /(?:^|[\s,;])(?!I\b)\p{Lu}[\p{L}'-]*\s+paid\b/u;

/** One of the user's own accounts being PAID, not paying: "paid Citi Card
 *  bill 500", "credit card payment 300" — a transfer in this app when the source
 *  is also an own account, else the model's call. */
function paysOwnAccount(t: string, accounts: readonly Account[]): boolean {
  const owed = '\\s+(?:bill|payment|repayment|statement|balance|dues)\\b';
  if (rx('\\b(?:credit card|card|mortgage|loan)' + owed).test(t)) return true;
  return accounts.some((a) => {
    const name = normalizeName(a.name);
    return !!name && rx(boundedNamePattern(name) + owed).test(t);
  });
}

/** The user's own account named after "from" ("from DBS Savings", "from
 *  savings"): the source side of a transfer. */
function fromOwnAccount(t: string, accounts: readonly Account[]): boolean {
  if (rx('\\bfrom\\s+(?:my |our |the )?(?:own )?' + OWN_ACCOUNT_WORDS + '\\b').test(t)) return true;
  return accounts.some((a) => {
    const name = normalizeName(a.name);
    return !!name && rx('\\bfrom\\s+(?:my |our |the )?' + boundedNamePattern(name)).test(t);
  });
}

/** True when the destination after "to" is one of the user's own accounts (or
 *  an account-type word). */
function toOwnAccount(t: string, accounts: readonly Account[]): boolean {
  if (rx('\\b(?:to|into|onto|in)\\s+(?:my |our |the )?(?:own )?' + OWN_ACCOUNT_WORDS + '\\b').test(t)) return true;
  if (BETWEEN_ACCOUNTS.test(t) || VERB_OWN_ACCOUNT_WORD.test(t)) return true;
  for (const account of accounts) {
    const name = normalizeName(account.name);
    if (name && rx('\\b(?:to|into|onto|in)\\s+(?:my |our |the )?' + boundedNamePattern(name)).test(t)) return true;
  }
  const fragment = DESTINATION.exec(t)?.[1]?.trim();
  if (fragment && accounts.length > 0) {
    const match = findAccountMatch(fragment.replace(/^(?:my|our|the) /, ''), [...accounts]);
    if (match?.account || match?.ambiguous?.length) return true;
  }
  return false;
}

/**
 * The type the user's own words decide, or null when they leave it open.
 * `accounts` (optional) are the user's own accounts, for the transfer rule;
 * without them only account-type words and "between accounts" count as an
 * own-account reference.
 */
export function readSign(text: string, accounts: readonly Account[] = []): SignVerdict | null {
  const t = prepareCueText(text);
  if (!t) return null;
  const incomeStrong = INCOME_STRONG.test(t);
  // "Sam paid 40 for dinner": someone else's payment; the words say nothing
  // about the user's money (unless "paid me", an income word).
  if (OTHER_PAYER.test(text) && !incomeStrong) return null;
  const expenseStrong = PAID_OUT.test(t) || GAVE_OUT.test(t) || EXPENSE_STRONG.test(t);
  const transferVerb = TRANSFER_VERB.test(t);
  const ownAccount = namesOwnAccount(t, accounts);
  const plus = hasPlusSign(text);

  // "paid Citi Card bill 500": paying one of the user's own accounts is a
  // transfer only when the source is an own account too; else the model's.
  if (expenseStrong && !incomeStrong && paysOwnAccount(t, accounts)) {
    return fromOwnAccount(t, accounts) ? { type: 'transfer', rule: 'transfer' } : null;
  }

  if (transferVerb && !incomeStrong && !plus) {
    // "transferred 200 to Sam from DBS Savings": the own account is only the
    // source; a named destination that is not an own account is a payment to
    // someone (when the account list is known), else the model's call.
    if (DESTINATION.test(t) && !toOwnAccount(t, accounts)) {
      if (accounts.length > 0 && !expenseStrong) return { type: 'expense', rule: 'payment-to-someone' };
      if (fromOwnAccount(t, accounts)) return null;
    }
    if (ownAccount) return { type: 'transfer', rule: 'transfer' };
    // A transfer verb with a named destination that is none of the user's
    // accounts is a payment to someone ("transferred 150 to mum"). Only when
    // the account list is known: with none, the destination could be one.
    if (accounts.length > 0 && !expenseStrong && DESTINATION.test(t)) {
      return { type: 'expense', rule: 'payment-to-someone' };
    }
  }
  if (incomeStrong && expenseStrong) return null;
  // "paid 500 to credit card", "paid 300 into savings": a payment INTO one of
  // the user's own accounts is a transfer in this app, so the spend verb alone
  // does not decide it; the model's answer stands.
  if (expenseStrong && ownAccount && !incomeStrong) return null;
  if (incomeStrong) return { type: 'income', rule: 'income-word' };
  if (expenseStrong) return { type: 'expense', rule: 'expense-verb' };
  if (plus) return { type: 'income', rule: 'plus-sign' };

  const incomeWeak = INCOME_WEAK.test(t);
  const expenseWeak = EXPENSE_WEAK.test(t);
  if (incomeWeak && !expenseWeak) return { type: 'income', rule: 'income-word' };
  if (expenseWeak && !incomeWeak && !transferVerb) return { type: 'expense', rule: 'expense-word' };
  return null;
}

/**
 * The type the pipeline uses: code's verdict where the words decide it, else
 * the model's — except a model `transfer` that nothing in the text supports
 * (no transfer verb, no account reference), which the app could not save as a
 * transfer anyway and so becomes an expense (income when an income word is
 * present). `modelType` may be null (the model gave none).
 */
export function resolveSign(
  text: string,
  modelType: TransactionType | null,
  accounts: readonly Account[] = []
): { type: TransactionType | null; rule: SignRule | null } {
  const read = readSign(text, accounts);
  if (read) return read;
  if (modelType === 'transfer') {
    const t = prepareCueText(text);
    if (!TRANSFER_VERB.test(t) && !namesOwnAccount(t, accounts)) {
      return { type: INCOME_WEAK.test(t) ? 'income' : 'expense', rule: 'not-a-transfer' };
    }
  }
  return { type: modelType, rule: null };
}

/** Words that name the KIND of a transaction, which the model sometimes puts
 *  in `payee` ("+3200 payday" -> payee "payday"; "gift 35" -> payee "gift").
 *  None of them is a merchant, place or person. */
const KIND_WORDS = new Set([
  'payday', 'salary', 'wages', 'paycheck', 'payslip', 'bonus', 'dividend', 'dividends', 'interest', 'cashback',
  'refund', 'reimbursement', 'rebate', 'income', 'gift', 'present', 'tax', 'taxes', 'deposit', 'fee', 'fees',
  'bill', 'fare', 'rent', 'tip', 'tips', 'donation', 'transfer', 'withdrawal', 'top up', 'topup',
]);

/** True when `payee` is only a transaction-kind word, never a real payee. */
export function isTransactionKindWord(payee: string): boolean {
  return KIND_WORDS.has(normalizeName(payee).replace(/^(?:the|my|a|an) /, ''));
}

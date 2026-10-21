/**
 * Which of the user's entities the parse prompt grounds the model in.
 *
 * Before this module the parse prompt builders (./deviceParsePrompt's
 * `buildFmParsePrompt`, which the BYOK `buildCloudParsePrompt` wraps) listed EVERY payee, category and account the user has.
 * The eval never sends more than 8 payees and 13 categories per case, but a
 * real user has far longer lists after a few months, and `applyGroundingGuards`
 * drops any payee or account the text does not name anyway - so most of that
 * list was tokens the small on-device model had to read for nothing, and the
 * likeliest reason the phone feels worse than the eval (package B review,
 * 2026-10-10). This selector caps the lists the same way for the app and the
 * eval harness:
 *   - payees: all of them when there are `MAX_UNCAPPED_PAYEES` or fewer; else
 *     every payee the text names (see `mentionsName`), plus at most
 *     `MAX_RECENT_PAYEES` of the rest by recency of use;
 *   - categories: all of them when there are `MAX_CATEGORIES` or fewer, else
 *     the `MAX_CATEGORIES` most used plus every category the text names;
 *   - accounts: all of them (the list is short and the account rules need it).
 * WHICH entities are kept depends only on the text, the entity set and the
 * usage (ties break by name). The output keeps the CALLER's order: the first
 * FM dev run of the capped lists (2026-10-12) sorted them by name, which moved
 * no entity in or out of any of the 306 small-list dev cases yet flipped six of
 * them (parse 95.6% -> 92.8%): the on-device model's answers on short texts
 * move with the order of the lists it reads. Keeping the caller's order makes
 * an uncapped prompt byte-identical to the one before the caps.
 *
 * Framework-free (no RN imports): the app, the plain-node BDD suite and the eval
 * harness import the exact module.
 */
import { Account, Category, Payee } from './types';
import { boundedNamePattern, isWholeWordVariant, normalizeName } from './textMatch';

/** Up to this many payees are all offered; the cap is for long lists only. */
export const MAX_UNCAPPED_PAYEES = 20;
/** Past `MAX_UNCAPPED_PAYEES`, how many recently used payees are offered
 *  beyond the ones the text names. */
export const MAX_RECENT_PAYEES = 10;
/** Up to this many categories are all offered; past it, the most used win. */
export const MAX_CATEGORIES = 30;

/** How often, and how recently, an entity was used - from the ledger. */
export interface EntityUsage {
  /** Transactions that reference the entity. */
  count: number;
  /** Epoch ms of the latest such transaction, or null for never. */
  lastUsedAt: number | null;
}

/** Usage keyed by entity id. Any entity absent here counts as never used. */
export interface GroundingUsage {
  payees?: Readonly<Record<string, EntityUsage>>;
  categories?: Readonly<Record<string, EntityUsage>>;
}

export interface GroundingEntities {
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
}

const byName = <T extends { name: string }>(a: T, b: T): number =>
  normalizeName(a.name).localeCompare(normalizeName(b.name)) || a.name.localeCompare(b.name);

/** Up to three consecutive words of the text, every start position. */
function wordRuns(text: string): string[] {
  const words = normalizeName(text).split(' ').filter(Boolean);
  const runs: string[] = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) runs.push(words.slice(i, i + n).join(' '));
  }
  return runs;
}

/** True when the text names the entity: its whole name as a bounded word
 *  ("FairPrice" in "groceries at FairPrice"), or - with `variants` - a run of
 *  the text's words that is a whole-word variant of it ("kopitiam" for "The
 *  Old Kopitiam", the same rule the payee matcher uses). A plain plural or
 *  singular of the name counts too ("donation" names "Donations"). Variants are for
 *  payees only: category names share words ("Fast Food", "Food Delivery"), so a
 *  category counts as named only by its whole name. */
export function nameAppearsInText(
  name: string,
  text: string,
  runs: string[] = wordRuns(text),
  variants = true
): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  if (new RegExp(boundedNamePattern(n), 'i').test(text)) return true;
  // A plain English plural: "donation" names "Donations", "fees" names "Fee".
  const singular = n.replace(/s$/, '');
  if (singular !== n && new RegExp(boundedNamePattern(singular), 'i').test(text)) return true;
  if (singular === n && new RegExp(boundedNamePattern(n + 's'), 'i').test(text)) return true;
  return variants && runs.some((run) => isWholeWordVariant(run, n));
}

/** Connector words of 3+ letters that name nothing on their own. */
const CONNECTORS = new Set(['the', 'and', 'for', 'from', 'with', 'via', 'off', 'per']);

/** Lower-case words of 3+ letters, punctuation stripped ("McDonald's" ->
 *  "mcdonalds"), connectors left out. */
function tokens(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => /\p{L}{3}/u.test(w) && !CONNECTORS.has(w));
  return new Set(words);
}

/** True when the text names the entity (`nameAppearsInText`) or shares a whole
 *  word of 3+ letters with it ("ntuc" -> "NTUC FairPrice", "starbucks" ->
 *  "Starbucks Reserve", "dental" -> "Dental Care"). Generous on purpose: it
 *  only decides what a CAPPED list offers, and an extra entry costs a few
 *  tokens while a missing one costs the answer. */
function mentionsName(name: string, text: string, runs: string[], textTokens: Set<string>, variants: boolean): boolean {
  if (nameAppearsInText(name, text, runs, variants)) return true;
  for (const t of tokens(name)) if (textTokens.has(t)) return true;
  return false;
}

/** True when `a` and `b` share a whole word of 3+ letters (the rule above,
 *  without the name-in-text half): "ntuc" and "NTUC FairPrice". Also used by
 *  the Ask-Xavier payee filter (./queryFilterResolution). */
export function sharesNameWord(a: string, b: string): boolean {
  const bt = tokens(b);
  for (const t of tokens(a)) if (bt.has(t)) return true;
  return false;
}

/** The kept entities, in the caller's order. */
function inCallerOrder<T extends { id: string }>(list: T[], kept: Iterable<T>): T[] {
  const ids = new Set([...kept].map((e) => e.id));
  return list.filter((e) => ids.has(e.id));
}

/** Most recently used first (ties: more used, then name); never used last. */
function byRecency(usage: Readonly<Record<string, EntityUsage>> | undefined) {
  return <T extends { id: string; name: string }>(a: T, b: T): number => {
    const ua = usage?.[a.id];
    const ub = usage?.[b.id];
    return (ub?.lastUsedAt ?? 0) - (ua?.lastUsedAt ?? 0) || (ub?.count ?? 0) - (ua?.count ?? 0) || byName(a, b);
  };
}

/** Most used first (ties: more recent, then name); never used last. */
function byUse(usage: Readonly<Record<string, EntityUsage>> | undefined) {
  return <T extends { id: string; name: string }>(a: T, b: T): number => {
    const ua = usage?.[a.id];
    const ub = usage?.[b.id];
    return (ub?.count ?? 0) - (ua?.count ?? 0) || (ub?.lastUsedAt ?? 0) - (ua?.lastUsedAt ?? 0) || byName(a, b);
  };
}

/**
 * The entities the prompt for `text` should list (see the module header).
 * Pure: same inputs, same output; each list keeps the caller's order.
 */
export function selectGroundingEntities(
  text: string,
  entities: GroundingEntities,
  usage: GroundingUsage = {}
): GroundingEntities {
  const runs = wordRuns(text);
  const textTokens = tokens(text);

  let payees: Payee[] = entities.payees;
  if (entities.payees.length > MAX_UNCAPPED_PAYEES) {
    const named = entities.payees.filter((p) => mentionsName(p.name, text, runs, textTokens, true));
    const namedIds = new Set(named.map((p) => p.id));
    const recent = entities.payees
      .filter((p) => !namedIds.has(p.id))
      .sort(byRecency(usage.payees))
      .slice(0, MAX_RECENT_PAYEES);
    payees = inCallerOrder(entities.payees, [...named, ...recent]);
  }

  let categories: Category[] = entities.categories;
  if (entities.categories.length > MAX_CATEGORIES) {
    const mostUsed = [...entities.categories].sort(byUse(usage.categories)).slice(0, MAX_CATEGORIES);
    const kept = new Set(mostUsed.map((c) => c.id));
    const alsoNamed = entities.categories.filter(
      (c) => !kept.has(c.id) && mentionsName(c.name, text, runs, textTokens, false)
    );
    categories = inCallerOrder(entities.categories, [...mostUsed, ...alsoNamed]);
  }

  return { categories: [...categories], payees: [...payees], accounts: [...entities.accounts] };
}

/**
 * Which of the user's entities the parse prompt grounds the model in.
 *
 * Before this module `buildFmParsePrompt` and `buildDeviceParsePrompt`
 * (./deviceParsePrompt) listed EVERY payee, category and account the user has.
 * The eval never sends more than 8 payees and 13 categories per case, but a
 * real user has far longer lists after a few months, and `applyGroundingGuards`
 * drops any payee or account the text does not name anyway - so most of that
 * list was tokens the small on-device model had to read for nothing, and the
 * likeliest reason the phone feels worse than the eval (package B review,
 * 2026-10-10). This selector caps the lists the same way for the app and the
 * eval harness:
 *   - payees: every payee the text names (whole-word, or a whole-word variant
 *     of a run of the text's words, see ./textMatch), plus at most
 *     `MAX_RECENT_PAYEES` of the rest by recency of use;
 *   - categories: all of them when there are `MAX_CATEGORIES` or fewer, else
 *     the `MAX_CATEGORIES` most used plus every category the text names;
 *   - accounts: all of them (the list is short and the account rules need it).
 * The output is sorted by name, so the prompt is a pure function of its inputs
 * and the eval stays reproducible. Without usage data (the eval's contexts, a
 * fresh install) recency and usage fall back to name order - deterministic,
 * never the insertion order of a database.
 *
 * Framework-free (no RN imports): the app, the plain-node BDD suite and the eval
 * harness import the exact module.
 */
import { Account, Category, Payee } from './types';
import { boundedNamePattern, isWholeWordVariant, normalizeName } from './textMatch';

/** Beyond the payees the text names, how many recently used ones are offered. */
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
 * Pure: same inputs, same output, sorted by name.
 */
export function selectGroundingEntities(
  text: string,
  entities: GroundingEntities,
  usage: GroundingUsage = {}
): GroundingEntities {
  const runs = wordRuns(text);

  const named = entities.payees.filter((p) => nameAppearsInText(p.name, text, runs));
  const namedIds = new Set(named.map((p) => p.id));
  const recent = entities.payees
    .filter((p) => !namedIds.has(p.id))
    .sort(byRecency(usage.payees))
    .slice(0, MAX_RECENT_PAYEES);
  const payees = [...named, ...recent].sort(byName);

  let categories: Category[];
  if (entities.categories.length <= MAX_CATEGORIES) {
    categories = [...entities.categories].sort(byName);
  } else {
    const mostUsed = [...entities.categories].sort(byUse(usage.categories)).slice(0, MAX_CATEGORIES);
    const kept = new Set(mostUsed.map((c) => c.id));
    const alsoNamed = entities.categories.filter(
      (c) => !kept.has(c.id) && nameAppearsInText(c.name, text, runs, false)
    );
    categories = [...mostUsed, ...alsoNamed].sort(byName);
  }

  return { categories, payees, accounts: [...entities.accounts].sort(byName) };
}

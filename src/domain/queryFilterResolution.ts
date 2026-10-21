/**
 * Ask-Xavier filter resolution — how a category / payee / account WORD in a
 * question ("food", "mcd", "dbs") becomes the user's own entities. Pure and
 * framework-free (BDD: tests/__features__/query-filter-resolution.feature);
 * `src/domain/queryTools.ts` runs every named filter through here before it
 * filters anything.
 *
 * The ladder, first rung that resolves wins:
 *  1. exact — the normalised name of one of the user's entities;
 *     then a sentinel ("none", "all", … — `isNoFilter`) is no filter at all,
 *     checked only AFTER the exact match so a real category named "All"
 *     still resolves (queryTools.ts's QA MAJOR 1 note), and BEFORE every
 *     looser rung so "all" never fuzzes into "Mall";
 *  2. memory — what the user picked for this word last time (a `q:` row of
 *     phrase memory, see `queryTermKey` in ./phraseMemory);
 *  3. fuzzy — a typo or whole-word variant (`findCategoryMatch` /
 *     `findPayeeMatch` suggestions); for payees also a shared word of 3+
 *     letters (`sharesNameWord`, the grounding rule) or a word prefix
 *     ("mcd" → "McDonald's"); several payees sharing the word are a union;
 *  4. synonym — a small built-in concept table ("food" → dining, groceries,
 *     …) matched against the user's category names of the question's kind;
 *  5. union — two or more of the user's categories match the concept: all of
 *     them are summed and all of them are named.
 * Every rung fails → `how: 'none'` and the caller keeps today's honest
 * "couldn't find … — showing all" note. Kind scoping is absolute: an expense
 * question never matches (or unions) an income category, at any rung.
 *
 * Accounts keep `findAccountMatch`'s stricter rules (an account guess can
 * point at the wrong real money): exact, memory, then its containment /
 * subtype match; a typo suggestion or an ambiguous pair is only ever offered
 * as an alternative, never applied.
 *
 * A matched category's sub-categories (`parentId`) are included in `ids`.
 */
import { Account, Category, Payee } from './types';
import { findCategoryMatch } from './categories';
import { findPayeeMatch } from './payees';
import { findAccountMatch } from './accountMatch';
import { editDistance, isWholeWordVariant, normalizeName } from './textMatch';
import { sharesNameWord } from './groundingSelection';
import { PhraseMemoryRow, QueryTermScope, queryTermId, queryTermKey } from './phraseMemory';

export type FilterDimension = 'category' | 'payee' | 'account';
export type FilterHow = 'exact' | 'memory' | 'fuzzy' | 'synonym' | 'union' | 'none';

export interface FilterOption {
  id: string;
  name: string;
}

/** How one named filter resolved — carried on the tool result (`filters`)
 *  so the answer card can say what was included and offer other choices. */
export interface FilterResolution {
  dim: FilterDimension;
  /** The word as asked (trimmed). */
  term: string;
  /** Every entity id the filter keeps (sub-categories included). Empty for 'none'. */
  ids: string[];
  /** The matched entities' own names, in the user's list order. */
  names: string[];
  how: FilterHow;
  /** Other entities the word could mean: the union's members for "just X",
   *  near misses for "did you mean". Never includes a name in `names`
   *  unless `how` is 'union'. */
  alternatives: FilterOption[];
  /** The phrase-memory key that applied (`how: 'memory'`), for the revert. */
  memoryKey?: string;
  /** The category kind the filter was scoped to (category filters only). */
  kind?: 'expense' | 'income';
}

/** At most this many alternatives are offered. */
export const MAX_FILTER_ALTERNATIVES = 4;

// ─── sentinels ──────────────────────────────────────────────────────────────

/**
 * Sentinel/"no filter" strings a model emits for "the user didn't actually
 * name one" (QA device-testing follow-up, build 55) — FM's own schema uses
 * `""`, BYOK cloud models freely emit "none"/"any"/"all"/etc. Case-insensitive
 * and trimmed. See queryTools.ts for the precedence rule (never before a real
 * exact match).
 */
const NO_FILTER_VALUES = new Set([
  '',
  'none',
  'null',
  'n/a',
  'na',
  'any',
  'all',
  'unspecified',
  'none of them',
  'everything',
]);

export function isNoFilter(name: string | undefined): boolean {
  if (!name) return true;
  return NO_FILTER_VALUES.has(name.trim().toLowerCase());
}

// ─── the synonym table ──────────────────────────────────────────────────────

interface Concept {
  key: string;
  words: string[];
}

/** Expense concepts: the umbrella word and what people file under it. */
export const EXPENSE_CONCEPTS: readonly Concept[] = [
  {
    key: 'food',
    words: ['dining', 'groceries', 'restaurants', 'eating out', 'food & drink', 'meals', 'hawker', 'kopi'],
  },
  { key: 'transport', words: ['transit', 'grab', 'taxi', 'mrt', 'bus', 'petrol', 'gas', 'parking'] },
  { key: 'shopping', words: ['clothes', 'fashion', 'zalora', 'amazon', 'shopee'] },
  { key: 'bills', words: ['utilities', 'phone', 'internet', 'insurance'] },
  { key: 'health', words: ['medical', 'pharmacy', 'dental', 'gym'] },
  { key: 'entertainment', words: ['movies', 'netflix', 'games', 'outings'] },
  { key: 'housing', words: ['rent', 'mortgage', 'home'] },
];

/** Lower-case words, '&' read as "and", other punctuation dropped. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A word and its plain English singulars ("movies" → movie, "groceries" → grocery). */
function forms(w: string): string[] {
  const out = [w];
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) {
    out.push(w.slice(0, -1));
    if (w.endsWith('es')) out.push(w.slice(0, -2));
    if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
  }
  return out;
}

function sameWord(a: string, b: string): boolean {
  const fb = forms(b);
  return forms(a).some((x) => fb.includes(x));
}

/** True when `phrase`'s words appear, in order and adjacent, in `name`. */
function phraseIn(phrase: string, name: string): boolean {
  const p = words(phrase);
  const n = words(name);
  if (!p.length || p.length > n.length) return false;
  for (let i = 0; i + p.length <= n.length; i++) {
    if (p.every((w, j) => sameWord(w, n[i + j]!))) return true;
  }
  return false;
}

function samePhrase(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  return wa.length === wb.length && wa.every((w, i) => sameWord(w, wb[i]!));
}

/** The concepts `term` names: the umbrella word itself or one of its words. */
function conceptsFor(term: string): Concept[] {
  return EXPENSE_CONCEPTS.filter((c) => samePhrase(term, c.key) || c.words.some((w) => samePhrase(term, w)));
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** `ids` plus every category below them (sub-categories, any depth). */
function withDescendants(ids: string[], categories: readonly Category[]): string[] {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return [...out];
}

function inListOrder<T extends { id: string }>(list: readonly T[], picked: Iterable<T>): T[] {
  const ids = new Set([...picked].map((e) => e.id));
  return list.filter((e) => ids.has(e.id));
}

function options(list: readonly { id: string; name: string }[], exclude: readonly string[] = []): FilterOption[] {
  const seen = new Set(exclude);
  const out: FilterOption[] = [];
  for (const e of list) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, name: e.name });
    if (out.length >= MAX_FILTER_ALTERNATIVES) break;
  }
  return out;
}

function memoryRow(
  scope: QueryTermScope,
  term: string,
  memory: readonly PhraseMemoryRow[]
): { key: string; id: string } | null {
  const key = queryTermKey(scope, term);
  if (!key) return null;
  const row = memory.find((r) => r.key === key);
  const id = queryTermId(row, scope);
  return id ? { key, id } : null;
}

/**
 * A typo suggestion is only trusted on a word long enough to have a typo in:
 * the matchers allow two edits on any word, which on a short word reaches a
 * different word entirely ("gas" → "Gym", "food" → "Gold"). Under six letters
 * one edit, under four none; a whole-word variant ("kopitiam" → "The Old
 * Kopitiam") is always fine.
 */
function trustedSuggestion(term: string, name: string): boolean {
  const a = normalizeName(term);
  const b = normalizeName(name);
  if (isWholeWordVariant(a, b)) return true;
  if (a.length < 4) return false;
  return a.length >= 6 || editDistance(a, b) <= 1;
}

// ─── categories ─────────────────────────────────────────────────────────────

/** The near misses of `term` among `pool` (one kind): typo, whole-word
 *  variant, then categories whose name contains a concept the term names. */
function categoryCandidates(term: string, pool: readonly Category[]): { fuzzy: Category[]; synonym: Category[] } {
  const fuzzy: Category[] = [];
  const found = findCategoryMatch(term, pool[0]?.kind ?? 'expense', [...pool]).suggestion;
  const suggestion = found && trustedSuggestion(term, found.name) ? found : undefined;
  if (suggestion) fuzzy.push(suggestion);
  const target = normalizeName(term);
  const variants = pool.filter((c) => c.id !== suggestion?.id && isWholeWordVariant(target, normalizeName(c.name)));
  fuzzy.push(...variants);

  const synonym: Category[] = [];
  if (pool[0]?.kind === 'expense') {
    const concepts = conceptsFor(term);
    for (const c of pool) {
      if (fuzzy.some((f) => f.id === c.id)) continue;
      if (concepts.some((k) => [k.key, ...k.words].some((w) => phraseIn(w, c.name)))) synonym.push(c);
    }
  }
  return { fuzzy, synonym };
}

function categoryResolution(
  term: string,
  kind: 'expense' | 'income',
  how: FilterHow,
  matched: Category[],
  categories: readonly Category[],
  alternatives: FilterOption[],
  memoryKey?: string
): FilterResolution {
  const ordered = inListOrder(categories, matched);
  return {
    dim: 'category',
    term,
    ids: withDescendants(
      ordered.map((c) => c.id),
      categories
    ),
    names: ordered.map((c) => c.name),
    how,
    alternatives,
    kind,
    ...(memoryKey ? { memoryKey } : {}),
  };
}

/**
 * Resolve a category word for a question of `kind` ('any' — search — tries
 * expense then income at every rung, never mixing the two). Null for an
 * absent or sentinel word (no filter, no note).
 */
export function resolveCategoryFilter(
  term: string | undefined,
  kind: 'expense' | 'income' | 'any',
  categories: readonly Category[],
  memory: readonly PhraseMemoryRow[] = []
): FilterResolution | null {
  if (!term || !term.trim()) return null;
  const t = term.trim();
  const kinds: Array<'expense' | 'income'> = kind === 'any' ? ['expense', 'income'] : [kind];
  const pools = kinds.map((k) => ({ kind: k, pool: categories.filter((c) => c.kind === k) }));

  // 1. exact
  for (const { kind: k, pool } of pools) {
    const exact = findCategoryMatch(t, k, [...pool]).exact;
    if (exact) return categoryResolution(t, k, 'exact', [exact], categories, []);
  }
  if (isNoFilter(t)) return null;

  // 2. memory
  for (const { kind: k, pool } of pools) {
    const hit = memoryRow(k, t, memory);
    const remembered = hit ? pool.find((c) => c.id === hit.id) : undefined;
    if (hit && remembered) {
      const { fuzzy, synonym } = categoryCandidates(t, pool);
      return categoryResolution(t, k, 'memory', [remembered], categories, options([...fuzzy, ...synonym], [remembered.id]), hit.key);
    }
  }

  // 3. fuzzy, 4. synonym, 5. union
  for (const { kind: k, pool } of pools) {
    if (!pool.length) continue;
    const { fuzzy, synonym } = categoryCandidates(t, pool);
    if (fuzzy.length) {
      const [best] = fuzzy;
      return categoryResolution(t, k, 'fuzzy', [best!], categories, options([...fuzzy, ...synonym], [best!.id]));
    }
    if (synonym.length === 1) return categoryResolution(t, k, 'synonym', synonym, categories, []);
    if (synonym.length > 1) {
      const members = inListOrder(categories, synonym);
      return categoryResolution(t, k, 'union', members, categories, options(members));
    }
  }

  return { dim: 'category', term: t, ids: [], names: [], how: 'none', alternatives: [], ...(kind !== 'any' ? { kind } : {}) };
}

// ─── payees ─────────────────────────────────────────────────────────────────

/** A 3+ letter word of `term` begins a word of `name` ("mcd" → "McDonald's"). */
function prefixesNameWord(term: string, name: string): boolean {
  const nw = words(name);
  return words(term).some((w) => w.length >= 3 && /\p{L}/u.test(w) && nw.some((n) => n.length > w.length && n.startsWith(w)));
}

/** Resolve a payee word. Null for an absent or sentinel word. */
export function resolvePayeeFilter(
  term: string | undefined,
  payees: readonly Payee[],
  memory: readonly PhraseMemoryRow[] = []
): FilterResolution | null {
  if (!term || !term.trim()) return null;
  const t = term.trim();
  const make = (how: FilterHow, matched: Payee[], alternatives: FilterOption[], memoryKey?: string): FilterResolution => {
    const ordered = inListOrder(payees, matched);
    return {
      dim: 'payee',
      term: t,
      ids: ordered.map((p) => p.id),
      names: ordered.map((p) => p.name),
      how,
      alternatives,
      ...(memoryKey ? { memoryKey } : {}),
    };
  };

  const found = findPayeeMatch(t, [...payees]);
  if (found.exact) return make('exact', [found.exact], []);
  if (isNoFilter(t)) return null;

  // A typo ("starbux") points at one payee; a word ("starbucks", "ntuc") can
  // name several ("Starbucks Reserve", "Starbucks Airport"), and then they
  // are a union. A word prefix ("mcd") only counts when no whole word does.
  const target = normalizeName(t);
  const typo =
    found.suggestion &&
    !isWholeWordVariant(target, normalizeName(found.suggestion.name)) &&
    trustedSuggestion(t, found.suggestion.name)
      ? found.suggestion
      : undefined;
  const byWord = payees.filter(
    (p) => p.id !== typo?.id && (isWholeWordVariant(target, normalizeName(p.name)) || sharesNameWord(t, p.name))
  );
  const byPrefix = byWord.length ? [] : payees.filter((p) => p.id !== typo?.id && prefixesNameWord(t, p.name));
  const near = [...(typo ? [typo] : []), ...byWord, ...byPrefix];

  const hit = memoryRow('payee', t, memory);
  const remembered = hit ? payees.find((p) => p.id === hit.id) : undefined;
  if (hit && remembered) return make('memory', [remembered], options(near, [remembered.id]), hit.key);

  if (typo) return make('fuzzy', [typo], options(near, [typo.id]));
  const named = byWord.length ? byWord : byPrefix;
  if (named.length === 1) return make('fuzzy', named, []);
  if (named.length > 1) {
    const members = inListOrder(payees, named);
    return make('union', members, options(members));
  }
  return make('none', [], []);
}

// ─── accounts ───────────────────────────────────────────────────────────────

/** Resolve an account word. Null for an absent or sentinel word. */
export function resolveAccountFilter(
  term: string | undefined,
  accounts: readonly Account[],
  memory: readonly PhraseMemoryRow[] = []
): FilterResolution | null {
  if (!term || !term.trim()) return null;
  const t = term.trim();
  const make = (how: FilterHow, matched: Account[], alternatives: FilterOption[], memoryKey?: string): FilterResolution => ({
    dim: 'account',
    term: t,
    ids: matched.map((a) => a.id),
    names: matched.map((a) => a.name),
    how,
    alternatives,
    ...(memoryKey ? { memoryKey } : {}),
  });

  const match = findAccountMatch(t, [...accounts]);
  if (match?.account && match.confidence >= 1) return make('exact', [match.account], []);
  if (isNoFilter(t)) return null;

  const near = [
    ...(match?.account ? [match.account] : []),
    ...(match?.ambiguous ?? []),
    ...(match?.suggestion ? [match.suggestion] : []),
  ];
  const hit = memoryRow('account', t, memory);
  const remembered = hit ? accounts.find((a) => a.id === hit.id && !a.archived) : undefined;
  if (hit && remembered) return make('memory', [remembered], options(near, [remembered.id]), hit.key);

  if (match?.account) return make('fuzzy', [match.account], []);
  return make('none', [], options(near));
}

// ─── result helpers ─────────────────────────────────────────────────────────

/** The caption name for a resolution: "Dining", "Dining + Groceries". */
export function resolvedLabel(r: FilterResolution | null): string | undefined {
  return r && r.names.length ? r.names.join(' + ') : undefined;
}

/** The honest "couldn't find" note for a word no rung resolved. */
export function unresolvedNote(r: FilterResolution | null): string | null {
  return r && r.how === 'none' ? `couldn't find ${r.dim} "${r.term}" — showing all` : null;
}

/** The set a transaction's id must be in, or null for no filter. */
export function idSet(r: FilterResolution | null): Set<string> | null {
  return r && r.ids.length ? new Set(r.ids) : null;
}

/** The phrase-memory scope a resolution teaches when the user picks `option`. */
export function termScope(
  dim: FilterDimension,
  option: FilterOption,
  categories: readonly Category[]
): QueryTermScope | null {
  if (dim === 'payee' || dim === 'account') return dim;
  const kind = categories.find((c) => c.id === option.id)?.kind;
  return kind === 'expense' || kind === 'income' ? kind : null;
}

// ─── what the answer card says and offers ───────────────────────────────────

/** A chip on the answer card. `pick` re-runs the same tool with that entity
 *  (no model call) and teaches term memory; `revert` counts a revert on the
 *  memory that applied and re-runs without it. */
export type FilterChipAction =
  | { kind: 'pick'; dim: FilterDimension; term: string; option: FilterOption }
  | { kind: 'revert'; dim: FilterDimension; term: string; memoryKey: string };

export interface FilterChip {
  label: string;
  action: FilterChipAction;
}

export interface FilterExplanation {
  /** One short line on what was included, or null when nothing needs saying. */
  line: string | null;
  chips: FilterChip[];
}

/**
 * The card's line and chips for one resolution. Exact matches need no words
 * (the caption names them); a memory says "as last time" with a revert; a
 * fuzzy or synonym match says what it read the word as, with a confirm chip
 * and "did you mean" alternatives; a union names every member with a
 * "Just <X>" chip each; an unresolved word offers its near misses.
 */
export function explainFilter(r: FilterResolution): FilterExplanation {
  const pick = (option: FilterOption, label: string): FilterChip => ({
    label,
    action: { kind: 'pick', dim: r.dim, term: r.term, option },
  });
  const label = resolvedLabel(r) ?? '';
  const applied = r.ids.length ? r.names.map((name, i) => ({ id: r.ids[i]!, name })) : [];
  switch (r.how) {
    case 'exact':
      return { line: null, chips: [] };
    case 'memory':
      return {
        line: `Read "${r.term}" as ${label}, as last time.`,
        chips: [
          ...(r.memoryKey
            ? [{ label: `Not ${label}`, action: { kind: 'revert', dim: r.dim, term: r.term, memoryKey: r.memoryKey } as const }]
            : []),
          ...r.alternatives.map((a) => pick(a, a.name)),
        ],
      };
    case 'fuzzy':
    case 'synonym':
      return {
        line: r.alternatives.length
          ? `Read "${r.term}" as ${label}. Did you mean something else?`
          : `Read "${r.term}" as ${label}.`,
        chips: [...(applied[0] ? [pick(applied[0], `Yes, ${applied[0].name}`)] : []), ...r.alternatives.map((a) => pick(a, a.name))],
      };
    case 'union':
      return {
        line: `Included ${label} for "${r.term}".`,
        chips: r.alternatives.map((a) => pick(a, `Just ${a.name}`)),
      };
    case 'none':
      return r.alternatives.length
        ? { line: `Did you mean one of these for "${r.term}"?`, chips: r.alternatives.map((a) => pick(a, a.name)) }
        : { line: null, chips: [] };
  }
}

/** The `filters` a tool result carries (its own executor's output). */
export function filtersOfResult(result: unknown): FilterResolution[] {
  const f = (result as { filters?: unknown } | null)?.filters;
  return Array.isArray(f) ? (f as FilterResolution[]) : [];
}

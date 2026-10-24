/**
 * The slot reader's purpose tail (./slotReader: "for lunch", "for the ride")
 * as a category, resolved through D1's ladder (`resolveCategoryFilter`,
 * ./queryFilterResolution: exact, term memory, fuzzy, synonym), scoped to the
 * transaction's kind, so an income's tail never picks an expense category
 * ("got 30 from dad for taxi" stays uncategorised). Used by `finishFmParse`
 * (./fmParse) when the model gave no category or one not in the user's list,
 * and by `localParse` when its exact match found none.
 *
 * The ladder's synonym table names concepts by their umbrella ("food",
 * "transport"). A meal or a ride is not an umbrella word, so `PURPOSE_WORDS`
 * maps the words people put after "for" to the category names they file them
 * under, tried in order: a meal tries "food", then "dining", "meals", ...;
 * the first one that resolves to exactly one of the user's categories wins.
 * A union ("food" -> Dining + Groceries) is not a pick: the next name is tried.
 *
 * Framework-free; BDD: tests/__features__/slot-purpose.feature.
 */
import { Category, TransactionType } from './types';
import { PhraseMemoryRow } from './phraseMemory';
import { resolveCategoryFilter } from './queryFilterResolution';
import { findCategoryMatch } from './categories';
import { normalizeName } from './textMatch';

const MEAL = ['food', 'dining', 'meals', 'restaurants', 'eating out', 'food and drink'];
const RIDE = ['transport', 'transportation', 'transit', 'travel'];
const SHOW = ['entertainment', 'leisure'];

/** Purpose words -> the category names they are filed under, in order. */
const PURPOSE_WORDS: Record<string, readonly string[]> = {
  lunch: MEAL, dinner: MEAL, breakfast: MEAL, brunch: MEAL, supper: MEAL, meal: MEAL, meals: MEAL,
  food: MEAL, makan: MEAL, mcd: MEAL, mcdonalds: MEAL, kopi: MEAL, coffee: MEAL, teh: MEAL, drinks: MEAL,
  bbt: MEAL, hawker: MEAL, snacks: MEAL, dessert: MEAL, takeaway: MEAL,
  taxi: RIDE, cab: RIDE, grab: RIDE, ride: RIDE, gojek: RIDE, bus: RIDE, mrt: RIDE, train: RIDE, fare: RIDE,
  petrol: RIDE, parking: RIDE, transport: RIDE,
  movie: SHOW, movies: SHOW, concert: SHOW, cinema: SHOW,
};

const DROP = new Set(['the', 'a', 'an', 'my', 'our', 'her', 'his', 'their', 'your', 'some', 'team', 'today', 'tonight']);

/** The purpose's own words, determiners dropped ("the team lunch" -> team lunch -> lunch). */
function purposeWords(purpose: string): string[] {
  return normalizeName(purpose)
    .replace(/'/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !DROP.has(w) && !/^\p{N}+$/u.test(w));
}

/** True when `name` is one of the user's categories of `kind` (exact). */
export function isUsersCategory(name: string | null, kind: 'expense' | 'income', categories: readonly Category[]): boolean {
  return !!name && !!findCategoryMatch(name, kind, [...categories]).exact;
}

/**
 * The user's category the purpose names, or null. `type` scopes it (a
 * transfer has no category here). Only a single, unambiguous match counts.
 */
export function categoryFromPurpose(
  purpose: string,
  type: TransactionType | null,
  categories: readonly Category[],
  memory: readonly PhraseMemoryRow[] = []
): string | null {
  if (type !== 'expense' && type !== 'income') return null;
  const words = purposeWords(purpose);
  if (!words.length) return null;
  const terms: string[] = [words.join(' '), ...words];
  for (const w of words) terms.push(...(PURPOSE_WORDS[w] ?? []));
  for (const term of [...new Set(terms)]) {
    const r = resolveCategoryFilter(term, type, categories, memory);
    if (r && r.names.length === 1 && r.how !== 'none' && r.how !== 'union') return r.names[0]!;
  }
  return null;
}

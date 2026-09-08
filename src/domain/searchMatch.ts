/**
 * One definition of "does this row match the search box".
 *
 * The Transactions screen searches two different kinds of thing that look
 * the same to a user: posted transactions, and the recurring series behind
 * the "Upcoming" section. Before this existed only the first was filtered,
 * so searching "Cookie" hid every unrelated transaction but still listed
 * every imminent recurring charge above them — the results read as if the
 * search had partly failed (device feedback, build 109).
 *
 * A `RecurrenceTemplate` carries the same searchable fields as a
 * `Transaction` (account, type, amount, currency, category, payee, note),
 * so both go through one predicate here rather than through two field lists
 * in two files that have to be kept in step by hand.
 */
import { toMajorUnits } from './money';
import { currencyExponent } from './currency';

/** The searchable shape common to a transaction and a recurrence template. */
export interface SearchableEntry {
  accountId: string;
  type: string;
  /** Minor units. Signed for a transaction, positive for a template — passed
   *  through as-is so the rendered figure is what gets matched. */
  amount: number;
  currency: string;
  categoryId?: string | null;
  payeeId?: string | null;
  note?: string | null;
}

/** Name lookups, injected so this stays free of the store and the screen. */
export interface SearchLookups {
  payeeName(id: string | null | undefined): string | undefined;
  categoryName(id: string | null | undefined): string | undefined;
  accountName(id: string): string | undefined;
}

/**
 * The strings a query is tested against, in the order a reader would expect
 * to find them. Exported so a test can assert what is searchable without
 * going through `matchesSearch`.
 */
export function searchFields(entry: SearchableEntry, lookups: SearchLookups): string[] {
  return [
    lookups.payeeName(entry.payeeId) ?? '',
    lookups.categoryName(entry.categoryId) ?? '',
    lookups.accountName(entry.accountId) ?? '',
    entry.note ?? '',
    entry.type,
    toMajorUnits(entry.amount, entry.currency).toFixed(currencyExponent(entry.currency)),
  ];
}

/**
 * Case-insensitive substring match across every searchable field. An empty
 * or whitespace-only query matches everything, so a caller can apply this
 * unconditionally instead of branching on whether search is active.
 */
export function matchesSearch(
  entry: SearchableEntry,
  query: string,
  lookups: SearchLookups
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return searchFields(entry, lookups).some((s) => s.toLowerCase().includes(q));
}

/**
 * Which recurring series belong in the "Upcoming" strip right now.
 *
 * Lives here rather than in the screen because the search filter is the part
 * that broke: the screen had this logic inline, computed from the series list
 * alone, so it never saw the query (build 109). A predicate test could not
 * catch that — the bug was a missing call, not a wrong rule — so the whole
 * selection moved down here where a scenario can exercise it directly.
 */
export interface UpcomingCandidate<S> {
  series: S;
  /** Epoch ms of the next occurrence. */
  date: number;
}

export interface UpcomingSelectionInput<S> {
  series: S[];
  now: number;
  /** How far ahead an occurrence still counts as "upcoming". */
  windowMs: number;
  query: string;
  lookups: SearchLookups;
  /** True for a series the user has paused or archived. */
  isInactive(series: S): boolean;
  /** The series' searchable template. */
  templateOf(series: S): SearchableEntry;
  /** Next occurrence at or after `now`, or null if there is none. */
  nextOccurrence(series: S, now: number): number | null;
}

export function selectUpcoming<S>({
  series,
  now,
  windowMs,
  query,
  lookups,
  isInactive,
  templateOf,
  nextOccurrence,
}: UpcomingSelectionInput<S>): UpcomingCandidate<S>[] {
  const out: UpcomingCandidate<S>[] = [];
  for (const s of series) {
    if (isInactive(s)) continue;
    // Matched on the template, which carries the same searchable fields as
    // the transaction this will post — so a payee search finds both the
    // charges already posted and the one still due.
    if (!matchesSearch(templateOf(s), query, lookups)) continue;
    const next = nextOccurrence(s, now);
    if (next != null && next - now < windowMs) out.push({ series: s, date: next });
  }
  return out.sort((a, b) => a.date - b.date);
}

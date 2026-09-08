import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  matchesSearch,
  selectUpcoming,
  SearchableEntry,
  SearchLookups,
} from '../../src/domain/searchMatch';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/search-match.feature')
);

const PAYEES: Record<string, string> = {
  p_cookie: 'Cookie Run Crumble',
  p_aviva: 'Aviva',
};
const CATEGORIES: Record<string, string> = { c_game: 'Game' };
const ACCOUNTS: Record<string, string> = { a_uob: 'UOB One' };

const lookups: SearchLookups = {
  payeeName: (id) => (id ? PAYEES[id] : undefined),
  categoryName: (id) => (id ? CATEGORIES[id] : undefined),
  accountName: (id) => ACCOUNTS[id],
};

/** A posted transaction: amount is signed (an expense is negative). */
const transaction: SearchableEntry = {
  accountId: 'a_uob',
  type: 'expense',
  amount: -13629,
  currency: 'SGD',
  categoryId: 'c_game',
  payeeId: 'p_cookie',
  note: 'receipt in the bag',
};

/** The same charge as a recurrence template: amount is positive, and there
 *  is no note — the shape differs, the searchable fields do not. */
const cookieTemplate: SearchableEntry = {
  accountId: 'a_uob',
  type: 'expense',
  amount: 13629,
  currency: 'SGD',
  categoryId: 'c_game',
  payeeId: 'p_cookie',
  note: null,
};

const avivaTemplate: SearchableEntry = {
  accountId: 'a_uob',
  type: 'expense',
  amount: 845,
  currency: 'SGD',
  categoryId: null,
  payeeId: 'p_aviva',
  note: null,
};

// ── Upcoming selection fixtures ─────────────────────────────────────────────
interface FakeSeries {
  id: string;
  template: SearchableEntry;
  dueInDays: number;
  paused?: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-08T12:00:00Z');
const WINDOW = 7 * DAY;

const runSelection = (series: FakeSeries[], query: string) =>
  selectUpcoming<FakeSeries>({
    series,
    now: NOW,
    windowMs: WINDOW,
    query,
    lookups,
    isInactive: (s) => s.paused === true,
    templateOf: (s) => s.template,
    nextOccurrence: (s) => NOW + s.dueInDays * DAY,
  }).map((c) => c.series.id);

defineFeature(feature, (test) => {
  const givenTransaction = (given: any) =>
    given(/^a transaction paid to "(.*)"$/, () => {
      // The fixtures above are the subjects; the payee name in the step text
      // is what makes the scenario readable.
    });

  test('An empty query matches everything', ({ given, then, and }) => {
    givenTransaction(given);
    then(/^a search for "(.*)" should match it$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(true);
    });
    and(/^a search for "(.*)" should match it$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(true);
    });
  });

  test('A query matches on the payee name, case-insensitively', ({
    given,
    then,
    and,
  }) => {
    givenTransaction(given);
    then(/^a search for "(.*)" should match it$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(true);
    });
    and(/^a search for "(.*)" should match it$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(true);
    });
    and(/^a search for "(.*)" should not match it$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(false);
    });
  });

  test('A recurring template matches the same query as a transaction', ({
    given,
    and,
    then,
  }) => {
    givenTransaction(given);
    and(/^a recurring template paid to "(.*)"$/, () => {});
    and(/^a recurring template paid to "(.*)"$/, () => {});
    then(
      /^a search for "(.*)" should match both the transaction and its template$/,
      (q: string) => {
        // The bug: these two disagreed, so the Upcoming section kept showing
        // rows the ledger below had already filtered out.
        expect(matchesSearch(transaction, q, lookups)).toBe(true);
        expect(matchesSearch(cookieTemplate, q, lookups)).toBe(true);
      }
    );
    and(
      /^a search for "(.*)" should not match the unrelated template$/,
      (q: string) => {
        expect(matchesSearch(avivaTemplate, q, lookups)).toBe(false);
      }
    );
  });

  test('A query matches the fields a user can see', ({ given, then, and }) => {
    givenTransaction(given);
    then(/^a search for "(.*)" should match it by category$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(true);
    });
    and(/^a search for "(.*)" should match it by account$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(true);
    });
    and(/^a search for "(.*)" should match it by amount$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(true);
    });
    and(/^a search for "(.*)" should match it by note$/, (q: string) => {
      expect(matchesSearch(transaction, q, lookups)).toBe(true);
    });
  });

  test('The Upcoming strip honours the search query', ({ given, and, then }) => {
    const series: FakeSeries[] = [];
    given(/^a "(.*)" series due in (\d+) days$/, (_name: string, days: string) => {
      series.push({ id: 'cookie', template: cookieTemplate, dueInDays: Number(days) });
    });
    and(/^an "(.*)" series due in (\d+) days$/, (_name: string, days: string) => {
      series.push({ id: 'aviva', template: avivaTemplate, dueInDays: Number(days) });
    });
    then('an empty search should list both', () => {
      expect(runSelection(series, '')).toEqual(['cookie', 'aviva']);
    });
    and(/^a search for "(.*)" should list only the Cookie series$/, (q: string) => {
      // The regression: this returned both, so the strip showed an unrelated
      // charge above a ledger that had already filtered it out.
      expect(runSelection(series, q)).toEqual(['cookie']);
    });
  });

  test('The Upcoming strip excludes what is not upcoming', ({ given, and, then }) => {
    const series: FakeSeries[] = [];
    given(/^a "(.*)" series due in (\d+) days$/, (_n: string, days: string) => {
      series.push({ id: 'active', template: cookieTemplate, dueInDays: Number(days) });
    });
    and(/^a paused "(.*)" series due in (\d+) days$/, (_n: string, days: string) => {
      series.push({
        id: 'paused',
        template: cookieTemplate,
        dueInDays: Number(days),
        paused: true,
      });
    });
    and(/^a "(.*)" series due in (\d+) days$/, (_n: string, days: string) => {
      series.push({ id: 'far', template: cookieTemplate, dueInDays: Number(days) });
    });
    then('an empty search should list only the active, imminent one', () => {
      expect(runSelection(series, '')).toEqual(['active']);
    });
  });
});

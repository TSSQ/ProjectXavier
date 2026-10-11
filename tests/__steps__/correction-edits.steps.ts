import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account } from '../../src/domain/types';
import { TransactionDraft } from '../../src/domain/assistant';
import {
  aggregateCorrectionEdits,
  amountChangeKind,
  appliedDefaultsOf,
  buildCorrectionEdits,
  changedFields,
  CORRECTION_FIELDS,
  CorrectionEdits,
  CorrectionField,
  dateOffsetBucket,
  EngineEditStats,
  engineProposalOf,
  FieldSnapshot,
  shouldCapture,
  snapshotOf,
} from '../../src/domain/correctionEdits';
import { makeAccount, money } from '../support/world';

const feature = loadFeature(path.resolve(__dirname, '../__features__/correction-edits.feature'));

/** Local noon on a calendar day, so the recorded day never shifts by zone. */
const localNoon = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12).getTime();
};

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** A minimal `edits` block for the aggregation fixture. */
function editsFor(
  engine: string,
  from: Partial<FieldSnapshot>,
  to: Partial<FieldSnapshot> | null,
  refused = false
): CorrectionEdits {
  const base: FieldSnapshot = {
    amount: 100,
    type: 'expense',
    category: null,
    payee: null,
    account: 'Wallet',
    date: '2026-10-09',
    note: null,
  };
  return buildCorrectionEdits({
    from: { ...base, ...from },
    to: to ? { ...base, ...to } : null,
    stage: 'draft',
    engine,
    parseSource: engine,
    appliedDefaults: [],
    refused,
  });
}

defineFeature(feature, (test) => {
  let accounts: Account[];
  let draft: TransactionDraft;
  let edits: CorrectionEdits;
  let reported: boolean;
  let cases: Array<{ edits: CorrectionEdits }>;
  let stats: Record<string, EngineEditStats>;

  const account = (name: string) => accounts.find((a) => a.name === name)!;

  const record = (saved: TransactionDraft | null, report = false) => {
    reported = report;
    edits = buildCorrectionEdits({
      from: snapshotOf(engineProposalOf(draft), accounts),
      to: saved ? snapshotOf(saved, accounts) : null,
      stage: 'draft',
      engine: 'on_device',
      parseSource: 'on_device',
      appliedDefaults: appliedDefaultsOf(draft),
      refused: false,
    });
  };

  const background = (given: any, and: any) => {
    given(/^accounts "(.*)" and "(.*)"$/, (a: string, b: string) => {
      accounts = [makeAccount({ name: a, currency: 'SGD' }), makeAccount({ name: b, currency: 'SGD' })];
    });
    and(
      /^an engine draft of (.*) expense on "(.*)" on (\S+), category "(.*)", payee "(.*)" and no note$/,
      (amt: string, acct: string, day: string, category: string, payee: string) => {
        draft = {
          accountId: account(acct).id,
          type: 'expense',
          amount: money(amt),
          currency: 'SGD',
          categoryName: category,
          payeeName: payee,
          note: null,
          occurredAt: localNoon(day),
          source: 'ai',
          defaulted: { account: false, payee: false, category: false, date: false },
        };
      }
    );
  };

  const whenSavedAsShown = (when: any) =>
    when(/^the user saves the draft as shown$/, () => record(draft));

  const thenEdit = (thenOrAnd: any) =>
    thenOrAnd(
      /^the edit for "(.*)" should be from (?:"(.*)"|(\d+)|nothing) to (?:"(.*)"|(\d+)|nothing)$/,
      (field: string, fromS?: string, fromN?: string, toS?: string, toN?: string) => {
        const e = edits[field as CorrectionField];
        expect(e.from).toEqual(fromS ?? (fromN ? Number(fromN) : null));
        expect(e.to).toEqual(toS ?? (toN ? Number(toN) : null));
      }
    );

  const thenCaptured = (thenOrAnd: any) =>
    thenOrAnd(/^the case should (not )?be captured$/, (not?: string) => {
      expect(shouldCapture(edits, reported)).toBe(!not);
    });

  const thenNoChange = (then: any) =>
    then(/^no field should count as changed$/, () => {
      expect(changedFields(edits)).toEqual([]);
    });

  test("The engine's own proposal is recorded, not the learned default that replaced it", ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    given(
      /^the payee's learned category "(.*)" and learned account "(.*)" were applied to the draft$/,
      (category: string, acct: string) => {
        draft = {
          ...draft,
          categoryName: category,
          accountId: account(acct).id,
          learnedCategory: { engineCategoryName: draft.categoryName, engineDefaulted: false },
          learnedAccount: {
            engineAccountId: draft.accountId,
            engineCurrency: draft.currency,
            engineMismatchedCurrency: null,
          },
        };
      }
    );
    whenSavedAsShown(when);
    thenEdit(then);
    thenEdit(and);
    and(/^the applied defaults should be "(.*)"$/, (s: string) => {
      expect(edits.appliedDefaults).toEqual(list(s));
    });
    thenCaptured(and);
  });

  test('Saving exactly what the engine proposed captures nothing', ({ given, and, when, then }) => {
    background(given, and);
    whenSavedAsShown(when);
    thenNoChange(then);
    thenCaptured(and);
  });

  test('A difference only in letter case is not an edit', ({ given, and, when, then }) => {
    background(given, and);
    when(/^the user saves it with payee "(.*)"$/, (payee: string) => record({ ...draft, payeeName: payee }));
    thenNoChange(then);
  });

  test('Reporting the parse as wrong captures it even when nothing changed', ({ given, and, when, then }) => {
    background(given, and);
    when(/^the user saves the draft as shown, reporting it as wrong$/, () => record(draft, true));
    thenCaptured(then);
  });

  test('Every changed field is recorded with names and day-precision dates', ({ given, and, when, then }) => {
    background(given, and);
    when(
      /^the user saves it as (.*) income on "(.*)" on (\S+) with category "(.*)", payee "(.*)" and note "(.*)"$/,
      (amt: string, acct: string, day: string, category: string, payee: string, note: string) =>
        record({
          ...draft,
          type: 'income',
          amount: money(amt),
          accountId: account(acct).id,
          occurredAt: localNoon(day),
          categoryName: category,
          payeeName: payee,
          note,
        })
    );
    thenEdit(then);
    thenEdit(and);
    thenEdit(and);
    thenEdit(and);
    and(/^the changed fields should be "(.*)"$/, (s: string) => {
      expect(changedFields(edits)).toEqual(list(s));
    });
  });

  test('A discarded draft is captured with no "to" values', ({ given, and, when, then }) => {
    background(given, and);
    when(/^the user discards the draft$/, () => record(null));
    then(/^the case should be marked discarded with every "to" empty$/, () => {
      expect(edits.discarded).toBe(true);
      for (const f of CORRECTION_FIELDS) expect(edits[f].to).toBeNull();
      expect(edits.amount.from).toBe(480);
    });
    thenCaptured(and);
  });

  test('An amount change is classified by what kind of mistake it was', ({ given, and, then }) => {
    background(given, and);
    then(/^an amount change from (\d+) to (\d+) should read "(.*)"$/, (from: string, to: string, kind: string) => {
      expect(amountChangeKind(Number(from), Number(to))).toBe(kind);
    });
  });

  test('A date change is bucketed by its day offset', ({ given, and, then }) => {
    background(given, and);
    then(/^a date change from "(.*)" to "(.*)" should read "(.*)"$/, (from: string, to: string, bucket: string) => {
      expect(dateOffsetBucket(from, to)).toBe(bucket);
    });
  });

  const whenAggregated = (when: any) =>
    when(/^the edits are aggregated per engine$/, () => {
      stats = aggregateCorrectionEdits(cases);
    });

  const thenFieldPairs = (thenOrAnd: any) =>
    thenOrAnd(
      /^engine "(.*)" field "(.*)" should show (\d+) edits with top pairs "(.*)"$/,
      (engine: string, field: string, n: string, pairs: string) => {
        const f = stats[engine]!.fields[field as CorrectionField];
        expect(f.edits).toBe(Number(n));
        expect(f.top.map((t) => `${t.pair} ×${t.count}`)).toEqual(list(pairs));
      }
    );

  test("The developer screen's per-engine view counts edits and ranks the top pairs", ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    given(
      /^captured cases:$/,
      (
        table: Array<{
          engine: string;
          'category from': string;
          'category to': string;
          'amount from': string;
          'amount to': string;
          discarded: string;
          refused: string;
        }>
      ) => {
        cases = table.map((r) => ({
          edits: editsFor(
            r.engine,
            { category: r['category from'], amount: Number(r['amount from']) },
            r.discarded === 'yes' ? null : { category: r['category to'], amount: Number(r['amount to']) },
            r.refused === 'yes'
          ),
        }));
      }
    );
    whenAggregated(when);
    then(
      /^engine "(.*)" should show (\d+) cases, (\d+) discarded and (\d+) after a refusal$/,
      (engine: string, n: string, d: string, r: string) => {
        expect(stats[engine]).toMatchObject({ cases: Number(n), discarded: Number(d), refused: Number(r) });
      }
    );
    thenFieldPairs(and);
    thenFieldPairs(and);
    thenFieldPairs(and);
  });

  test('At most five pairs are listed per field', ({ given, and, when, then }) => {
    background(given, and);
    given(/^seven captured on-device cases each changing the category to a different name$/, () => {
      cases = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => ({
        edits: editsFor('on_device', { category: 'Food' }, { category: name }),
      }));
    });
    whenAggregated(when);
    then(
      /^engine "(.*)" field "(.*)" should show (\d+) edits and list (\d+) pairs$/,
      (engine: string, field: string, n: string, k: string) => {
        const f = stats[engine]!.fields[field as CorrectionField];
        expect(f.edits).toBe(Number(n));
        expect(f.top).toHaveLength(Number(k));
      }
    );
  });
});

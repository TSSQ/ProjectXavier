import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  confidenceBucket,
  amountDeltaBucket,
  isAmountMaterial,
  isNameMaterial,
  isDateMaterial,
} from '../../src/domain/parseMetrics';
import {
  aggregate,
  aggregateByEngine,
  AggregateRow,
  EngineStats,
  MetricsAggregate,
} from '../../src/domain/parseMetrics';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/parse-metrics.feature')
);

/** Build a local-time epoch from "YYYY-MM-DD" + "HH:MM". */
function localMs(ymd: string, hm: string): number {
  const [y, mo, d] = ymd.split('-').map(Number) as [number, number, number];
  const [h, mi] = hm.split(':').map(Number) as [number, number];
  return new Date(y, mo - 1, d, h, mi).getTime();
}

defineFeature(feature, (test) => {
  test('Confidence maps to a 0-4 bucket', ({ given, then }) => {
    let bucket: number | null = null;
    given(/^an AI confidence of (.*)$/, (c: string) => {
      bucket = confidenceBucket(Number(c));
    });
    then(/^the confidence bucket should be (\d+)$/, (expected: string) => {
      expect(bucket).toBe(Number(expected));
    });
  });

  test('Top confidence clamps to the highest bucket', ({ given, then }) => {
    let bucket: number | null = null;
    given(/^an AI confidence of (.*)$/, (c: string) => {
      bucket = confidenceBucket(Number(c));
    });
    then(/^the confidence bucket should be (\d+)$/, (expected: string) => {
      expect(bucket).toBe(Number(expected));
    });
  });

  test('Mid confidence buckets correctly', ({ given, then }) => {
    let bucket: number | null = null;
    given(/^an AI confidence of (.*)$/, (c: string) => {
      bucket = confidenceBucket(Number(c));
    });
    then(/^the confidence bucket should be (\d+)$/, (expected: string) => {
      expect(bucket).toBe(Number(expected));
    });
  });

  test('A tiny amount change is not material', ({ given, then, and }) => {
    let before = 0;
    let after = 0;
    given(
      /^a proposed amount of (\d+) and a saved amount of (\d+)$/,
      (b: string, a: string) => {
        before = Number(b);
        after = Number(a);
      }
    );
    then('the amount edit should not be material', () => {
      expect(isAmountMaterial(before, after)).toBe(false);
    });
    and(/^the amount delta bucket should be (\d+)$/, (expected: string) => {
      expect(amountDeltaBucket(before, after)).toBe(Number(expected));
    });
  });

  test('A real amount correction is material', ({ given, then, and }) => {
    let before = 0;
    let after = 0;
    given(
      /^a proposed amount of (\d+) and a saved amount of (\d+)$/,
      (b: string, a: string) => {
        before = Number(b);
        after = Number(a);
      }
    );
    then('the amount edit should be material', () => {
      expect(isAmountMaterial(before, after)).toBe(true);
    });
    and(/^the amount delta bucket should be (\d+)$/, (expected: string) => {
      expect(amountDeltaBucket(before, after)).toBe(Number(expected));
    });
  });

  test('A near-typo payee fix is not material', ({ given, then }) => {
    let material = true;
    given(
      /^a proposed name "(.*)" and a saved name "(.*)"$/,
      (b: string, a: string) => {
        material = isNameMaterial(b, a);
      }
    );
    then('the name edit should not be material', () => {
      expect(material).toBe(false);
    });
  });

  test('A different payee is material', ({ given, then }) => {
    let material = false;
    given(
      /^a proposed name "(.*)" and a saved name "(.*)"$/,
      (b: string, a: string) => {
        material = isNameMaterial(b, a);
      }
    );
    then('the name edit should be material', () => {
      expect(material).toBe(true);
    });
  });

  test('Adding a payee that was missing is material', ({ given, then }) => {
    let material = false;
    given(
      /^a proposed name "(.*)" and a saved name "(.*)"$/,
      (b: string, a: string) => {
        material = isNameMaterial(b, a);
      }
    );
    then('the name edit should be material', () => {
      expect(material).toBe(true);
    });
  });

  test('Same calendar day is not a material date change', ({ given, then }) => {
    let material = true;
    given(
      /^a proposed date (.*) at (.*) and a saved date (.*) at (.*)$/,
      (bd: string, bt: string, ad: string, at: string) => {
        material = isDateMaterial(localMs(bd, bt), localMs(ad, at));
      }
    );
    then('the date edit should not be material', () => {
      expect(material).toBe(false);
    });
  });

  test('A different day is a material date change', ({ given, then }) => {
    let material = false;
    given(
      /^a proposed date (.*) at (.*) and a saved date (.*) at (.*)$/,
      (bd: string, bt: string, ad: string, at: string) => {
        material = isDateMaterial(localMs(bd, bt), localMs(ad, at));
      }
    );
    then('the date edit should be material', () => {
      expect(material).toBe(true);
    });
  });

  // ── aggregate() ────────────────────────────────────────────────────────────

  /** Build a minimal AggregateRow fixture. Only the fields aggregate() reads. */
  function makeRow(resolved: string | null, editedFlag = 0): AggregateRow {
    return {
      engine: 'cloud',
      outcome: 'confirm',
      confidenceBucket: null,
      latencyMs: null,
      resolved,
      payeeSwapped: null,
      edited: editedFlag,
      editedAmount: null,
      editedType: null,
      editedPayee: null,
      editedCategory: null,
      editedDate: null,
    };
  }

  /** Same fixture, varying `engine` instead of `resolved` — for the
   *  byEngine-bucketing scenario below. */
  function makeRowWithEngine(engine: string): AggregateRow {
    return { ...makeRow(null), engine };
  }

  test('aggregate counts an edited row toward saved', ({ given, then, and }) => {
    let agg: MetricsAggregate;
    given(/^aggregate rows with resolved values "(.*)"$/, (values: string) => {
      const rows = values.split(',').map((v) => makeRow(v.trim()));
      agg = aggregate(rows);
    });
    then(/^the aggregate saved count should be (\d+)$/, (n: string) => {
      expect(agg.saved).toBe(Number(n));
    });
    and(/^the aggregate discarded count should be (\d+)$/, (n: string) => {
      expect(agg.discarded).toBe(Number(n));
    });
    and(/^the aggregate editedAtDraft count should be (\d+)$/, (n: string) => {
      expect(agg.editedAtDraft).toBe(Number(n));
    });
  });

  test('aggregate handles a mix of saved, discarded, and edited rows', ({ given, then, and }) => {
    let agg: MetricsAggregate;
    given(/^aggregate rows with resolved values "(.*)"$/, (values: string) => {
      const rows = values.split(',').map((v) => makeRow(v.trim()));
      agg = aggregate(rows);
    });
    then(/^the aggregate saved count should be (\d+)$/, (n: string) => {
      expect(agg.saved).toBe(Number(n));
    });
    and(/^the aggregate discarded count should be (\d+)$/, (n: string) => {
      expect(agg.discarded).toBe(Number(n));
    });
    and(/^the aggregate editedAtDraft count should be (\d+)$/, (n: string) => {
      expect(agg.editedAtDraft).toBe(Number(n));
    });
  });

  test('aggregate materialEditRate uses saved denominator that includes edited rows', ({ given, then, and }) => {
    let agg: MetricsAggregate;
    given(
      /^aggregate rows with resolved values "(.*)" and no post-save field edits$/,
      (values: string) => {
        // edited=0 means no post-save material field changes recorded
        const rows = values.split(',').map((v) => makeRow(v.trim(), 0));
        agg = aggregate(rows);
      }
    );
    then(/^the aggregate saved count should be (\d+)$/, (n: string) => {
      expect(agg.saved).toBe(Number(n));
    });
    and(/^the aggregate editedAtDraft count should be (\d+)$/, (n: string) => {
      expect(agg.editedAtDraft).toBe(Number(n));
    });
    and(/^the aggregate materialEditRate should be (\d+)$/, (n: string) => {
      expect(agg.materialEditRate).toBe(Number(n));
    });
  });

  test('aggregate keeps "floor" (account gate, no engine extracted) distinct from "heuristic" (expense deterministic parse)', ({
    given,
    then,
    and,
  }) => {
    let agg: MetricsAggregate;
    given(/^aggregate rows with engines "(.*)"$/, (values: string) => {
      const rows = values.split(',').map((v) => makeRowWithEngine(v.trim()));
      agg = aggregate(rows);
    });
    const assertEngineCount = (engine: string, n: string) => {
      expect(agg.byEngine[engine]).toBe(Number(n));
    };
    then(/^the aggregate byEngine "(.*)" count should be (\d+)$/, assertEngineCount);
    and(/^the aggregate byEngine "(.*)" count should be (\d+)$/, assertEngineCount);
    and(/^the aggregate byEngine "(.*)" count should be (\d+)$/, assertEngineCount);
  });

  // ── aggregateByEngine() ────────────────────────────────────────────────────

  const engineRow = (partial: Partial<AggregateRow> & { engine: string }): AggregateRow => ({
    ...makeRow(null),
    outcome: 'confirm',
    ...partial,
  });

  const givenPerEngineRows = (given: any, byEngineRef: { current: Record<string, EngineStats> }) =>
    given(/^per-engine rows:$/, (table: Array<{ engine: string; outcome: string; resolved: string }>) => {
      byEngineRef.current = aggregateByEngine(
        table.map((r) => engineRow({ engine: r.engine, outcome: r.outcome, resolved: r.resolved || null }))
      );
    });

  const thenCounts = (then: any, byEngineRef: { current: Record<string, EngineStats> }) =>
    then(
      /^engine "(.*)" should show (\d+) parses, (\d+) confirms, (\d+) saved and a save rate of (.*)$/,
      (engine: string, parses: string, confirms: string, saved: string, rate: string) => {
        const s = byEngineRef.current[engine]!;
        expect(s.parses).toBe(Number(parses));
        expect(s.confirms).toBe(Number(confirms));
        expect(s.saved).toBe(Number(saved));
        expect(s.saveRate).toBeCloseTo(Number(rate));
      }
    );

  const thenRefusals = (and: any, byEngineRef: { current: Record<string, EngineStats> }) =>
    and(/^engine "(.*)" should show (\d+) refused and (\d+) logged anyway$/, (engine: string, refused: string, over: string) => {
      const s = byEngineRef.current[engine]!;
      expect(s.refused).toBe(Number(refused));
      expect(s.refusedOverridden).toBe(Number(over));
    });

  const thenEditRate = (and: any, byEngineRef: { current: Record<string, EngineStats> }) =>
    and(/^engine "(.*)" should show an edit rate of (.*)$/, (engine: string, rate: string) => {
      expect(byEngineRef.current[engine]!.editRate).toBeCloseTo(Number(rate));
    });

  test('aggregateByEngine reports parse count, save rate and refusals per engine', ({ given, then, and }) => {
    const ref = { current: {} as Record<string, EngineStats> };
    givenPerEngineRows(given, ref);
    thenCounts(then, ref);
    thenRefusals(and, ref);
    thenCounts(and, ref);
    thenRefusals(and, ref);
  });

  test('aggregateByEngine reports post-save edit rates by field over saved rows', ({ given, then, and }) => {
    const ref = { current: {} as Record<string, EngineStats> };
    given(
      /^per-engine rows with post-save edits:$/,
      (table: Array<{ engine: string; resolved: string; edited: string; fields: string }>) => {
        ref.current = aggregateByEngine(
          table.map((r) => {
            const fields = new Set(r.fields.split(',').map((f) => f.trim()).filter(Boolean));
            return engineRow({
              engine: r.engine,
              resolved: r.resolved.trim() || null,
              edited: Number(r.edited),
              editedAmount: fields.has('amount') ? 1 : 0,
              editedType: fields.has('type') ? 1 : 0,
              editedPayee: fields.has('payee') ? 1 : 0,
              editedCategory: fields.has('category') ? 1 : 0,
              editedDate: fields.has('date') ? 1 : 0,
            });
          })
        );
      }
    );
    thenEditRate(then, ref);
    and(
      /^engine "(.*)" should show field edit rates amount (.*), type (.*), payee (.*), category (.*), date (.*)$/,
      (engine: string, amount: string, type: string, payee: string, category: string, date: string) => {
        const f = ref.current[engine]!.editRateByField;
        expect(f.amount).toBeCloseTo(Number(amount));
        expect(f.type).toBeCloseTo(Number(type));
        expect(f.payee).toBeCloseTo(Number(payee));
        expect(f.category).toBeCloseTo(Number(category));
        expect(f.date).toBeCloseTo(Number(date));
      }
    );
  });

  test('aggregateByEngine has no rates to report for an engine that never confirmed or saved', ({
    given,
    then,
    and,
  }) => {
    const ref = { current: {} as Record<string, EngineStats> };
    givenPerEngineRows(given, ref);
    thenCounts(then, ref);
    thenEditRate(and, ref);
  });
});

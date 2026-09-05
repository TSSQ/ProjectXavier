import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { reconstructLayout, StatementLayout, LayoutRow, SourceBand } from '../../src/domain/statementLayout';
import { chooseScanRoute, ScanRoute, applyLayoutAmount } from '../../src/domain/statementDrafts';
import { OcrObservation } from '../../src/domain/ocrObservation';
import { localParse } from '../../src/domain/localParse';
import { AiParsedExpense } from '../../src/lib/validation';
import { TransactionDraft } from '../../src/domain/assistant';
import { detectIntent } from '../../src/domain/intentGate';

const feature = loadFeature(path.join(__dirname, '..', '__features__', 'scan-route.feature'));

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'statement');

function loadFixtureObservations(name: string): OcrObservation[] {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, `${name}.observations.json`), 'utf8');
  return JSON.parse(raw).observations;
}

/** A placeholder band — none of this file's scenarios exercise row-snippet-
 *  spec.md geometry, so every literal row/receiptTotal below shares one
 *  honest, in-bounds rectangle. */
const PLACEHOLDER_BAND: SourceBand = { x: 0, y: 0, w: 1, h: 0.05 };

/** A minimal-but-complete LayoutRow literal — every field the type
 *  requires, filled with an honest placeholder where the scenario doesn't
 *  care (chooseScanRoute only ever reads `value`; applyLayoutAmount also
 *  reads `currency`/`sign`). */
function makeRow(value: number, sign: LayoutRow['sign'] = '-', currency: string | null = null): LayoutRow {
  return {
    dateText: null,
    value,
    sign,
    description: 'Row',
    amountText: String(value),
    currency,
    band: PLACEHOLDER_BAND,
    amountBand: PLACEHOLDER_BAND,
  };
}

/** A minimal-but-complete TransactionDraft literal, matching the shape
 *  used throughout statement-drafts.feature's own "plain draft" steps. */
function makeDraft(type: TransactionDraft['type'], amount: number, currency: string): TransactionDraft {
  return {
    accountId: 'acc-main',
    type,
    amount,
    currency,
    categoryName: null,
    payeeName: 'Some Shop',
    note: null,
    occurredAt: Date.now(),
    source: 'ai',
    defaulted: { account: false, payee: false, category: true, date: false },
  };
}

defineFeature(feature, (test) => {
  let layout: Pick<StatementLayout, 'kind' | 'rows'> & Partial<StatementLayout>;
  let route: ScanRoute;
  let heuristicParsed: AiParsedExpense;
  let plainDraft: TransactionDraft;
  let appliedDraft: TransactionDraft;

  const givenFixtureLayout = (given: any) =>
    given(/^the "(.*)" statement fixture reconstructed as a layout$/, (name: string) => {
      layout = reconstructLayout(loadFixtureObservations(name));
    });

  // QA M1 — proves the §7 no-Total-family edge case (and its "only TOTAL
  // survives" sibling) against the REAL receipt fixture, exact-text-matched
  // so a price cell like "S$ 8.30" (with the space) is never mistaken for
  // the total's own "S$8.30" (no space) amount token.
  const givenFixtureLayoutMinusObservations = (given: any) =>
    given(
      /^the "(.*)" statement fixture reconstructed as a layout with these observations removed:$/,
      (name: string, table: Array<{ text: string }>) => {
        const remove = new Set(table.map((r) => r.text));
        const kept = loadFixtureObservations(name).filter((o) => !remove.has(o.text));
        layout = reconstructLayout(kept);
      }
    );

  // Review B2 — OCR-mangled total-family labels (T0TAL, G5T in, 5ubtot)
  // must still normalise back to a receipt signal.
  const givenFixtureLayoutRelabelled = (given: any) =>
    given(
      /^the "(.*)" statement fixture reconstructed as a layout with these observations relabelled:$/,
      (name: string, table: Array<{ from: string; to: string }>) => {
        const renames = new Map(table.map((r) => [r.from, r.to]));
        const relabelled = loadFixtureObservations(name).map((o) =>
          renames.has(o.text) ? { ...o, text: renames.get(o.text)! } : o
        );
        layout = reconstructLayout(relabelled);
      }
    );

  // QA MAJOR 1, measured scenario (4) — removes two labels outright AND
  // relabels a third, in one combined fixture transform.
  const givenFixtureLayoutRemovedAndRelabelled = (given: any) =>
    given(
      /^the "(.*)" statement fixture, with "(.*)" and "(.*)" removed and "(.*)" relabelled to "(.*)", reconstructed as a layout$/,
      (name: string, remove1: string, remove2: string, from: string, to: string) => {
        const remove = new Set([remove1, remove2]);
        const transformed = loadFixtureObservations(name)
          .filter((o) => !remove.has(o.text))
          .map((o) => (o.text === from ? { ...o, text: to } : o));
        layout = reconstructLayout(transformed);
      }
    );

  const givenSyntheticRows = (given: any) =>
    given(
      /^a synthetic layout with kind "(.*)" and these rows:$/,
      (kind: string, table: Array<{ value: string; sign: string }>) => {
        layout = {
          kind: kind as StatementLayout['kind'],
          rows: table.map((r) => makeRow(Number(r.value), r.sign as LayoutRow['sign'])),
        };
      }
    );

  const givenSyntheticRowCount = (given: any) =>
    given(
      /^a synthetic layout with kind "(.*)" and (\d+) rows of value ([\d.]+)$/,
      (kind: string, count: string, value: string) => {
        const rows: LayoutRow[] = [];
        for (let i = 0; i < Number(count); i++) rows.push(makeRow(Number(value)));
        layout = { kind: kind as StatementLayout['kind'], rows };
      }
    );

  const givenEmptyLayout = (given: any) =>
    given('the layout reconstructed from no observations', () => {
      layout = reconstructLayout([]);
    });

  // QA m2 / B1(a) / QA MAJOR 1 — a layout built through the REAL geometry
  // rules (lines → blocks → rows), not a LayoutRow literal, so the
  // zero-value filter, the amount-override repro, and the soft-signal
  // fix are all proven end-to-end from observations.
  const givenGeometryLayout = (given: any) =>
    given(
      /^a layout reconstructed from these observations:$/,
      (table: Array<{ text: string; x: string; y: string; w: string; h: string }>) => {
        const observations: OcrObservation[] = table.map((r) => ({
          text: r.text,
          x: Number(r.x),
          y: Number(r.y),
          w: Number(r.w),
          h: Number(r.h),
        }));
        layout = reconstructLayout(observations);
      }
    );

  // B1(b)/(c) / reviewer S1-S3 / QA MAJOR 2 — one flexible literal-layout
  // step exercising applyLayoutAmount's own rule order directly,
  // independent of reconstructLayout's geometry: unreadRows, value,
  // currency (SGD/USD), and an optional printed sign are all parameters.
  // Default sign '-' when the step doesn't say "signed" (matches every
  // scenario written before sign mattered).
  const givenLiteralSingleRowLayout = (given: any) =>
    given(
      /^a single-kind layout with (\d+) unread rows? and a ([\d.]+) (SGD|USD) row(?: signed "([+\-?])")?$/,
      (unread: string, value: string, currency: string, sign?: string) => {
        layout = {
          kind: 'single',
          rows: [makeRow(Number(value), (sign as LayoutRow['sign']) ?? '-', currency)],
          unreadRows: Number(unread),
          receiptTotal: null,
        };
      }
    );

  const givenLiteralLayoutTotalWins = (given: any) =>
    given('a single-kind layout with a 8.30 receiptTotal and a 23.40 SGD row', () => {
      layout = {
        kind: 'single',
        rows: [makeRow(23.4, '-', 'SGD')],
        unreadRows: 0,
        receiptTotal: { value: 8.3, text: 'S$8.30', band: PLACEHOLDER_BAND, amountBand: PLACEHOLDER_BAND },
      };
    });

  const givenLiteralLayoutNoRows = (given: any) =>
    given('a single-kind layout with no rows', () => {
      layout = { kind: 'single', rows: [], unreadRows: 0, receiptTotal: null };
    });

  const givenPlainDraft = (given: any) =>
    given(
      /^a plain (expense|income|transfer) draft for (\d+) minor units in (.*)$/,
      (type: string, amount: string, currency: string) => {
        plainDraft = makeDraft(type as TransactionDraft['type'], Number(amount), currency);
      }
    );

  // QA MINOR — seeds the plain draft's amount from the PayLah scenario's
  // own pinned heuristic result (400800), so the chain visibly shows
  // 400800 → 2340 on one draft, rather than a draft that was never really
  // "wrong" in the first place.
  const givenSeededPlainDraft = (given: any) =>
    given('a plain expense draft in SGD seeded from that heuristic amount', () => {
      plainDraft = makeDraft('expense', heuristicParsed.amount!, 'SGD');
    });

  // One step covers both "I choose the scan route" and "…with maxRows N" —
  // each scenario only ever has ONE When step, so this must stay a single
  // registration (jest-cucumber matches step definitions positionally
  // against the feature file's step count).
  const whenChooseRoute = (when: any) =>
    when(/^I choose the scan route(?: with maxRows (\d+))?$/, (n?: string) => {
      route = n !== undefined ? chooseScanRoute(layout, Number(n)) : chooseScanRoute(layout);
    });

  // B1(a) — the heuristic tier's own take on the layout's joined text, so
  // the decoy (a card suffix mistaken for the amount) is pinned BEFORE
  // applyLayoutAmount corrects it, rather than assumed.
  const whenHeuristicParse = (when: any) =>
    when("the layout's text is parsed by the heuristic", () => {
      heuristicParsed = localParse((layout as StatementLayout).text, {
        categories: [],
        payees: [],
        now: Date.now(),
        currency: 'SGD',
      });
    });

  const whenApplyLayoutAmount = (when: any) =>
    when('I apply the layout amount to that draft', () => {
      appliedDraft = applyLayoutAmount(plainDraft, layout as StatementLayout);
    });

  // Likewise one step covers both "route should be X" and "…with rowCount N".
  const thenRouteIs = (then: any) =>
    then(/^the route should be "([a-z_]+)"(?: with rowCount (\d+))?$/, (kind: string, rowCount?: string) => {
      expect(route.kind).toBe(kind);
      if (rowCount !== undefined) {
        expect((route as { rowCount: number }).rowCount).toBe(Number(rowCount));
      }
    });

  const andReceiptTotalIs = (and: any) =>
    and(/^the layout's receiptTotal value should be ([\d.]+)$/, (value: string) => {
      expect((layout as StatementLayout).receiptTotal?.value).toBe(Number(value));
    });

  const thenKindIs = (then: any) =>
    then(/^the layout kind should be "(.*)"$/, (kind: string) => {
      expect(layout.kind).toBe(kind);
    });

  const andRowCountIs = (and: any) =>
    and(/^the layout should have (\d+) rows$/, (n: string) => {
      expect((layout as StatementLayout).rows).toHaveLength(Number(n));
    });

  const andUnreadRowsIs = (and: any) =>
    and(/^the layout's unreadRows should be (\d+)$/, (n: string) => {
      expect((layout as StatementLayout).unreadRows).toBe(Number(n));
    });

  const andNoReceiptTotal = (and: any) =>
    and('the layout should have no receiptTotal', () => {
      expect((layout as StatementLayout).receiptTotal).toBeNull();
    });

  const thenHeuristicAmountIs = (then: any) =>
    then(/^the heuristic amount should be (\d+)$/, (n: string) => {
      expect(heuristicParsed.amount).toBe(Number(n));
    });

  const thenDraftAmountIs = (then: any) =>
    then(/^the draft amount should be (\d+)$/, (n: string) => {
      expect(appliedDraft.amount).toBe(Number(n));
    });

  const thenDraftTypeIs = (then: any) =>
    then(/^the draft type should be "(.*)"$/, (type: string) => {
      expect(appliedDraft.type).toBe(type);
    });

  const thenDraftUnchanged = (then: any) =>
    then('the draft should be unchanged', () => {
      expect(appliedDraft).toBe(plainDraft);
    });

  const andDraftFlaggedAmountFromRow = (and: any) =>
    and(/^the draft should (not )?be flagged amount-from-row$/, (not?: string) => {
      if (not) expect(appliedDraft.amountFromRow).toBeUndefined();
      else expect(appliedDraft.amountFromRow).toBe(true);
    });

  const andDraftFlaggedAmountFromTotal = (and: any) =>
    and('the draft should be flagged amount-from-total', () => {
      expect(appliedDraft.amountFromTotal).toBe(true);
    });

  const andMismatchedCurrencyIs = (and: any) =>
    and(/^the draft's mismatchedCurrency should be "(.*)"$/, (currency: string) => {
      expect(appliedDraft.mismatchedCurrency).toBe(currency);
    });

  const andNoMismatchedCurrency = (and: any) =>
    and('the draft should have no mismatchedCurrency', () => {
      expect(appliedDraft.mismatchedCurrency).toBeUndefined();
    });

  test('bank1 routes into the queue with 6 rows', ({ given, when, then }) => {
    givenFixtureLayout(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('OCBC routes into the queue with 4 rows', ({ given, when, then }) => {
    givenFixtureLayout(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('The receipt fixture stays a single transaction, and its total survives', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixtureLayout(given);
    whenChooseRoute(when);
    thenRouteIs(then);
    andReceiptTotalIs(and);
  });

  test('A receipt-kind layout is always single, even with several rows (rule 1 wins over the count)', ({
    given,
    when,
    then,
  }) => {
    givenSyntheticRows(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('A one-row layout stays single', ({ given, when, then }) => {
    givenSyntheticRows(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('An empty layout (no observations at all) stays single', ({ given, when, then }) => {
    givenEmptyLayout(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('Two rows tip the decision only when both are non-zero', ({ given, when, then }) => {
    givenSyntheticRows(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('Two non-zero rows route into the queue', ({ given, when, then }) => {
    givenSyntheticRows(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('Exactly the row cap still routes into the queue', ({ given, when, then }) => {
    givenSyntheticRowCount(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('One row over the cap asks for two screenshots', ({ given, when, then }) => {
    givenSyntheticRowCount(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('A custom maxRows parameter is honoured', ({ given, when, then }) => {
    givenSyntheticRowCount(given);
    whenChooseRoute(when);
    thenRouteIs(then);
  });

  test('Every Total-family LABEL and its own AMOUNT removed falls back to unknown, not receipt (QA M1)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixtureLayoutMinusObservations(given);
    whenChooseRoute(when);
    thenKindIs(then);
    andRowCountIs(and);
    andUnreadRowsIs(and);
    andNoReceiptTotal(and);
    thenRouteIs(and);
  });

  test("Total-family labels removed but their amounts left behind still can't recover a total (QA measured)", ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixtureLayoutMinusObservations(given);
    whenChooseRoute(when);
    thenKindIs(then);
    andUnreadRowsIs(and);
    thenRouteIs(and);
  });

  test('Only the TOTAL line surviving still reads as a receipt (QA M1 sibling)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixtureLayoutMinusObservations(given);
    whenChooseRoute(when);
    thenKindIs(then);
    andReceiptTotalIs(and);
    thenRouteIs(and);
  });

  test('OCR-mangled TOTAL and GST labels still read as a receipt (review B2)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixtureLayoutRelabelled(given);
    whenChooseRoute(when);
    thenKindIs(then);
    andReceiptTotalIs(and);
    thenRouteIs(and);
  });

  test('All three OCR-mangled total-family labels still read as a receipt (review B2)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixtureLayoutRelabelled(given);
    whenChooseRoute(when);
    thenKindIs(then);
    andReceiptTotalIs(and);
    thenRouteIs(and);
  });

  test('A merchant name that only LOOKS like a total label after normalisation stays a row (QA MAJOR 1)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenGeometryLayout(given);
    whenChooseRoute(when);
    thenKindIs(then);
    andRowCountIs(and);
    andUnreadRowsIs(and);
    thenRouteIs(and);
  });

  test("The soft-mangled merchant as the LAST row still isn't mistaken for a footer total (QA MAJOR 1)", ({
    given,
    when,
    then,
    and,
  }) => {
    givenGeometryLayout(given);
    whenChooseRoute(when);
    andRowCountIs(then);
    thenRouteIs(and);
  });

  test('A receipt with only a soft-matched TOTAL label falls back to unknown, not receipt (QA MAJOR 1, measured)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenFixtureLayoutRemovedAndRelabelled(given);
    whenChooseRoute(when);
    thenKindIs(then);
    andRowCountIs(and);
    andUnreadRowsIs(and);
    thenRouteIs(and);
  });

  test('A two-row layout built from real geometry keeps a zero-valued row out of the queue (QA m2)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenGeometryLayout(given);
    whenChooseRoute(when);
    andRowCountIs(then);
    thenRouteIs(and);
  });

  test('The same layout with both rows non-zero routes into the queue (QA m2)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenGeometryLayout(given);
    whenChooseRoute(when);
    andRowCountIs(then);
    thenRouteIs(and);
  });

  test('The layout\'s own amount overrides a text-parse decoy (B1 — PayLah notification repro)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenGeometryLayout(given);
    whenChooseRoute(when);
    thenRouteIs(then);
    whenHeuristicParse(when);
    thenHeuristicAmountIs(then);
    givenSeededPlainDraft(given);
    whenApplyLayoutAmount(when);
    thenDraftAmountIs(then);
    andDraftFlaggedAmountFromRow(and);
    andNoMismatchedCurrency(and);
  });

  test('An unread row alongside the single row blocks the override (B1 literal b)', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftUnchanged(then);
  });

  test('A foreign-currency row still overrides the amount but flags mismatchedCurrency (reviewer S1/S2)', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftAmountIs(then);
    andDraftFlaggedAmountFromRow(and);
    andMismatchedCurrencyIs(and);
  });

  test('A same-currency row never flags mismatchedCurrency (reviewer S1/S2)', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftAmountIs(then);
    andDraftFlaggedAmountFromRow(and);
    andNoMismatchedCurrency(and);
  });

  test('A zero-value row never overrides the amount (reviewer S3)', ({ given, and, when, then }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftUnchanged(then);
  });

  test('A receipt total always wins over a row amount (B1 literal d)', ({ given, and, when, then }) => {
    givenLiteralLayoutTotalWins(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftAmountIs(then);
    andDraftFlaggedAmountFromTotal(and);
    andDraftFlaggedAmountFromRow(and);
  });

  test('An empty-rows layout leaves the draft amount alone (B1 literal e)', ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralLayoutNoRows(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftUnchanged(then);
  });

  test("A '+' row forces income even when the text parse guessed expense (QA MAJOR 2 — PayNow)", ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftAmountIs(then);
    thenDraftTypeIs(and);
    andDraftFlaggedAmountFromRow(and);
  });

  test("A '+' row forces income (QA MAJOR 2 — Interest credited)", ({ given, and, when, then }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftAmountIs(then);
    thenDraftTypeIs(and);
  });

  test("A '-' row forces expense even when the text parse guessed income (QA MAJOR 2)", ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftTypeIs(then);
  });

  test("A '?' row leaves the text parse's own type alone (QA MAJOR 2)", ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftTypeIs(then);
  });

  test("A transfer draft keeps its type regardless of the row's sign (QA MAJOR 2)", ({
    given,
    and,
    when,
    then,
  }) => {
    givenLiteralSingleRowLayout(given);
    givenPlainDraft(and);
    whenApplyLayoutAmount(when);
    thenDraftTypeIs(then);
    thenDraftAmountIs(and);
  });

  test('Two SOFT signals never collapse a dated, interleaved statement into a receipt (BLOCKER — fuzzed 30k layouts, 3919 losses)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenGeometryLayout(given);
    whenChooseRoute(when);
    thenKindIs(then);
    andRowCountIs(and);
    andNoReceiptTotal(and);
    thenRouteIs(and);
  });

  test("The two soft merchants in the MIDDLE (a hard row after them) still don't collapse the list (BLOCKER sibling b)", ({
    given,
    when,
    then,
    and,
  }) => {
    givenGeometryLayout(given);
    whenChooseRoute(when);
    andRowCountIs(then);
    thenRouteIs(and);
  });

  test('A soft "AM0UNT DUE" merchant alongside a soft GST merchant still doesn\'t collapse the list (BLOCKER sibling c)', ({
    given,
    when,
    then,
    and,
  }) => {
    givenGeometryLayout(given);
    whenChooseRoute(when);
    andRowCountIs(then);
    thenRouteIs(and);
  });

  // ── The intent gate must never see OCR text (user report, build 95) ──────
  // The gate's vocabulary is not the bug and widening it is not the fix: no
  // wordlist survives arbitrary receipt copy. These scenarios pin WHY the
  // scan path bypasses the gate, so the reason survives someone later
  // "tidying up" the forceExpense argument at the call site.

  test('Ordinary receipt lines satisfy the transaction-op gate on their own', ({ given, then, and }) => {
    let text = '';
    given(/^the receipt text "(.*)"$/, (raw: string) => {
      text = raw.replace(/\\n/g, '\n');
    });
    then(/^the unturned intent gate should classify it as "(.*)"$/, (expected: string) => {
      expect(detectIntent(text)).toBe(expected);
    });
    and('the same text with forceExpense should classify as null', () => {
      expect(detectIntent(text, { forceExpense: true })).toBeNull();
    });
  });

  test('Neither receipt line trips the gate alone — it takes both', ({ given, then }) => {
    let text = '';
    const setText = (raw: string) => {
      text = raw.replace(/\\n/g, '\n');
    };
    given(/^the receipt text "(.*)"$/, setText);
    then('the unturned intent gate should classify it as null', () => {
      expect(detectIntent(text)).toBeNull();
    });
    given(/^the receipt text "(.*)"$/, setText);
    then('the unturned intent gate should classify it as null', () => {
      expect(detectIntent(text)).toBeNull();
    });
  });

  test('The scan path passes forceExpense to runParse', ({ then }) => {
    then('the assistant screen should call runParse with forceExpense on the OCR path', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'app', '(tabs)', 'index.tsx'),
        'utf8'
      );
      // The OCR call site, and only it, carries the bypass.
      expect(source).toContain('await runParse(outcome.text, { forceExpense: true });');
      expect(source).not.toContain('await runParse(outcome.text);');
    });
  });
});

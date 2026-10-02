import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runDeviceParseAttempts } from '../../src/domain/deviceParseAttempts';
import { normalizeDeviceParseOutput, isUsefulDeviceParse } from '../../src/domain/deviceParsePrompt';
import { classifyDeviceParse, FmParseOutcome } from '../../src/domain/fmRefusal';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { heuristicExpense } from '../../src/domain/heuristicParse';
import { interpret } from '../../src/domain/assistant';
import { aggregate, AggregateRow, MetricsAggregate, fmFallbackDetail, fmFallbackCounts } from '../../src/domain/parseMetrics';
import { AiParsedExpense } from '../../src/lib/validation';

const feature = loadFeature(path.resolve(__dirname, '../__features__/fm-refusal.feature'));

const NOW = 1735689600000;

/** What the model "said" for `text`, run through the same amount-resolution ->
 *  normalize -> guard -> validate chain `deviceParseUnsafe` uses (minus the
 *  native binding): `finishFmParse`, with the plan the app would have made. */
function parseRaw(text: string, raw: Record<string, unknown>): FmDeviceParse | null {
  return finishFmParse(raw, text, planFmAmount(text), NOW, 'USD');
}

const FIELDS = {
  currency: '', type: 'expense', category: '', payee: '', account: '', note: '',
  occurredOn: '', confidence: 0.2, pending: false,
};
/** isTransaction false: the model's deliberate "not a transaction". */
const REFUSAL_RAW = { ...FIELDS, isTransaction: false, amount: 0 };
/** isTransaction true, no amount given. */
const NO_AMOUNT_RAW = { ...FIELDS, isTransaction: true, amount: 0 };
const HEURISTIC_CTX = { categories: [], payees: [], now: NOW };

defineFeature(feature, (test) => {
  let attempt: () => Promise<FmDeviceParse | null>;
  let text: string;
  let outcome: FmParseOutcome;

  const run = (when: any) =>
    when('the on-device attempts run', async () => {
      const { parse } = await runDeviceParseAttempts(text, attempt);
      outcome = classifyDeviceParse(parse, text);
    });
  const givenModelReturns = (given: any, raw: Record<string, unknown>) =>
    given(/^the model (?:refuses|returns no amount for|says transaction with no amount for) "(.*)"$/, (t: string) => {
      text = t;
      attempt = async () => parseRaw(text, raw);
    });

  test('A refusal is distinguished from a failure and the heuristic is not consulted', ({ given, when, then, and }) => {
    givenModelReturns(given, REFUSAL_RAW);
    run(when);
    then('the outcome is refused', () => expect(outcome.kind).toBe('refused'));
    and('the heuristic was not consulted', () => {
      // The outcome carries no parse and classification takes no heuristic, so
      // a refusal cannot produce a draft by itself (the app only shows
      // "Log anyway", which is the sole path to the heuristic).
      expect(outcome).toEqual({ kind: 'refused' });
    });
  });

  test('An invalid or thrown result is a failure, not a refusal', ({ given, when, then }) => {
    given('every attempt fails', () => {
      text = 'coffee 4';
      let i = 0;
      attempt = async () => {
        i += 1;
        if (i === 1) throw new Error('generation failed');
        // deviceParseUnsafe returns null when the output fails validation.
        return null;
      };
    });
    run(when);
    then('the outcome is failed', () => expect(outcome).toMatchObject({ kind: 'failed' }));
  });

  test('A failure with no parse says why the on-device tier fell back', ({ given, when, then }) => {
    let threw = 0;
    let failed: FmParseOutcome;
    given(/^attempts that made (\d+) throws and settled on no parse$/, (n: string) => { threw = Number(n); });
    when('the outcome is classified', () => { failed = classifyDeviceParse(null, 'coffee 4', { threw }); });
    then(/^the failure reason is "(.*)" and it is logged as "(.*)"$/, (reason: string, detail: string) => {
      expect(failed).toEqual({ kind: 'failed', reason });
      expect(fmFallbackDetail(reason)).toBe(detail);
    });
  });

  test('Fallback reasons are counted from the logged detail', ({ given, then }) => {
    let rows: Array<{ groundingCounts: string | null }>;
    given('parse metric rows with details threw, threw, invalid and none', () => {
      rows = [fmFallbackDetail('threw'), fmFallbackDetail('threw'), fmFallbackDetail('invalid'), null, 'not json']
        .map((groundingCounts) => ({ groundingCounts }));
    });
    then('the fallback counts are threw 2 and invalid 1', () => {
      expect(fmFallbackCounts(rows)).toEqual({ threw: 2, invalid: 1 });
    });
  });

  test('The aggregate carries the fallback counts for the debug screen', ({ given, then }) => {
    let rows: AggregateRow[];
    given('parse metric rows with details threw, threw, invalid and none', () => {
      const base = { engine: 'heuristic', outcome: 'confirm', resolved: null, payeeSwapped: null, confidenceBucket: null,
        latencyMs: null, edited: null, editedAmount: null, editedType: null, editedPayee: null, editedCategory: null, editedDate: null };
      rows = [fmFallbackDetail('threw'), fmFallbackDetail('threw'), fmFallbackDetail('invalid'), null]
        .map((groundingCounts) => ({ ...base, groundingCounts }));
    });
    then('the aggregate fallback counts are threw 2 and invalid 1', () => {
      expect(aggregate(rows).fmFallbacks).toEqual({ threw: 2, invalid: 1 });
    });
  });

  test('A usable parse is accepted', ({ given, when, then }) => {
    given(/^the model parses "(.*)" as (\d+)$/, (t: string, minor: string) => {
      text = t;
      attempt = async () => parseRaw(text, { ...NO_AMOUNT_RAW, amount: Number(minor) / 100, confidence: 0.9 });
    });
    run(when);
    then(/^the outcome is parsed with amount (\d+)$/, (minor: string) => {
      expect(outcome.kind).toBe('parsed');
      if (outcome.kind === 'parsed') expect(outcome.parse.amount).toBe(Number(minor));
    });
  });

  test('A parsed outcome does not carry the verdict', ({ given, when, then }) => {
    given(/^the model parses "(.*)" as (\d+)$/, (t: string) => {
      text = t;
      attempt = async () => parseRaw(text, { ...NO_AMOUNT_RAW, confidence: 0.9 });
    });
    run(when);
    then('the parsed expense has no isTransaction key', () => {
      expect(outcome.kind).toBe('parsed');
      if (outcome.kind === 'parsed') expect('isTransaction' in outcome.parse).toBe(false);
    });
  });

  test('A refusal on one attempt and a throw on the next stays a refusal', ({ given, when, then }) => {
    given(/^the model refuses "(.*)" then the next attempt throws$/, (t: string) => {
      text = t;
      let i = 0;
      attempt = async () => {
        i += 1;
        if (i === 1) return parseRaw(text, REFUSAL_RAW);
        throw new Error('generation failed');
      };
    });
    run(when);
    then('the outcome is refused', () => expect(outcome.kind).toBe('refused'));
  });

  test('Log anyway runs the heuristic on the refused text', ({ given, when, then }) => {
    let draft: AiParsedExpense | null;
    given(/^the refused text "(.*)"$/, (t: string) => { text = t; });
    when('I tap Log anyway', () => { draft = heuristicExpense(text, HEURISTIC_CTX); });
    then(/^the heuristic draft has amount (\d+)$/, (minor: string) => {
      expect(draft?.amount).toBe(Number(minor));
    });
  });

  test('Log anyway on text with nothing loggable yields no amount', ({ given, when, then }) => {
    let draft: AiParsedExpense | null;
    given(/^the refused text "(.*)"$/, (t: string) => { text = t; });
    when('I tap Log anyway', () => { draft = heuristicExpense(text, HEURISTIC_CTX); });
    then('the heuristic draft has no amount', () => {
      expect(draft === null || draft.amount === null).toBe(true);
    });
  });

  test('A refused model output never carries a zero or empty-string field', ({ given, when, then, and }) => {
    let normalized: ReturnType<typeof normalizeDeviceParseOutput>;
    given('a refusal output with amount 0 and every text field empty', () => undefined);
    when('the output is normalized', () => { normalized = normalizeDeviceParseOutput(REFUSAL_RAW, 'USD'); });
    then('amount category payee account and note are all null', () => {
      expect(normalized.amount).toBeNull();
      expect(normalized.category).toBeNull();
      expect(normalized.payee).toBeNull();
      expect(normalized.account).toBeNull();
      expect(normalized.note).toBeNull();
    });
    and('the parse is not useful', () => expect(isUsefulDeviceParse(normalized)).toBe(false));
  });

  test('isTransaction false removes the amount even when the model gave one', ({ given, when, then }) => {
    let parsed: FmDeviceParse | null;
    given('a refusal output that still has amount 50', () => undefined);
    when('the FM parse is finished', () => { parsed = parseRaw('should I pay 50', { ...REFUSAL_RAW, amount: 50 }); });
    then('the amount is null and the verdict is false', () => {
      expect(parsed?.amount).toBeNull();
      expect(parsed?.isTransaction).toBe(false);
    });
  });

  test('Output without a verdict (the shared BYOK contract) normalizes exactly as before', ({ given, when, then }) => {
    let normalized: ReturnType<typeof normalizeDeviceParseOutput>;
    given('a shared-contract output with amount 12.5 and no isTransaction', () => undefined);
    when('the output is normalized', () => {
      const shared: Record<string, unknown> = { ...NO_AMOUNT_RAW, amount: 12.5 };
      delete shared.isTransaction;
      normalized = normalizeDeviceParseOutput(shared, 'USD');
    });
    then('the amount is 1250 and the result has no isTransaction key', () => {
      expect(normalized.amount).toBe(1250);
      expect('isTransaction' in normalized).toBe(false);
    });
  });

  test('A stray isTransaction false in BYOK output does not change how it normalizes', ({ given, when, then }) => {
    let normalized: ReturnType<typeof normalizeDeviceParseOutput>;
    given('a shared-contract output with amount 12.5 and isTransaction false', () => undefined);
    when('the output is normalized', () => {
      normalized = normalizeDeviceParseOutput({ ...NO_AMOUNT_RAW, isTransaction: false, amount: 12.5 }, 'USD');
    });
    then('the amount is 1250 and the result has no isTransaction key', () => {
      expect(normalized.amount).toBe(1250);
      expect('isTransaction' in normalized).toBe(false);
    });
  });

  test('A missing or non-boolean verdict is a failure, not a refusal', ({ given, when, then }) => {
    const results: Array<FmDeviceParse | null> = [];
    given('a model output with a missing verdict and one with the verdict "false" as a string', () => undefined);
    when('the FM parse is finished for both', () => {
      const noVerdict: Record<string, unknown> = { ...NO_AMOUNT_RAW };
      delete noVerdict.isTransaction;
      results.push(parseRaw('coffee 4.80', noVerdict), parseRaw('coffee 4.80', { ...NO_AMOUNT_RAW, isTransaction: 'false' }));
    });
    then('neither gives a parse', () => expect(results).toEqual([null, null]));
  });

  test('A transaction with no amount in text with no digits is a failure so the heuristic asks how much', ({ given, when, then }) => {
    givenModelReturns(given, NO_AMOUNT_RAW);
    run(when);
    then('the outcome is failed', () => expect(outcome).toEqual({ kind: 'failed' }));
  });

  test('A transaction with a date but no amount is a failure so the heuristic asks how much', ({ given, when, then }) => {
    givenModelReturns(given, NO_AMOUNT_RAW);
    run(when);
    then('the outcome is failed', () => expect(outcome).toEqual({ kind: 'failed' }));
  });

  test('A transaction verdict with an amount the code can read is parsed whatever the model said for the amount', ({ given, when, then }) => {
    givenModelReturns(given, NO_AMOUNT_RAW);
    run(when);
    then(/^the outcome is parsed with amount (\d+)$/, (minor: string) => {
      expect(outcome.kind).toBe('parsed');
      if (outcome.kind === 'parsed') expect(outcome.parse.amount).toBe(Number(minor));
    });
  });

  test('A not-a-transaction verdict on text that names an amount is a refusal', ({ given, when, then }) => {
    givenModelReturns(given, REFUSAL_RAW);
    run(when);
    then('the outcome is refused', () => expect(outcome.kind).toBe('refused'));
  });

  test('A not-a-transaction verdict on text with no amount is a failure so the heuristic asks how much', ({ given, when, then }) => {
    givenModelReturns(given, REFUSAL_RAW);
    run(when);
    then('the outcome is failed', () => expect(outcome).toEqual({ kind: 'failed' }));
  });

  test('The explicit transactions command is never refused', ({ given, when, then }) => {
    givenModelReturns(given, REFUSAL_RAW);
    when('the on-device attempts run with forceExpense', async () => {
      const { parse } = await runDeviceParseAttempts(text, attempt);
      outcome = classifyDeviceParse(parse, text, { forceExpense: true });
    });
    then('the outcome is failed', () => expect(outcome).toEqual({ kind: 'failed' }));
  });

  test('Log anyway on a no-amount draft reaches the how-much clarification', ({ given, when, then }) => {
    let message = '';
    given(/^the refused text "(.*)"$/, (t: string) => { text = t; });
    when('I tap Log anyway and the draft is interpreted', () => {
      const draft = heuristicExpense(text, HEURISTIC_CTX);
      expect(draft).not.toBeNull();
      const accounts = [{ id: 'a1', name: 'Cash', type: 'cash', currency: 'USD', archived: false }] as any;
      const res = interpret(draft!, { accounts, now: HEURISTIC_CTX.now, text });
      expect(res.kind).toBe('clarify');
      message = res.message;
    });
    then('the reply asks how much it was', () => expect(message).toMatch(/how much/i));
  });

  test('A refused metric row and its override resolution aggregate distinctly', ({ given, then, and }) => {
    let agg: MetricsAggregate;
    const row = (outcome: string, resolved: string): AggregateRow => ({
      engine: 'on_device', outcome, resolved, payeeSwapped: null, confidenceBucket: null,
      latencyMs: null, edited: 0, editedAmount: null, editedType: null, editedPayee: null,
      editedCategory: null, editedDate: null,
    });
    given('metric rows refused and overridden, refused and discarded, confirm and saved', () => {
      agg = aggregate([row('refused', 'overridden'), row('refused', 'discarded'), row('confirm', 'saved')]);
    });
    then(/^the refused outcome count is (\d+)$/, (n: string) => expect(agg.byOutcome['refused']).toBe(Number(n)));
    and(/^the saved count is (\d+)$/, (n: string) => expect(agg.saved).toBe(Number(n)));
    and(/^the discarded count is (\d+)$/, (n: string) => expect(agg.discarded).toBe(Number(n)));
    and(/^the refusals overridden count is (\d+)$/, (n: string) => expect(agg.refusedOverridden).toBe(Number(n)));
    and(/^the refusals dismissed count is (\d+)$/, (n: string) => expect(agg.refusedDismissed).toBe(Number(n)));
  });
});

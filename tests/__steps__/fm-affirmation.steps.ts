import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { affirmsTransaction, classifyDeviceParse, isRefusalVerdict, FmParseOutcome } from '../../src/domain/fmRefusal';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { runDeviceParseAttempts } from '../../src/domain/deviceParseAttempts';
import { describeFmDebugRun, FmDebugView } from '../../src/domain/fmDebug';

const feature = loadFeature(path.resolve(__dirname, '../__features__/fm-affirmation.feature'));

const FIELDS = {
  currency: '', type: 'expense', category: '', payee: '', account: '', note: '',
  occurredOn: '', confidence: 0.2, pending: false,
};

/** What a refusing model returns for `text`: `isTransaction: false`, the
 *  required fields filled with the sentinels, and the amount shaped as the
 *  per-plan schema demands (absent under `single`). */
function refusalOutput(text: string): Record<string, unknown> {
  const plan = planFmAmount(text);
  if (plan.mode === 'single') return { ...FIELDS, isTransaction: false };
  return { ...FIELDS, isTransaction: false, amount: plan.mode === 'choice' ? String(plan.values[0]) : 0 };
}

const localNoon = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12, 0, 0, 0).getTime();
};

defineFeature(feature, (test) => {
  let text = '';
  let finished: FmDeviceParse | null = null;
  let outcome: FmParseOutcome;
  let attempts = 0;
  let view: FmDebugView;

  test('A terse log or a past-tense spend the model refused is affirmed', ({ then }) => {
    then(/^the refusal of "(.*)" is affirmed as "(.*)"$/, (t: string, reason: string) => {
      expect(affirmsTransaction(t, planFmAmount(t))).toBe(reason);
    });
  });

  test('A refusal the code cannot read as a log stays refused', ({ then }) => {
    then(/^the refusal of "(.*)" stands$/, (t: string) => {
      expect(affirmsTransaction(t, planFmAmount(t))).toBeNull();
    });
  });

  const givenRefuses = (given: any) =>
    given(/^the model refuses "(.*)"$/, (t: string) => { text = t; });
  const whenFinishedAt = (when: any) =>
    when(/^the FM parse is finished at (\d{4}-\d{2}-\d{2})$/, (iso: string) => {
      finished = finishFmParse(refusalOutput(text), text, planFmAmount(text), localNoon(iso), 'USD');
    });

  test('The affirmed parse carries the code-read amount, the typed date and the verdict', ({ given, when, then }) => {
    givenRefuses(given);
    whenFinishedAt(when);
    then(/^the parse is a transaction with amount (\d+) dated (\S+) affirmed as "(.*)"$/,
      (amount: string, iso: string, reason: string) => {
        expect(finished).not.toBeNull();
        expect(finished!.isTransaction).toBe(true);
        expect(finished!.affirmed).toBe(reason);
        expect(finished!.amount).toBe(Number(amount));
        expect(finished!.occurredAt).toBe(localNoon(iso));
      });
  });

  const givenRefusesAlways = (given: any) =>
    given(/^the model refuses "(.*)" on every attempt$/, (t: string) => { text = t; });
  const run = async (forceExpense: boolean) => {
    const result = await runDeviceParseAttempts(
      text,
      async () => finishFmParse(refusalOutput(text), text, planFmAmount(text), localNoon('2026-07-16'), 'USD'),
      isRefusalVerdict
    );
    attempts = result.attempts;
    outcome = classifyDeviceParse(result.parse, text, { forceExpense, threw: result.threw });
  };
  const whenRun = (when: any) => when('the on-device attempts run', () => run(false));
  const thenAttempts = (and: any) =>
    and(/^(\d+) attempts? (?:was|were) made$/, (n: string) => expect(attempts).toBe(Number(n)));

  test('An affirmed refusal is a parsed outcome and costs no second generation', ({ given, when, then, and }) => {
    givenRefusesAlways(given);
    whenRun(when);
    then(/^the outcome is parsed with amount (\d+)$/, (minor: string) => {
      expect(outcome.kind).toBe('parsed');
      if (outcome.kind === 'parsed') expect(outcome.parse.amount).toBe(Number(minor));
    });
    thenAttempts(and);
  });

  test('A refusal that stands is still final and not retried', ({ given, when, then, and }) => {
    givenRefusesAlways(given);
    whenRun(when);
    then('the outcome is refused', () => expect(outcome).toEqual({ kind: 'refused' }));
    thenAttempts(and);
  });

  test('A refusal under forceExpense is still a failure, not an affirmation question', ({ given, when, then }) => {
    givenRefusesAlways(given);
    when('the on-device attempts run with forceExpense', () => run(true));
    then('the outcome is failed', () => expect(outcome).toEqual({ kind: 'failed' }));
  });

  test("The debug view shows the model's own verdict and the affirmation", ({ given, when, and, then }) => {
    givenRefuses(given);
    whenFinishedAt(when);
    and('the debug view is built', () => { view = describeFmDebugRun(text, { fm: finished, error: null }); });
    then(/^the view shows verdict "(.*)", app outcome "(.*)" and affirmation "(.*)"$/,
      (verdict: string, app: string, affirmed: string) => {
        expect(view).toMatchObject({ verdict, appOutcome: app, affirmed, cue: null });
      });
  });

  test('The affirmed parse does not carry the verdict or the affirmation once classified', ({ given, when, then }) => {
    givenRefusesAlways(given);
    whenRun(when);
    then('the parsed expense has no isTransaction or affirmed key', () => {
      expect(outcome.kind).toBe('parsed');
      if (outcome.kind === 'parsed') {
        expect(outcome.parse).not.toHaveProperty('isTransaction');
        expect(outcome.parse).not.toHaveProperty('affirmed');
      }
    });
  });
});

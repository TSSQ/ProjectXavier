import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { cueRefusal, detectNotTransactionCue } from '../../src/domain/notTransactionCues';
import { describeFmDebugRun, FmDebugView } from '../../src/domain/fmDebug';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { fmFallbackCounts, notTransactionCueDetail } from '../../src/domain/parseMetrics';

const feature = loadFeature(path.resolve(__dirname, '../__features__/not-transaction-cues.feature'));

const NOW = 1735689600000;
const FIELDS = {
  currency: '', type: 'expense', category: '', payee: '', account: '', note: '',
  occurredOn: '', confidence: 0.9, pending: false,
};

function modelParse(text: string, isTransaction: boolean, amount: number): FmDeviceParse | null {
  return finishFmParse({ ...FIELDS, isTransaction, amount }, text, planFmAmount(text), NOW, 'USD');
}

defineFeature(feature, (test) => {
  let text: string;
  let forceExpense: boolean;

  test('Each cue family fires on text that names an amount', ({ when, then }) => {
    when(/^the cue check runs on "(.*)"$/, (t: string) => { text = t; });
    then(/^the cue is "(.*)"$/, (cue: string) => {
      expect(cueRefusal(text)).toEqual({ cue });
      expect(detectNotTransactionCue(text)).toEqual({ cue });
    });
  });

  test('Real expenses with cue-like words are not refused', ({ when, then }) => {
    when(/^the cue check runs on "(.*)"$/, (t: string) => { text = t; });
    then('no cue fires', () => {
      expect(detectNotTransactionCue(text)).toBeNull();
      expect(cueRefusal(text)).toBeNull();
    });
  });

  test('A cue with no amount evidence does not refuse', ({ when, then }) => {
    when(/^the cue check runs on "(.*)"$/, (t: string) => { text = t; });
    then('the text has a cue but the gate does not refuse it', () => {
      expect(detectNotTransactionCue(text)).toEqual({ cue: 'should-i' });
      expect(cueRefusal(text)).toBeNull();
    });
  });

  test('forceExpense bypasses the check entirely', ({ when, then }) => {
    when(/^the cue check runs on "(.*)" with forceExpense$/, (t: string) => { text = t; forceExpense = true; });
    then('the gate does not refuse it', () => {
      expect(cueRefusal(text, { forceExpense })).toBeNull();
      expect(cueRefusal(text)).not.toBeNull();
    });
  });

  test('The cue is logged as a content-free detail the fallback counter ignores', ({ when, then }) => {
    let detail = '';
    when(/^the cue detail for "(.*)" is built$/, (cue: string) => { detail = notTransactionCueDetail(cue); });
    then('it is {"notTransactionCue":"should-i"} and the fallback counts are empty', () => {
      expect(detail).toBe('{"notTransactionCue":"should-i"}');
      expect(fmFallbackCounts([{ groundingCounts: detail }])).toEqual({});
    });
  });

  let run: { fm: FmDeviceParse | null; error: string | null };
  let view: FmDebugView;
  const givenAnswered = (given: any) =>
    given(/^the model answered isTransaction (true|false) for "(.*)"(?: with amount (\d+))?$/,
      (v: string, t: string, amount?: string) => {
        text = t;
        run = { fm: modelParse(t, v === 'true', Number(amount ?? 0) / 100), error: null };
      });
  const whenBuilt = (when: any) => when('the debug view is built', () => { view = describeFmDebugRun(text, run); });

  test('The debug screen shows the model verdict, the outcome and the cue', ({ given, when, then }) => {
    givenAnswered(given);
    whenBuilt(when);
    then(/^the verdict is "(.*)", the model outcome is "(.*)", the cue is "(.*)" and the app outcome is "(.*)"$/,
      (verdict: string, model: string, cue: string, app: string) => {
        expect(view).toMatchObject({ verdict, modelOutcome: model, cue, appOutcome: app });
      });
  });

  test('The debug screen shows a model refusal with no cue', ({ given, when, then }) => {
    givenAnswered(given);
    whenBuilt(when);
    then(/^the verdict is "(.*)", the model outcome is "(.*)", there is no cue and the app outcome is "(.*)"$/,
      (verdict: string, model: string, app: string) => {
        expect(view).toMatchObject({ verdict, modelOutcome: model, cue: null, appOutcome: app });
      });
  });

  test('The debug screen reports a throw as no answer', ({ given, when, then }) => {
    given(/^the model threw for "(.*)"$/, (t: string) => { text = t; run = { fm: null, error: 'boom' }; });
    whenBuilt(when);
    then(/^the verdict is "(.*)", the model outcome is "(.*)", there is no cue and the app outcome is "(.*)"$/,
      (verdict: string, model: string, app: string) => {
        expect(view).toMatchObject({ verdict, modelOutcome: model, cue: null, appOutcome: app });
      });
  });

  test('The debug screen flags a cue that lacks an amount', ({ given, when, then }) => {
    givenAnswered(given);
    whenBuilt(when);
    then(/^the cue is only noted as "(.*)" without an amount$/, (cue: string) => {
      expect(view).toMatchObject({ cue: null, cueWithoutAmount: cue });
    });
  });
});

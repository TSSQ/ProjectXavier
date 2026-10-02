import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { planFmAmount, MAX_AMOUNT_CHOICES } from '../../src/domain/fmAmountPlan';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';

const feature = loadFeature(path.resolve(__dirname, '../__features__/fm-amount.feature'));

const NOW = 1735689600000;
const FIELDS = {
  currency: '', type: 'expense', category: '', payee: '', account: '', note: '',
  occurredOn: '', confidence: 0.9, pending: false,
};

/** The model's output for `text`: no `amount` key under a single plan (that
 *  schema has no such field), a string label under a choice plan, a number
 *  otherwise - the shapes the per-plan schema allows. */
function modelOutput(text: string, isTransaction: boolean, amount: string): Record<string, unknown> {
  const plan = planFmAmount(text);
  if (plan.mode === 'single') return { ...FIELDS, isTransaction };
  return { ...FIELDS, isTransaction, amount: plan.mode === 'choice' ? amount : Number(amount) };
}

defineFeature(feature, (test) => {
  let result: FmDeviceParse | null;

  const run = (text: string, isTransaction: boolean, amount: string, currency = 'USD') => {
    result = finishFmParse(modelOutput(text, isTransaction, amount), text, planFmAmount(text), NOW, currency);
  };
  const parsedAmount = (then: any) =>
    then(/^the parsed amount is (\d+|none)$/, (expected: string) => {
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(expected === 'none' ? null : Number(expected));
    });

  test('The plan follows the number of candidates', ({ then }) => {
    then(/^the amount plan for "(.*)" is "(.*)"$/, (text: string, mode: string) => {
      expect(planFmAmount(text).mode).toBe(mode);
    });
  });

  test('Single only when the reading is unambiguous', ({ then }) => {
    then(/^the amount plan for "(.*)" is "(.*)"$/, (text: string, mode: string) => {
      expect(planFmAmount(text).mode).toBe(mode);
    });
  });

  const offeredIs = (then: any) =>
    then(/^the choice offered for "(.*)" is "(.*)"$/, (text: string, values: string) => {
      const plan = planFmAmount(text);
      expect(plan.mode).toBe('choice');
      if (plan.mode === 'choice') expect(plan.values.join(',')).toBe(values);
    });
  test('A choice offers every plausible reading', ({ then }) => offeredIs(then));
  test('Over eight readings keeps the largest in reading order', ({ then }) => offeredIs(then));
  test('Over eight readings keeps the money-marked ones first', ({ then }) => offeredIs(then));
  test('A very large number is not a candidate, so its label never uses exponent notation', ({ then }) => {
    then(/^the amount plan for "(.*)" is "(.*)"$/, (text: string, mode: string) => {
      expect(planFmAmount(text).mode).toBe(mode);
    });
  });

  test('Only eight candidates are offered as a choice', ({ then }) => {
    then('the amount plan for a text with ten distinct amounts offers exactly 8', () => {
      const plan = planFmAmount('paid 11 12 13 14 15 16 17 18 19 20');
      expect(plan.mode).toBe('choice');
      if (plan.mode === 'choice') expect(plan.values).toEqual([13, 14, 15, 16, 17, 18, 19, 20].slice(0, MAX_AMOUNT_CHOICES));
    });
  });

  const when = (name: string, f: (w: any) => void) => test(name, ({ when: w, then }) => { f(w); parsedAmount(then); });
  const saysTransaction = (w: any) =>
    w(/^the model says transaction with amount "(.*)" for "(.*)"$/, (amount: string, text: string) => run(text, true, amount));

  when('A single candidate is the amount whatever the model says', saysTransaction);
  when("Several candidates: the model's pick from the set is used", saysTransaction);
  when('Several candidates: a pick outside the set gives no amount', saysTransaction);
  when('No candidate: an amount invented for text with no number is dropped', saysTransaction);
  when('No candidate: a number that is only a date is not accepted as the amount', saysTransaction);
  when("Thai digits and CJK numerals are not read, and the model's own number for them is dropped", saysTransaction);
  when('No candidate: a spelled-out amount the extractor does not read is trusted', saysTransaction);

  test('A not-a-transaction verdict gives no amount even with one candidate', ({ when: w, then, and }) => {
    w(/^the model refuses "(.*)" with amount "(.*)"$/, (text: string, amount: string) => run(text, false, amount));
    parsedAmount(then);
    and('the verdict is false', () => expect(result!.isTransaction).toBe(false));
  });

  test('The code-read amount is scaled to the active currency', ({ when: w, then }) => {
    w(
      /^the model says transaction with amount "(.*)" for "(.*)" in currency "(.*)"$/,
      (amount: string, text: string, currency: string) => run(text, true, amount, currency)
    );
    parsedAmount(then);
  });
});

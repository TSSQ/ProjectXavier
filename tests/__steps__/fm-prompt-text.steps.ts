import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { fmPromptText, typedDateSpan } from '../../src/domain/deviceParsePrompt';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';

const feature = loadFeature(path.resolve(__dirname, '../__features__/fm-prompt-text.feature'));

const NOW = new Date(2026, 6, 16, 12, 0, 0, 0).getTime();
const localNoon = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12, 0, 0, 0).getTime();
};

defineFeature(feature, (test) => {
  const thenPromptText = (then: any) =>
    then(/^the model's text for "(.*)" is "(.*)"$/, (text: string, prompt: string) => {
      expect({ text, prompt: fmPromptText(text, NOW) }).toEqual({ text, prompt });
    });

  test("The date phrase is removed from the model's text", ({ then }) => thenPromptText(then));
  test('Text with no date phrase, or nothing left without it, is unchanged', ({ then }) => thenPromptText(then));

  test('The span the date resolvers read is reported without changing their reading', ({ then }) => {
    then(/^the date span of "(.*)" is "(.*)"$/, (text: string, span: string) => {
      const found = typedDateSpan(text, NOW);
      expect({ text, span: found ? text.slice(found.index, found.end) : '' }).toEqual({ text, span });
    });
  });

  test('The pipeline still dates and grounds from the original text', ({ given, when, then }) => {
    let text = '';
    let payee = '';
    let finished: FmDeviceParse | null = null;
    given(/^the model logs "(.*)" with payee "(.*)"$/, (t: string, p: string) => {
      text = t;
      payee = p;
    });
    when('the FM parse is finished', () => {
      const object = {
        isTransaction: true, currency: '', type: 'expense', category: '', payee, account: '', note: '',
        occurredOn: '', confidence: 0.9, pending: false,
      };
      finished = finishFmParse(object, text, planFmAmount(text), NOW, 'USD');
    });
    then(/^the parse is dated (\S+) with payee "(.*)"$/, (iso: string, p: string) => {
      expect(finished).not.toBeNull();
      expect(finished!.occurredAt).toBe(localNoon(iso));
      expect(finished!.payee).toBe(p);
    });
  });
});

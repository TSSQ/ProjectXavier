import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runDeviceParseAttempts } from '../../src/domain/deviceParseAttempts';
import { normalizeDeviceParseOutput, isUsefulDeviceParse } from '../../src/domain/deviceParsePrompt';
import { classifyDeviceParse, FmParseOutcome, heuristicExpense } from '../../src/domain/fmRefusal';
import { aiParsedExpenseSchema, AiParsedExpense } from '../../src/lib/validation';

const feature = loadFeature(path.resolve(__dirname, '../__features__/fm-refusal.feature'));

/** What the model "said" for one text, run through the same normalize ->
 *  validate chain `deviceParseUnsafe` uses (minus the native binding). */
function parseRaw(raw: Record<string, unknown>): AiParsedExpense | null {
  const normalized = normalizeDeviceParseOutput(raw, 'USD');
  const validated = aiParsedExpenseSchema.safeParse({ ...normalized, occurredAt: 1735689600000 });
  return validated.success ? validated.data : null;
}

const REFUSAL_RAW = {
  amount: 0, currency: '', type: 'expense', category: '', payee: '', account: '', note: '',
  occurredOn: '', confidence: 0.2, pending: false,
};
const HEURISTIC_CTX = { categories: [], payees: [], now: 1735689600000 };

defineFeature(feature, (test) => {
  let attempt: () => Promise<AiParsedExpense | null>;
  let text: string;
  let outcome: FmParseOutcome;

  const run = (when: any) =>
    when('the on-device attempts run', async () => {
      const { parse } = await runDeviceParseAttempts(text, attempt);
      outcome = classifyDeviceParse(parse);
    });

  test('A refusal is distinguished from a failure and the heuristic is not consulted', ({ given, when, then, and }) => {
    given(/^the model refuses "(.*)"$/, (t: string) => {
      text = t;
      attempt = async () => parseRaw(REFUSAL_RAW);
    });
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
    then('the outcome is failed', () => expect(outcome).toEqual({ kind: 'failed' }));
  });

  test('A usable parse is accepted', ({ given, when, then }) => {
    given(/^the model parses "(.*)" as (\d+)$/, (t: string, minor: string) => {
      text = t;
      attempt = async () => parseRaw({ ...REFUSAL_RAW, amount: Number(minor) / 100, confidence: 0.9 });
    });
    run(when);
    then(/^the outcome is parsed with amount (\d+)$/, (minor: string) => {
      expect(outcome.kind).toBe('parsed');
      if (outcome.kind === 'parsed') expect(outcome.parse.amount).toBe(Number(minor));
    });
  });

  test('A refusal on one attempt and a throw on the next stays a refusal', ({ given, when, then }) => {
    given(/^the model refuses "(.*)" then the next attempt throws$/, (t: string) => {
      text = t;
      let i = 0;
      attempt = async () => {
        i += 1;
        if (i === 1) return parseRaw(REFUSAL_RAW);
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
});

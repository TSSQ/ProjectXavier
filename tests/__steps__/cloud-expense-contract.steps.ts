import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared';
import {
  buildFmParseInstructions,
  buildFmParsePrompt,
  buildCloudParsePrompt,
} from '../../src/domain/deviceParsePrompt';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';
import { classifyDeviceParse, FmParseOutcome } from '../../src/domain/fmRefusal';
import { cueRefusal } from '../../src/domain/notTransactionCues';

const feature = loadFeature(path.resolve(__dirname, '../__features__/cloud-expense-contract.feature'));

/** Local noon on a YYYY-MM-DD (the suite pins TZ=UTC). */
const noonOf = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const FIELDS = {
  currency: '', type: 'expense', category: '', payee: '', account: '', note: '',
  occurredOn: '', confidence: 0.9, pending: false,
};

/** A model reply shaped by the text's plan (no `amount` under a single plan,
 *  a label under a choice plan, a number otherwise). */
function reply(text: string, isTransaction: boolean, occurredOn = ''): Record<string, unknown> {
  const plan = planFmAmount(text);
  const base = { ...FIELDS, isTransaction, occurredOn };
  if (plan.mode === 'single') return base;
  if (plan.mode === 'choice') return { ...base, amount: String(plan.values[0]) };
  return { ...base, amount: 0 };
}

const ctx = (now: number) => ({ categories: [], payees: [], accounts: [], now, currency: 'USD' });

defineFeature(feature, (test) => {
  test("The cloud instructions and prompt carry the refuse rule and today's date", ({
    when,
    then,
    and,
  }) => {
    let text: string;
    let now: number;
    let prompt: string;

    when(/^I build the cloud expense prompt for "(.*)" on (\d{4}-\d{2}-\d{2})$/, (t: string, ymd: string) => {
      text = t;
      now = noonOf(ymd);
      prompt = EXPENSE_PARSE_CONTRACT.buildPrompt(text, ctx(now));
    });

    then('the instructions should be the FM instructions', () => {
      expect(EXPENSE_PARSE_CONTRACT.instructions()).toBe(buildFmParseInstructions());
    });

    and(/^the prompt should start with "(.*)"$/, (prefix: string) => {
      expect(prompt.startsWith(prefix)).toBe(true);
      expect(prompt).toBe(buildCloudParsePrompt(text, ctx(now)));
    });

    and('the prompt should end with the FM prompt for the same text', () => {
      expect(prompt.endsWith(buildFmParsePrompt(text, ctx(now)))).toBe(true);
    });

    and('the prompt should not ask the model to propose a new category name', () => {
      expect(prompt).not.toMatch(/propose a concise new name/);
      expect(EXPENSE_PARSE_CONTRACT.instructions()).not.toMatch(/propose/);
    });
  });

  test('The request schema name and tool name are unchanged, the schema follows the text', ({
    when,
    then,
  }) => {
    let schema: Record<string, unknown>;

    when(/^I build the cloud expense JSON schema through the contract for "(.*)"$/, (text: string) => {
      schema = EXPENSE_PARSE_CONTRACT.jsonSchema(text);
      expect(EXPENSE_PARSE_CONTRACT.toolName).toBe('record_expense');
      expect(EXPENSE_PARSE_CONTRACT.jsonSchemaName).toBe('expense');
    });

    then(/^the contract's amount field should be "(.*)"$/, (expected: string) => {
      const properties = schema.properties as Record<string, { type?: string; enum?: string[] }>;
      if (expected === 'absent') expect('amount' in properties).toBe(false);
      else if (expected === 'enum') expect(Array.isArray(properties.amount?.enum)).toBe(true);
      else expect(properties.amount?.type).toBe('number');
    });
  });

  const classifyScenario = (title: string) =>
    test(title, ({ given, when, then }) => {
      let text: string;
      let raw: Record<string, unknown>;
      let outcome: FmParseOutcome;

      given(/^a cloud model reply for "(.*)" with isTransaction (true|false)$/, (t: string, v: string) => {
        text = t;
        raw = reply(text, v === 'true');
      });

      when(/^I normalize it through the cloud expense contract and classify it(?: under (forceExpense))?$/, (force?: string) => {
        const now = noonOf('2026-07-16');
        const parsed = EXPENSE_PARSE_CONTRACT.normalize(raw, text, ctx(now));
        outcome = classifyDeviceParse(parsed, text, { forceExpense: force === 'forceExpense' });
      });

      then(/^the classification should be "(.*)"$/, (kind: string) => {
        expect(outcome.kind).toBe(kind);
        if (outcome.kind === 'parsed') expect(outcome.parse.amount).toBe(500);
      });
    });
  classifyScenario('A cloud verdict is classified exactly like the on-device one');
  classifyScenario('Under forceExpense a cloud refusal is never a refusal');

  const dateScenario = (title: string) =>
    test(title, ({ given, when, then }) => {
      let text: string;
      let now: number;
      let raw: Record<string, unknown>;
      let parsed: FmDeviceParse | null;

      given(
        /^a cloud model reply for "(.*)" dated "(.*)" on (\d{4}-\d{2}-\d{2})$/,
        (t: string, modelDate: string, today: string) => {
          text = t;
          now = noonOf(today);
          raw = reply(text, true, modelDate);
        }
      );

      when(/^I (normalize it through the cloud expense contract|finish it as the on-device tier does)$/, (how: string) => {
        parsed = how.startsWith('normalize')
          ? EXPENSE_PARSE_CONTRACT.normalize(raw, text, ctx(now))
          : // deviceParseUnsafe's call: no dateFallback option -> today, never the model's.
            finishFmParse(raw, text, planFmAmount(text), now, 'USD');
      });

      then(/^the parse should be dated "(.*)"$/, (expected: string) => {
        expect(parsed).not.toBeNull();
        expect(ymdOf(parsed!.occurredAt!)).toBe(expected);
      });
    });
  dateScenario("The user's own words date the parse; else the cloud model's date; else today");
  dateScenario("The on-device tier still never takes the model's date");

  test('The cue gate the chat screen runs before any request refuses the same texts as on-device', ({
    then,
  }) => {
    then(/^cueRefusal for "(.*)" should be (a cue|nothing)$/, (text: string, expected: string) => {
      const hit = cueRefusal(text);
      if (expected === 'a cue') expect(hit?.cue).toBeTruthy();
      else expect(hit).toBeNull();
    });
  });
});

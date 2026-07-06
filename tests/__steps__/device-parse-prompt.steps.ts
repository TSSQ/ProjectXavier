import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { zodSchema } from 'ai';
import { Category, Payee, Account, TransactionType } from '../../src/domain/types';
import {
  deviceParseSchema,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
  normalizeDeviceParseOutput,
  isUsefulDeviceParse,
  resolveRelativeDate,
  resolveAbsoluteDate,
  NormalizedDeviceParse,
} from '../../src/domain/deviceParsePrompt';
import { nextId } from '../support/world';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/device-parse-prompt.feature')
);

/** Table cells are strings; a quoted cell ("foo") is a string value, anything
 *  else parses as a number. */
function parseCellValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return Number(trimmed);
}

/** A schema-valid parse with every nullable field populated. */
function fullyPopulatedParse(): Record<string, unknown> {
  return {
    amount: 1250,
    currency: 'USD',
    type: 'expense',
    category: 'Dining',
    payee: 'Starbucks',
    account: 'Amex',
    note: 'coffee',
    occurredOn: '2026-07-05',
    confidence: 0.9,
  };
}

/** A schema-valid parse where the model knew nothing usable: the required
 *  fields carry their "unknown" sentinels and every optional field is omitted
 *  (the FM binding can't express null — see deviceParseSchema). */
function requiredWithSentinelsParse(): Record<string, unknown> {
  return { amount: 0, type: 'expense', category: 'Other', payee: '', account: '', confidence: 0 };
}

defineFeature(feature, (test) => {
  let categories: Category[] = [];
  let payees: Payee[] = [];
  let accounts: Account[] = [];
  let prompt: string;
  let instructions: string;
  let schemaAccepted: boolean;
  let normalized: NormalizedDeviceParse;
  let useful: boolean;
  let resolvedDate: number | null;

  beforeEach(() => {
    categories = [];
    payees = [];
    accounts = [];
  });

  test('The schema accepts required fields with sentinels and optionals omitted', ({
    when,
    then,
  }) => {
    when(
      /^the model returns the required fields with sentinels and optionals omitted$/,
      () => {
        schemaAccepted = deviceParseSchema.safeParse(requiredWithSentinelsParse()).success;
      }
    );
    then(/^the guided-generation schema should accept it$/, () => {
      expect(schemaAccepted).toBe(true);
    });
  });

  test('The schema rejects a parse missing a required field', ({ when, then }) => {
    when(/^the model returns a parse with no amount field$/, () => {
      const { amount, ...noAmount } = fullyPopulatedParse();
      void amount;
      schemaAccepted = deviceParseSchema.safeParse(noAmount).success;
    });
    then(/^the guided-generation schema should reject it$/, () => {
      expect(schemaAccepted).toBe(false);
    });
  });

  test('The guided-generation schema accepts a fully populated parse', ({
    when,
    then,
  }) => {
    when(/^the model returns a fully populated parse$/, () => {
      schemaAccepted = deviceParseSchema.safeParse(fullyPopulatedParse()).success;
    });
    then(/^the guided-generation schema should accept it$/, () => {
      expect(schemaAccepted).toBe(true);
    });
  });

  test('The guided-generation schema rejects a wrongly typed field', ({
    when,
    then,
  }) => {
    when(/^the model returns a parse whose amount is the string "(.*)"$/, (amount: string) => {
      schemaAccepted = deviceParseSchema.safeParse({
        ...fullyPopulatedParse(),
        amount,
      }).success;
    });
    then(/^the guided-generation schema should reject it$/, () => {
      expect(schemaAccepted).toBe(false);
    });
  });

  test('The guided-generation schema stays expressible by the FM binding', ({
    when,
    then,
    and,
  }) => {
    // What @react-native-ai/apple's native converter (AppleLLMImpl.swift
    // parseDynamicSchema) supports: every property must carry a SINGLE type
    // string from this list — no anyOf / ["string","null"] unions (which is
    // exactly what .nullable() fields compile to and the sim rejected with
    // "Unsupported schema type").
    const SUPPORTED_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean'];
    let json: Record<string, any>;

    when(/^the AI SDK converts the schema to JSON schema$/, () => {
      json = zodSchema(deviceParseSchema).jsonSchema as Record<string, any>;
    });
    then(/^every property type should be a single supported type$/, () => {
      const properties = json.properties as Record<string, any>;
      expect(Object.keys(properties).length).toBeGreaterThan(0);
      for (const [name, prop] of Object.entries(properties)) {
        expect({ name, anyOf: prop.anyOf }).toEqual({ name, anyOf: undefined });
        expect({ name, type: typeof prop.type }).toEqual({ name, type: 'string' });
        expect(SUPPORTED_TYPES).toContain(prop.type);
      }
    });
    and(/^the required fields should be amount, type, category, payee, account, confidence$/, () => {
      expect([...(json.required as string[])].sort()).toEqual(
        ['account', 'amount', 'category', 'confidence', 'payee', 'type'].sort()
      );
    });
  });

  test('The prompt includes known categories and payees as grounding hints', ({
    given,
    when,
    then,
    and,
  }) => {
    given(/^existing categories:$/, (table: Array<{ name: string; kind: string }>) => {
      categories = table.map((r) => ({
        id: nextId('cat'),
        name: r.name,
        kind: r.kind as TransactionType,
      }));
    });
    given(/^existing payees:$/, (table: Array<{ name: string }>) => {
      payees = table.map((r) => ({ id: nextId('pay'), name: r.name }));
    });
    when(
      /^I build the device parse prompt for "(.*)" at time (\d+)$/,
      (text: string, now: string) => {
        prompt = buildDeviceParsePrompt(text, { categories, payees, accounts, now: parseInt(now, 10) });
      }
    );
    then(/^the prompt should mention "(.*)"$/, (snippet: string) => {
      expect(prompt).toContain(snippet);
    });
    and(/^the prompt should mention "(.*)"$/, (snippet: string) => {
      expect(prompt).toContain(snippet);
    });
    and(/^the prompt should mention "(.*)"$/, (snippet: string) => {
      expect(prompt).toContain(snippet);
    });
  });

  test('The prompt includes known accounts as a grounding hint', ({
    given,
    when,
    then,
  }) => {
    given(/^existing accounts:$/, (table: Array<{ name: string }>) => {
      accounts = table.map((r) => ({
        id: nextId('acc'),
        name: r.name,
        currency: 'USD',
        openingBalance: 0,
      }));
    });
    when(
      /^I build the device parse prompt for "(.*)" at time (\d+)$/,
      (text: string, now: string) => {
        prompt = buildDeviceParsePrompt(text, { categories, payees, accounts, now: parseInt(now, 10) });
      }
    );
    then(/^the prompt should mention "(.*)"$/, (snippet: string) => {
      expect(prompt).toContain(snippet);
    });
  });

  test('The prompt omits hints when there are no known categories or payees', ({
    when,
    then,
    and,
  }) => {
    when(
      /^I build the device parse prompt for "(.*)" at time (\d+)$/,
      (text: string, now: string) => {
        prompt = buildDeviceParsePrompt(text, { categories, payees, accounts, now: parseInt(now, 10) });
      }
    );
    then(/^the prompt should not mention "(.*)"$/, (snippet: string) => {
      expect(prompt).not.toContain(snippet);
    });
    and(/^the prompt should not mention "(.*)"$/, (snippet: string) => {
      expect(prompt).not.toContain(snippet);
    });
    and(/^the prompt should not mention "(.*)"$/, (snippet: string) => {
      expect(prompt).not.toContain(snippet);
    });
  });

  test('The instructions ask to omit (not guess) unknown fields', ({
    when,
    then,
  }) => {
    when(/^I build the device parse instructions$/, () => {
      instructions = buildDeviceParseInstructions();
    });
    then(/^the instructions should mention "(.*)"$/, (snippet: string) => {
      expect(instructions).toContain(snippet);
    });
  });

  const whenNormalize = (when: any) =>
    when(
      /^I normalize the device parse output:$/,
      (table: Array<{ field: string; value: string }>) => {
        const raw: Record<string, unknown> = {};
        for (const row of table) {
          raw[row.field] = parseCellValue(row.value);
        }
        normalized = normalizeDeviceParseOutput(raw);
      }
    );

  test('A negative amount normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized amount should be null$/, () => {
      expect(normalized.amount).toBeNull();
    });
  });

  test('A zero amount normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized amount should be null$/, () => {
      expect(normalized.amount).toBeNull();
    });
  });

  test('A whole-dollar amount converts to minor units', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized amount should be (\d+)$/, (val: string) => {
      expect(normalized.amount).toBe(parseInt(val, 10));
    });
  });

  test('A decimal amount converts to minor units', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized amount should be (\d+)$/, (val: string) => {
      expect(normalized.amount).toBe(parseInt(val, 10));
    });
  });

  test('Empty-string text fields normalize to null', ({ when, then, and }) => {
    whenNormalize(when);
    then(/^the normalized currency should be null$/, () => {
      expect(normalized.currency).toBeNull();
    });
    and(/^the normalized payee should be null$/, () => {
      expect(normalized.payee).toBeNull();
    });
    and(/^the normalized category should be null$/, () => {
      expect(normalized.category).toBeNull();
    });
    and(/^the normalized account should be null$/, () => {
      expect(normalized.account).toBeNull();
    });
    and(/^the normalized note should be null$/, () => {
      expect(normalized.note).toBeNull();
    });
  });

  test('A non-empty text field normalizes unchanged', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized payee should be "(.*)"$/, (name: string) => {
      expect(normalized.payee).toBe(name);
    });
  });

  test('A placeholder-word payee normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized payee should be null$/, () => {
      expect(normalized.payee).toBeNull();
    });
  });

  test('A lowercase currency code normalizes to uppercase', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized currency should be "(.*)"$/, (code: string) => {
      expect(normalized.currency).toBe(code);
    });
  });

  test('A chatty non-code currency normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized currency should be null$/, () => {
      expect(normalized.currency).toBeNull();
    });
  });

  test('A recognised type passes through', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized type should be "(.*)"$/, (type: string) => {
      expect(normalized.type).toBe(type);
    });
  });

  test('A garbage type value normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized type should be null$/, () => {
      expect(normalized.type).toBeNull();
    });
  });

  const whenResolveRelative = (when: any) =>
    when(
      /^I resolve the relative date in "(.*)" at time (\d+)$/,
      (txt: string, now: string) => {
        resolvedDate = resolveRelativeDate(txt, parseInt(now, 10));
      }
    );
  const whenResolveAbsolute = (when: any) =>
    when(
      /^I resolve the absolute date in "(.*)" at time (\d+)$/,
      (txt: string, now: string) => {
        resolvedDate = resolveAbsoluteDate(txt, parseInt(now, 10));
      }
    );
  const thenResolvedNoonOn = (then: any) =>
    then(
      /^the resolved date should be local noon on (\d{4})-(\d{2})-(\d{2})$/,
      (y: string, mo: string, d: string) => {
        const expected = new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0, 0).getTime();
        expect(resolvedDate).toBe(expected);
      }
    );
  const thenNoonDaysBefore = (then: any) =>
    then(
      /^the resolved date should be local noon (\d+) days before (\d+)$/,
      (n: string, now: string) => {
        const d = new Date(parseInt(now, 10) - parseInt(n, 10) * 86_400_000);
        d.setHours(12, 0, 0, 0);
        expect(resolvedDate).toBe(d.getTime());
      }
    );

  test('"yesterday" in the text resolves deterministically to the prior day', ({ when, then }) => {
    whenResolveRelative(when);
    thenNoonDaysBefore(then);
  });

  test('"3 days ago" resolves three days back', ({ when, then }) => {
    whenResolveRelative(when);
    thenNoonDaysBefore(then);
  });

  test('"today" resolves to the current day', ({ when, then }) => {
    whenResolveRelative(when);
    thenNoonDaysBefore(then);
  });

  test('text with no relative date resolves to null', ({ when, then }) => {
    whenResolveRelative(when);
    then(/^the resolved date should be null$/, () => {
      expect(resolvedDate).toBeNull();
    });
  });

  test('"24th June" (day first) resolves to that date, this year if past', ({ when, then }) => {
    whenResolveAbsolute(when);
    thenResolvedNoonOn(then);
  });

  test('"June 24" (month first) resolves the same', ({ when, then }) => {
    whenResolveAbsolute(when);
    thenResolvedNoonOn(then);
  });

  test('an absolute date with an explicit year is honoured', ({ when, then }) => {
    whenResolveAbsolute(when);
    thenResolvedNoonOn(then);
  });

  test('a bare month with no day is not an absolute date', ({ when, then }) => {
    whenResolveAbsolute(when);
    then(/^the resolved date should be null$/, () => {
      expect(resolvedDate).toBeNull();
    });
  });

  test('A YYYY-MM-DD date converts to a local-noon epoch', ({ when, then }) => {
    whenNormalize(when);
    then(
      /^the normalized date should be local noon on (\d{4})-(\d{2})-(\d{2})$/,
      (y: string, mo: string, d: string) => {
        const expected = new Date(
          Number(y),
          Number(mo) - 1,
          Number(d),
          12, 0, 0, 0
        ).getTime();
        expect(normalized.occurredAt).toBe(expected);
      }
    );
  });

  test('A non-date occurredOn normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized occurredAt should be null$/, () => {
      expect(normalized.occurredAt).toBeNull();
    });
  });

  test('An impossible date normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized occurredAt should be null$/, () => {
      expect(normalized.occurredAt).toBeNull();
    });
  });

  test('Confidence is clamped to the 0..1 range', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized confidence should be (\d+)$/, (val: string) => {
      expect(normalized.confidence).toBe(parseInt(val, 10));
    });
  });

  test('A missing or malformed confidence defaults to zero', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized confidence should be (\d+)$/, (val: string) => {
      expect(normalized.confidence).toBe(parseInt(val, 10));
    });
  });

  test('A parse with a positive amount is useful', ({ when, then }) => {
    when(/^I check usefulness of a parse with amount (\d+)$/, (val: string) => {
      useful = isUsefulDeviceParse({ amount: parseInt(val, 10) });
    });
    then(/^the parse should be useful$/, () => {
      expect(useful).toBe(true);
    });
  });

  test('A parse with no amount is not useful', ({ when, then }) => {
    when(/^I check usefulness of a parse with amount null$/, () => {
      useful = isUsefulDeviceParse({ amount: null });
    });
    then(/^the parse should not be useful$/, () => {
      expect(useful).toBe(false);
    });
  });

  test('A parse with a zero amount is not useful', ({ when, then }) => {
    when(/^I check usefulness of a parse with amount (\d+)$/, (val: string) => {
      useful = isUsefulDeviceParse({ amount: parseInt(val, 10) });
    });
    then(/^the parse should not be useful$/, () => {
      expect(useful).toBe(false);
    });
  });

  test('A null parse is not useful', ({ when, then }) => {
    when(/^I check usefulness of a null parse$/, () => {
      useful = isUsefulDeviceParse(null);
    });
    then(/^the parse should not be useful$/, () => {
      expect(useful).toBe(false);
    });
  });
});

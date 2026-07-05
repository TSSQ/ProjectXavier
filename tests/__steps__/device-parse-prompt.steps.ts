import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category, Payee, TransactionType } from '../../src/domain/types';
import {
  deviceParseSchema,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
  normalizeDeviceParseOutput,
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
    occurredAt: 1735689600000,
    confidence: 0.9,
  };
}

/** A schema-valid parse where the model knew nothing. */
function allNullParse(): Record<string, unknown> {
  return {
    amount: null,
    currency: null,
    type: null,
    category: null,
    payee: null,
    account: null,
    note: null,
    occurredAt: null,
    confidence: 0,
  };
}

defineFeature(feature, (test) => {
  let categories: Category[] = [];
  let payees: Payee[] = [];
  let prompt: string;
  let instructions: string;
  let schemaAccepted: boolean;
  let normalized: NormalizedDeviceParse;

  beforeEach(() => {
    categories = [];
    payees = [];
  });

  test('The guided-generation schema accepts an all-unknown (null) parse', ({
    when,
    then,
  }) => {
    when(/^the model returns an all-null parse with confidence 0$/, () => {
      schemaAccepted = deviceParseSchema.safeParse(allNullParse()).success;
    });
    then(/^the guided-generation schema should accept it$/, () => {
      expect(schemaAccepted).toBe(true);
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
        prompt = buildDeviceParsePrompt(text, { categories, payees, now: parseInt(now, 10) });
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

  test('The prompt omits hints when there are no known categories or payees', ({
    when,
    then,
    and,
  }) => {
    when(
      /^I build the device parse prompt for "(.*)" at time (\d+)$/,
      (text: string, now: string) => {
        prompt = buildDeviceParsePrompt(text, { categories, payees, now: parseInt(now, 10) });
      }
    );
    then(/^the prompt should not mention "(.*)"$/, (snippet: string) => {
      expect(prompt).not.toContain(snippet);
    });
    and(/^the prompt should not mention "(.*)"$/, (snippet: string) => {
      expect(prompt).not.toContain(snippet);
    });
  });

  test('The instructions ask for null (not sentinels) on unknown fields', ({
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

  test('A real amount normalizes unchanged', ({ when, then }) => {
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

  test('A numeric occurredAt passes through', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized occurredAt should be (\d+)$/, (val: string) => {
      expect(normalized.occurredAt).toBe(parseInt(val, 10));
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
});

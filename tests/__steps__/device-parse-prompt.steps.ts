import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category, Payee, TransactionType } from '../../src/domain/types';
import {
  isDeviceParseAvailable,
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

defineFeature(feature, (test) => {
  let categories: Category[] = [];
  let payees: Payee[] = [];
  let available: boolean;
  let prompt: string;
  let normalized: NormalizedDeviceParse;

  beforeEach(() => {
    categories = [];
    payees = [];
  });

  test('The "available" state means the device can run Foundation Models', ({
    when,
    then,
  }) => {
    when(/^I check device parse availability for "(.*)"$/, (state: string) => {
      available = isDeviceParseAvailable(state);
    });
    then(/^the device should be usable for parsing$/, () => {
      expect(available).toBe(true);
    });
  });

  test('"appleIntelligenceNotEnabled" means the device cannot run it', ({
    when,
    then,
  }) => {
    when(/^I check device parse availability for "(.*)"$/, (state: string) => {
      available = isDeviceParseAvailable(state);
    });
    then(/^the device should not be usable for parsing$/, () => {
      expect(available).toBe(false);
    });
  });

  test('"modelNotReady" means the device cannot run it', ({ when, then }) => {
    when(/^I check device parse availability for "(.*)"$/, (state: string) => {
      available = isDeviceParseAvailable(state);
    });
    then(/^the device should not be usable for parsing$/, () => {
      expect(available).toBe(false);
    });
  });

  test('"unavailable" means the device cannot run it', ({ when, then }) => {
    when(/^I check device parse availability for "(.*)"$/, (state: string) => {
      available = isDeviceParseAvailable(state);
    });
    then(/^the device should not be usable for parsing$/, () => {
      expect(available).toBe(false);
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

  test('A sentinel amount normalizes to null', ({ when, then }) => {
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

  test('A recognised type passes through', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized type should be "(.*)"$/, (type: string) => {
      expect(normalized.type).toBe(type);
    });
  });

  test('The "unknown" type sentinel normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized type should be null$/, () => {
      expect(normalized.type).toBeNull();
    });
  });

  test('A garbage type value normalizes to null', ({ when, then }) => {
    whenNormalize(when);
    then(/^the normalized type should be null$/, () => {
      expect(normalized.type).toBeNull();
    });
  });

  test('A sentinel occurredAt normalizes to null', ({ when, then }) => {
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
});

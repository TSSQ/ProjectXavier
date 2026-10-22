import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { workedExamplesFromMemory, formatWorkedExample, WorkedExample } from '../../src/domain/workedExamples';
import { PhraseMemoryRow, PhraseVerdict } from '../../src/domain/phraseMemory';
import { buildCloudParsePrompt, buildFmParsePrompt, DeviceParseContext } from '../../src/domain/deviceParsePrompt';
import { Account, Category, Payee, TransactionType } from '../../src/domain/types';
import { EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared';

const feature = loadFeature(path.resolve(__dirname, '../__features__/byok-worked-examples.feature'));

const cat = (name: string, kind: Category['kind'] = 'expense'): Category => ({ id: `c-${name}`, name, kind });
const CATEGORIES: Category[] = [
  cat('Food'),
  cat('Transport'),
  cat('Gifts'),
  cat('Groceries'),
  cat('Bills'),
  cat('Salary', 'income'),
];
const PAYEES: Payee[] = ['Ya Kun', 'Grab', 'FairPrice', 'Netflix'].map((name) => ({ id: `p-${name}`, name }));
const ACCOUNTS: Account[] = ['Cash', 'DBS', 'Citi'].map(
  (name) => ({ id: `a-${name}`, name, currency: 'SGD', openingBalance: 0 }) as Account
);
const LISTS = { categories: CATEGORIES, payees: PAYEES, accounts: ACCOUNTS };
const NOW = Date.UTC(2026, 9, 22, 4);

type Row = { key: string; verdict: string; type: string; category: string; payee: string; account: string; lastUsedAt: string };

/** A name that is not in the lists ("Deleted") stands for an entity deleted since. */
const idFor = (list: ReadonlyArray<{ id: string; name: string }>, name: string): string | null =>
  name.trim() ? (list.find((e) => e.name === name.trim())?.id ?? 'deleted-id') : null;

function toRow(r: Row): PhraseMemoryRow {
  return {
    key: r.key.trim(),
    verdict: (r.verdict.trim() || null) as PhraseVerdict | null,
    type: (r.type.trim() || null) as TransactionType | null,
    categoryId: idFor(CATEGORIES, r.category),
    payeeId: idFor(PAYEES, r.payee),
    accountId: idFor(ACCOUNTS, r.account),
    hits: 1,
    reverts: 0,
    lastUsedAt: Number(r.lastUsedAt),
    updatedAt: Number(r.lastUsedAt),
  };
}

function ctx(examples?: readonly WorkedExample[]): DeviceParseContext & { workedExamples?: readonly WorkedExample[] } {
  return { ...LISTS, now: NOW, ...(examples ? { workedExamples: examples } : {}) };
}

defineFeature(feature, (test) => {
  let rows: PhraseMemoryRow[];
  let examples: WorkedExample[];
  let cloud: string;
  let other: string;
  let onDevice: string;

  const givenRows = (given: (m: string, fn: (t: Row[]) => void) => void) =>
    given('phrase memory with these rows:', (table: Row[]) => {
      rows = table.map(toRow);
    });

  const thenExamples = (then: (m: string, fn: (t: Array<{ example: string }>) => void) => void) =>
    then('the examples should be:', (table: Array<{ example: string }>) => {
      expect(examples.map(formatWorkedExample)).toEqual(table.map((t) => t.example.trim()));
    });

  test('The most recently used transaction phrases become examples, at most five', ({ given, when, then }) => {
    givenRows(given);
    when('I take the worked examples', () => {
      examples = workedExamplesFromMemory(rows, LISTS);
    });
    thenExamples(then);
  });

  test('The phrase being parsed is never its own example, and a deleted entity is left out', ({ given, when, then }) => {
    givenRows(given);
    when(/^I take the worked examples excluding "(.*)"$/, (key: string) => {
      examples = workedExamplesFromMemory(rows, LISTS, { excludeKey: key });
    });
    thenExamples(then);
  });

  test('No examples leave the cloud prompt byte-identical', ({ when, then, and }) => {
    when(/^I build the cloud prompt for "(.*)" without examples and with an empty list$/, (text: string) => {
      cloud = buildCloudParsePrompt(text, ctx());
      other = buildCloudParsePrompt(text, ctx([]));
    });
    then('the two cloud prompts should be identical', () => {
      expect(other).toBe(cloud);
    });
    and(/^the cloud prompt should not contain "(.*)"$/, (s: string) => {
      expect(cloud).not.toContain(s);
    });
  });

  test('Examples go into the cloud prompt and never the on-device prompt', ({ given, when, then, and }) => {
    let text: string;
    givenRows(given);
    when(/^I build the cloud and on-device prompts for "(.*)" with the worked examples$/, (t: string) => {
      text = t;
      examples = workedExamplesFromMemory(rows, LISTS);
      cloud = buildCloudParsePrompt(text, ctx(examples));
      onDevice = buildFmParsePrompt(text, ctx(examples));
    });
    then(/^the cloud prompt should contain "(.*)"$/, (s: string) => {
      expect(cloud).toContain(s);
    });
    and(/^the cloud prompt should end with the on-device prompt for "(.*)"$/, (t: string) => {
      expect(cloud.endsWith(buildFmParsePrompt(t, ctx()))).toBe(true);
    });
    and(/^the on-device prompt should not contain "(.*)"$/, (s: string) => {
      expect(onDevice).not.toContain(s);
      expect(onDevice).toBe(buildFmParsePrompt(text, ctx()));
    });
    and("the expense contract's prompt should equal the cloud prompt", () => {
      expect(EXPENSE_PARSE_CONTRACT.buildPrompt(text, { ...ctx(examples), currency: 'SGD' })).toBe(cloud);
    });
  });
});

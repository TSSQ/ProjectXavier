/**
 * BDD suite for the question-term half of src/domain/phraseMemory.ts and its
 * write sequence (src/features/phraseMemory/remember.ts) over a fake store.
 */
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  PhraseMemoryRow,
  QueryTermScope,
  lookup,
  queryTermId,
  queryTermKey,
} from '../../src/domain/phraseMemory';
import { PhraseMemoryStore, rememberQueryTerm, rememberRevert } from '../../src/features/phraseMemory/remember';

const feature = loadFeature(path.resolve(__dirname, '../__features__/query-term-memory.feature'));

const ids: Record<string, string> = { Dining: 'cat-dining', Groceries: 'cat-groceries', Salary: 'cat-salary' };

function fakeStore(): PhraseMemoryStore & { rows: Map<string, PhraseMemoryRow> } {
  const rows = new Map<string, PhraseMemoryRow>();
  return {
    rows,
    get: async (key) => rows.get(key) ?? null,
    put: async (row) => void rows.set(row.key, row),
    remove: async (key) => void rows.delete(key),
    list: async () => [...rows.values()],
  };
}

type Fns = Record<string, (re: RegExp, fn: (...args: string[]) => unknown) => void>;

defineFeature(feature, (test) => {
  let store: ReturnType<typeof fakeStore>;
  let clock = 0;
  const stepTable = () => {
    const steps: Array<[string, RegExp, (...a: string[]) => unknown]> = [
      ['given', /^an empty phrase memory$/, () => void (store = fakeStore())],
      [
        'then',
        /^the (expense|payee) key for "(.*)" is "(.*)"$/,
        (scope, term, key) => expect(queryTermKey(scope as QueryTermScope, term!)).toBe(key),
      ],
      [
        'when',
        /^I pick "(.*)" for the (expense|income) word "(.*)"$/,
        (name, scope, term) => rememberQueryTerm(store, scope as QueryTermScope, term!, ids[name!]!, ++clock),
      ],
      ['when', /^I revert the word "(.*)"$/, (term) => rememberRevert(store, queryTermKey('expense', term!), ++clock)],
      [
        'then',
        /^the word "(.*)" reads as "(.*)" with (\d+) hits?$/,
        (term, name, hits) => {
          const row = store.rows.get(queryTermKey('expense', term!));
          expect(queryTermId(row, 'expense')).toBe(ids[name!]);
          expect(row?.hits).toBe(Number(hits));
        },
      ],
      ['then', /^the word "(.*)" is forgotten$/, (term) => expect(store.rows.has(queryTermKey('expense', term!))).toBe(false)],
      ['then', /^looking up the transaction phrase "(.*)" finds nothing$/, (key) => expect(lookup(key!, [...store.rows.values()])).toBeNull()],
      [
        'then',
        /^the expense word "(.*)" has no memory$/,
        (term) => {
          expect(store.rows.get(queryTermKey('expense', term!))).toBeUndefined();
          expect(queryTermId(store.rows.get(queryTermKey('income', term!)), 'expense')).toBeNull();
        },
      ],
    ];
    return steps;
  };
  for (const scenario of feature.scenarios) {
    test(scenario.title, (fns) => {
      const table = stepTable();
      for (const step of scenario.steps) {
        const found = table.find(([, re]) => re.test(step.stepText));
        if (!found) throw new Error(`no step for: ${step.stepText}`);
        const [, re, fn] = found;
        (fns as unknown as Fns)[step.keyword]!(re, () => fn(...re.exec(step.stepText)!.slice(1)));
      }
    });
  }
});

/**
 * BDD suite for src/domain/queryFilterResolution.ts through the real tool
 * executors (src/domain/queryTools.ts) and the deterministic caption.
 * Steps are bound by pattern: every scenario's steps (Background included)
 * are matched against the table below in order.
 */
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { executeQueryTool, QueryToolCall, QueryToolContext, QueryToolName } from '../../src/domain/queryTools';
import { buildDeterministicQueryCaption } from '../../src/domain/queryCaption';
import { FilterDimension, FilterResolution, explainFilter, filtersOfResult } from '../../src/domain/queryFilterResolution';
import { PhraseMemoryRow, queryTermKey, queryTermPatch } from '../../src/domain/phraseMemory';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/query-filter-resolution.feature'));

const NOW = Date.UTC(2026, 6, 15, 12);
const THIS_MONTH = Date.UTC(2026, 6, 5);
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const minor = (s: string) => Math.round(parseFloat(s) * 100);

interface World {
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  transactions: Transaction[];
  memory: PhraseMemoryRow[];
  call: QueryToolCall | null;
  result: unknown;
}

function fresh(): World {
  return { categories: [], payees: [], accounts: [], transactions: [], memory: [], call: null, result: null };
}

function spend(w: World, type: 'expense' | 'income', amount: number, categoryId: string) {
  w.transactions.push({
    id: `tx-${w.transactions.length + 1}`,
    accountId: 'acc-cash',
    type,
    amount,
    currency: 'SGD',
    categoryId,
    occurredAt: THIS_MONTH,
    createdAt: THIS_MONTH,
    source: 'manual',
    pending: false,
  });
}

function ask(w: World, tool: QueryToolName, dim: FilterDimension, term: string) {
  const params: Record<string, unknown> = { period: 'this_month', [dim]: term };
  if (tool === 'spending_over_time') params.granularity = 'week';
  if (tool === 'search_transactions') params.limit = 20;
  w.call = { tool, params } as QueryToolCall;
  const ctx: QueryToolContext = {
    accounts: w.accounts,
    transactions: w.transactions,
    categories: w.categories,
    payees: w.payees,
    now: NOW,
    termMemory: w.memory,
  };
  w.result = executeQueryTool(ctx, w.call);
}

const filterOf = (w: World, dim: FilterDimension): FilterResolution | undefined =>
  filtersOfResult(w.result).find((f) => f.dim === dim);
const teach = (w: World, term: string, id: string) => {
  const key = queryTermKey('expense', term);
  w.memory.push(queryTermPatch(key, 'expense', id, null, NOW)!);
};

type Handler = (w: World, ...args: string[]) => void;
const STEPS: Array<[RegExp, Handler]> = [
  [
    /^the expense categories "(.*)"$/,
    (w, names) => {
      w.categories = [
        ...w.categories.filter((c) => c.kind !== 'expense'),
        ...list(names).map((n) => ({ id: `cat-${slug(n)}`, name: n, kind: 'expense' as const })),
      ];
    },
  ],
  [
    /^the income categories "(.*)"$/,
    (w, names) => {
      w.categories.push(...list(names).map((n) => ({ id: `cat-${slug(n)}`, name: n, kind: 'income' as const })));
    },
  ],
  [/^the payees "(.*)"$/, (w, names) => void (w.payees = list(names).map((n) => ({ id: `pay-${slug(n)}`, name: n })))],
  [
    /^the accounts "(.*)"$/,
    (w, names) => void (w.accounts = list(names).map((n) => ({ id: `acc-${slug(n)}`, name: n, currency: 'SGD', openingBalance: 0 }))),
  ],
  [
    /^this month I spent (.*)$/,
    (w, rest) => {
      for (const part of rest.split(/,| and /).map((p) => p.trim()).filter(Boolean)) {
        const [, amount, name] = /^([\d.]+) on (.+)$/.exec(part)!;
        spend(w, 'expense', minor(amount!), `cat-${slug(name!)}`);
      }
    },
  ],
  [/^this month I earned ([\d.]+) from (.+)$/, (w, amount, name) => spend(w, 'income', minor(amount!), `cat-${slug(name!)}`)],
  [
    /^the expense category "(.*)" under "(.*)" with ([\d.]+) spent this month$/,
    (w, name, parent, amount) => {
      w.categories.push({ id: `cat-${slug(name!)}`, name: name!, kind: 'expense', parentId: `cat-${slug(parent!)}` });
      spend(w, 'expense', minor(amount!), `cat-${slug(name!)}`);
    },
  ],
  [/^I taught "(.*)" to mean a deleted category$/, (w, term) => teach(w, term!, 'cat-deleted')],
  [/^I taught "(.*)" to mean "(.*)"$/, (w, term, name) => teach(w, term!, `cat-${slug(name!)}`)],
  [
    /^I ask (\w+) with (category|payee|account) "(.*)"$/,
    (w, tool, dim, term) => ask(w, tool as QueryToolName, dim as FilterDimension, term!),
  ],
  [
    /^the (category|payee|account) resolves "(\w+)" to "(.*)"$/,
    (w, dim, how, names) => {
      const f = filterOf(w, dim as FilterDimension);
      expect(f?.how).toBe(how);
      expect(f?.names.join(' + ')).toBe(names);
    },
  ],
  [/^there is no category filter$/, (w) => expect(filterOf(w, 'category')).toBeUndefined()],
  [/^the category does not resolve to "(.*)"$/, (w, name) => expect(filterOf(w, 'category')?.names ?? []).not.toContain(name)],
  [/^the category does not include "(.*)"$/, (w, name) => expect(filterOf(w, 'category')?.names ?? []).not.toContain(name)],
  [
    /^the total is ([\d.]+) with no notes$/,
    (w, amount) => {
      const r = w.result as { amountMinor: number; notes: string[] };
      expect(r.amountMinor).toBe(minor(amount!));
      expect(r.notes).toEqual([]);
    },
  ],
  [
    /^the total is ([\d.]+) with the note "(.*)"$/,
    (w, amount, note) => {
      const r = w.result as { amountMinor: number; notes: string[] };
      expect(r.amountMinor).toBe(minor(amount!));
      expect(r.notes).toEqual([note]);
    },
  ],
  [/^the caption reads "(.*)"$/, (w, caption) => expect(buildDeterministicQueryCaption(w.call!, w.result)).toBe(caption)],
  [
    /^the card line reads "(.*)"$/,
    (w, line) => expect(filtersOfResult(w.result).map((f) => explainFilter(f).line)).toContain(line),
  ],
  [
    /^the card offers the chips "(.*)"$/,
    (w, chips) => expect(filtersOfResult(w.result).flatMap((f) => explainFilter(f).chips.map((c) => c.label))).toEqual(list(chips)),
  ],
  [
    /^the trend sums to ([\d.]+)$/,
    (w, amount) => {
      const r = w.result as { series: Array<{ amountMinor: number }> };
      expect(r.series.reduce((sum, p) => sum + p.amountMinor, 0)).toBe(minor(amount!));
    },
  ],
  [/^the search returns (\d+) rows$/, (w, n) => expect((w.result as { rows: unknown[] }).rows).toHaveLength(Number(n))],
];

defineFeature(feature, (test) => {
  for (const scenario of feature.scenarios) {
    test(scenario.title, (fns) => {
      const w = fresh();
      for (const step of scenario.steps) {
        const found = STEPS.find(([re]) => re.test(step.stepText));
        if (!found) throw new Error(`no step for: ${step.stepText}`);
        const [re, handler] = found;
        const bind = (fns as unknown as Record<string, (text: RegExp, fn: () => void) => void>)[step.keyword]!;
        bind(re, () => handler(w, ...re.exec(step.stepText)!.slice(1)));
      }
    });
  }
});

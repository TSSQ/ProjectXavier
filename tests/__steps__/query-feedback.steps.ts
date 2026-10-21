/**
 * BDD suite for src/domain/queryFeedback.ts, the question case of
 * src/domain/parseCorrection.ts (through the real evals/corrections/fold.mjs
 * --validate), the questions block of aggregateByEngine, and the additive
 * wrong_dims migration. Steps are bound by pattern, Background included.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { executeQueryTool, QueryToolCall, QueryToolName } from '../../src/domain/queryTools';
import { filtersOfResult, resolvedLabel } from '../../src/domain/queryFilterResolution';
import {
  QueryFeedbackChoice,
  answerFigure,
  appliedEntities,
  callPeriod,
  correctedCall,
  mergeWrongDims,
  parseWrongDims,
  periodToken,
  wrongDimensions,
  wrongDimsValue,
  FeedbackPeriod,
} from '../../src/domain/queryFeedback';
import {
  QuestionCorrectionCase,
  buildQuestionCorrectionCase,
  parseCorrectionsText,
  serializeQuestionCorrectionLine,
} from '../../src/domain/parseCorrection';
import { AggregateRow, aggregateByEngine } from '../../src/domain/parseMetrics';
import { runMigrations, MigrationDriver } from '../../src/db/migrationPlan';
import { Account, Category, Payee, Transaction } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/query-feedback.feature'));
const REPO_ROOT = path.resolve(__dirname, '../..');
const FOLD_SCRIPT = path.join(REPO_ROOT, 'evals', 'corrections', 'fold.mjs');

const NOW = Date.UTC(2026, 6, 15, 12);
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const minor = (s: string) => Math.round(parseFloat(s) * 100);

interface World {
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  transactions: Transaction[];
  original: QueryToolCall | null;
  choice: QueryFeedbackChoice;
  built: QuestionCorrectionCase | null;
  rows: AggregateRow[];
  db: DatabaseSync | null;
}

const fresh = (): World => ({
  categories: [],
  payees: [],
  accounts: [{ id: 'acc-cash', name: 'Cash', currency: 'SGD', openingBalance: 0 }],
  transactions: [],
  original: null,
  choice: {},
  built: null,
  rows: [],
  db: null,
});

const ctxOf = (w: World, pinned?: { dim: 'category' | 'payee'; id: string }) => ({
  accounts: w.accounts,
  transactions: w.transactions,
  categories: w.categories,
  payees: w.payees,
  now: NOW,
  ...(pinned ? { pinned } : {}),
});

const appliedIds = (w: World) => appliedEntities(filtersOfResult(executeQueryTool(ctxOf(w), w.original!)));

function build(w: World): QuestionCorrectionCase {
  const before = executeQueryTool(ctxOf(w), w.original!);
  const { call, pinned } = correctedCall(w.original!, w.choice);
  const after = executeQueryTool(ctxOf(w, pinned), call);
  const named = (dim: 'category' | 'payee') => resolvedLabel(filtersOfResult(after).find((f) => f.dim === dim) ?? null) ?? null;
  return buildQuestionCorrectionCase({
    text: 'how much did I spend on food',
    categories: w.categories,
    payeeNames: w.payees.map((p) => p.name),
    accounts: w.accounts,
    now: NOW,
    nonce: 'abc123',
    question: {
      engine: 'on_device',
      call: w.original as { tool: QueryToolName; params: Record<string, unknown> },
      filters: filtersOfResult(before).map((f) => ({ dim: f.dim, term: f.term, how: f.how, names: f.names })),
      corrected: call as { tool: QueryToolName; params: Record<string, unknown> },
      dimensions: wrongDimensions(w.original!, w.choice, appliedIds(w)),
      expect: {
        expectTool: call.tool,
        expectPeriod: w.choice.period === 'other' ? 'other' : periodToken(callPeriod(call)),
        expectCategory: named('category'),
        expectPayee: named('payee'),
      },
      answer: { before: answerFigure(w.original!.tool, before), after: answerFigure(call.tool, after) },
    },
  });
}

function driverFor(db: DatabaseSync): MigrationDriver {
  return {
    execDdl: async (sql) => void db.exec(sql),
    execAlter: async (sql) => void db.exec(sql),
    columnNames: async (table) =>
      new Set((db.prepare(`PRAGMA table_info(${table});`).all() as unknown as { name: string }[]).map((r) => r.name)),
  };
}

const metricRow = (engine: string, wrongDims: string | null): AggregateRow => ({
  engine,
  outcome: 'answered',
  intent: 'query',
  resolved: null,
  payeeSwapped: null,
  confidenceBucket: null,
  latencyMs: null,
  edited: 0,
  editedAmount: null,
  editedType: null,
  editedPayee: null,
  editedCategory: null,
  editedDate: null,
  wrongDims,
});

const expectCall = (w: World, tool: string, period: string, filter: Record<string, string>) => {
  const { call } = correctedCall(w.original!, w.choice);
  expect(call.tool).toBe(tool);
  const p = call.params as Record<string, unknown>;
  expect(p.period).toBe(period);
  expect({ category: p.category, payee: p.payee }).toEqual({ category: filter.category, payee: filter.payee });
};

type Handler = (w: World, ...args: string[]) => unknown;
const STEPS: Array<[RegExp, Handler]> = [
  [
    /^the expense categories "(.*)"$/,
    (w, names) => void (w.categories = list(names!).map((n) => ({ id: `cat-${slug(n)}`, name: n, kind: 'expense' as const }))),
  ],
  [/^the payees "(.*)"$/, (w, names) => void (w.payees = list(names!).map((n) => ({ id: `pay-${slug(n)}`, name: n })))],
  [
    /^this month I spent (.*)$/,
    (w, rest) => {
      for (const part of rest!.split(' and ')) {
        const [, amount, cat, payee] = /^([\d.]+) on (.+) at (.+)$/.exec(part.trim())!;
        w.transactions.push({
          id: `tx-${w.transactions.length + 1}`,
          accountId: 'acc-cash',
          type: 'expense',
          amount: minor(amount!),
          currency: 'SGD',
          categoryId: `cat-${slug(cat!)}`,
          payeeId: `pay-${slug(payee!)}`,
          occurredAt: Date.UTC(2026, 6, 5),
          createdAt: Date.UTC(2026, 6, 5),
          source: 'manual',
          pending: false,
        });
      }
    },
  ],
  [
    /^the question was total_spent this_month with category "(.*)"$/,
    (w, term) => void (w.original = { tool: 'total_spent', params: { period: 'this_month', category: term } }),
  ],
  [
    /^the question was total_spent (\w+) with no filter$/,
    (w, period) => void (w.original = { tool: 'total_spent', params: { period: period as 'last_month' } }),
  ],
  [
    /^a net_worth trend with no period ran for "(.*)"$/,
    (_w, period) => expect(callPeriod({ tool: 'net_worth', params: { series: true } })).toBe(period),
  ],
  [
    /^the expense category "(.*)" under "(.*)"$/,
    (w, name, parent) =>
      void w.categories.push({ id: `cat-${slug(name!)}`, name: name!, kind: 'expense', parentId: `cat-${slug(parent!)}` }),
  ],
  [
    /^merging "(.*)" with "(.*)" gives "(.*)"$/,
    (_w, a, b, out) => expect(mergeWrongDims(a, parseWrongDims(b))).toBe(out),
  ],
  [/^I say the period should be "(.*)"$/, (w, p) => void (w.choice = { period: p as FeedbackPeriod })],
  [
    /^I say the category should be "(.*)"$/,
    (w, name) => void (w.choice = { filter: { dim: 'category', id: `cat-${slug(name!)}`, name: name! } }),
  ],
  [/^I say there should be no filter$/, (w) => void (w.choice = { filter: { dim: 'category', id: null, name: null } })],
  [/^I say the tool should be "(\w+)"$/, (w, t) => void (w.choice = { tool: t as QueryToolName })],
  [
    /^I say the tool should be "(\w+)" and the period "(\w+)"$/,
    (w, t, p) => void (w.choice = { tool: t as QueryToolName, period: p as FeedbackPeriod }),
  ],
  [
    /^the wrong dimensions are "(.*)"$/,
    (w, dims) => expect(wrongDimsValue(wrongDimensions(w.original!, w.choice, appliedIds(w)))).toBe(dims),
  ],
  [
    /^the corrected call is (\w+) (\w+) with category "(.*)"$/,
    (w, tool, period, term) => expectCall(w, tool!, period!, { category: term! }),
  ],
  [/^the corrected call is (\w+) (\w+) with no filter$/, (w, tool, period) => expectCall(w, tool!, period!, {})],
  [
    /^the corrected call is net_worth as of (\w+)$/,
    (w, period) => expect(correctedCall(w.original!, w.choice).call).toEqual({ tool: 'net_worth', params: { asOf: period } }),
  ],
  [
    /^the corrected call pins category "(.*)"$/,
    (w, name) => expect(correctedCall(w.original!, w.choice).pinned).toEqual({ dim: 'category', id: `cat-${slug(name!)}` }),
  ],
  [
    /^re-running it answers ([\d.]+)$/,
    (w, amount) => {
      const { call, pinned } = correctedCall(w.original!, w.choice);
      expect((executeQueryTool(ctxOf(w, pinned), call) as { amountMinor: number }).amountMinor).toBe(minor(amount!));
    },
  ],
  [
    /^the figure of a total_spent of ([\d.]+) is ([\d.]+) with no items$/,
    (_w, a, b) => expect(answerFigure('total_spent', { amountMinor: minor(a!), count: 2, notes: [] })).toEqual({ amountMinor: minor(b!), items: null }),
  ],
  [
    /^the figure of a top_payees list of ([\d.]+) and ([\d.]+) is ([\d.]+) over (\d+) items$/,
    (_w, a, b, sum, n) =>
      expect(answerFigure('top_payees', { rows: [{ amountMinor: minor(a!) }, { amountMinor: minor(b!) }], notes: [] })).toEqual({
        amountMinor: minor(sum!),
        items: Number(n),
      }),
  ],
  [
    /^the figure of a net_worth trend ending at ([\d.]+) is ([\d.]+) over (\d+) items$/,
    (_w, end, b, n) =>
      expect(
        answerFigure('net_worth', { series: [{ amountMinor: 1 }, { amountMinor: 2 }, { amountMinor: minor(end!) }], notes: [] })
      ).toEqual({ amountMinor: minor(b!), items: Number(n) }),
  ],
  [
    /^the figure of a search_transactions list of (\d+) rows has no amount over (\d+) items$/,
    (_w, rows, n) =>
      expect(answerFigure('search_transactions', { rows: Array.from({ length: Number(rows) }, () => ({ amountMinor: 5 })) })).toEqual({
        amountMinor: null,
        items: Number(n),
      }),
  ],
  [/^I build the question correction$/, (w) => void (w.built = build(w))],
  [/^it validates with the id prefix "(.*)"$/, (w, prefix) => expect(w.built!.id.startsWith(prefix!)).toBe(true)],
  [
    /^its expect block reads tool "(.*)", period "(.*)", category "(.*)"$/,
    (w, tool, period, category) =>
      expect(w.built!.question.expect).toEqual({ expectTool: tool, expectPeriod: period, expectCategory: category, expectPayee: null }),
  ],
  [
    /^its answer went from ([\d.]+) to ([\d.]+)$/,
    (w, a, b) => {
      expect(w.built!.question.answer.before.amountMinor).toBe(minor(a!));
      expect(w.built!.question.answer.after.amountMinor).toBe(minor(b!));
    },
  ],
  [
    /^reading the corrections file back returns it as a question, not a transaction case$/,
    (w) => {
      const parsed = parseCorrectionsText(serializeQuestionCorrectionLine(w.built!) + '\n');
      expect(parsed).toEqual({ cases: [], questions: [w.built], invalid: 0 });
    },
  ],
  [
    /^the fold script leaves a file holding it to the question fold, naming it a question correction$/,
    (w) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'question-fold-'));
      try {
        const file = path.join(dir, 'corrections.jsonl');
        fs.writeFileSync(file, serializeQuestionCorrectionLine(w.built!) + '\n');
        // evals/questions.jsonl now exists (question eval D2): fold.mjs sets
        // the line aside for evals/corrections/fold-questions.mjs, folding
        // nothing into the transaction dataset and failing nothing.
        const out = execFileSync('node', [FOLD_SCRIPT, '--validate', file], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        expect(out).toContain('question correction');
        expect(out).toContain('fold-questions.mjs');
        expect(out).toContain('0 valid correction(s)');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  ],
  [
    /^a question correction with an unknown tool is rejected$/,
    (w) => {
      w.original = { tool: 'total_spent', params: { period: 'this_month' } };
      const good = build(w);
      const bad = { ...good, question: { ...good.question, corrected: { tool: 'guess_answer', params: {} } } };
      expect(() => serializeQuestionCorrectionLine(bad as unknown as QuestionCorrectionCase)).toThrow();
      expect(parseCorrectionsText(JSON.stringify(bad)).invalid).toBe(1);
    },
  ],
  [
    /^metrics rows: on_device answered 3 questions, one marked wrong with "(.*)", one with "(.*)"$/,
    (w, a, b) => void (w.rows = [metricRow('on_device', a!), metricRow('on_device', b!), metricRow('on_device', null)]),
  ],
  [
    /^the on_device questions block reads (\d+) questions, (\d+) wrong, tool (\d+), period (\d+), filter (\d+)$/,
    (w, count, wrong, tool, period, filter) =>
      expect(aggregateByEngine(w.rows).on_device!.questions).toEqual({
        count: Number(count),
        wrong: Number(wrong),
        wrongRate: Number(wrong) / Number(count),
        byDimension: { tool: Number(tool), period: Number(period), filter: Number(filter) },
      }),
  ],
  [
    /^a database migrated before the wrong_dims column existed$/,
    async (w) => {
      w.db = new DatabaseSync(':memory:');
      await runMigrations(driverFor(w.db));
      w.db.exec('ALTER TABLE parse_metrics DROP COLUMN wrong_dims');
    },
  ],
  [
    /^the migrations run twice$/,
    async (w) => {
      await runMigrations(driverFor(w.db!));
      await runMigrations(driverFor(w.db!));
    },
  ],
  [/^parse_metrics has a wrong_dims column$/, async (w) => expect((await driverFor(w.db!).columnNames('parse_metrics')).has('wrong_dims')).toBe(true)],
];

defineFeature(feature, (test) => {
  for (const scenario of feature.scenarios) {
    test(scenario.title, (fns) => {
      const w = fresh();
      for (const step of scenario.steps) {
        const found = STEPS.find(([re]) => re.test(step.stepText));
        if (!found) throw new Error(`no step for: ${step.stepText}`);
        const [re, handler] = found;
        const bind = (fns as unknown as Record<string, (text: RegExp, fn: () => unknown) => void>)[step.keyword]!;
        bind(re, () => handler(w, ...re.exec(step.stepText)!.slice(1)));
      }
    });
  }
});

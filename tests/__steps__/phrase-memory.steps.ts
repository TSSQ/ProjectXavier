import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Account, Category, Payee } from '../../src/domain/types';
import { TransactionDraft } from '../../src/domain/assistant';
import {
  PhraseMemoryRow,
  applyMemory,
  lookup,
  memoryForcesLog,
  memoryKeepsRefusal,
  phraseKey,
  revertLearnedPayee,
  revertLearnedType,
} from '../../src/domain/phraseMemory';
import { applyLearnedDefaults } from '../../src/domain/learnedDefaults';
import { classifyDeviceParse, FmParseOutcome } from '../../src/domain/fmRefusal';
import { finishFmParse } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { aggregateByEngine, phraseMemoryDetail, fmFallbackDetail, AggregateRow } from '../../src/domain/parseMetrics';
import {
  PhraseMemoryStore,
  rememberConfirmed,
  rememberRevert,
  rememberVerdict,
} from '../../src/features/phraseMemory/remember';
import { saveAssistantDraftWith, SaveAssistantDraftDeps } from '../../src/features/ai/saveDraftSequence';

const feature = loadFeature(path.resolve(__dirname, '../__features__/phrase-memory.feature'));

const NOW = new Date(2026, 9, 9, 12, 0, 0, 0).getTime();

const CATEGORIES: Category[] = [
  { id: 'cat-food', name: 'Food', kind: 'expense' },
  { id: 'cat-dining', name: 'Dining', kind: 'expense' },
  { id: 'cat-groceries', name: 'Groceries', kind: 'expense' },
  { id: 'cat-side', name: 'Side income', kind: 'income' },
] as Category[];
const ACCOUNTS: Account[] = [
  { id: 'acc-cash', name: 'Cash', currency: 'SGD', openingBalance: 0 },
  { id: 'acc-card', name: 'Card', currency: 'SGD', openingBalance: 0 },
] as Account[];
const BASE_PAYEES: Payee[] = [
  { id: 'pay-koufu', name: 'Koufu' },
  { id: 'pay-kopitiam', name: 'Kopitiam' },
] as Payee[];

const categoryId = (name: string) => CATEGORIES.find((c) => c.name === name)?.id ?? `missing-${name}`;
const payeeId = (name: string) => BASE_PAYEES.find((p) => p.name === name)!.id;
const accountId = (name: string) => ACCOUNTS.find((a) => a.name === name)!.id;

function row(partial: Partial<PhraseMemoryRow> & { key: string }): PhraseMemoryRow {
  return {
    verdict: null,
    type: null,
    categoryId: null,
    payeeId: null,
    accountId: null,
    hits: 1,
    reverts: 0,
    lastUsedAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

function draftFor(partial: Partial<TransactionDraft>): TransactionDraft {
  return {
    type: 'expense',
    amount: 1200,
    currency: 'SGD',
    accountId: 'acc-cash',
    categoryName: null,
    payeeName: null,
    note: null,
    occurredAt: NOW,
    source: 'ai',
    defaulted: { account: false, payee: true, category: false, date: false },
    ...partial,
  } as TransactionDraft;
}

/** An in-memory PhraseMemoryStore. */
function fakeStore(initial: PhraseMemoryRow[] = [], failing = false): PhraseMemoryStore & { rows: Map<string, PhraseMemoryRow> } {
  const rows = new Map(initial.map((r) => [r.key, r]));
  const guard = () => {
    if (failing) throw new Error('disk full');
  };
  return {
    rows,
    async get(key) {
      guard();
      return rows.get(key) ?? null;
    },
    async put(r) {
      guard();
      rows.set(r.key, r);
    },
    async remove(key) {
      guard();
      rows.delete(key);
    },
    async list() {
      guard();
      return [...rows.values()];
    },
  };
}

defineFeature(feature, (test) => {
  let rows: PhraseMemoryRow[] = [];
  let payees: Payee[] = [];
  let text = '';
  let draft: TransactionDraft;
  let result: TransactionDraft;
  let store: ReturnType<typeof fakeStore>;

  beforeEach(() => {
    rows = [];
    payees = BASE_PAYEES.map((p) => ({ ...p }));
    store = fakeStore();
  });

  const ctx = () => ({ categories: CATEGORIES, payees, accounts: ACCOUNTS, text });
  const apply = () => {
    result = applyMemory(draft, lookup(phraseKey(text, NOW), rows), ctx());
  };

  // ── givens shared across scenarios ──────────────────────────────────────
  const givenMemoryWith = (given: any) =>
    given(/^a memory for "(.*)" with (category|payee|account) "(.*)"$/, (key: string, field: string, value: string) => {
      rows = [
        row({
          key,
          ...(field === 'category' ? { categoryId: categoryId(value) } : {}),
          ...(field === 'payee' ? { payeeId: payeeId(value) } : {}),
          ...(field === 'account' ? { accountId: accountId(value) } : {}),
        }),
      ];
    });
  const givenTypedMemory = (given: any) =>
    given(/^a memory for "(.*)" with type "(.*)" and category "(.*)"$/, (key: string, type: string, cat: string) => {
      rows = [row({ key, type: type as 'income', categoryId: categoryId(cat) })];
    });
  const givenNoMemory = (given: any) => given('no phrase memories', () => (rows = []));
  const givenDraftWithCategory = (given: any) =>
    given(/^an engine draft for "(.*)" with category "(.*)"$/, (t: string, cat: string) => {
      text = t;
      draft = draftFor({ categoryName: cat });
    });
  const givenDraftWithCategoryAndPayee = (given: any) =>
    given(/^an engine draft for "(.*)" with category "(.*)" and payee "(.*)"$/, (t: string, cat: string, p: string) => {
      text = t;
      draft = draftFor({ categoryName: cat, payeeName: p, defaulted: { account: false, payee: false, category: false, date: false } });
    });
  const givenPayeeDefault = (given: any) =>
    given(/^the payee "(.*)" remembers category "(.*)"$/, (name: string, cat: string) => {
      payees = payees.map((p) => (p.name === name ? { ...p, defaultCategoryId: categoryId(cat) } : p));
    });
  const whenApplied = (when: any) => when('the memory is applied', apply);
  const whenAppliedThenDefaults = (when: any) =>
    when('the memory and then the payee defaults are applied', () => {
      apply();
      result = applyLearnedDefaults(result, { payees, categories: CATEGORIES, accounts: ACCOUNTS, text });
    });
  const thenCategoryFromPhrase = (then: any) =>
    then(/^the draft's category is "(.*)" from phrase memory, revertible to "(.*)"$/, (cat: string, engine: string) => {
      expect(result.categoryName).toBe(cat);
      expect(result.learnedCategory).toEqual({ engineCategoryName: engine, engineDefaulted: false, source: 'phrase' });
      expect(result.phraseMemoryKey).toBeDefined();
    });
  const thenCategoryUntouched = (then: any) =>
    then(/^the draft's category is "(.*)" with nothing learned$/, (cat: string) => {
      expect(result.categoryName).toBe(cat);
      expect(result.learnedCategory).toBeUndefined();
      expect(result.phraseMemoryKey).toBeUndefined();
    });
  const thenVerdict = (then: any) =>
    then(/^the memory for "(.*)" has verdict "(.*)"$/, (key: string, verdict: string) => {
      expect(store.rows.get(key)?.verdict).toBe(verdict);
    });

  // ── scenarios ───────────────────────────────────────────────────────────
  test('The key is the words without the amount, the currency, the date and punctuation', ({ then }) => {
    then(/^the phrase key of "(.*)" is "(.*)"$/, (t: string, key: string) => {
      expect({ t, key: phraseKey(t, NOW) }).toEqual({ t, key });
    });
  });

  test('A question mark does not make a new phrase', ({ then }) => {
    then(/^"(.*)" and "(.*)" share a phrase key$/, (a: string, b: string) => {
      expect(phraseKey(a, NOW)).toBe(phraseKey(b, NOW));
      expect(phraseKey(a, NOW)).not.toBe('');
    });
  });

  test('A memory is found by its exact key, else by one whole-word variant', ({ given, then }) => {
    given(/^phrase memories for "(.*)"$/, (keys: string) => {
      rows = keys.split(',').map((k) => row({ key: k.trim() }));
    });
    then(/^looking up "(.*)" finds "(.*)"$/, (key: string, found: string) => {
      expect({ key, found: lookup(key, rows)?.key ?? '' }).toEqual({ key, found });
    });
  });

  test("A remembered category replaces the engine's proposal and says so", ({ given, and, when, then }) => {
    givenMemoryWith(given);
    givenDraftWithCategory(and);
    whenApplied(when);
    thenCategoryFromPhrase(then);
  });

  test('A category the user typed wins over the memory', ({ given, and, when, then }) => {
    givenMemoryWith(given);
    givenDraftWithCategory(and);
    whenApplied(when);
    thenCategoryUntouched(then);
  });

  test("Phrase memory outranks the payee's learned default", ({ given, and, when, then }) => {
    givenMemoryWith(given);
    givenPayeeDefault(and);
    givenDraftWithCategoryAndPayee(and);
    whenAppliedThenDefaults(when);
    thenCategoryFromPhrase(then);
  });

  test("With no memory the payee's learned default still applies", ({ given, and, when, then }) => {
    givenNoMemory(given);
    givenPayeeDefault(and);
    givenDraftWithCategoryAndPayee(and);
    whenAppliedThenDefaults(when);
    then(/^the draft's category is "(.*)" from the payee's default$/, (cat: string) => {
      expect(result.categoryName).toBe(cat);
      expect(result.learnedCategory?.source).toBeUndefined();
      expect(result.learnedCategory?.engineCategoryName).toBe('Food');
    });
  });

  test('A remembered payee fills a draft the engine left without one', ({ given, and, when, then }) => {
    givenMemoryWith(given);
    and(/^an engine draft for "(.*)" with no payee$/, (t: string) => {
      text = t;
      draft = draftFor({});
    });
    whenApplied(when);
    then(/^the draft's payee is "(.*)" from phrase memory$/, (p: string) => {
      expect(result.payeeName).toBe(p);
      expect(result.defaulted.payee).toBe(false);
      expect(result.learnedPayee).toEqual({ enginePayeeName: null, engineDefaulted: true, source: 'phrase' });
    });
    when('the payee is reverted', () => {
      result = revertLearnedPayee(result);
    });
    then('the draft has no payee and nothing learned', () => {
      expect(result.payeeName).toBeNull();
      expect(result.defaulted.payee).toBe(true);
      expect(result.learnedPayee).toBeUndefined();
    });
  });

  test('A payee the user typed wins over the memory', ({ given, and, when, then }) => {
    givenMemoryWith(given);
    and(/^an engine draft for "(.*)" with payee "(.*)"$/, (t: string, p: string) => {
      text = t;
      draft = draftFor({ payeeName: p, defaulted: { account: false, payee: false, category: false, date: false } });
    });
    whenApplied(when);
    then(/^the draft's payee is "(.*)" with nothing learned$/, (p: string) => {
      expect(result.payeeName).toBe(p);
      expect(result.learnedPayee).toBeUndefined();
    });
  });

  test('A remembered account is used only when the engine named none', ({ given, and, when, then }) => {
    givenMemoryWith(given);
    and(/^an engine draft for "(.*)" on the default account$/, (t: string) => {
      text = t;
      draft = draftFor({ defaulted: { account: true, payee: true, category: false, date: false } });
    });
    whenApplied(when);
    then(/^the draft is on account "(.*)" from phrase memory$/, (name: string) => {
      expect(result.accountId).toBe(accountId(name));
      expect(result.learnedAccount).toEqual({
        engineAccountId: 'acc-cash',
        engineCurrency: 'SGD',
        engineMismatchedCurrency: null,
        source: 'phrase',
      });
    });
    given(/^an engine draft for "(.*)" on account "(.*)" the user named$/, (t: string, name: string) => {
      text = t;
      draft = draftFor({ accountId: accountId(name) });
    });
    whenApplied(when);
    then(/^the draft is on account "(.*)" with nothing learned$/, (name: string) => {
      expect(result.accountId).toBe(accountId(name));
      expect(result.learnedAccount).toBeUndefined();
    });
  });

  test('A remembered type comes with its category, and reverts with it', ({ given, and, when, then }) => {
    givenTypedMemory(given);
    givenDraftWithCategory(and);
    whenApplied(when);
    then(/^the draft is "(.*)" with category "(.*)" from phrase memory$/, (type: string, cat: string) => {
      expect(result.type).toBe(type);
      expect(result.categoryName).toBe(cat);
      expect(result.learnedType).toEqual({ engineType: 'expense', source: 'phrase' });
      expect(result.learnedCategory?.source).toBe('phrase');
    });
    when('the type is reverted', () => {
      result = revertLearnedType(result);
    });
    then(/^the draft is "(.*)" with category "(.*)"$/, (type: string, cat: string) => {
      expect(result.type).toBe(type);
      expect(result.categoryName).toBe(cat);
      expect(result.learnedType).toBeUndefined();
      expect(result.learnedCategory).toBeUndefined();
    });
  });

  test('Words that decide the type keep it', ({ given, and, when, then }) => {
    givenTypedMemory(given);
    givenDraftWithCategory(and);
    whenApplied(when);
    then(/^the draft is "(.*)" with category "(.*)"$/, (type: string, cat: string) => {
      expect(result.type).toBe(type);
      expect(result.categoryName).toBe(cat);
      expect(result.learnedType).toBeUndefined();
    });
  });

  test('A transfer draft is never changed, and a forgotten category is ignored', ({ given, and, when, then }) => {
    givenMemoryWith(given);
    givenDraftWithCategory(and);
    whenApplied(when);
    thenCategoryUntouched(then);
    givenMemoryWith(given);
    and(/^a transfer draft for "(.*)"$/, (t: string) => {
      text = t;
      draft = draftFor({ type: 'transfer', transferAccountId: 'acc-card' });
    });
    whenApplied(when);
    then('the draft is unchanged', () => {
      expect(result).toBe(draft);
    });
  });

  test('"Log anyway" teaches a verdict that overrides the next refusal of the same words', ({ given, when, then, and }) => {
    givenNoMemory(given);
    when(/^the user taps "Log anyway" on "(.*)"$/, async (t: string) => {
      await rememberVerdict(store, t, 'log', NOW);
    });
    thenVerdict(then);
    and(/^a refusal of "(.*)" is overridden$/, async (t: string) => {
      const hit = lookup(phraseKey(t, NOW), await store.list());
      expect(memoryForcesLog(hit)).toBe(true);
    });
  });

  test('A discarded affirmation keeps the next affirmation of the same words refused', ({ given, when, then, and }) => {
    givenNoMemory(given);
    when(/^the user discards a draft code affirmed for "(.*)"$/, async (t: string) => {
      await rememberVerdict(store, t, 'not_log', NOW);
    });
    thenVerdict(then);
    and(/^an affirmation by code of "(.*)" stays a refusal$/, async (t: string) => {
      const hit = lookup(phraseKey(t, NOW), await store.list());
      expect(memoryKeepsRefusal(hit, true)).toBe(true);
      expect(memoryForcesLog(hit)).toBe(false);
    });
    and(/^the model's own "this is a transaction" for "(.*)" is not overridden$/, async (t: string) => {
      const hit = lookup(phraseKey(t, NOW), await store.list());
      expect(memoryKeepsRefusal(hit, false)).toBe(false);
    });
  });

  test("Saving the words after a 'not_log' turns the verdict back to 'log'", ({ given, when, and, then }) => {
    givenNoMemory(given);
    when(/^the user discards a draft code affirmed for "(.*)"$/, async (t: string) => {
      await rememberVerdict(store, t, 'not_log', NOW);
    });
    and(/^the user saves "(.*)" as an expense in "(.*)"$/, async (t: string, cat: string) => {
      await rememberConfirmed(store, t, { type: 'expense', categoryId: categoryId(cat), payeeId: null, accountId: 'acc-cash' }, NOW + 1);
    });
    then(/^the memory for "(.*)" has verdict "(.*)" and (\d+) hit$/, (key: string, verdict: string, hits: string) => {
      expect(store.rows.get(key)).toMatchObject({ verdict, hits: Number(hits), categoryId: 'cat-dining' });
    });
  });

  test('The pipeline reports when code, not the model, affirmed the transaction', ({ when, then }) => {
    let outcome: FmParseOutcome;
    when(/^the model refuses "(.*)" and the parse is finished and classified$/, (t: string) => {
      const refusal = {
        isTransaction: false, currency: '', type: 'expense', category: '', payee: '', account: '', note: '',
        occurredOn: '', confidence: 0.2, pending: false,
      };
      outcome = classifyDeviceParse(finishFmParse(refusal, t, planFmAmount(t), NOW, 'USD'), t);
    });
    then('the outcome is parsed and says code affirmed it', () => {
      expect(outcome.kind).toBe('parsed');
      expect(outcome.kind === 'parsed' && outcome.affirmed).toBe('terse-log');
    });
  });

  test('Two reverts forget a memory', ({ given, when, then }) => {
    given(/^a memory for "(.*)" with category "(.*)"$/, (key: string, cat: string) => {
      store = fakeStore([row({ key, categoryId: categoryId(cat) })]);
    });
    when('the user reverts a field that memory applied', async () => {
      await rememberRevert(store, 'on lunch', NOW);
    });
    then(/^the memory for "(.*)" has (\d+) revert$/, (key: string, n: string) => {
      expect(store.rows.get(key)?.reverts).toBe(Number(n));
    });
    when('the user reverts a field that memory applied', async () => {
      await rememberRevert(store, 'on lunch', NOW);
    });
    then(/^there is no memory for "(.*)"$/, (key: string) => {
      expect(store.rows.has(key)).toBe(false);
    });
  });

  test('The store is capped and the least recently used phrase goes first', ({ given, when, then }) => {
    let cap = 0;
    given(/^3 phrase memories used at 1, 2 and 3 with a cap of (\d+)$/, (c: string) => {
      cap = Number(c);
      store = fakeStore([1, 2, 3].map((t) => row({ key: `used-${t}`, lastUsedAt: t, updatedAt: t })));
    });
    when(/^the user saves "(.*)" at (\d+)$/, async (t: string, at: string) => {
      await rememberConfirmed(store, t, { type: 'expense', categoryId: null, payeeId: null, accountId: 'acc-cash' }, Number(at), cap);
    });
    then(/^the memories kept are "(.*)"$/, (keys: string) => {
      expect([...store.rows.keys()].sort()).toEqual(keys.split(',').map((k) => k.trim()).sort());
    });
  });

  const saveSetup = () => {
    const calls: string[] = [];
    let failing = false;
    const deps = (): SaveAssistantDraftDeps => ({
      async listAccounts() {
        return ACCOUNTS;
      },
      async findOrCreateCategory() {
        calls.push('findOrCreateCategory');
        return 'cat-1';
      },
      async getPayeeByName() {
        return null;
      },
      async findOrCreatePayee() {
        return 'payee-1';
      },
      async rememberPayeeDefaults() {},
      async listCategories() {
        return CATEGORIES;
      },
      async rememberPhrase(t, fields) {
        calls.push('rememberPhrase');
        if (failing) throw new Error('disk full');
        await rememberConfirmed(store, t, fields, NOW);
      },
      async createSeries() {},
      async createTransaction() {
        calls.push('createTransaction');
      },
      async postDueOccurrences() {},
      newId: () => 'tx-1',
      now: () => NOW,
    });
    return { calls, deps, fail: () => (failing = true) };
  };

  test('A confirmed parse teaches the memory after the row is written', ({ given, when, then, and }) => {
    const s = saveSetup();
    given(/^a draft for "(.*)" with category "(.*)" ready to save$/, (t: string, cat: string) => {
      draft = draftFor({ categoryName: cat, sourceText: t });
    });
    when('it is saved', async () => {
      await saveAssistantDraftWith(s.deps(), draft);
    });
    then('phrase memory was taught after the row was written', () => {
      expect(s.calls.indexOf('rememberPhrase')).toBeGreaterThan(s.calls.indexOf('createTransaction'));
    });
    and(/^the memory for "(.*)" has category "(.*)" and (\d+) hit$/, (key: string, cat: string, hits: string) => {
      expect(store.rows.get(key)).toMatchObject({ categoryId: cat, hits: Number(hits), type: 'expense', accountId: 'acc-cash' });
    });
  });

  test('A failure to remember never fails the save', ({ given, and, when, then }) => {
    const s = saveSetup();
    let id: string | null = null;
    given(/^a draft for "(.*)" with category "(.*)" ready to save$/, (t: string, cat: string) => {
      draft = draftFor({ categoryName: cat, sourceText: t });
    });
    and('phrase memory cannot be written', () => s.fail());
    when('it is saved', async () => {
      id = await saveAssistantDraftWith(s.deps(), draft);
    });
    then('the save returned the new transaction id', () => {
      expect(id).toBe('tx-1');
    });
  });

  test('The diagnostics count memory hits and how often they were kept', ({ given, then }) => {
    let metricRows: AggregateRow[] = [];
    given(
      /^parse metric rows on "(.*)": an applied memory saved as shown, an applied memory edited, and a plain save$/,
      (engine: string) => {
        const base = {
          engine,
          outcome: 'confirm',
          payeeSwapped: null,
          confidenceBucket: null,
          latencyMs: null,
          edited: null,
          editedAmount: null,
          editedType: null,
          editedPayee: null,
          editedCategory: null,
          editedDate: null,
        };
        metricRows = [
          { ...base, resolved: 'saved', groundingCounts: phraseMemoryDetail('applied') },
          { ...base, resolved: 'edited', groundingCounts: phraseMemoryDetail('applied') },
          { ...base, resolved: 'saved', groundingCounts: null },
        ];
      }
    );
    then(/^the engine shows (\d+) memory applications, (\d+) kept$/, (applied: string, kept: string) => {
      const stats = aggregateByEngine(metricRows).on_device!;
      expect(stats.memoryApplied).toBe(Number(applied));
      expect(stats.memoryKept).toBe(Number(kept));
      expect(stats.memoryKeepRate).toBeCloseTo(Number(kept) / Number(applied));
    });
  });

  test("The memory detail is merged into the row's other detail", ({ then }) => {
    then(/^the memory detail on a fallback row reads fmFallback "(.*)" and phraseMemory "(.*)"$/, (reason: string, kind: string) => {
      expect(JSON.parse(phraseMemoryDetail('applied', fmFallbackDetail(reason)))).toEqual({
        fmFallback: reason,
        phraseMemory: kind,
      });
    });
  });
});

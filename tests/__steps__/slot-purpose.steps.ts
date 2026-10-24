import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { finishFmParse, FmDeviceParse } from '../../src/domain/fmParse';
import { planFmAmount } from '../../src/domain/fmAmountPlan';
import { categoryFromPurpose } from '../../src/domain/slotCategory';
import { localParse } from '../../src/domain/localParse';
import { appliedDefaultsOf } from '../../src/domain/correctionEdits';
import { TransactionDraft, withSlotFields } from '../../src/domain/assistant';
import { Category, Payee, TransactionType } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/slot-purpose.feature'));

const NOW = Date.UTC(2026, 9, 23, 4);
const FIELDS = { currency: '', category: '', payee: '', account: '', note: '', occurredOn: '', confidence: 0.9, pending: false };
const names = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const orNull = (s: string) => (s === 'none' ? null : s);
const orEmpty = (s: string) => (s === 'none' ? '' : s);

defineFeature(feature, (test) => {
  let categories: Category[] = [];
  let payees: Payee[] = [];
  let text = '';
  let modelObject: Record<string, unknown> = {};
  let finished: FmDeviceParse | null = null;
  let draft: TransactionDraft | null = null;

  const givenCategories = (step: any) =>
    step(/^the user's categories are "(.*)"$/, (s: string) => {
      categories = names(s).map((entry, i) => {
        const [name, kind] = entry.split(':');
        return { id: `cat-${i}`, name: name!, kind: kind as TransactionType };
      });
    });
  const givenPayees = (step: any) =>
    step(/^the user's payees are "(.*)"$/, (s: string) => {
      payees = names(s).map((name, i) => ({ id: `payee-${i}`, name }));
    });
  const background = (given: any, and: any) => {
    givenCategories(given);
    givenPayees(and);
  };
  const whenFinished = (when: any) =>
    when('the parse is finished', () => {
      finished = finishFmParse(modelObject, text, planFmAmount(text), NOW, 'USD', [], { payees, categories });
    });
  const thenFinished = (then: any) =>
    then(/^the finished category is "(.*)" and note "(.*)"$/, (category: string, note: string) => {
      expect({ text, category: finished?.category ?? null, note: finished?.note ?? null }).toEqual({
        text,
        category: orNull(category),
        note: orNull(note),
      });
    });
  const thenFiles = (then: any) =>
    then(/^the purpose "(.*)" for a "(.*)" files under "(.*)"$/, (purpose: string, type: TransactionType, category: string) => {
      expect({ purpose, category: categoryFromPurpose(purpose, type, categories) }).toEqual({ purpose, category: orNull(category) });
    });

  test('The tail is the note, kept short, in the user\'s own spelling', ({ given, and, when, then }) => {
    background(given, and);
    given(
      /^the model answered type "(.*)", category "(.*)" and note "(.*)" for "(.*)"$/,
      (type: string, category: string, note: string, t: string) => {
        text = t;
        modelObject = { ...FIELDS, isTransaction: true, type, category: orEmpty(category), note: orEmpty(note) };
      }
    );
    whenFinished(when);
    thenFinished(then);
  });

  test('A note the slot reader did not produce keeps every groundedNote rule', ({ given, and, when, then }) => {
    background(given, and);
    given(/^the model answered type "(.*)", category "(.*)" and note "(.*)" for "(.*)"$/, (type: string, category: string, note: string, t: string) => {
      text = t;
      modelObject = { ...FIELDS, isTransaction: true, type, category: orEmpty(category), note: orEmpty(note) };
    });
    whenFinished(when);
    thenFinished(then);
  });

  test("The tail's category comes from the ladder for the transaction's kind", ({ given, and, then }) => {
    background(given, and);
    thenFiles(then);
  });

  test('A meal files under Dining when the user has Dining and Groceries but no Food', ({ given, and, then }) => {
    background(given, and);
    givenCategories(given);
    thenFiles(then);
  });

  test('The heuristic floor takes the note and category from the tail too', ({ given, and, when, then }) => {
    background(given, and);
    let parsed: ReturnType<typeof localParse> | null = null;
    when(/^I locally parse "(.*)"$/, (t: string) => {
      parsed = localParse(t, { categories, payees, now: NOW });
    });
    then(/^the heuristic category is "(.*)" and note "(.*)"$/, (category: string, note: string) => {
      expect({ category: parsed!.category, note: parsed!.note }).toEqual({ category, note });
    });
  });

  test('A category from the tail is flagged on the card', ({ given, and, then }) => {
    background(given, and);
    given('a draft whose category the slot reader set from the tail', () => {
      const base: TransactionDraft = {
        accountId: 'acct-0',
        type: 'expense',
        amount: 2500,
        currency: 'USD',
        categoryName: 'Food',
        payeeName: 'Sister',
        note: 'lunch',
        occurredAt: NOW,
        source: 'ai',
        defaulted: { account: true, payee: false, category: false, date: true },
      };
      draft = withSlotFields(base, ['category', 'note']);
    });
    then("the draft's category is flagged as defaulted", () => {
      expect(draft!.defaulted.category).toBe(true);
    });
    and(/^its applied defaults are "(.*)"$/, (s: string) => {
      expect(appliedDefaultsOf(draft!)).toEqual(names(s));
    });
  });
});

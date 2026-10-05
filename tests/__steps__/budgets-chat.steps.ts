import fs from 'fs';
import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { Category } from '../../src/domain/types';
import {
  BudgetCommandIntent,
  BudgetIntent,
  detectBudgetIntent,
  resolveBudgetCategory,
} from '../../src/domain/budgetIntent';
import { BudgetChatAction, BudgetChatPlan, chatActionOf, planBudgetChat } from '../../src/domain/budgetChatPlan';
import { BudgetRow, budgetFor, ongoingBudgetFor, planBudgetWrite } from '../../src/domain/budgets';
import { budgetClarifyText, createCategoryOfferText } from '../../src/domain/budgetCopy';
import { bubbleText, budgetRemovedText, createCategoryReceipt } from '../../src/domain/bubbleCopy';
import { newCategoryName, resolveForCommand } from '../../src/domain/budgetCategoryCreate';
import { CreateCategoryRefused, createCategoryWithBudgetFlow } from '../../src/domain/createCategoryBudgetFlow';
import { detectIntent } from '../../src/domain/intentGate';
import {
  BudgetModelResult,
  budgetFallback,
  budgetFmCandidate,
  budgetFmSlots,
  normalizeBudgetFmOutput,
} from '../../src/domain/budgetFm';
import { budgetFmSchemaFor } from '../../src/domain/deviceSchemas';
import { cat } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/budgets-chat.feature'));

const OCT = '2026-10';
const SEP = '2026-09';

defineFeature(feature, (test) => {
  let categories: Category[] = [];
  let current: number | null = null;
  let ongoing: number | null = null;
  let plan: BudgetChatPlan;
  let rows: BudgetRow[] = [];
  let lastInsert: BudgetRow | null = null;

  beforeEach(() => {
    categories = [];
    current = null;
    ongoing = null;
    rows = [];
    lastInsert = null;
  });

  const givenCategories = () => {
    categories = [
      cat('food', 'Food', '🍔'),
      cat('groceries', 'Groceries', '🛒'),
      cat('shopping', 'Shopping', '🛍️'),
      cat('transport', 'Transport', '🚌'),
    ];
  };
  const intentOf = (text: string): BudgetIntent | null => detectBudgetIntent(text, categories);

  test('Set wordings route to set-budget', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(
      /^"(.*)" should route to set-budget for "(.*)" at (\d+)$/,
      (text: string, category: string, amount: string) => {
        expect(intentOf(text)).toEqual({ kind: 'set-budget', categoryName: category, amount: Number(amount) });
      }
    );
  });

  test('Edit wordings route to edit-budget', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(
      /^"(.*)" should route to edit-budget for "(.*)" (to|raise by|lower by) (\d+)$/,
      (text: string, category: string, how: string, amount: string) => {
        const change =
          how === 'to'
            ? { mode: 'to', amount: Number(amount) }
            : { mode: 'by', direction: how.startsWith('raise') ? 'raise' : 'lower', amount: Number(amount) };
        expect(intentOf(text)).toEqual({ kind: 'edit-budget', categoryName: category, change });
      }
    );
  });

  test('Remove wordings route to remove-budget', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^"(.*)" should route to remove-budget for "(.*)"$/, (text: string, category: string) => {
      expect(intentOf(text)).toEqual({ kind: 'remove-budget', categoryName: category });
    });
  });

  test('Spends and other talk are left alone', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^"(.*)" should not route to a budget answer$/, (text: string) => {
      expect(intentOf(text)).toBeNull();
    });
  });

  test('An unknown category still routes, and then cannot be resolved', ({ given, then, and }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^"set gym budget to 40" should route to set-budget for "gym" at 40$/, () => {
      expect(intentOf('set gym budget to 40')).toMatchObject({ kind: 'set-budget', categoryName: 'gym', amount: 40 });
    });
    and(/^"remove gym budget" should route to remove-budget for "gym"$/, () => {
      expect(intentOf('remove gym budget')).toMatchObject({ kind: 'remove-budget', categoryName: 'gym' });
    });
    and(/^"gym" should resolve as none$/, () => {
      expect(resolveBudgetCategory('gym', categories).kind).toBe('none');
    });
  });

  test('A command missing a slot asks, it never guesses', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^"(.*)" should ask for the (\w+)$/, (text: string, missing: string) => {
      expect(intentOf(text)).toMatchObject({ kind: 'budget-clarify', missing });
    });
  });

  test('The reply to a clarifying question', ({ then }) => {
    then(
      /^asking for the ([\w-]+) with "(.*)" should read "(.*)"$/,
      (missing: string, category: string, reply: string) => {
        expect(
          budgetClarifyText({
            missing: missing as 'category' | 'amount' | 'wording',
            categoryName: category || undefined,
            example: 'Food',
          })
        ).toBe(reply);
      }
    );
  });

  const actionFrom = (text: string): BudgetChatAction => {
    const [verb, ...rest] = text.split(' ');
    const n = (rest[rest.length - 1] ?? '0') + '00';
    if (text === 'remove') return { kind: 'remove' };
    if (verb === 'set') return { kind: 'set', amount: Number(n) };
    if (verb === 'edit') return { kind: 'edit-to', amount: Number(n) };
    return { kind: 'edit-by', direction: verb === 'raise' ? 'raise' : 'lower', amount: Number(n) };
  };

  test('What the plan does for each action', ({ given, when, then }) => {
    given(/^a Food budget of (\w+) this month$/, (value: string) => {
      current = value === 'none' ? null : Number(value) * 100;
      ongoing = current;
    });
    when(/^the user asks to (.*)$/, (action: string) => {
      plan = planBudgetChat({
        action: actionFrom(action),
        categoryName: 'Food',
        current,
        ongoing,
        month: OCT,
        currency: 'USD',
      });
    });
    then(/^the plan should be ([\w-]+) reading "(.*)"$/, (kind: string, text: string) => {
      expect(plan.kind).toBe(kind);
      expect(plan.text).toBe(text);
    });
  });

  const apply = (action: BudgetChatAction) => {
    const food = budgetFor(rows, 'food', OCT);
    const p = planBudgetChat({
      action,
      categoryName: 'Food',
      current: food,
      ongoing: ongoingBudgetFor(rows, 'food', OCT),
      month: OCT,
      currency: 'USD',
    });
    if (p.kind === 'reply') throw new Error('nothing to confirm');
    const write = p.write;
    const w = planBudgetWrite({ id: 'new', categoryId: 'food', amount: write.amount, month: OCT, scope: write.scope, now: 9 });
    rows = rows.filter((r) => !(w.deleteFromMonth !== null && r.categoryId === 'food' && r.startMonth >= w.deleteFromMonth));
    rows.push(w.insert);
    lastInsert = w.insert;
  };
  const givenFoodFromSeptember = (major: string) => {
    rows = [{ id: 'old', categoryId: 'food', amount: Number(major) * 100, startMonth: SEP, endMonth: null, createdAt: 1 }];
  };
  const foodIn = (month: string) => budgetFor(rows, 'food', month);

  test('Confirming writes onward, and a removal is a tombstone', ({ given, when, then, and }) => {
    given(/^a Food budget of (\d+) from September$/, givenFoodFromSeptember);
    when('the user confirms removing the Food budget in October', () => apply({ kind: 'remove' }));
    then('Food has no budget in October and later', () => {
      expect(foodIn(OCT)).toBeNull();
      expect(foodIn('2027-03')).toBeNull();
    });
    and(/^Food still has (\d+) in September$/, (major: string) => {
      expect(foodIn(SEP)).toBe(Number(major) * 100);
    });
    and('the removal row has a null amount', () => {
      expect(lastInsert?.amount).toBeNull();
      expect(lastInsert?.endMonth).toBeNull();
    });
  });

  test('Confirming a raise writes the new amount onward', ({ given, when, then, and }) => {
    given(/^a Food budget of (\d+) from September$/, givenFoodFromSeptember);
    when('the user confirms raising Food by 50 in October', () =>
      apply({ kind: 'edit-by', direction: 'raise', amount: 5000 })
    );
    then(/^Food has (\d+) in October and later$/, (major: string) => {
      expect(foodIn(OCT)).toBe(Number(major) * 100);
      expect(foodIn('2027-03')).toBe(Number(major) * 100);
    });
    and(/^Food still has (\d+) in September$/, (major: string) => {
      expect(foodIn(SEP)).toBe(Number(major) * 100);
    });
  });

  test("Amounts are converted at the currency's exponent", ({ then }) => {
    then('lowering by 500 in JPY from 3000 should plan 2500', () => {
      const action = chatActionOf(
        { kind: 'edit-budget', categoryName: 'food', change: { mode: 'by', direction: 'lower', amount: 500 } },
        'JPY'
      );
      const p = planBudgetChat({ action, categoryName: 'Food', current: 3000, ongoing: 3000, month: OCT, currency: 'JPY' });
      expect(p).toMatchObject({ kind: 'confirm-set', next: 2500 });
    });
  });

  test('Wording the router does not read, but that is plainly about a budget', ({ given, then, and }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^"(.*)" should not be read by the router$/, (text: string) => {
      expect(intentOf(text)).toBeNull();
    });
    and(/^"(.*)" should be a candidate for the model$/, (text: string) => {
      expect(budgetFmCandidate(text, categories)).toBe(true);
    });
  });

  test('Spends never reach the model', ({ then }) => {
    then(/^"(.*)" should not be a candidate for the model$/, (text: string) => {
      expect(budgetFmCandidate(text, categories)).toBe(false);
    });
  });

  const schemaProps = (text: string) =>
    (budgetFmSchemaFor(budgetFmSlots(text, categories)).jsonSchema as unknown as {
      properties: Record<string, { enum?: string[] }>;
      'x-order': string[];
    });

  test('The model is asked with closed choices only', ({ given, then, and }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(
      /^the model schema for "(.*)" offers the categories and amounts 300, 350$/,
      (text: string) => {
        const props = schemaProps(text).properties;
        expect(props.category!.enum).toEqual(['none', 'Food', 'Groceries', 'Shopping', 'Transport']);
        expect(props.amount!.enum).toEqual(['none', '300', '350']);
      }
    );
    and(/^the model schema for "(.*)" does not ask for an amount$/, (text: string) => {
      expect(schemaProps(text).properties.amount).toBeUndefined();
    });
  });

  const modelAnswer = (spec: string, text: string): BudgetCommandIntent | null => {
    const [action = 'none', category = 'none', third] = spec.split(' ');
    const raw: Record<string, unknown> = {
      action,
      category,
      direction: third === 'lower' || third === 'raise' ? third : 'to',
    };
    if (spec.endsWith('at an invented amount')) {
      raw.action = action;
      raw.amount = '999';
    }
    return normalizeBudgetFmOutput(raw, text, categories);
  };

  test('Code validates every slot the model fills', ({ given, then, and }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(
      /^a model answer of (.*) for "(.*)" should read set-budget (\w+) at (\d+)$/,
      (spec: string, text: string, name: string, amount: string) => {
        expect(modelAnswer(spec, text)).toEqual({ kind: 'set-budget', categoryName: name, amount: Number(amount) });
      }
    );
    and(/^a model answer of (.*) for "(.*)" should ask for the category$/, (spec: string, text: string) => {
      expect(modelAnswer(spec, text)).toMatchObject({ kind: 'budget-clarify', missing: 'category' });
    });
    and(/^a model answer of (.*) for "(.*)" should ask for the amount$/, (spec: string, text: string) => {
      expect(modelAnswer(spec, text)).toMatchObject({ kind: 'budget-clarify', missing: 'amount' });
    });
    and(/^a model answer of (.*) for "(.*)" should be ignored$/, (spec: string, text: string) => {
      expect(modelAnswer(spec, text)).toBeNull();
    });
    and(/^a model answer of (.*) for "(.*)" should read remove-budget (\w+)$/, (spec: string, text: string, name: string) => {
      expect(modelAnswer(spec, text)).toEqual({ kind: 'remove-budget', categoryName: name });
    });
    and(
      /^a model answer of (.*) for "(.*)" should read edit-budget (\w+) lowering by (\d+)$/,
      (spec: string, text: string, name: string, amount: string) => {
        expect(modelAnswer(spec, text)).toEqual({
          kind: 'edit-budget',
          categoryName: name,
          change: { mode: 'by', direction: 'lower', amount: Number(amount) },
        });
      }
    );
    and(/^a model answer of (.*) for "(.*)" should be checked with the user first$/, (spec: string, text: string) => {
      expect(modelAnswer(spec, text)).toMatchObject({ kind: 'set-budget', categoryName: 'Shopping', ungrounded: true });
    });
    and(/^a model answer of (.*) for "(.*)" should ask for the amount$/, (spec: string, text: string) => {
      expect(modelAnswer(spec, text)).toMatchObject({ kind: 'budget-clarify', missing: 'amount' });
    });
  });

  test("The model's schema is pinned to declaration order", ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^the model schema for "(.*)" has x-order action, category, direction, amount$/, (text: string) => {
      expect(schemaProps(text)['x-order']).toEqual(['action', 'category', 'direction', 'amount']);
    });
  });

  const givenFoodAndLunch = () => {
    categories = [cat('food', 'Food', '🍔'), cat('lunch', 'Lunch', '🥪')];
  };
  const SPEND_STEPS = (
    given: (m: RegExp, fn: () => void) => void,
    then: (m: RegExp, fn: (text: string) => void) => void,
    and: (m: RegExp, fn: (text: string) => void) => void
  ) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^"(.*)" should not route to a budget answer$/, (text: string) => {
      expect(intentOf(text)).toBeNull();
    });
    and(/^"(.*)" should not be a candidate for the model$/, (text: string) => {
      expect(budgetFmCandidate(text, categories)).toBe(false);
    });
  };

  test('Spends that mention a budget are not budget commands', ({ given, then, and }) => {
    SPEND_STEPS(given, then, and);
  });

  test('With a Lunch category, only the marked forms route', ({ given, then, and }) => {
    given(/^the categories Food and Lunch$/, givenFoodAndLunch);
    then(/^"(.*)" should route to set-budget for "lunch" at 12$/, (text: string) => {
      expect(intentOf(text)).toEqual({ kind: 'set-budget', categoryName: 'lunch', amount: 12 });
    });
    and(/^"(.*)" should route to set-budget for "lunch" at 12$/, (text: string) => {
      expect(intentOf(text)).toEqual({ kind: 'set-budget', categoryName: 'lunch', amount: 12 });
    });
    and(/^"budget lunch 12" should not route to a budget answer$/, () => {
      expect(intentOf('budget lunch 12')).toBeNull();
    });
    and(/^"budget 12 food" should not route to a budget answer$/, () => {
      expect(intentOf('budget 12 food')).toBeNull();
    });
  });

  const neverAsked = async (): Promise<BudgetModelResult> => {
    throw new Error('the model must not be asked');
  };

  test('What chat cannot do is answered without asking the model', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^"(.*)" should be answered with ([\w-]+) and the model is not asked$/, async (text: string, reason: string) => {
      expect(await budgetFallback(text, categories, neverAsked)).toMatchObject({
        kind: 'budget-clarify',
        missing: reason,
      });
    });
  });

  const MODELS: Record<string, (text: string) => BudgetModelResult> = {
    'no model': () => ({ kind: 'unavailable' }),
    'a none answer': () => ({ kind: 'answer', intent: null }),
    'a failed answer': () => ({ kind: 'answer', intent: null }),
    'a category question': () => ({
      kind: 'answer',
      intent: { kind: 'budget-clarify', missing: 'category', action: 'edit' },
    }),
    'an ungrounded pick': () => ({
      kind: 'answer',
      intent: { kind: 'set-budget', categoryName: 'Food', amount: 300, ungrounded: true },
    }),
    'a set answer': () => ({
      kind: 'answer',
      intent: { kind: 'set-budget', categoryName: 'Food', amount: 300 },
    }),
  };

  test('The model fallback decides what is shown', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^with (.+) for "(.*)" the Assistant shows (.+)$/, async (model: string, text: string, outcome: string) => {
      const got = await budgetFallback(text, categories, async () => MODELS[model]!(text));
      const shown =
        got === null
          ? 'nothing'
          : got.kind === 'budget-clarify' && got.missing === 'wording'
            ? 'the hint'
            : got.kind === 'budget-clarify'
              ? 'the question'
              : got.kind === 'set-budget' && got.ungrounded
                ? 'the pick'
                : 'the set';
      expect(shown).toBe(outcome);
    });
  });

  test('The routing order keeps questions ahead of the model fallback', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^the gate for "(.*)" should be (\w+)$/, (text: string, gate: string) => {
      expect(detectIntent(text, { categories })).toBe(gate === 'none' ? null : gate);
    });
  });

  test('The screen asks the model only after the other gates have returned', ({ then }) => {
    then(
      'in the Assistant screen the budget fallback comes after the transaction-op gate and before the parse ladder',
      () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/index.tsx'), 'utf8');
        const fallbackCall = src.indexOf('budgetFallback(trimmed');
        expect(fallbackCall).toBeGreaterThan(src.indexOf('if (txOpCandidate) {'));
        expect(fallbackCall).toBeLessThan(src.indexOf('const ENGINE_RUNNERS'));
        // The model is reached through that one call only, and the early budget
        // gate is the deterministic router alone.
        expect(src.match(/deviceParseBudget\(/g)).toHaveLength(1);
        expect(src.indexOf('deviceParseBudget(')).toBeGreaterThan(src.indexOf('if (txOpCandidate) {'));
        expect(src).toContain('!queryIntent && !accountIntent && !txOpCandidate');
      }
    );
  });

  const checkResolution = (text: string, result: string) => {
    const intent = intentOf(text);
    if (!intent || !('categoryName' in intent) || intent.kind === 'budget-clarify') throw new Error('not a command');
    const got = resolveForCommand(intent, categories);
    let m: RegExpExecArray | null;
    if ((m = /^offer to create (.+)$/.exec(result))) {
      expect(got).toEqual({ kind: 'offer-create', name: m[1] });
    } else if ((m = /^suggest (\w+) with the create button for (\w+)$/.exec(result))) {
      expect(got).toMatchObject({ kind: 'suggest', createName: m[2] });
      expect((got as { category: Category }).category.name).toBe(m[1]);
    } else if ((m = /^suggest (\w+) without a create button$/.exec(result))) {
      expect(got).toMatchObject({ kind: 'suggest', createName: null });
      expect((got as { category: Category }).category.name).toBe(m[1]);
    } else if ((m = /^go ahead with (\w+)$/.exec(result))) {
      expect(got).toMatchObject({ kind: 'proceed' });
      expect((got as { category: Category }).category.name).toBe(m[1]);
    } else if ((m = /^reply "(.*)"$/.exec(result))) {
      expect(got).toEqual({ kind: 'reply', text: m[1] });
    } else {
      throw new Error(`unknown expectation: ${result}`);
    }
  };

  test('A set-budget for a missing category offers to create it', ({ given, then }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^resolving "(.*)" should (.*)$/, checkResolution);
  });

  test('A category name has to be a real name', ({ then }) => {
    then(/^the new category name for "(.*)" should be (.+)$/, (typed: string, name: string) => {
      expect(newCategoryName(typed)).toBe(name === 'rejected' ? null : name);
    });
  });

  test('The create offer reads with the amount', ({ then, and }) => {
    then(/^the create offer for Pets at 300 should read "(.*)"$/, (text: string) => {
      expect(createCategoryOfferText({ name: 'Pets', amount: 30000, currency: 'USD' })).toBe(text);
    });
    and(/^the create done reply for Pets at 300 should read "(.*)"$/, (text: string) => {
      expect(bubbleText(createCategoryReceipt({ name: 'Pets', amount: 30000, month: OCT, currency: 'USD' }))).toBe(text);
    });
    and(/^the remove done reply for Food should read "(.*)"$/, (text: string) => {
      expect(budgetRemovedText('Food')).toBe(text);
    });
  });

  /** The real flow, with in-memory deps recording what it does. */
  const runCreate = async (name: string, amount = 30000) => {
    const created: string[] = [];
    const written: Array<{ id: string; amount: number }> = [];
    const outcome = await createCategoryWithBudgetFlow(
      { name, amount, month: OCT },
      {
        listCategories: async () => categories,
        createExpenseCategory: async (n) => {
          created.push(n);
          return `new-${n.toLowerCase()}`;
        },
        writeBudget: async (id, amt) => {
          written.push({ id, amount: amt });
        },
      }
    ).then(
      (id) => ({ id, error: null as string | null }),
      (e: unknown) => ({ id: null, error: e instanceof CreateCategoryRefused ? e.message : String(e) })
    );
    return { created, written, ...outcome };
  };

  test('Confirming creates an expense category and writes the budget onward', ({ given, then, and }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(
      /^creating Pets with 300 should create one top-level expense category and write its budget 300 onward$/,
      async () => {
        const r = await runCreate('Pets');
        expect(r.created).toEqual(['Pets']);
        expect(r.written).toEqual([{ id: 'new-pets', amount: 30000 }]);
      }
    );
    and(/^creating food with 300 should reuse the existing Food and create nothing$/, async () => {
      const r = await runCreate('food');
      expect(r.created).toEqual([]);
      expect(r.written).toEqual([{ id: 'food', amount: 30000 }]);
    });
  });

  test("A sub-category's name is never reused or offered", ({ given, then, and }) => {
    given(/^the categories Home with a sub-category Pets$/, () => {
      categories = [cat('home', 'Home', '🏠'), cat('pets', 'Pets', '🐾', 'home')];
    });
    then(/^resolving "(.*)" should (.*)$/, checkResolution);
    and(/^resolving "(.*)" should (.*)$/, checkResolution);
    and(/^resolving "(.*)" should (.*)$/, checkResolution);
    and(
      /^creating Pets with 300 should be refused with "(.*)" and write nothing$/,
      async (text: string) => {
        const r = await runCreate('Pets');
        expect(r.error).toBe(text);
        expect(r.created).toEqual([]);
        expect(r.written).toEqual([]);
      }
    );
  });

  test("An income category's name is never duplicated as an expense category", ({ given, then, and }) => {
    given(/^the categories Food and an income Salary$/, () => {
      categories = [cat('food', 'Food', '🍔'), { id: 'salary', name: 'Salary', kind: 'income', parentId: null, icon: null }];
    });
    then(/^resolving "(.*)" should (.*)$/, checkResolution);
    and(
      /^creating Salary with 300 should be refused with "(.*)" and write nothing$/,
      async (text: string) => {
        const r = await runCreate('Salary');
        expect(r.error).toBe(text);
        expect(r.created).toEqual([]);
        expect(r.written).toEqual([]);
      }
    );
  });

  test('A placeholder name is not created, but an existing category of that name still matches', ({ given, then, and }) => {
    given(/^the categories Food and Other$/, () => {
      categories = [cat('food', 'Food', '🍔'), cat('other', 'Other', '📦')];
    });
    then(/^resolving "(.*)" should (.*)$/, checkResolution);
    and(/^resolving "(.*)" should (.*)$/, checkResolution);
  });

  test("A model remove must match the router's adjacency shape", ({ given, then, and }) => {
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    then(/^"(.*)" should not be a candidate for the model$/, (text: string) => {
      expect(budgetFmCandidate(text, categories)).toBe(false);
    });
    and(/^"(.*)" should not be a candidate for the model$/, (text: string) => {
      expect(budgetFmCandidate(text, categories)).toBe(false);
    });
    and(/^a model answer of (.*) for "(.*)" should be ignored$/, (spec: string, text: string) => {
      expect(modelAnswer(spec, text)).toBeNull();
    });
    and(/^a model answer of (.*) for "(.*)" should read remove-budget (\w+)$/, (spec: string, text: string, name: string) => {
      expect(modelAnswer(spec, text)).toEqual({ kind: 'remove-budget', categoryName: name });
    });
  });

  test('Cancelling the offer writes nothing', ({ given, when, and, then }) => {
    let before: string;
    let offered: ReturnType<typeof resolveForCommand> | null = null;
    given(/^the categories Food, Groceries, Shopping and Transport$/, givenCategories);
    when(/^the user is offered to create Pets at 300$/, () => {
      before = JSON.stringify({ categories, rows });
      offered = resolveForCommand({ kind: 'set-budget', categoryName: 'pets', amount: 300 }, categories);
    });
    and('the user cancels', () => {
      offered = null;
    });
    then('no category was created and no budget was written', () => {
      expect(offered).toBeNull();
      expect(JSON.stringify({ categories, rows })).toBe(before);
    });
  });

  const givenOneOff = (ongoingMajor: string | null, oneOffMajor: string) => {
    rows = [];
    if (ongoingMajor !== null) {
      rows.push({ id: 'o', categoryId: 'food', amount: Number(ongoingMajor) * 100, startMonth: SEP, endMonth: null, createdAt: 1 });
    }
    rows.push({ id: 'x', categoryId: 'food', amount: Number(oneOffMajor) * 100, startMonth: OCT, endMonth: OCT, createdAt: 2 });
    current = budgetFor(rows, 'food', OCT);
    ongoing = ongoingBudgetFor(rows, 'food', OCT);
  };
  const askPlan = (action: string) => {
    plan = planBudgetChat({ action: actionFrom(action), categoryName: 'Food', current, ongoing, month: OCT, currency: 'USD' });
  };

  test("A delta builds on the ongoing amount, not on this month's one-off", ({ given, when, then }) => {
    given(/^an ongoing Food budget of (\d+) and a one-off of (\d+) this month$/, givenOneOff);
    when(/^the user asks to (.*)$/, askPlan);
    then(/^the plan should be ([\w-]+) reading "(.*)"$/, (kind: string, text: string) => {
      expect(plan).toMatchObject({ kind, text });
    });
  });

  test('A delta with only a one-off to go on says so', ({ given, when, then }) => {
    given(/^only a one-off Food budget of (\d+) this month$/, (oneOff: string) => givenOneOff(null, oneOff));
    when(/^the user asks to (.*)$/, askPlan);
    then(/^the plan should be ([\w-]+) reading "(.*)"$/, (kind: string, text: string) => {
      expect(plan).toMatchObject({ kind, text });
    });
  });

  test("A raise of an ongoing budget replaces this month's one-off", ({ given, when, then }) => {
    given(/^an ongoing Food budget of (\d+) and a one-off of (\d+) this month$/, givenOneOff);
    when('the user confirms raising Food by 50 in October', () =>
      apply({ kind: 'edit-by', direction: 'raise', amount: 5000 })
    );
    then(/^Food has (\d+) in October and later$/, (major: string) => {
      expect(foodIn(OCT)).toBe(Number(major) * 100);
      expect(foodIn('2027-03')).toBe(Number(major) * 100);
    });
  });
});

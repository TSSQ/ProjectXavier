/**
 * Closed-choice filter parameters for the BYOK query loop (question eval D4,
 * src/domain/queryToolChoices.ts): per question, category / payee / account
 * become an enum of the user's own (capped) names + "unspecified"; without
 * grounding the wire format is the static, free-text one. Fetch-mocked like
 * tests/__steps__/query-loop-wire.steps.ts.
 */
import { closeToolSchema, queryToolChoicesFor, UNSPECIFIED_CHOICE, QueryToolGrounding } from '../../src/domain/queryToolChoices';
import { MAX_UNCAPPED_PAYEES, MAX_RECENT_PAYEES } from '../../src/domain/groundingSelection';
import { QUERY_TOOL_DEFS } from '../../src/domain/queryTools';
import {
  ANTHROPIC_TOOLS,
  OPENAI_TOOLS,
  anthropicToolsFor,
  runAnthropicQueryLoop,
  runOpenAiQueryLoop,
} from '../../src/features/ai/queryLoop';
import { Account, Category, Payee } from '../../src/domain/types';

const NOW = Date.UTC(2026, 9, 21, 4, 0, 0);

const cat = (name: string, kind: Category['kind']): Category => ({ id: `c-${name}`, name, kind, parentId: null, icon: null });
const acc = (name: string, archived = false): Account => ({ id: `a-${name}`, name, currency: 'SGD', openingBalance: 0, archived });
const pay = (name: string): Payee => ({ id: `p-${name}`, name });

const GROUNDING: QueryToolGrounding = {
  categories: [cat('Food', 'expense'), cat('Dining Out', 'expense'), cat('Salary', 'income'), cat('Card Payment', 'transfer')],
  payees: [pay('Grab'), pay('FairPrice')],
  accounts: [acc('DBS Savings'), acc('Old Wallet', true)],
};

type Schema = { properties: Record<string, { type?: string; enum?: string[]; description?: string }> };
const schemaOf = (tools: Array<{ name: string; input_schema: unknown }>, name: string) =>
  tools.find((t) => t.name === name)!.input_schema as Schema;

describe('query tool choices — the closed lists', () => {
  it('splits categories by kind, never offers transfers or archived accounts', () => {
    const c = queryToolChoicesFor('how much on food', GROUNDING);
    expect(c.expenseCategories).toEqual(['Food', 'Dining Out']);
    expect(c.incomeCategories).toEqual(['Salary']);
    expect(c.anyCategories).toEqual(['Food', 'Dining Out', 'Salary']);
    expect(c.accounts).toEqual(['DBS Savings']);
    expect(c.payees).toEqual(['Grab', 'FairPrice']);
  });

  it('caps a long payee list the way the parse prompt does, always keeping a named payee', () => {
    const many = Array.from({ length: MAX_UNCAPPED_PAYEES + 15 }, (_, i) => pay(`Shop ${i}`));
    const grounding = { ...GROUNDING, payees: [...many, pay('Golden Village')] };
    const c = queryToolChoicesFor('how much at golden village', grounding);
    expect(c.payees).toContain('Golden Village');
    expect(c.payees.length).toBeLessThanOrEqual(MAX_RECENT_PAYEES + 1);
  });

  it('closes each tool over the right list, adds the sentinel, and leaves other params alone', () => {
    const tools = anthropicToolsFor('how much on food', GROUNDING);
    const spent = schemaOf(tools, 'total_spent');
    expect(spent.properties.category!.enum).toEqual(['Food', 'Dining Out', UNSPECIFIED_CHOICE]);
    expect(spent.properties.payee!.enum).toEqual(['Grab', 'FairPrice', UNSPECIFIED_CHOICE]);
    expect(spent.properties.account!.enum).toEqual(['DBS Savings', UNSPECIFIED_CHOICE]);
    expect(spent.properties.period!.enum).toContain('this_month');
    expect(schemaOf(tools, 'total_income').properties.category!.enum).toEqual(['Salary', UNSPECIFIED_CHOICE]);
    expect(schemaOf(tools, 'total_income').properties.payee!.enum).toEqual(['Grab', 'FairPrice', UNSPECIFIED_CHOICE]);
    expect(schemaOf(tools, 'search_transactions').properties.category!.enum).toEqual(['Food', 'Dining Out', 'Salary', UNSPECIFIED_CHOICE]);
    expect(schemaOf(tools, 'spending_by_category').properties.category).toBeUndefined();
  });

  it('never sends a duplicate enum item, even for a name that is the sentinel or differs only in case/space', () => {
    const grounding = {
      ...GROUNDING,
      categories: [cat('Food', 'expense'), cat(' food', 'expense'), cat('Unspecified', 'expense')],
      payees: [pay('unspecified'), pay('Grab ')],
    };
    const spent = schemaOf(anthropicToolsFor('how much', grounding), 'total_spent');
    expect(spent.properties.category!.enum).toEqual(['Food', UNSPECIFIED_CHOICE]);
    expect(spent.properties.payee!.enum).toEqual(['Grab', UNSPECIFIED_CHOICE]);
  });

  it('keeps a list the user has nothing in as free text, and never mutates the static definitions', () => {
    const before = JSON.stringify(QUERY_TOOL_DEFS.map((d) => d.jsonSchema));
    const def = QUERY_TOOL_DEFS.find((d) => d.name === 'total_spent')!;
    const closed = closeToolSchema('total_spent', def.jsonSchema, {
      expenseCategories: ['Food'],
      incomeCategories: [],
      anyCategories: ['Food'],
      payees: [],
      accounts: [],
    }) as Schema;
    expect(closed.properties.payee!.enum).toBeUndefined();
    expect(closed.properties.category!.enum).toEqual(['Food', UNSPECIFIED_CHOICE]);
    expect(JSON.stringify(QUERY_TOOL_DEFS.map((d) => d.jsonSchema))).toBe(before);
  });
});

describe('query tool choices — on the wire', () => {
  let originalFetch: typeof fetch;
  let bodies: Record<string, unknown>[];
  beforeEach(() => {
    originalFetch = global.fetch;
    bodies = [];
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const capture = (reply: unknown) =>
    (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as typeof fetch;

  it('without grounding, Anthropic gets the static free-text tools unchanged', async () => {
    global.fetch = capture({ content: [{ type: 'text', text: 'ok' }] });
    await runAnthropicQueryLoop('how much on food', 'k', 'm', NOW, 'SGD', jest.fn());
    expect(bodies[0]!.tools).toEqual(JSON.parse(JSON.stringify(ANTHROPIC_TOOLS)));
  });

  it('with grounding, both providers get the closed choices on every round', async () => {
    let round = 0;
    global.fetch = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      round++;
      const reply =
        round === 1
          ? { content: [{ type: 'tool_use', id: 't1', name: 'total_spent', input: { period: 'this_month', category: 'Dining Out' } }] }
          : { content: [{ type: 'text', text: 'done' }] };
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as typeof fetch;
    const executeTool = jest.fn(() => ({ amountMinor: 100, count: 1, notes: [] }));
    const r = await runAnthropicQueryLoop('how much eating out', 'k', 'm', NOW, 'SGD', executeTool, { grounding: GROUNDING });
    expect(r?.calls[0]?.params.category).toBe('Dining Out');
    for (const b of bodies) {
      const tools = b.tools as Array<{ name: string; input_schema: unknown }>;
      expect(schemaOf(tools, 'total_spent').properties.category!.enum).toContain('Dining Out');
    }

    bodies = [];
    global.fetch = capture({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    await runOpenAiQueryLoop('how much eating out', 'k', 'm', NOW, 'SGD', jest.fn(), { grounding: GROUNDING });
    const tools = bodies[0]!.tools as Array<{ function: { name: string; parameters: Schema } }>;
    const spent = tools.find((t) => t.function.name === 'total_spent')!.function.parameters;
    expect(spent.properties.category!.enum).toEqual(['Food', 'Dining Out', UNSPECIFIED_CHOICE]);
    expect(OPENAI_TOOLS.length).toBe(tools.length);
  });

  it('a model that answers "unspecified" runs unfiltered, not as an unknown name', async () => {
    let round = 0;
    global.fetch = (async () => {
      round++;
      const reply =
        round === 1
          ? { content: [{ type: 'tool_use', id: 't1', name: 'total_spent', input: { period: 'this_month', category: UNSPECIFIED_CHOICE } }] }
          : { content: [{ type: 'text', text: 'done' }] };
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as typeof fetch;
    const executeTool = jest.fn(() => ({ amountMinor: 1, count: 1, notes: [] }));
    const r = await runAnthropicQueryLoop('how much this month', 'k', 'm', NOW, 'SGD', executeTool, { grounding: GROUNDING });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(r?.calls[0]?.params.category).toBe(UNSPECIFIED_CHOICE);
  });
});

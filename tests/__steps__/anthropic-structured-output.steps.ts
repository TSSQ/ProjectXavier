import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { AnthropicOutputMode, anthropicOutputMode } from '../../src/domain/byokSampling';
import {
  anthropicStructuredOutputSchema,
  extractAnthropicStructuredOutput,
} from '../../src/domain/cloudParseTransport';
import { anthropicParseResult, fetchAnthropicRaw } from '../../src/features/ai/engines/anthropic';
import {
  ACCOUNT_PARSE_CONTRACT,
  ACCOUNT_UPDATE_PARSE_CONTRACT,
  CloudParseContext,
  EXPENSE_PARSE_CONTRACT,
  TRANSACTION_OP_PARSE_CONTRACT,
} from '../../src/features/ai/engines/shared';
import { testByokKey } from '../../src/features/ai/testKey';
import { runAnthropicQueryLoop } from '../../src/features/ai/queryLoop';

const feature = loadFeature(path.resolve(__dirname, '../__features__/anthropic-structured-output.feature'));

const FIELDS = {
  isTransaction: true,
  type: 'expense',
  category: 'Coffee',
  payee: 'Starbucks',
  account: '',
  note: '',
  confidence: 0.9,
  pending: false,
};

function ctx(): CloudParseContext {
  return { categories: [], payees: [], accounts: [], now: Date.UTC(2026, 0, 1), currency: 'USD' };
}

/** Reply fixtures, shaped like `/v1/messages` bodies. */
function reply(kind: string): unknown {
  const json = JSON.stringify(FIELDS);
  switch (kind) {
    case 'json-text':
      return { id: 'msg_1', stop_reason: 'end_turn', content: [{ type: 'text', text: json }] };
    case 'thinking-then-json-text':
      return {
        id: 'msg_1',
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: json },
        ],
      };
    case 'text-not-json':
      return { id: 'msg_1', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry, no.' }] };
    case 'json-is-an-array':
      return { id: 'msg_1', stop_reason: 'end_turn', content: [{ type: 'text', text: '[1,2]' }] };
    case 'json-is-a-number':
      return { id: 'msg_1', stop_reason: 'end_turn', content: [{ type: 'text', text: '5' }] };
    case 'no-text-block':
      return { id: 'msg_1', stop_reason: 'end_turn', content: [] };
    case 'tool-use-only':
      return { id: 'msg_1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'record_expense', input: FIELDS }] };
    case 'stop-refusal':
      return { id: 'msg_1', stop_reason: 'refusal', content: [{ type: 'text', text: json }] };
    case 'stop-max-tokens':
      return { id: 'msg_1', stop_reason: 'max_tokens', content: [{ type: 'text', text: json.slice(0, 20) }] };
    case 'content-not-an-array':
      return { id: 'msg_1', content: 'nope' };
    case 'non-object-response':
      return 'not an object';
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

/** A fetch stub answering in whatever shape the request asked for. */
function replyInRequestedShape(bodies: Array<Record<string, unknown>>): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    bodies.push(body);
    return new Response(JSON.stringify(reply(body.output_config ? 'json-text' : 'tool-use-only')), { status: 200 });
  }) as typeof fetch;
}

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    visit(rec);
    for (const [k, v] of Object.entries(rec)) {
      if (k === 'properties' && v && typeof v === 'object') Object.values(v).forEach((p) => walk(p, visit));
      else if (k !== 'enum' && k !== 'required') walk(v, visit);
    }
  }
}

const CONTRACT_SCHEMAS = (): Array<Record<string, unknown>> =>
  [EXPENSE_PARSE_CONTRACT, ACCOUNT_PARSE_CONTRACT, ACCOUNT_UPDATE_PARSE_CONTRACT, TRANSACTION_OP_PARSE_CONTRACT].flatMap(
    (c) => ['coffee 5', 'lunch 12 and coffee 4', 'paid rent', 'spent twenty on lunch'].map((t) => c.jsonSchema(t))
  );

defineFeature(feature, (test) => {
  let originalFetch: typeof fetch;
  let bodies: Array<Record<string, unknown>>;

  beforeEach(() => {
    originalFetch = global.fetch;
    bodies = [];
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('The output mode is picked from the model id', ({ when, then }) => {
    let mode: AnthropicOutputMode;
    when(/^I pick the Anthropic output mode for "(.*)"$/, (model: string) => {
      mode = anthropicOutputMode(model);
    });
    then(/^the output mode should be "(.*)"$/, (expected: string) => {
      expect(mode).toBe(expected);
    });
  });

  test('The structured-output reply yields the object in its text block', ({ given, when, then }) => {
    let response: unknown;
    let out: unknown;
    given(/^an Anthropic structured-output reply of kind "(.*)"$/, (kind: string) => {
      response = reply(kind);
    });
    when('I extract the Anthropic structured output', () => {
      out = extractAnthropicStructuredOutput(response);
    });
    then(/^the structured output should be "(.*)"$/, (outcome: string) => {
      if (outcome === 'object') expect(out).toEqual(FIELDS);
      else expect(out).toBeNull();
    });
  });

  test('Every contract schema is made acceptable to structured outputs', ({ when, then, and }) => {
    let originals: Array<Record<string, unknown>>;
    let adapted: Array<Record<string, unknown>>;
    when("I adapt every parse contract's schema for structured outputs", () => {
      originals = CONTRACT_SCHEMAS();
      adapted = originals.map(anthropicStructuredOutputSchema);
    });
    then('no adapted schema carries "$schema" or a numeric or length constraint', () => {
      const banned = ['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength'];
      for (const s of adapted) walk(s, (n) => banned.forEach((k) => expect(n).not.toHaveProperty([k])));
      // The adapter also strips them when a schema does carry them.
      const loose = anthropicStructuredOutputSchema({
        type: 'object',
        properties: { minimum: { type: 'number', minimum: 0, maximum: 9 }, s: { type: 'string', maxLength: 3 } },
        additionalProperties: true,
      });
      expect(loose).toEqual({
        type: 'object',
        properties: { minimum: { type: 'number' }, s: { type: 'string' } },
        additionalProperties: false,
      });
    });
    and('every adapted object schema sets additionalProperties to false', () => {
      for (const s of adapted) walk(s, (n) => {
        if (n.type === 'object') expect(n.additionalProperties).toBe(false);
      });
    });
    and('the adapted schemas keep their properties, enums and required lists', () => {
      adapted.forEach((s, i) => {
        const rest = { ...originals[i]! };
        delete rest.$schema;
        expect(s).toEqual(rest);
      });
      // Never mutates the contract's own schema.
      expect(originals.every((s) => '$schema' in s)).toBe(true);
    });
  });

  test('The request body matches the output mode', ({ given, when, then, and }) => {
    let raw: unknown;
    given('a mocked Anthropic reply in the requested shape', () => {
      global.fetch = replyInRequestedShape(bodies);
    });
    when(/^I call fetchAnthropicRaw for model "(.*)" with EXPENSE_PARSE_CONTRACT$/, async (model: string) => {
      ({ raw } = await fetchAnthropicRaw('coffee 5', ctx(), 'sk-ant-test', model, new AbortController().signal, EXPENSE_PARSE_CONTRACT));
    });
    then(/^the request should ask for "(.*)"$/, (mode: string) => {
      const body = bodies[0]!;
      if (mode === 'structured_output') {
        expect(body).not.toHaveProperty('tools');
        expect(body).not.toHaveProperty('tool_choice');
        const format = (body.output_config as { format: Record<string, unknown> }).format;
        expect(format.type).toBe('json_schema');
        expect(format.schema).toEqual(anthropicStructuredOutputSchema(EXPENSE_PARSE_CONTRACT.jsonSchema('coffee 5')));
      } else {
        expect(body).not.toHaveProperty('output_config');
        expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_expense' });
        expect((body.tools as Array<{ input_schema: unknown }>)[0]!.input_schema).toEqual(EXPENSE_PARSE_CONTRACT.jsonSchema('coffee 5'));
      }
    });
    and('the raw object should be returned', () => {
      expect(raw).toEqual(FIELDS);
    });
  });

  test('A parse reads only the reply shape its mode asked for', ({ given, when, then }) => {
    let outcome: string;
    given(/^a mocked Anthropic reply of kind "(.*)"$/, (kind: string) => {
      const status = /^status (\d+)$/.exec(kind);
      global.fetch = (async () =>
        status
          ? new Response(JSON.stringify({ error: { message: 'nope' } }), { status: Number(status[1]) })
          : new Response(JSON.stringify(reply(kind)), { status: 200 })) as typeof fetch;
    });
    when(/^I run anthropicParseResult for model "(.*)" and text "(.*)"$/, async (model: string, text: string) => {
      const r = await anthropicParseResult(text, ctx(), 'sk-ant-test', model, EXPENSE_PARSE_CONTRACT);
      outcome = r.ok ? 'ok' : r.reason;
    });
    then(/^the Anthropic parse outcome should be "(.*)"$/, (expected: string) => {
      expect(outcome).toBe(expected);
    });
  });

  test('Test key round-trips on both paths', ({ given, when, then }) => {
    let result: string;
    given('a mocked Anthropic reply in the requested shape', () => {
      global.fetch = replyInRequestedShape(bodies);
    });
    when(/^I test an Anthropic key on model "(.*)"$/, async (model: string) => {
      result = await testByokKey('anthropic', 'sk-ant-test', model);
    });
    then(/^the test-key result should be "(.*)"$/, (expected: string) => {
      expect(result).toBe(expected);
    });
  });

  test('The question loop never forces a tool', ({ given, when, then, and }) => {
    let result: Awaited<ReturnType<typeof runAnthropicQueryLoop>>;
    given('a mocked Anthropic question loop that calls one tool and then answers', () => {
      global.fetch = (async (_url: unknown, init?: { body?: string }) => {
        bodies.push(JSON.parse(init?.body ?? '{}'));
        const body =
          bodies.length === 1
            ? { id: 'msg_1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'total_spent', input: { period: 'this_month' } }] }
            : { id: 'msg_2', stop_reason: 'end_turn', content: [{ type: 'text', text: 'You spent SGD 5.00.' }] };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;
    });
    when(/^I run the Anthropic question loop on model "(.*)"$/, async (model: string) => {
      result = await runAnthropicQueryLoop('how much did I spend this month', 'sk-ant-test', model, Date.UTC(2026, 6, 15), 'SGD', () => ({
        amountMinor: 500,
        count: 1,
        notes: [],
      }));
    });
    then('no request should carry a forced tool_choice', () => {
      expect(bodies.length).toBeGreaterThan(0);
      for (const b of bodies) {
        const choice = b.tool_choice as { type?: string } | undefined;
        expect(choice === undefined || choice.type === 'auto' || choice.type === 'none').toBe(true);
      }
    });
    and('the loop should return the tool call and the narration', () => {
      expect(result?.calls.map((c) => c.tool)).toEqual(['total_spent']);
      expect(result?.narration).toBe('You spent SGD 5.00.');
    });
  });
});

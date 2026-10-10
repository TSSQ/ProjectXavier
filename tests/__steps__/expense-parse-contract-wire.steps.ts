import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { fetchOpenAiRaw, openaiParse, openaiParseResult } from '../../src/features/ai/engines/openai';
import { fetchAnthropicRaw, anthropicParse, anthropicParseResult } from '../../src/features/ai/engines/anthropic';
import { CloudParseContext, CloudParseResult, EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared';
import { AiParsedExpense } from '../../src/lib/validation';
import { AccountExtraction } from '../../src/domain/accountParsePrompt';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/expense-parse-contract-wire.feature')
);

function testCtx(currency = 'USD'): CloudParseContext {
  return { categories: [], payees: [], accounts: [], now: Date.UTC(2026, 0, 1), currency };
}

// Reviewer follow-up: "the result must make it a COMPILE error to get the
// wrong contract — no `as unknown as`". Before the fix, `contract` had a
// generic default (`= EXPENSE_PARSE_CONTRACT as unknown as ParseContract<T>`)
// that let BOTH of the snippets below compile while silently running the
// expense contract at runtime. Neither function is ever called (arrow bodies
// only, wrapped in `void` so eslint doesn't flag them as unused) — this is a
// type-level assertion: ts-jest type-checks this file, so if either
// `@ts-expect-error` directive turns out to be unnecessary (i.e. the bad call
// now compiles again), TS itself fails the whole suite with "Unused
// '@ts-expect-error' directive".
function _omittedContractDoesNotCompile() {
  // @ts-expect-error — contract is a required 6th argument; omitting it must not compile.
  return fetchOpenAiRaw('x', testCtx(), 'k', 'm', new AbortController().signal);
}
function _mismatchedContractDoesNotCompile() {
  // @ts-expect-error — EXPENSE_PARSE_CONTRACT (ParseContract<AiParsedExpense>) is not
  // assignable to ParseContract<AccountExtraction>; a mismatched T + contract must not compile.
  return openaiParse<AccountExtraction>('x', testCtx(), 'k', 'm', EXPENSE_PARSE_CONTRACT);
}
void _omittedContractDoesNotCompile;
void _mismatchedContractDoesNotCompile;

// Shaped like the step-2/3 contract's output (src/domain/fmParse.ts):
// `isTransaction` is the model's log-or-refuse verdict, and `amount` is only
// read for a text whose plan asks the model for it (the "coffee 5" / "coffee
// 500" texts below are single-reading, so code supplies the amount).
const SAMPLE_EXPENSE_FIELDS = {
  isTransaction: true,
  amount: 5,
  type: 'expense',
  category: 'Coffee',
  payee: 'Starbucks',
  account: '',
  confidence: 0.9,
  pending: false,
};

function openAiSuccessResponseBody(fields: Record<string, unknown> = SAMPLE_EXPENSE_FIELDS): unknown {
  return {
    choices: [{ message: { role: 'assistant', content: JSON.stringify(fields) } }],
  };
}

function anthropicSuccessResponseBody(fields: Record<string, unknown> = SAMPLE_EXPENSE_FIELDS): unknown {
  return {
    id: 'msg_1',
    content: [{ type: 'tool_use', id: 'toolu_1', input: fields }],
  };
}

/** A fetch stub for the failure outlines: a non-2xx status, a thrown
 *  transport error, or a 2xx whose body is unusable in some way. */
function mockFetchOfKind(provider: 'OpenAI' | 'Anthropic', kind: string): typeof fetch {
  const statusMatch = /^status (\d+)$/.exec(kind);
  const throwsMatch = /^throws (\w+)$/.exec(kind);
  return (async () => {
    if (statusMatch) {
      return new Response(JSON.stringify({ error: { message: 'nope' } }), {
        status: Number(statusMatch[1]),
      });
    }
    if (throwsMatch) {
      const name = throwsMatch[1] ?? 'Error';
      const err = new Error('boom');
      err.name = name;
      // Mirror the DOM's AbortError/TypeError shape closely enough: the
      // engine only ever reads the constructor name for its warn label.
      throw name === 'TypeError' ? new TypeError('boom') : err;
    }
    let body: unknown;
    switch (kind) {
      case '200 unparsable body':
        body = provider === 'OpenAI'
          ? { choices: [{ message: { content: 'not json' } }] }
          : { content: [{ type: 'tool_use', input: 'not a record' }] };
        break;
      case '200 schema-invalid': {
        // A category longer than aiParsedExpenseSchema's 60-char cap survives
        // normalizeDeviceParseOutput untouched and then fails re-validation.
        const fields = { ...SAMPLE_EXPENSE_FIELDS, category: 'x'.repeat(80) };
        body = provider === 'OpenAI'
          ? openAiSuccessResponseBody(fields)
          : anthropicSuccessResponseBody(fields);
        break;
      }
      case '200 no tool_use':
        body = { id: 'msg_1', content: [{ type: 'text', text: 'Sorry, no.' }] };
        break;
      default:
        throw new Error(`unknown kind ${kind}`);
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

defineFeature(feature, (test) => {
  let capturedBody: Record<string, unknown>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('fetchOpenAiRaw with EXPENSE_PARSE_CONTRACT keeps json_schema.name "expense"', ({
    given,
    when,
    then,
  }) => {
    given('a mocked OpenAI success response', () => {
      global.fetch = (async (_url: unknown, init?: { body?: string }) => {
        capturedBody = JSON.parse(init?.body ?? '{}');
        return new Response(JSON.stringify(openAiSuccessResponseBody()), { status: 200 });
      }) as typeof fetch;
    });

    when('I call fetchOpenAiRaw with EXPENSE_PARSE_CONTRACT', async () => {
      const controller = new AbortController();
      await fetchOpenAiRaw(
        'coffee 5',
        testCtx(),
        'sk-test',
        'gpt-4o-mini',
        controller.signal,
        EXPENSE_PARSE_CONTRACT
      );
    });

    then(
      /^the captured request body's response_format\.json_schema\.name should be "(.*)"$/,
      (expected: string) => {
        const responseFormat = capturedBody.response_format as { json_schema: { name: string } };
        expect(responseFormat.json_schema.name).toBe(expected);
      }
    );
  });

  test('fetchAnthropicRaw with EXPENSE_PARSE_CONTRACT keeps the "record_expense" tool', ({
    given,
    when,
    then,
    and,
  }) => {
    given('a mocked Anthropic success response', () => {
      global.fetch = (async (_url: unknown, init?: { body?: string }) => {
        capturedBody = JSON.parse(init?.body ?? '{}');
        return new Response(JSON.stringify(anthropicSuccessResponseBody()), { status: 200 });
      }) as typeof fetch;
    });

    when('I call fetchAnthropicRaw with EXPENSE_PARSE_CONTRACT', async () => {
      const controller = new AbortController();
      await fetchAnthropicRaw(
        'coffee 5',
        testCtx(),
        'sk-ant-test',
        'claude-3-5-haiku-latest',
        controller.signal,
        EXPENSE_PARSE_CONTRACT
      );
    });

    then(
      /^the captured request body's tools\[0\]\.name should be "(.*)"$/,
      (expected: string) => {
        const tools = capturedBody.tools as Array<{ name: string }>;
        expect(tools[0]?.name).toBe(expected);
      }
    );
    and(
      /^the captured request body's tool_choice\.name should be "(.*)"$/,
      (expected: string) => {
        const toolChoice = capturedBody.tool_choice as { name: string };
        expect(toolChoice.name).toBe(expected);
      }
    );
  });
  test('temperature 0 is sent only to models that accept it', ({ given, when, then }) => {
    given(/^a mocked (OpenAI|Anthropic) success response$/, (provider: string) => {
      global.fetch = (async (_url: unknown, init?: { body?: string }) => {
        capturedBody = JSON.parse(init?.body ?? '{}');
        const body =
          provider === 'OpenAI' ? openAiSuccessResponseBody() : anthropicSuccessResponseBody();
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;
    });

    when(
      /^I call the (OpenAI|Anthropic) raw fetch for model "(.*)" with EXPENSE_PARSE_CONTRACT$/,
      async (provider: string, model: string) => {
        const signal = new AbortController().signal;
        if (provider === 'OpenAI') {
          await fetchOpenAiRaw('coffee 5', testCtx(), 'sk-test', model, signal, EXPENSE_PARSE_CONTRACT);
        } else {
          await fetchAnthropicRaw('coffee 5', testCtx(), 'sk-ant-test', model, signal, EXPENSE_PARSE_CONTRACT);
        }
      }
    );

    then(/^the captured request body's temperature should be (.*)$/, (expected: string) => {
      if (expected === 'absent') {
        expect('temperature' in capturedBody).toBe(false);
      } else {
        expect(capturedBody.temperature).toBe(Number(expected));
      }
    });
  });

  // The currency scaling bug: normalizeExpenseParse used to call
  // normalizeDeviceParseOutput/applyGroundingGuards with no currency, so a
  // JPY "coffee 500" via BYOK stored 50000 minor units.
  const amountScenario = (title: string) =>
    test(title, ({ given, when, then }) => {
      let result: CloudParseResult<AiParsedExpense>;

      given(/^a mocked Anthropic success response with amount (\d+)$/, (amount: string) => {
        global.fetch = (async () =>
          new Response(
            JSON.stringify(anthropicSuccessResponseBody({ ...SAMPLE_EXPENSE_FIELDS, amount: Number(amount) })),
            { status: 200 }
          )) as typeof fetch;
      });

      when(
        /^I run anthropicParseResult for text "(.*)" in currency "(.*)"$/,
        async (text: string, currency: string) => {
          result = await anthropicParseResult(
            text,
            testCtx(currency),
            'sk-ant-test',
            'claude-haiku-4-5',
            EXPENSE_PARSE_CONTRACT
          );
        }
      );

      then(/^the cloud parse should succeed with amount (\d+) minor$/, (minor: string) => {
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.amount).toBe(Number(minor));
      });
    });
  amountScenario('A JPY amount read by a cloud model is stored in minor units of the app currency');
  amountScenario('The same amount in a 2-decimal currency scales by 100');

  test('A failed BYOK request reports a key-free reason instead of a bare null', ({
    given,
    when,
    then,
    and,
  }) => {
    let provider: 'OpenAI' | 'Anthropic';
    let text: string;
    let result: CloudParseResult<AiParsedExpense>;

    given(/^a mocked (OpenAI|Anthropic) response of kind "(.*)"$/, (p: string, kind: string) => {
      provider = p as 'OpenAI' | 'Anthropic';
      global.fetch = mockFetchOfKind(provider, kind);
    });

    when(/^I run the (OpenAI|Anthropic) parse result for text "(.*)"$/, async (_p: string, t: string) => {
      text = t;
      result =
        provider === 'OpenAI'
          ? await openaiParseResult(text, testCtx(), 'sk-test', 'gpt-4.1-mini', EXPENSE_PARSE_CONTRACT)
          : await anthropicParseResult(text, testCtx(), 'sk-ant-test', 'claude-haiku-4-5', EXPENSE_PARSE_CONTRACT);
    });

    then(/^the cloud parse should fail with reason "(.*)"$/, (reason: string) => {
      expect(result).toEqual({ ok: false, reason });
    });

    and(/^the (OpenAI|Anthropic) parse value-or-null wrapper should be null$/, async () => {
      const value =
        provider === 'OpenAI'
          ? await openaiParse(text, testCtx(), 'sk-test', 'gpt-4.1-mini', EXPENSE_PARSE_CONTRACT)
          : await anthropicParse(text, testCtx(), 'sk-ant-test', 'claude-haiku-4-5', EXPENSE_PARSE_CONTRACT);
      expect(value).toBeNull();
    });
  });
});

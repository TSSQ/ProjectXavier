import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { fetchOpenAiRaw, openaiParse } from '../../src/features/ai/engines/openai';
import { fetchAnthropicRaw } from '../../src/features/ai/engines/anthropic';
import { CloudParseContext, EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared';
import { AccountExtraction } from '../../src/domain/accountParsePrompt';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/expense-parse-contract-wire.feature')
);

function testCtx(): CloudParseContext {
  return { categories: [], payees: [], accounts: [], now: Date.UTC(2026, 0, 1) };
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

const SAMPLE_EXPENSE_FIELDS = {
  amount: 5,
  type: 'expense',
  category: 'Coffee',
  payee: 'Starbucks',
  account: '',
  confidence: 0.9,
  pending: false,
};

function openAiSuccessResponseBody(): unknown {
  return {
    choices: [{ message: { role: 'assistant', content: JSON.stringify(SAMPLE_EXPENSE_FIELDS) } }],
  };
}

function anthropicSuccessResponseBody(): unknown {
  return {
    id: 'msg_1',
    content: [{ type: 'tool_use', id: 'toolu_1', input: SAMPLE_EXPENSE_FIELDS }],
  };
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
});

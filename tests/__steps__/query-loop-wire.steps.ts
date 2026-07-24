/**
 * BDD suite for src/features/ai/queryLoop.ts (docs/design/ask-xavier-
 * queries-spec.md §5.3/§7 acceptance #5) — fetch-mocked, mirroring
 * tests/__steps__/expense-parse-contract-wire.steps.ts's approach: capture
 * the exact request bodies sent to each provider and assert on their shape,
 * plus the round-cap/timeout/never-throws/never-logs-key behavior. Tool
 * EXECUTION is injected (a plain jest mock), so no real DB/grounding data is
 * needed here — only the wire format and control flow are under test (the
 * tools' own math is covered by tests/__steps__/query-tools.steps.ts).
 */
import {
  runAnthropicQueryLoop,
  runOpenAiQueryLoop,
  MAX_TOOL_ROUNDS,
} from '../../src/features/ai/queryLoop';
import { QUERY_TOOL_NAMES } from '../../src/domain/queryTools';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function anthropicTextResponse(text: string): unknown {
  return { id: 'msg_1', content: [{ type: 'text', text }] };
}

function anthropicToolUseResponse(name: string, input: unknown, id = 'toolu_1'): unknown {
  return { id: 'msg_1', content: [{ type: 'tool_use', id, name, input }] };
}

function openAiTextResponse(text: string): unknown {
  return { choices: [{ message: { role: 'assistant', content: text } }] };
}

function openAiToolCallResponse(name: string, args: unknown, id = 'call_1'): unknown {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

describe('runAnthropicQueryLoop — wire format', () => {
  let originalFetch: typeof fetch;
  let capturedBodies: Record<string, unknown>[];

  beforeEach(() => {
    originalFetch = global.fetch;
    capturedBodies = [];
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends all 7 tools with exact names, and never leaks the key in the request URL/headers capture', async () => {
    global.fetch = (async (_url: unknown, init?: { body?: string }) => {
      capturedBodies.push(JSON.parse(init?.body ?? '{}'));
      return new Response(JSON.stringify(anthropicTextResponse('all good')), { status: 200 });
    }) as typeof fetch;

    const executeTool = jest.fn();
    const result = await runAnthropicQueryLoop('how much did I spend', 'sk-ant-test', 'claude-x', NOW, executeTool);

    expect(result).not.toBeNull();
    expect(result?.narration).toBe('all good');
    expect(result?.calls).toEqual([]);
    const tools = capturedBodies[0]!.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name).sort()).toEqual([...QUERY_TOOL_NAMES].sort());
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('threads a tool_use round into a tool_result reply, executes the tool, and returns the final narration', async () => {
    let call = 0;
    global.fetch = (async (_url: unknown, init?: { body?: string }) => {
      capturedBodies.push(JSON.parse(init?.body ?? '{}'));
      call++;
      if (call === 1) {
        return new Response(
          JSON.stringify(anthropicToolUseResponse('total_spent', { period: 'this_month' })),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(anthropicTextResponse('You spent a lot.')), { status: 200 });
    }) as typeof fetch;

    const executeTool = jest.fn().mockReturnValue({ amountMinor: 1234, count: 1, notes: [] });
    const result = await runAnthropicQueryLoop('how much did I spend', 'sk-ant-test', 'claude-x', NOW, executeTool);

    expect(executeTool).toHaveBeenCalledWith('total_spent', { period: 'this_month' });
    expect(result?.calls).toEqual([
      { tool: 'total_spent', params: { period: 'this_month' }, result: { amountMinor: 1234, count: 1, notes: [] } },
    ]);
    expect(result?.narration).toBe('You spent a lot.');

    // Second request's messages must carry a tool_result block referencing
    // the SAME tool_use_id the first response returned.
    const secondBody = capturedBodies[1]!;
    const messages = secondBody.messages as Array<{ role: string; content: unknown }>;
    const toolResultMessage = messages.find((m) => m.role === 'user' && Array.isArray(m.content) && (m.content as Array<{type:string}>).some(b=>b.type==='tool_result'));
    expect(toolResultMessage).toBeDefined();
    const block = (toolResultMessage!.content as Array<{ type: string; tool_use_id: string }>).find(
      (b) => b.type === 'tool_result'
    );
    expect(block?.tool_use_id).toBe('toolu_1');
  });

  it('caps at MAX_TOOL_ROUNDS tool-calling rounds, then forces one final tool-free narration request', async () => {
    let fetchCount = 0;
    global.fetch = (async (_url: unknown, init?: { body?: string }) => {
      fetchCount++;
      const body = JSON.parse(init?.body ?? '{}');
      capturedBodies.push(body);
      if (fetchCount <= MAX_TOOL_ROUNDS) {
        return new Response(
          JSON.stringify(anthropicToolUseResponse('total_spent', { period: 'this_month' }, `toolu_${fetchCount}`)),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(anthropicTextResponse('final answer')), { status: 200 });
    }) as typeof fetch;

    const executeTool = jest.fn().mockReturnValue({ ok: true });
    const result = await runAnthropicQueryLoop('compare things', 'sk-ant-test', 'claude-x', NOW, executeTool);

    expect(fetchCount).toBe(MAX_TOOL_ROUNDS + 1); // 3 tool rounds + 1 forced narration
    expect(result?.calls.length).toBe(MAX_TOOL_ROUNDS);
    expect(result?.narration).toBe('final answer');
    // The final forced-narration request must not offer tools at all.
    const finalBody = capturedBodies[capturedBodies.length - 1]!;
    expect(finalBody.tools).toBeUndefined();
  });

  it('never throws on a network failure — resolves to null, and logs no key', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const result = await runAnthropicQueryLoop('how much did I spend', 'sk-ant-SECRET', 'claude-x', NOW, jest.fn());
    expect(result).toBeNull();
    for (const call of warnSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sk-ant-SECRET');
    }
    warnSpy.mockRestore();
  });

  it('never throws on a non-2xx response — resolves to null', async () => {
    global.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    const result = await runAnthropicQueryLoop('how much did I spend', 'bad-key', 'claude-x', NOW, jest.fn());
    expect(result).toBeNull();
  });
});

describe('runOpenAiQueryLoop — wire format', () => {
  let originalFetch: typeof fetch;
  let capturedBodies: Record<string, unknown>[];

  beforeEach(() => {
    originalFetch = global.fetch;
    capturedBodies = [];
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends all 7 tools as function-tool defs with exact names', async () => {
    global.fetch = (async (_url: unknown, init?: { body?: string }) => {
      capturedBodies.push(JSON.parse(init?.body ?? '{}'));
      return new Response(JSON.stringify(openAiTextResponse('all good')), { status: 200 });
    }) as typeof fetch;

    const executeTool = jest.fn();
    const result = await runOpenAiQueryLoop('how much did I spend', 'sk-test', 'gpt-x', NOW, executeTool);

    expect(result?.narration).toBe('all good');
    const tools = capturedBodies[0]!.tools as Array<{ type: string; function: { name: string } }>;
    expect(tools.every((t) => t.type === 'function')).toBe(true);
    expect(tools.map((t) => t.function.name).sort()).toEqual([...QUERY_TOOL_NAMES].sort());
  });

  it('threads a tool_calls round into tool-role replies and executes the tool', async () => {
    let call = 0;
    global.fetch = (async (_url: unknown, init?: { body?: string }) => {
      capturedBodies.push(JSON.parse(init?.body ?? '{}'));
      call++;
      if (call === 1) {
        return new Response(
          JSON.stringify(openAiToolCallResponse('total_spent', { period: 'this_month' })),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(openAiTextResponse('You spent a lot.')), { status: 200 });
    }) as typeof fetch;

    const executeTool = jest.fn().mockReturnValue({ amountMinor: 1234, count: 1, notes: [] });
    const result = await runOpenAiQueryLoop('how much did I spend', 'sk-test', 'gpt-x', NOW, executeTool);

    expect(executeTool).toHaveBeenCalledWith('total_spent', { period: 'this_month' });
    expect(result?.calls[0]?.tool).toBe('total_spent');
    expect(result?.narration).toBe('You spent a lot.');

    const secondBody = capturedBodies[1]!;
    const messages = secondBody.messages as Array<{ role: string; tool_call_id?: string }>;
    const toolMessage = messages.find((m) => m.role === 'tool');
    expect(toolMessage?.tool_call_id).toBe('call_1');
  });

  it('caps at MAX_TOOL_ROUNDS tool-calling rounds, then forces one final tool-free narration request', async () => {
    let fetchCount = 0;
    global.fetch = (async (_url: unknown, init?: { body?: string }) => {
      fetchCount++;
      const body = JSON.parse(init?.body ?? '{}');
      capturedBodies.push(body);
      if (fetchCount <= MAX_TOOL_ROUNDS) {
        return new Response(
          JSON.stringify(openAiToolCallResponse('total_spent', { period: 'this_month' }, `call_${fetchCount}`)),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(openAiTextResponse('final answer')), { status: 200 });
    }) as typeof fetch;

    const result = await runOpenAiQueryLoop(
      'compare things',
      'sk-test',
      'gpt-x',
      NOW,
      jest.fn().mockReturnValue({ ok: true })
    );

    expect(fetchCount).toBe(MAX_TOOL_ROUNDS + 1);
    expect(result?.calls.length).toBe(MAX_TOOL_ROUNDS);
    expect(result?.narration).toBe('final answer');
    const finalBody = capturedBodies[capturedBodies.length - 1]!;
    expect(finalBody.tools).toBeUndefined();
  });

  it('never throws on a network failure — resolves to null, and logs no key', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const result = await runOpenAiQueryLoop('how much did I spend', 'sk-SECRET', 'gpt-x', NOW, jest.fn());
    expect(result).toBeNull();
    for (const call of warnSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sk-SECRET');
    }
    warnSpy.mockRestore();
  });
});

// ─── QA BLOCKER 2: a malformed model tool call must never throw or hang ────
// The model's tool call (name + params) is untrusted input. Before the fix,
// params were only shape-checked (coerceToolParams), never schema-validated,
// so (a) a tool call missing a REQUIRED param (e.g. `period`) reached
// `resolvePeriodRange`, which threw on `undefined.startsWith(...)`, and (b)
// an out-of-enum `granularity` ("fortnight") reached `spendingOverTime`'s
// bucket-building loop, whose cursor never advanced — an infinite loop. Both
// must now resolve to a SAFE result (the invalid call rejected before
// execution, never counted in `calls`) in bounded time, never throwing.
describe('runAnthropicQueryLoop / runOpenAiQueryLoop — malformed tool-call safety (QA BLOCKER)', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it(
    'Anthropic: a tool_use missing the required "period" param never throws, never executes the tool, and still reaches a narration',
    async () => {
      let call = 0;
      global.fetch = (async () => {
        call++;
        if (call === 1) {
          // Missing `period` entirely — total_spent's zod schema requires it.
          return new Response(
            JSON.stringify(anthropicToolUseResponse('total_spent', { category: 'Dining' })),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify(anthropicTextResponse('done')), { status: 200 });
      }) as typeof fetch;

      const executeTool = jest.fn();
      const result = await runAnthropicQueryLoop('how much did I spend', 'sk-ant-test', 'claude-x', NOW, executeTool);

      expect(result).not.toBeNull();
      expect(result?.calls).toEqual([]); // the invalid call was never executed
      expect(executeTool).not.toHaveBeenCalled();
      expect(result?.narration).toBe('done');
    },
    2000
  );

  it(
    'Anthropic: a tool_use with an out-of-enum "granularity" never throws, never executes the tool, and completes quickly',
    async () => {
      let call = 0;
      global.fetch = (async () => {
        call++;
        if (call === 1) {
          return new Response(
            JSON.stringify(
              anthropicToolUseResponse('spending_over_time', { period: 'this_month', granularity: 'fortnight' })
            ),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify(anthropicTextResponse('done')), { status: 200 });
      }) as typeof fetch;

      const executeTool = jest.fn();
      const result = await runAnthropicQueryLoop('chart my spending', 'sk-ant-test', 'claude-x', NOW, executeTool);

      expect(result).not.toBeNull();
      expect(result?.calls).toEqual([]);
      expect(executeTool).not.toHaveBeenCalled();
      expect(result?.narration).toBe('done');
    },
    2000
  );

  it(
    'OpenAI: a tool call missing the required "period" param never throws, never executes the tool, and still reaches a narration',
    async () => {
      let call = 0;
      global.fetch = (async () => {
        call++;
        if (call === 1) {
          return new Response(JSON.stringify(openAiToolCallResponse('total_spent', { category: 'Dining' })), {
            status: 200,
          });
        }
        return new Response(JSON.stringify(openAiTextResponse('done')), { status: 200 });
      }) as typeof fetch;

      const executeTool = jest.fn();
      const result = await runOpenAiQueryLoop('how much did I spend', 'sk-test', 'gpt-x', NOW, executeTool);

      expect(result).not.toBeNull();
      expect(result?.calls).toEqual([]);
      expect(executeTool).not.toHaveBeenCalled();
      expect(result?.narration).toBe('done');
    },
    2000
  );

  it(
    'OpenAI: a tool call with an out-of-enum "granularity" never throws, never executes the tool, and completes quickly',
    async () => {
      let call = 0;
      global.fetch = (async () => {
        call++;
        if (call === 1) {
          return new Response(
            JSON.stringify(
              openAiToolCallResponse('spending_over_time', { period: 'this_month', granularity: 'fortnight' })
            ),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify(openAiTextResponse('done')), { status: 200 });
      }) as typeof fetch;

      const executeTool = jest.fn();
      const result = await runOpenAiQueryLoop('chart my spending', 'sk-test', 'gpt-x', NOW, executeTool);

      expect(result).not.toBeNull();
      expect(result?.calls).toEqual([]);
      expect(executeTool).not.toHaveBeenCalled();
      expect(result?.narration).toBe('done');
    },
    2000
  );

  it('a tool call with an unrecognised tool NAME never throws and never executes', async () => {
    let call = 0;
    global.fetch = (async () => {
      call++;
      if (call === 1) {
        return new Response(
          JSON.stringify(anthropicToolUseResponse('delete_everything', { period: 'this_month' })),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(anthropicTextResponse('done')), { status: 200 });
    }) as typeof fetch;

    const executeTool = jest.fn();
    const result = await runAnthropicQueryLoop('do something', 'sk-ant-test', 'claude-x', NOW, executeTool);
    expect(result?.calls).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('an executor that itself throws never propagates out of the loop', async () => {
    let call = 0;
    global.fetch = (async () => {
      call++;
      if (call === 1) {
        return new Response(
          JSON.stringify(anthropicToolUseResponse('total_spent', { period: 'this_month' })),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(anthropicTextResponse('done')), { status: 200 });
    }) as typeof fetch;

    const executeTool = jest.fn(() => {
      throw new Error('executor blew up');
    });
    const result = await runAnthropicQueryLoop('how much did I spend', 'sk-ant-test', 'claude-x', NOW, executeTool);
    expect(result).not.toBeNull();
    expect(result?.calls).toEqual([]); // the throwing call is not recorded as a real result
    expect(result?.narration).toBe('done');
  });
});

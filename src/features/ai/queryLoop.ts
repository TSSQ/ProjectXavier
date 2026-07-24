/**
 * BYOK multi-round tool loop for Ask-Xavier queries
 * (docs/design/ask-xavier-queries-spec.md §5.3) — the SAME raw-`fetch`
 * philosophy as `src/features/ai/engines/{openai,anthropic}.ts` (no Vercel AI
 * SDK `generateObject`; see those files' headers and memory
 * `byok-generateobject-rn-incompat` for why), extended to provider-NATIVE
 * tool use so a question can compose multiple tool calls ("compare dining
 * this month vs last month" = two `total_spent` calls) before a final
 * narration turn.
 *
 * Capped at `MAX_TOOL_ROUNDS` (3) rounds of tool-calling; after that, one
 * final request with tools withheld forces a plain-text narration turn no
 * matter how insistent the model is on calling more tools. Every round
 * carries its own `AbortController` timeout (`CLOUD_REQUEST_TIMEOUT_MS`,
 * reused from `engines/shared.ts`) — a hang on ANY round resolves the WHOLE
 * loop to `null` (never throws to the caller), exactly like the parse
 * engines' "any failure -> null -> fall through to the next tier" contract.
 * The key, the Authorization/x-api-key header, and any request/response body
 * are NEVER logged — only a generic, key-free label reaches `console.warn`,
 * mirroring `runCloudParse`'s hygiene.
 *
 * Tool EXECUTION is injected (`QueryToolExecutor`) rather than imported
 * directly — the caller wires it to `src/domain/queryTools.ts`'s
 * `executeQueryTool` against the already-loaded grounding data. This keeps
 * this module fetch-mockable without a real DB, and keeps the actual math
 * out of the network layer entirely ("the model plans; deterministic code
 * computes" — spec §2).
 *
 * The model's final narration is a CAPTION ONLY — every number the user sees
 * comes from a tool result, never from this text (spec §5.4). Callers should
 * treat `narration` as untrusted display copy, not a source of truth.
 *
 * ── QA device bug (build 56): never hand the model raw minor-unit integers ─
 * A tool result's `amountMinor` (e.g. `5000` for "SGD 50.00") used to be
 * serialized straight into the tool_result/tool message content via
 * `JSON.stringify(result)` — the model read the raw minor-unit integer back
 * as if it were the display amount and narrated "5,000" while the card (built
 * from the SAME result, but through the app's own currency formatter)
 * correctly showed "SGD 50.00". `safeExecuteTool` now runs the result through
 * `src/domain/queryToolResultDisplay.ts`'s `formatAmountsForModel` (currency-
 * decimals-aware — 0-decimal currencies like JPY are never divided by 100)
 * before serializing it into `content` — ONLY the model-facing copy is
 * transformed; `call.result` (what the caller's card renders from) is always
 * the untouched, raw result, exactly as `executeTool` returned it.
 *

 * ── QA BLOCKER: a malformed tool call must never throw or hang ────────────
 * The model's tool call (name + params) is untrusted input (guardrail #6) —
 * before this file only shape-checked it into a plain object
 * (`coerceToolParams`) and cast it straight to each tool's typed params with
 * an `as`, no runtime validation. Two concrete failures followed: a tool call
 * missing `period` reached `resolvePeriodRange`, which called
 * `token.startsWith(...)` on `undefined` and THREW, propagating out of the
 * loop (violating "never throws (null → fall through)"); a tool call with
 * `granularity: "fortnight"` (outside the enum) reached
 * `spendingOverTime`'s bucket-building loop, where `endOfPeriod`'s
 * unknown-granularity fallback returns the SAME instant it was given, so the
 * `while (cursor < range.end)` loop never advanced — an infinite loop (DoS).
 *
 * `safeExecuteTool` closes both: every tool call's raw params are
 * `.safeParse()`d against that tool's OWN zod schema (`QUERY_TOOL_DEFS`,
 * `src/domain/queryTools.ts` — the SAME schema shape used to build the
 * provider's native tool definition, so "what the model was told the shape
 * is" and "what we validate against" can never drift apart) BEFORE the
 * executor ever runs. A validation failure never executes the tool at all —
 * it feeds the model a `{ error }` tool_result/tool message instead (so a
 * capable model can retry with corrected params) and is not counted in
 * `calls`. The executor call itself is ALSO wrapped in try/catch (defense in
 * depth: `QueryToolExecutor`'s contract says it must never throw, but this
 * loop's OWN "never throws" contract to ITS caller can't depend on that at
 * runtime). `src/domain/queryTools.ts`'s executors carry their own
 * independent hardening too (unknown-period/-granularity fallbacks, a hard
 * bucket-count cap) — this is defense in depth, not the only line of
 * defense.
 */
import { CLOUD_REQUEST_TIMEOUT_MS } from './engines/shared';
import { isRecord } from '../../domain/cloudParseTransport';
import { QUERY_TOOL_DEFS, QueryToolName } from '../../domain/queryTools';
import { buildQueryLoopInstructions, buildQueryLoopPrompt } from '../../domain/queryLoopPrompt';
import { formatAmountsForModel } from '../../domain/queryToolResultDisplay';

export const MAX_TOOL_ROUNDS = 3;

/** Pure executor the caller supplies — normally a thin wrapper around
 *  `executeQueryTool` bound to the loaded `QueryToolContext`. Must never
 *  throw for a recognised tool name (query tools are pure); an unrecognised
 *  name should return `null` rather than throw, so one bad tool call can't
 *  crash the whole loop. */
export type QueryToolExecutor = (tool: QueryToolName, params: Record<string, unknown>) => unknown;

export interface QueryLoopToolCall {
  tool: QueryToolName;
  params: Record<string, unknown>;
  result: unknown;
}

export interface QueryLoopResult {
  /** Every tool call actually executed, in order, with its params and
   *  result — this is what a chat card is built from. */
  calls: QueryLoopToolCall[];
  /** The model's closing prose, or null if it never produced one (e.g. the
   *  final forced-narration turn itself failed) — display-only caption. */
  narration: string | null;
}

const KNOWN_TOOLS = new Set<string>(QUERY_TOOL_DEFS.map((d) => d.name));

/** Parse a tool call's raw (string or already-object) arguments into a
 *  plain record, never throwing — an unparsable/non-object payload becomes
 *  `{}`, so a malformed tool call still executes (and likely just returns an
 *  unfiltered/default result) rather than aborting the whole round. */
function coerceToolParams(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

const TOOL_DEFS_BY_NAME = new Map(QUERY_TOOL_DEFS.map((d) => [d.name, d]));

/**
 * Validate `rawParams` against `toolName`'s OWN zod schema and, only on
 * success, run the injected executor — see the module header's QA-blocker
 * note. Never throws: a validation failure OR the executor itself throwing
 * both resolve to an `{ error }` payload (fed back to the model as the
 * tool's result) with `call: null` (so it isn't recorded as a real,
 * data-backed tool call). Only a successful validate-AND-execute produces a
 * non-null `call`.
 */
function safeExecuteTool(
  toolName: QueryToolName,
  rawParams: Record<string, unknown>,
  executeTool: QueryToolExecutor,
  currency: string
): { content: string; call: QueryLoopToolCall | null } {
  const def = TOOL_DEFS_BY_NAME.get(toolName);
  if (!def) {
    return { content: JSON.stringify({ error: `unknown tool "${toolName}"` }), call: null };
  }
  const validated = def.params.safeParse(rawParams);
  if (!validated.success) {
    return { content: JSON.stringify({ error: 'invalid parameters for this tool' }), call: null };
  }
  const validParams = validated.data as Record<string, unknown>;
  try {
    const result = executeTool(toolName, validParams);
    return {
      // MODEL-FACING copy only — every amountMinor becomes a formatted
      // display string (QA device bug, build 56 — see the module header).
      content: JSON.stringify(formatAmountsForModel(result, currency) ?? null),
      // `call.result` stays the RAW result, untouched — this is what the
      // caller's card renders from, via the app's own formatter.
      call: { tool: toolName, params: validParams, result },
    };
  } catch {
    // Defense in depth — see the module header: never trust the injected
    // executor's own "never throws" contract at runtime.
    return { content: JSON.stringify({ error: 'tool execution failed' }), call: null };
  }
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) return { ok: false, status: res.status, json: null };
  return { ok: true, status: res.status, json: await res.json() };
}

/** Run one request with its own timeout, returning `null` on ANY failure
 *  (non-2xx, network error, abort) — shared by both providers' loops. */
async function timedPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  engineLabel: string
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const { ok, json } = await postJson(url, headers, body, controller.signal);
    return ok ? json : null;
  } catch (e) {
    // Deliberately key/content-free — see runCloudParse's identical rule.
    const label = e instanceof Error ? e.constructor.name : 'unknown error';
    console.warn(`${engineLabel} query loop failed:`, label);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Anthropic ──────────────────────────────────────────────────────────────

const ANTHROPIC_TOOLS = QUERY_TOOL_DEFS.map((d) => ({
  name: d.name,
  description: d.description,
  input_schema: d.jsonSchema,
}));

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export async function runAnthropicQueryLoop(
  text: string,
  apiKey: string,
  modelId: string,
  now: number,
  /** The app's display currency (e.g. "SGD") — used ONLY to format amounts
   *  in the MODEL-FACING tool_result content (see the module header's QA
   *  device-bug note); never affects `call.result`, which stays raw. */
  currency: string,
  executeTool: QueryToolExecutor
): Promise<QueryLoopResult | null> {
  try {
    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    const messages: unknown[] = [{ role: 'user', content: buildQueryLoopPrompt(text, now) }];
    const calls: QueryLoopToolCall[] = [];

    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      const body = {
        model: modelId,
        max_tokens: 1024,
        system: buildQueryLoopInstructions(),
        messages,
        tools: ANTHROPIC_TOOLS,
      };
      const json = await timedPost('https://api.anthropic.com/v1/messages', headers, body, 'anthropic');
      if (!isRecord(json) || !Array.isArray(json.content)) return null;
      const blocks = json.content as AnthropicContentBlock[];
      const toolUses = blocks.filter((b) => b.type === 'tool_use');

      if (toolUses.length === 0) {
        const narration = blocks
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return { calls, narration: narration || null };
      }

      messages.push({ role: 'assistant', content: json.content });
      const toolResults = toolUses.map((block) => {
        const toolName = KNOWN_TOOLS.has(block.name ?? '') ? (block.name as QueryToolName) : null;
        if (!toolName) {
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: 'unknown tool' }),
          };
        }
        const { content, call } = safeExecuteTool(
          toolName,
          coerceToolParams(block.input),
          executeTool,
          currency
        );
        if (call) calls.push(call);
        return { type: 'tool_result', tool_use_id: block.id, content };
      });
      messages.push({ role: 'user', content: toolResults });
    }

    // Round cap hit — force a final, tool-free narration turn.
    const finalBody = {
      model: modelId,
      max_tokens: 1024,
      system: buildQueryLoopInstructions(),
      messages,
    };
    const finalJson = await timedPost('https://api.anthropic.com/v1/messages', headers, finalBody, 'anthropic');
    if (!isRecord(finalJson) || !Array.isArray(finalJson.content)) return { calls, narration: null };
    const narration = (finalJson.content as AnthropicContentBlock[])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { calls, narration: narration || null };
  } catch (e) {
    // Absolute "never throws" backstop — see the module header. Every known
    // failure mode above already resolves to null/a safe value; this only
    // catches something truly unexpected.
    const label = e instanceof Error ? e.constructor.name : 'unknown error';
    console.warn('anthropic query loop failed:', label);
    return null;
  }
}

// ─── OpenAI ─────────────────────────────────────────────────────────────────

const OPENAI_TOOLS = QUERY_TOOL_DEFS.map((d) => ({
  type: 'function',
  function: { name: d.name, description: d.description, parameters: d.jsonSchema },
}));

interface OpenAiToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}

export async function runOpenAiQueryLoop(
  text: string,
  apiKey: string,
  modelId: string,
  now: number,
  /** The app's display currency — see `runAnthropicQueryLoop`'s identical
   *  parameter for the full rationale. */
  currency: string,
  executeTool: QueryToolExecutor
): Promise<QueryLoopResult | null> {
  try {
    const headers = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
    const messages: unknown[] = [
      { role: 'system', content: buildQueryLoopInstructions() },
      { role: 'user', content: buildQueryLoopPrompt(text, now) },
    ];
    const calls: QueryLoopToolCall[] = [];

    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      const body = { model: modelId, messages, tools: OPENAI_TOOLS };
      const json = await timedPost('https://api.openai.com/v1/chat/completions', headers, body, 'openai');
      if (!isRecord(json) || !Array.isArray(json.choices)) return null;
      const first = json.choices[0];
      const message = isRecord(first) ? (first.message as OpenAiMessage | undefined) : undefined;
      if (!message) return null;

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return { calls, narration: message.content?.trim() || null };
      }

      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls });
      for (const toolCall of toolCalls) {
        const toolName = KNOWN_TOOLS.has(toolCall.function?.name ?? '')
          ? (toolCall.function.name as QueryToolName)
          : null;
        if (!toolName) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: 'unknown tool' }),
          });
          continue;
        }
        const { content, call } = safeExecuteTool(
          toolName,
          coerceToolParams(toolCall.function?.arguments),
          executeTool,
          currency
        );
        if (call) calls.push(call);
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content });
      }
    }

    // Round cap hit — force a final, tool-free narration turn.
    const finalJson = await timedPost(
      'https://api.openai.com/v1/chat/completions',
      headers,
      { model: modelId, messages },
      'openai'
    );
    if (!isRecord(finalJson) || !Array.isArray(finalJson.choices)) return { calls, narration: null };
    const first = finalJson.choices[0];
    const message = isRecord(first) ? (first.message as OpenAiMessage | undefined) : undefined;
    return { calls, narration: message?.content?.trim() || null };
  } catch (e) {
    // Absolute "never throws" backstop — see the module header.
    const label = e instanceof Error ? e.constructor.name : 'unknown error';
    console.warn('openai query loop failed:', label);
    return null;
  }
}

/** Convenience dispatcher mirroring `openaiParse`/`anthropicParse`'s
 *  provider switch in `app/(tabs)/index.tsx`. */
export async function runQueryLoop(
  provider: 'openai' | 'anthropic',
  text: string,
  apiKey: string,
  modelId: string,
  now: number,
  currency: string,
  executeTool: QueryToolExecutor
): Promise<QueryLoopResult | null> {
  return provider === 'openai'
    ? runOpenAiQueryLoop(text, apiKey, modelId, now, currency, executeTool)
    : runAnthropicQueryLoop(text, apiKey, modelId, now, currency, executeTool);
}

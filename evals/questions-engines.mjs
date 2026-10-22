/**
 * Engines for the question eval (dev tooling — never ships; see
 * evals/README.md "Questions"). Runs under `tsx`. THE #1 RULE, as for the
 * parse eval: every engine runs the app's real code path for a question, in
 * the order `runParse` (app/(tabs)/index.tsx) applies it, with tool
 * execution bound to the fixture ledger instead of the device DB:
 *
 *   gate       `detectIntent` only (src/domain/intentGate.ts)
 *   floor      gate → `resolveFloorQueryCall` → `executeQueryTool`
 *   fm         gate → the on-device selection through the Swift probe
 *              (`buildQueryToolSelectionInstructions` / `…Prompt`,
 *              `QUERY_TOOL_SELECTION_SCHEMA`, the binding's own zod validate,
 *              `normalizeQueryToolSelection`, `MAX_ATTEMPTS` = 2) →
 *              `applyDeterministicPeriodOverride` → `executeQueryTool`
 *   anthropic  gate → `runAnthropicQueryLoop` (src/features/ai/queryLoop.ts)
 *   openai     gate → `runOpenAiQueryLoop`
 *
 * A model engine is scored on its OWN answer: when it serves nothing the case
 * is a miss even though the app would then try the floor (that fallback is
 * reported separately as `withFloorFallback`). Model engines run on every case
 * the gate routes to `query` AND every case labelled `query` (so a gate miss
 * still shows what the model would have done; the case fails on `intent`
 * either way).
 *
 * Statuses: `ok`, `skipped` (no key / no probe — the whole engine), `error`
 * (a harness or transport fault: bad key, rate limit, network, probe crash).
 * An `error` is listed separately and never scored as a model miss. Keys,
 * headers and request/response bodies are never logged: only an HTTP status
 * class reaches a result.
 */
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { executeQueryTool, applyDeterministicPeriodOverride } from '../src/domain/queryTools.ts';
import { resolveFloorQueryCall } from '../src/domain/queryFloor.ts';
import {
  buildQueryToolSelectionInstructions,
  buildQueryToolSelectionPrompt,
  normalizeQueryToolSelection,
  queryToolSelectionSchema,
} from '../src/domain/queryToolSelection.ts';
import { QUERY_TOOL_SELECTION_SCHEMA } from '../src/domain/deviceSchemas.ts';
import { DEFAULT_BYOK_MODEL } from '../src/domain/byokModels.ts';
import { runAnthropicQueryLoop, runOpenAiQueryLoop } from '../src/features/ai/queryLoop.ts';
import { gateClass, toolContextFor } from './questions-score.mjs';

export const MODEL_ENGINES = ['fm', 'anthropic', 'openai'];
export const ENGINES = ['gate', 'floor', ...MODEL_ENGINES];

/** Mirrors src/features/ai/deviceParse.ts's MAX_ATTEMPTS. */
export const FM_MAX_ATTEMPTS = 2;
const FM_PROBE_TIMEOUT_MS = 60_000;

export function engineModel(engine) {
  if (engine === 'anthropic') return process.env.ANTHROPIC_MODEL || DEFAULT_BYOK_MODEL.anthropic;
  if (engine === 'openai') return process.env.OPENAI_MODEL || DEFAULT_BYOK_MODEL.openai;
  if (engine === 'fm') return 'apple-foundation-models (on-device)';
  if (engine === 'floor') return 'resolveFloorQueryCall (src/domain/queryFloor.ts)';
  return 'detectIntent (src/domain/intentGate.ts)';
}

/** Why an engine cannot run at all here, or null when it can. */
export function engineUnavailable(engine) {
  if (engine === 'fm' && !process.env.FM_PROBE_PATH) return 'skipped (no probe: set FM_PROBE_PATH, Mac only)';
  if (engine === 'anthropic' && !process.env.ANTHROPIC_API_KEY) return 'skipped: no key (ANTHROPIC_API_KEY)';
  if (engine === 'openai' && !process.env.OPENAI_API_KEY) return 'skipped: no key (OPENAI_API_KEY)';
  return null;
}

function executeOne(ledger, c, call) {
  return { tool: call.tool, params: call.params, result: executeQueryTool(toolContextFor(ledger, c), call) };
}

export function runFloor(ledger, c) {
  // The app passes the user's lists (the floor reads loose names against them).
  const call = resolveFloorQueryCall(c.text, Date.parse(c.context.nowISO), toolContextFor(ledger, c));
  return { status: 'ok', served: call ? { calls: [executeOne(ledger, c, call)] } : null };
}

// ─── fm ─────────────────────────────────────────────────────────────────────

/** The probe input for a case — the same three things `generateObject`
 *  hands the binding. `prompt` is a seam for the D4 on-device A/B arms. */
export function fmProbeInput(text, { prompt = buildQueryToolSelectionPrompt(text) } = {}) {
  return {
    instructions: buildQueryToolSelectionInstructions(),
    prompt,
    schema: QUERY_TOOL_SELECTION_SCHEMA.jsonSchema,
  };
}

/**
 * One case through the probe, mirroring `deviceParseQuerySelection`: up to
 * `FM_MAX_ATTEMPTS` tries; a generation failure (probe exit 2), unparsable
 * text, a schema-invalid object (generateObject validates against the zod
 * schema and throws) or a "none" pick is a failed attempt; a harness fault
 * (spawn failure, timeout, any other exit) is `status: 'error'`.
 */
export function runFm(ledger, c, { probePath = process.env.FM_PROBE_PATH, prompt } = {}) {
  const input = JSON.stringify(fmProbeInput(c.text, prompt === undefined ? {} : { prompt }));
  const attempts = [];
  for (let attempt = 1; attempt <= FM_MAX_ATTEMPTS; attempt++) {
    const startedAt = performance.now();
    const res = spawnSync(probePath, [], { input, encoding: 'utf8', timeout: FM_PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (res.error || res.signal || (res.status !== 0 && res.status !== 2)) {
      const reason = res.error ? 'spawn failed' : res.signal ? `killed by ${res.signal}` : `probe exit ${res.status}`;
      return { status: 'error', error: reason, served: null, diagnostics: { attempts } };
    }
    if (res.status === 2) {
      attempts.push({ outcome: 'generation_failed', latencyMs });
      continue;
    }
    let raw;
    try {
      raw = queryToolSelectionSchema.parse(JSON.parse(res.stdout));
    } catch {
      attempts.push({ outcome: 'invalid_output', latencyMs });
      continue;
    }
    const call = normalizeQueryToolSelection(raw);
    attempts.push({ outcome: call ? 'call' : 'none', latencyMs, raw });
    if (call) {
      const now = Date.parse(c.context.nowISO);
      const final = applyDeterministicPeriodOverride(call, c.text, now);
      return { status: 'ok', served: { calls: [executeOne(ledger, c, final)] }, diagnostics: { attempts } };
    }
  }
  return { status: 'ok', served: null, diagnostics: { attempts } };
}

// ─── cloud ──────────────────────────────────────────────────────────────────

/** Per-case record of the HTTP outcomes the loop saw — status codes and a
 *  thrown error's class only, never a body or header. */
const httpLog = new AsyncLocalStorage();
let wrappedFetch = null;

/** Wrap whatever `fetch` is current (re-wrapping if something replaced it,
 *  e.g. a test's mock) so each case's HTTP outcomes land in its own log. */
function ensureFetchWrapped() {
  if (globalThis.fetch === wrappedFetch) return;
  const inner = globalThis.fetch;
  wrappedFetch = async (...args) => {
    const log = httpLog.getStore();
    try {
      const res = await inner(...args);
      // A 2xx whose body is not JSON is the provider's fault, not the model's.
      let badBody = false;
      if (res.ok && typeof res.clone === 'function') {
        try {
          await res.clone().json();
        } catch {
          badBody = true;
        }
      }
      log?.push({ status: res.status, ...(badBody ? { badBody } : {}) });
      return res;
    } catch (e) {
      log?.push({ thrown: e instanceof Error ? e.name : 'unknown' });
      throw e;
    }
  };
  globalThis.fetch = wrappedFetch;
}

/** Key-free failure reason from what the loop saw, or null when every
 *  request succeeded (so a null loop result is the model's own bad output). */
export function transportFailure(log) {
  for (const entry of log) {
    if (entry.thrown) return entry.thrown === 'AbortError' ? 'timeout' : 'network';
    if (entry.badBody) return 'bad_body';
    if (entry.status === 401 || entry.status === 403) return 'auth';
    if (entry.status === 404) return 'not_found';
    if (entry.status === 429) return 'rate_limited';
    if (entry.status === 529 || entry.status === 503) return 'overloaded';
    if (entry.status >= 500) return 'server';
    if (entry.status >= 400) return `http_${entry.status}`;
  }
  return null;
}

const RETRYABLE = new Set(['rate_limited', 'overloaded', 'server', 'timeout', 'network', 'bad_body']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runCloud(engine, ledger, c, { retries = 2, loopOptions } = {}) {
  ensureFetchWrapped();
  const apiKey = engine === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  const loop = engine === 'anthropic' ? runAnthropicQueryLoop : runOpenAiQueryLoop;
  const now = Date.parse(c.context.nowISO);
  const ctx = toolContextFor(ledger, c);
  const executeTool = (tool, params) => executeQueryTool(ctx, { tool, params });
  for (let attempt = 0; ; attempt++) {
    const log = [];
    const startedAt = performance.now();
    const result = await httpLog.run(log, () =>
      loop(c.text, apiKey, engineModel(engine), now, c.context.currency, executeTool, loopOptions ?? {})
    );
    const latencyMs = Math.round(performance.now() - startedAt);
    const failure = transportFailure(log);
    if (failure) {
      if (RETRYABLE.has(failure) && attempt < retries) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      return { status: 'error', error: `${engine} request failed: ${failure}`, served: null, diagnostics: { requests: log.length, latencyMs } };
    }
    const calls = result?.calls ?? [];
    return {
      status: 'ok',
      served: calls.length ? { calls } : null,
      diagnostics: { requests: log.length, latencyMs, outcome: result === null ? 'bad_output' : calls.length ? 'answered' : 'declined' },
    };
  }
}

/** Run one engine over one case; `gate` is always computed. */
export async function runEngine(engine, ledger, c, opts = {}) {
  const gate = gateClass(c.text);
  if (engine === 'gate') return { gate, status: 'ok', served: null };
  const shouldRun = gate === 'query' || (engine !== 'floor' && c.expect.intent === 'query');
  if (!shouldRun) return { gate, status: 'ok', served: null, ran: false };
  if (engine === 'floor') return { gate, ran: true, ...runFloor(ledger, c) };
  if (engine === 'fm') return { gate, ran: true, ...runFm(ledger, c, opts) };
  return { gate, ran: true, ...(await runCloud(engine, ledger, c, { loopOptions: opts.loopOptions })) };
}

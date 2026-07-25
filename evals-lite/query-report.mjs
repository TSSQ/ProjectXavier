#!/usr/bin/env node
/**
 * Human-readable eval surface for the layer AFTER the query gate
 * (docs/design/ask-xavier-queries-spec.md §5.2/§5.3) — reads the SAME
 * tests/query-corpus.jsonl the jest suite (tests/__steps__/query-corpus.
 * steps.ts) asserts against, runs every case through the deterministic floor
 * (`src/domain/queryFloor.ts`'s `resolveFloorQueryCall`) and the shared period
 * extractor (`src/domain/periodRange.ts`'s `resolvePeriodFromText`), and
 * prints a per-dimension pass/fail table (tool routing, period extraction,
 * category extraction) plus a per-tool breakdown. Mirrors
 * evals-lite/intent-report.mjs's shape and "100% bar, not a statistical
 * threshold" doctrine — both routing and period/category resolution are
 * fully deterministic, so `npm run eval:query` is the thing to run green
 * before landing any change to queryFloor.ts's patterns or periodRange.ts's
 * extraction rules (see the "no gate change without a corpus case first"
 * rule now documented in both files' headers).
 *
 * `expectTool`/`expectCategory` of `null` means "skip that dimension's
 * assertion for this line" — used for genuine floor gaps (top_payees/
 * search_transactions aren't implemented at all) and one accepted, documented
 * single-shot-loop limitation (a multi-period comparison falls back to
 * this_month); see tests/__steps__/query-corpus.steps.ts's header. Two
 * PREVIOUSLY-null lines (the earn/earned income-verb gap, and the trend/
 * average keyword collision on total_spent) were genuine bugs this corpus
 * caught — both are now fixed in queryFloor.ts and relabeled to assert the
 * ideal behavior. `expectPeriod` is never skipped.
 *
 * Run with `npm run eval:query` (wired to `tsx`, no build step, same as
 * eval:intent). This deterministic report — and ONLY this report — decides
 * the exit code; everything below (`--engine=`) is report-only.
 *
 * ── Model-tier grading (`--engine=fm|openai|anthropic`) ─────────────────────
 * Grades the SAME corpus against a real model tier instead of the
 * deterministic floor — report-only, NEVER affects the exit code, and never
 * runs unless `--engine=` is passed.
 *
 * `fm` always reports "skipped": Foundation Models is on-device only (see
 * src/features/ai/deviceParse.ts's `deviceParseQuerySelection`) and cannot
 * run headless in this Node environment — grading it needs a Mac-side Swift
 * probe, the same approach the parse eval harness documents
 * (evals/engines/run_node.mjs's `runFM`/`FM_PROBE_PATH` slot) and hasn't
 * built yet for queries either.
 *
 * `openai`/`anthropic` do ONE tool-selection round per gradeable corpus row —
 * a raw `fetch` that mirrors the app's shipping engines' wire shape
 * (`src/features/ai/queryLoop.ts`'s `runOpenAiQueryLoop`/
 * `runAnthropicQueryLoop`, ROUND 1 specifically: same URL, same headers, same
 * body keys), reusing the REAL production prompt builders
 * (`src/domain/queryLoopPrompt.ts`'s `buildQueryLoopInstructions`/
 * `buildQueryLoopPrompt`) and the REAL tool-definition wire arrays exported
 * from `queryLoop.ts` (`OPENAI_TOOLS`/`ANTHROPIC_TOOLS`, themselves built from
 * `src/domain/queryTools.ts`'s `QUERY_TOOL_DEFS`) — never a re-implemented
 * copy, same "#1 rule" as the parse eval harness
 * (docs/design/eval-harness-spec.md). Deliberately only ONE round (not the
 * full up-to-`MAX_TOOL_ROUNDS` loop `runOpenAiQueryLoop`/
 * `runAnthropicQueryLoop` run in the app): we are grading WHICH tool the
 * model picks first, not composing/narrating an answer, and no tool is
 * actually executed against real data here (there is no live DB in this
 * script) — so calling the full loop would either need a fake executor
 * (indistinguishable resutls across rounds) or run up to 4 real HTTP requests
 * per case for no extra signal. `period`/`asOf` is graded PURELY
 * INFORMATIONALLY (printed, never pass/failed) — the app always overrides
 * the model's period deterministically before executing
 * (`applyDeterministicPeriodOverride`/`safeExecuteTool`'s period-override
 * block), so period is not the model's decision to grade here; TOOL
 * selection is.
 *
 * Scored against `expectModelTool` (falling back to `expectTool` when absent)
 * — see tests/__steps__/query-corpus.steps.ts's header for why the floor and
 * the model need two different "ideal" columns (the floor can't implement
 * top_payees/spending_over_time/search_transactions at all; a model can).
 *
 * Requires `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` in the environment — see
 * `loadEnvIfPresent` below for where those are read from. Prints "skipped —
 * no key" and returns (exit code unaffected either way) when absent — the
 * no-key path must stay a no-op, same shape as the parse eval harness's own
 * cloud engines (evals/engines/run_node.mjs's `runOpenAi`/`runAnthropic`).
 * The key itself, the Authorization/x-api-key header, and any raw request/
 * response body are NEVER printed or logged — only the engine label, model
 * id, chosen tool name, and tool params (which never contain the key) reach
 * stdout, mirroring every other cloud call site in this codebase's hygiene
 * rule (see src/features/ai/engines/shared.ts's `runCloudParse` header).
 *
 * `--limit=N` caps the number of gradeable corpus rows sent to the model
 * tier, for a cheap smoke run instead of paying for the full corpus every
 * time.
 *
 * Default model ids (env-overridable via `OPENAI_MODEL`/`ANTHROPIC_MODEL`,
 * matching evals/engines/run_node.mjs's convention): `gpt-4o-mini` and
 * `claude-haiku-4-5` — the LATTER matches this app's own shipping default
 * (`DEFAULT_BYOK_MODEL.anthropic` in src/features/settings/repository.ts),
 * not the (older) parse-eval-harness default, since it's more current.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolveFloorQueryCall } from '../src/domain/queryFloor.ts';
import { resolvePeriodFromText } from '../src/domain/periodRange.ts';
import { CLOUD_REQUEST_TIMEOUT_MS } from '../src/features/ai/engines/shared.ts';
import { buildQueryLoopInstructions, buildQueryLoopPrompt } from '../src/domain/queryLoopPrompt.ts';
import { OPENAI_TOOLS, ANTHROPIC_TOOLS } from '../src/features/ai/queryLoop.ts';

// Mirrors jest.config.js's own TZ pin — period extraction depends on the
// process's local calendar (getFullYear/getMonth), so this script must
// resolve "in March"/"this year" identically to the jest suite regardless of
// the machine it runs on.
if (!process.env.TZ) process.env.TZ = 'UTC';

// Same fixed instant as tests/__steps__/query-corpus.steps.ts (and the
// query-floor/period-range suites it mirrors) — 15 July 2026, mid-month/
// mid-year so no boundary is ambiguous.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.resolve(__dirname, '../tests/query-corpus.jsonl');

function loadCorpus() {
  const raw = fs.readFileSync(CORPUS_PATH, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function periodsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function categoryOf(call) {
  return call && typeof call === 'object' && call.params ? call.params.category : undefined;
}

function runDeterministicReport(corpus) {
  const dims = {
    tool: { pass: 0, total: 0 },
    period: { pass: 0, total: 0 },
    category: { pass: 0, total: 0 },
  };
  /** @type {Record<string, { pass: number; total: number }>} */
  const perTool = {};
  const failures = [];

  for (const c of corpus) {
    const call = resolveFloorQueryCall(c.text, NOW);
    const period = resolvePeriodFromText(c.text, NOW);

    // Period is ALWAYS graded.
    dims.period.total++;
    const periodOk = periodsEqual(period, c.expectPeriod);
    if (periodOk) dims.period.pass++;
    else failures.push({ text: c.text, dim: 'period', expected: c.expectPeriod, actual: period, note: c.note });

    // Tool is graded only when expectTool isn't null (see file header).
    if (c.expectTool !== null) {
      dims.tool.total++;
      const toolBucketKey = c.expectTool;
      perTool[toolBucketKey] ??= { pass: 0, total: 0 };
      perTool[toolBucketKey].total++;
      const actualTool = call?.tool ?? null;
      const toolOk = actualTool === c.expectTool;
      if (toolOk) {
        dims.tool.pass++;
        perTool[toolBucketKey].pass++;
      } else {
        failures.push({ text: c.text, dim: 'tool', expected: c.expectTool, actual: actualTool, note: c.note });
      }
    }

    // Category is graded only when expectCategory isn't null.
    if (c.expectCategory !== null) {
      dims.category.total++;
      const actualCategory = categoryOf(call);
      const categoryOk = actualCategory === c.expectCategory;
      if (categoryOk) dims.category.pass++;
      else {
        failures.push({
          text: c.text,
          dim: 'category',
          expected: c.expectCategory,
          actual: actualCategory ?? null,
          note: c.note,
        });
      }
    }
  }

  console.log('Query floor + period eval — tests/query-corpus.jsonl\n');
  console.log(`corpus size: ${corpus.length}\n`);
  console.log('dimension   pass/total');
  console.log('----------  -----------');
  for (const dim of ['tool', 'period', 'category']) {
    const { pass, total } = dims[dim];
    console.log(`${dim.padEnd(10)}  ${pass}/${total}`);
  }
  console.log('');

  console.log('per-tool breakdown (tool dimension only)');
  console.log('---------------------------------------');
  for (const toolName of Object.keys(perTool).sort()) {
    const { pass, total } = perTool[toolName];
    console.log(`${toolName.padEnd(24)}  ${pass}/${total}`);
  }
  console.log('');

  if (failures.length > 0) {
    console.log(`FAILURES (${failures.length}):\n`);
    for (const f of failures) {
      console.log(`  "${f.text}"  [${f.dim}]`);
      console.log(`    expected: ${JSON.stringify(f.expected)}  actual: ${JSON.stringify(f.actual)}`);
      console.log(`    note: ${f.note}\n`);
    }
    console.log(`FAIL — ${failures.length} assertion(s) failed.`);
    return false;
  }

  console.log('PASS — every graded dimension is 100%.');
  return true;
}

// ─── CLI flags ──────────────────────────────────────────────────────────────

function parseFlag(argv, name) {
  const prefix = `--${name}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

// ─── Env loading (model tier only — never touched by the deterministic
// report above) ─────────────────────────────────────────────────────────────

/**
 * Try `process.loadEnvFile(p)`, tolerating a missing file (ENOENT) or any
 * other load failure — never throws. Returns whether it actually loaded
 * something. NEVER logs `p`'s contents or any key; only whether a file was
 * found is ever reported by the caller.
 */
function tryLoadEnvFile(p) {
  try {
    process.loadEnvFile(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * This worktree has no `.env` of its own — the real one (OPENAI_API_KEY +
 * ANTHROPIC_API_KEY) lives at the MAIN checkout's repo root, a different
 * directory `git worktree`-linked to this one. `git rev-parse
 * --git-common-dir` resolves back to the main checkout's `.git` regardless of
 * which worktree this script runs from; its parent is the main checkout, and
 * `<mainCheckout>/.env` is the real file. Both lookups are wrapped so a
 * missing file (CI, a fresh clone, a reviewer without the key) is a silent,
 * safe no-op — the no-key path below still reports "skipped" and exits 0.
 */
function loadEnvIfPresent() {
  // 1) an .env in this worktree's own cwd, if one is ever added.
  if (tryLoadEnvFile('.env')) return 'cwd .env';

  // 2) fall back to the main checkout's .env, resolved via git itself (no
  // hardcoded path) so this keeps working from any worktree.
  try {
    const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const mainCheckout = path.dirname(path.resolve(gitCommonDir));
    const mainEnvPath = path.join(mainCheckout, '.env');
    if (tryLoadEnvFile(mainEnvPath)) return `main checkout .env (${mainCheckout})`;
  } catch {
    // git itself unavailable/failed — tolerate, same as a missing file.
  }
  return null;
}

// ─── Model-tier one-shot tool-selection calls ──────────────────────────────

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
// Matches this app's own shipping BYOK default (DEFAULT_BYOK_MODEL.anthropic
// in src/features/settings/repository.ts) — more current than the parse
// eval harness's older claude-3-5-haiku-latest default.
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';

/** POST `body` to `url`, own timeout (reusing the app's own
 *  `CLOUD_REQUEST_TIMEOUT_MS`), never throws — resolves `{ ok: false }` for
 *  any network error, abort, or non-2xx status. NEVER logs `headers` or
 *  `body` (both may carry the key/prompt). */
async function timedFetchJson(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status, json: null, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status, json: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: e?.constructor?.name ?? 'unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

/** One OpenAI round — same URL/headers/body shape as
 *  `queryLoop.ts`'s `runOpenAiQueryLoop` round 1, reusing the SAME
 *  instructions/prompt builders and the SAME exported `OPENAI_TOOLS` wire
 *  array (no re-implementation). Returns the FIRST tool call chosen, or
 *  `{ tool: null }` when the model answered without calling a tool at all. */
async function oneShotOpenAi(text, apiKey, modelId) {
  const headers = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: buildQueryLoopInstructions() },
      { role: 'user', content: buildQueryLoopPrompt(text, NOW) },
    ],
    tools: OPENAI_TOOLS,
  };
  const { ok, json, error } = await timedFetchJson('https://api.openai.com/v1/chat/completions', headers, body);
  if (!ok) return { tool: null, params: null, error };
  const message = json?.choices?.[0]?.message;
  const toolCall = message?.tool_calls?.[0];
  if (!toolCall) return { tool: null, params: null, narration: message?.content ?? null };
  let params = null;
  try {
    params = JSON.parse(toolCall.function.arguments);
  } catch {
    params = null;
  }
  return { tool: toolCall.function.name ?? null, params };
}

/** One Anthropic round — same URL/headers/body shape as `queryLoop.ts`'s
 *  `runAnthropicQueryLoop` round 1, reusing the SAME instructions/prompt
 *  builders and the SAME exported `ANTHROPIC_TOOLS` wire array. */
async function oneShotAnthropic(text, apiKey, modelId) {
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const body = {
    model: modelId,
    max_tokens: 1024,
    system: buildQueryLoopInstructions(),
    messages: [{ role: 'user', content: buildQueryLoopPrompt(text, NOW) }],
    tools: ANTHROPIC_TOOLS,
  };
  const { ok, json, error } = await timedFetchJson('https://api.anthropic.com/v1/messages', headers, body);
  if (!ok) return { tool: null, params: null, error };
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const toolUse = blocks.find((b) => b?.type === 'tool_use');
  if (!toolUse) {
    const narration = blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { tool: null, params: null, narration: narration || null };
  }
  return { tool: toolUse.name ?? null, params: toolUse.input ?? null };
}

/** The model-facing period/asOf param off a chosen tool call, if any —
 *  INFORMATIONAL only (see file header for why period isn't scored). */
function modelPeriodOf(params) {
  if (!params || typeof params !== 'object') return null;
  return params.period ?? params.asOf ?? null;
}

/**
 * Grade `corpus` (already possibly `--limit`-ed) against one cloud engine —
 * ONE HTTP request per gradeable row, sequential (no concurrency) to stay a
 * well-behaved caller of someone else's rate limits. Report-only: return
 * value is never used to affect this script's exit code.
 */
async function runModelTierGrading(engine, modelId, apiKey, corpus) {
  const oneShot = engine === 'openai' ? oneShotOpenAi : oneShotAnthropic;
  const gradeable = corpus.filter((c) => (c.expectModelTool ?? c.expectTool) !== null);

  let pass = 0;
  const perTool = {};
  const mismatches = [];
  const errors = [];

  for (const c of gradeable) {
    const expected = c.expectModelTool ?? c.expectTool;
    perTool[expected] ??= { pass: 0, total: 0 };
    perTool[expected].total++;

    const { tool, params, error } = await oneShot(c.text, apiKey, modelId);
    if (error) {
      errors.push({ text: c.text, error });
      continue;
    }

    const ok = tool === expected;
    if (ok) {
      pass++;
      perTool[expected].pass++;
    } else {
      mismatches.push({
        text: c.text,
        expected,
        chosen: tool,
        period: modelPeriodOf(params),
        note: c.note,
      });
    }
  }

  const attempted = gradeable.length - errors.length;
  console.log(`\nModel tier — ${engine} (${modelId}) — report-only, does not affect exit code.`);
  console.log(`gradeable rows: ${gradeable.length}  (skipped for grading: ${corpus.length - gradeable.length} — no tool is correct for anyone)`);
  if (errors.length > 0) {
    console.log(`request errors: ${errors.length} (excluded from the accuracy denominator below)`);
  }
  console.log(`\ntool accuracy: ${pass}/${attempted}\n`);

  console.log('per-tool breakdown');
  console.log('-------------------');
  for (const toolName of Object.keys(perTool).sort()) {
    const { pass: p, total: t } = perTool[toolName];
    console.log(`${toolName.padEnd(24)}  ${p}/${t}`);
  }

  if (mismatches.length > 0) {
    console.log(`\nMISMATCHES (${mismatches.length}) — text -> expected vs chosen (period is informational only):\n`);
    for (const m of mismatches) {
      console.log(`  "${m.text}"`);
      console.log(`    expected: ${m.expected}  chosen: ${m.chosen ?? '(no tool call — narrated instead)'}`);
      console.log(`    model period (informational): ${JSON.stringify(m.period)}`);
      console.log(`    note: ${m.note}\n`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nREQUEST ERRORS (${errors.length}) — excluded from scoring, not scored as mismatches:\n`);
    for (const e of errors) {
      console.log(`  "${e.text}" -> ${e.error}`);
    }
  }
}

/**
 * Report-only model-tier entry point — see the file header. Never affects
 * this script's exit code (the deterministic floor/period report is the only
 * thing that gates `npm run eval:query`).
 */
async function runModelTierReport(engine, corpus, limit) {
  if (engine === 'fm') {
    console.log('\nModel tier (--engine=fm) — report-only, does not affect exit code.');
    console.log(
      'skipped — Foundation Models is on-device only and cannot run headless in this Node ' +
        'environment; grading it needs a Mac-side Swift probe (the same approach the parse eval ' +
        'harness documents for FM — evals/engines/run_node.mjs\'s FM_PROBE_PATH slot — not yet built ' +
        'for queries either).'
    );
    return;
  }

  if (engine !== 'openai' && engine !== 'anthropic') {
    console.log(`\nModel tier (--engine=${engine}) — report-only, does not affect exit code.`);
    console.log(`skipped — unrecognised engine "${engine}" (expected fm, openai, or anthropic).`);
    return;
  }

  const envKey = engine === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const key = process.env[envKey];
  if (!key) {
    console.log(`\nModel tier (--engine=${engine}) — report-only, does not affect exit code.`);
    console.log(`skipped — no key (${envKey} not set in this environment).`);
    return;
  }

  const defaultModel = engine === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL;
  const modelEnvVar = engine === 'openai' ? 'OPENAI_MODEL' : 'ANTHROPIC_MODEL';
  const modelId = process.env[modelEnvVar] || defaultModel;

  const rows = limit != null ? corpus.slice(0, limit) : corpus;
  await runModelTierGrading(engine, modelId, key, rows);
}

async function main() {
  const argv = process.argv.slice(2);
  const corpus = loadCorpus();
  const deterministicPassed = runDeterministicReport(corpus);

  const engine = parseFlag(argv, 'engine');
  if (engine) {
    const envSource = loadEnvIfPresent();
    console.log(
      envSource ? `\n(env loaded from: ${envSource})` : '\n(no .env found — relying on already-exported env vars, if any)'
    );
    const limitRaw = parseFlag(argv, 'limit');
    const limit = limitRaw != null ? Number(limitRaw) : null;
    await runModelTierReport(engine, corpus, Number.isFinite(limit) ? limit : null);
  }

  process.exit(deterministicPassed ? 0 : 1);
}

main();

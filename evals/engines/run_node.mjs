#!/usr/bin/env node
/**
 * Node engine runner for the parse eval harness (dev tooling — never ships).
 *
 * THE #1 RULE: this file imports and calls the REAL production parse code —
 * it never re-implements parse/prompt logic. Specifically:
 *   - `heuristic` calls the actual `src/domain/localParse.ts`.
 *   - `openai` / `anthropic` call the Vercel AI SDK's `generateObject` with
 *     the SAME `buildDeviceParseInstructions` / `buildDeviceParsePrompt` /
 *     `deviceParseSchema` / `normalizeDeviceParseOutput` / `applyGroundingGuards`
 *     from `src/domain/deviceParsePrompt.ts` that `src/features/ai/deviceParse.ts`
 *     uses for Apple Foundation Models — only the `model:` passed to
 *     `generateObject` differs (see `runGenerateObjectEngine` below, which
 *     mirrors `deviceParseUnsafe` line for line).
 *   - Every engine re-validates its output against the real
 *     `aiParsedExpenseSchema` (src/lib/validation.ts) before returning it,
 *     same as the app does (guardrail #6 — AI output is untrusted).
 *   - `fm` shells out to a Mac-side Swift probe when one is configured/found;
 *     otherwise it reports "skipped (no probe)" — see docs/design and the
 *     README for how to wire one next.
 *
 * Usage:
 *   npx tsx evals/engines/run_node.mjs <engine> <datasetPath>
 *   engine ∈ heuristic | openai | anthropic | fm
 *
 * Prints a JSON array of per-case results to stdout:
 *   { id, engine, status: 'ok'|'skipped'|'error', parse: AiParsedExpense|null, reason?, error? }
 *
 * `parse` is JSON `null` whenever the engine did not produce a *usable* parse
 * — same rule the app itself uses to decide whether to keep a parse
 * (`isUsefulDeviceParse`, imported below, not reimplemented): schema-invalid
 * output, or a schema-valid parse with no positive amount, both become null.
 * This is also how "fail-to-parse" ground truth (`expected: null` in the
 * dataset) is checked by scoring.py.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Pin the clock's timezone before anything constructs a Date, so relative/
// absolute date resolution (both in localParse's "now" and
// deviceParsePrompt's resolveRelativeDate/resolveAbsoluteDate/toLocalDateString)
// is reproducible across machines — mirrors tests/jest.config.js's TZ pin for
// the app's own BDD suite.
process.env.TZ = process.env.TZ || 'UTC';

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

// ─── REAL production modules — imported directly, never re-implemented ─────
import { localParse } from '../../src/domain/localParse.ts';
import {
  deviceParseSchema,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
  normalizeDeviceParseOutput,
  applyGroundingGuards,
  isUsefulDeviceParse,
  resolveRelativeDate,
  resolveAbsoluteDate,
} from '../../src/domain/deviceParsePrompt.ts';
import { aiParsedExpenseSchema } from '../../src/lib/validation.ts';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';

// ─── dataset → real src input shapes ────────────────────────────────────────

/**
 * The dataset's `context` deliberately extends the spec's illustrative flat
 * string-array example: `categories` carry `{ name, kind }` rather than a
 * bare name, because `src/domain/types.ts`'s `Category` (and
 * `findCategoryMatch`'s kind-scoped matching in categories.ts, which
 * localParse relies on) requires a `kind`. `payees`/`accounts` stay flat name
 * strings as the spec shows — no parse-relevant code path reads anything
 * else off them (buildDeviceParsePrompt only reads `.name`; localParse never
 * touches accounts at all). Ids/currency/openingBalance below are synthesized
 * placeholders never inspected by any parse logic. See README "Dataset
 * schema" for the full rationale.
 */
function buildFixtures(context) {
  const categories = context.categories.map((c, i) => ({
    id: `cat-${i}`,
    name: c.name,
    kind: c.kind,
  }));
  const payees = context.payees.map((name, i) => ({ id: `payee-${i}`, name }));
  const accounts = context.accounts.map((name, i) => ({
    id: `acct-${i}`,
    name,
    currency: 'USD',
    openingBalance: 0,
  }));
  const now = Date.parse(context.nowISO);
  return { categories, payees, accounts, now };
}

/** null unless the (already schema-validated) parse is worth surfacing —
 *  the same gate the app itself applies (see module doc above). */
function usableOrNull(parse) {
  return isUsefulDeviceParse(parse) ? parse : null;
}

// ─── heuristic engine ────────────────────────────────────────────────────────

async function runHeuristic({ text, context }) {
  const { categories, payees, now } = buildFixtures(context);
  const raw = localParse(text, { categories, payees, now });
  // Treat the heuristic's own output as untrusted too, exactly as
  // app/(tabs)/index.tsx's runHeuristicParse does (guardrail #6).
  const validated = aiParsedExpenseSchema.safeParse(raw);
  if (!validated.success) {
    return { status: 'ok', parse: null, note: 'failed aiParsedExpenseSchema validation' };
  }
  return { status: 'ok', parse: usableOrNull(validated.data) };
}

// ─── cloud (openai/anthropic) engines — real generateObject path ───────────

/**
 * Mirrors `src/features/ai/deviceParse.ts`'s `deviceParseUnsafe` EXACTLY
 * (same prompt/schema/normalize/guard/date-resolution/re-validation calls) —
 * the only harness-specific part is which `model` object is handed to
 * `generateObject`, per the task's fidelity requirement ("just swap the
 * model").
 */
async function runGenerateObjectEngine(model, { text, context }) {
  const { categories, payees, accounts, now } = buildFixtures(context);
  const ctx = { categories, payees, accounts, now };

  const { object } = await generateObject({
    model,
    system: buildDeviceParseInstructions(),
    prompt: buildDeviceParsePrompt(text, ctx),
    schema: deviceParseSchema,
  });

  const normalized = applyGroundingGuards(normalizeDeviceParseOutput(object), text);
  const textDate = resolveRelativeDate(text, now) ?? resolveAbsoluteDate(text, now);
  if (textDate != null) normalized.occurredAt = textDate;

  const validated = aiParsedExpenseSchema.safeParse(normalized);
  if (!validated.success) {
    return { status: 'ok', parse: null, note: 'failed aiParsedExpenseSchema validation' };
  }
  return { status: 'ok', parse: usableOrNull(validated.data) };
}

async function runOpenAI(caseObj) {
  if (!process.env.OPENAI_API_KEY) {
    return { status: 'skipped', reason: 'no key', parse: null };
  }
  const modelId = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  try {
    return await runGenerateObjectEngine(openai(modelId), caseObj);
  } catch (e) {
    return { status: 'error', error: String(e?.message ?? e), parse: null };
  }
}

async function runAnthropic(caseObj) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 'skipped', reason: 'no key', parse: null };
  }
  const modelId = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  try {
    return await runGenerateObjectEngine(anthropic(modelId), caseObj);
  } catch (e) {
    return { status: 'error', error: String(e?.message ?? e), parse: null };
  }
}

// ─── Foundation Models (native, Mac-side Swift probe) ───────────────────────

/**
 * FM runs natively only (Apple Foundation Models has no Node binding). If
 * `FM_PROBE_PATH` points at a compiled probe binary that accepts the case
 * text + a JSON context blob and prints a `deviceParseSchema`-shaped JSON
 * object, shell out to it. No probe wired into this repo yet — see README
 * "Wiring the FM Swift probe" for how to build one from
 * `src/domain/deviceParsePrompt.ts` (mirrors the fm-probe-harness approach:
 * a `@Generable` struct whose `@Guide` strings match the schema's
 * `.describe()`s, fed the exact `buildDeviceParseInstructions()` /
 * `buildDeviceParsePrompt()` strings from this same module).
 */
async function runFM({ text, context }) {
  const probePath = process.env.FM_PROBE_PATH;
  if (!probePath) {
    return { status: 'skipped', reason: 'no probe (set FM_PROBE_PATH)', parse: null };
  }
  const { categories, payees, accounts, now } = buildFixtures(context);
  try {
    const stdout = execFileSync(
      probePath,
      [text, JSON.stringify({ categories, payees, accounts, now })],
      { encoding: 'utf8' }
    );
    const raw = JSON.parse(stdout);
    const normalized = applyGroundingGuards(normalizeDeviceParseOutput(raw), text);
    const textDate = resolveRelativeDate(text, now) ?? resolveAbsoluteDate(text, now);
    if (textDate != null) normalized.occurredAt = textDate;
    const validated = aiParsedExpenseSchema.safeParse(normalized);
    if (!validated.success) return { status: 'ok', parse: null };
    return { status: 'ok', parse: usableOrNull(validated.data) };
  } catch (e) {
    return { status: 'error', error: String(e?.message ?? e), parse: null };
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const RUNNERS = { heuristic: runHeuristic, openai: runOpenAI, anthropic: runAnthropic, fm: runFM };

async function main() {
  const [engine, datasetPath] = process.argv.slice(2);
  if (!engine || !datasetPath) {
    console.error('usage: run_node.mjs <heuristic|openai|anthropic|fm> <datasetPath>');
    process.exit(1);
  }
  const runner = RUNNERS[engine];
  if (!runner) {
    console.error(`unknown engine: ${engine} (expected one of ${Object.keys(RUNNERS).join(', ')})`);
    process.exit(1);
  }

  const cases = readFileSync(datasetPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const results = [];
  for (const c of cases) {
    let r;
    try {
      r = await runner(c);
    } catch (e) {
      r = { status: 'error', error: String(e?.message ?? e), parse: null };
    }
    results.push({ id: c.id, engine, ...r });
  }
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
}

main();

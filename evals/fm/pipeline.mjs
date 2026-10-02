/**
 * Shared FM-probe pipeline (dev tooling — never ships), extracted so
 * `evals/engines/run_node.mjs`'s `runFM` and `evals/fm/replay-orders.mjs`
 * can never hand-drift apart. Both call into the SAME:
 *   - `buildFixtures` (dataset `context` -> the app's real input shapes),
 *   - `classifyProbeResult`/`extractLoggedOrder` (one `spawnSync` result ->
 *     model-error vs harness-fault, and the "schema property order: …"
 *     diagnostic line the probe writes to stderr),
 *   - `runPipeline` (one probe stdout string -> the exact normalize/guard/
 *     date-override/re-validate/usefulness chain `deviceParseUnsafe` runs in
 *     the app — see that function's own doc comment), and
 *   - `scoreParse` (ground truth + a `runPipeline` result -> pass/fail, the
 *     one "pass rule" both callers use: a fail-to-parse case is scored on
 *     `scoreCase`'s own `correct`, everything else on its `overall`).
 *
 * THE #1 RULE (same as run_node.mjs/replay-orders.mjs themselves): every
 * function here calls real production code — `src/domain/deviceParsePrompt.ts`,
 * `src/lib/validation.ts`, `evals/score.mjs` — never a re-implementation.
 */
import { createHash } from 'node:crypto';
import { isUsefulDeviceParse } from '../../src/domain/deviceParsePrompt.ts';
import { fmParseSchemaFor, finishFmParse } from '../../src/domain/fmParse.ts';
import { classifyDeviceParse } from '../../src/domain/fmRefusal.ts';
import { scoreCase } from '../score.mjs';

/** Wall-clock ceiling for one probe invocation (shared by both callers). A
 *  hang here (rather than a clean non-zero exit) would otherwise wedge the
 *  whole run; a timeout is classified as a HARNESS fault, never a model
 *  miss. */
export const FM_PROBE_TIMEOUT_MS = 60_000;

/**
 * The dataset's `context` deliberately extends the spec's illustrative flat
 * string-array example: `categories` carry `{ name, kind }` rather than a
 * bare name, because `src/domain/types.ts`'s `Category` requires a `kind`.
 * `payees`/`accounts` stay flat name strings. Ids/currency/openingBalance
 * are synthesized placeholders never inspected by any parse logic. See
 * evals/README.md "Dataset schema" for the full rationale.
 */
export function buildFixtures(context) {
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

/** Classifies one probe invocation's `spawnSync` result — model errors vs
 *  harness faults:
 *   - `'ok'`         — exit 0, stdout is the parse-shaped JSON.
 *   - `'generation'` — exit 2: the probe's own `session.respond` call threw
 *     or its output failed to decode — a MODEL/generation failure, the same
 *     bucket as `deviceParseUnsafe`'s `generateObject` throwing in the app.
 *   - `'harness'`     — anything else: a spawn failure (`res.error`), a
 *     timeout/signal kill, exit 1 (bad args/bad JSON/model unavailable), or
 *     any unexpected exit code. Never silently treated as a model miss. */
export function classifyProbeResult(res) {
  if (res.error) return 'harness';
  if (res.signal) return 'harness';
  if (res.status === 0) return 'ok';
  if (res.status === 2) return 'generation';
  return 'harness';
}

/** Extracts the schema property order the probe logged to stderr (see
 *  probe.swift's `logGenerationSchemaPropertyOrder`) — `null` when the line
 *  is absent or logged the "UNAVAILABLE" fallback instead. */
export function extractLoggedOrder(stderr) {
  const orderMatch = /^schema property order: (.+)$/m.exec(stderr ?? '');
  return orderMatch ? orderMatch[1].split(',').map((s) => s.trim()) : null;
}

export function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * One probe invocation's raw stdout, through the SAME validate/amount/normalize/
 * guard/date-override/re-validate chain `deviceParseUnsafe`
 * (`src/features/ai/deviceParse.ts`) runs on `generateObject`'s `object`.
 * `fmParseSchemaFor(plan).parse(JSON.parse(stdout))` reproduces `generateObject`'s
 * own `safeParseJSON` + zod-validate step as one throw (see
 * `src/domain/deviceParseSchemaOrder.ts`'s own doc comment - "THE
 * ZOD-TO-JSON-SCHEMA CALL-CHAIN" - for the exact call-chain proof) - a
 * malformed/schema-invalid response THROWS here, mirroring a real
 * `generateObject` failure; callers decide how to handle that (run_node.mjs's
 * `runFM` feeds it through `runDeviceParseAttempts`' retry/catch, exactly as
 * the app does; replay-orders.mjs - no retry loop by design - catches it
 * itself and records a `scoreError`). Everything after the validate step is
 * `finishFmParse` (src/domain/fmParse.ts), the one function the app calls too.
 * `plan` is the text's `planFmAmount` (one per text, also used to build the
 * schema the probe was handed).
 */
export function runPipeline(stdout, { text, now, currency, plan }) {
  const modelOutput = fmParseSchemaFor(plan).parse(JSON.parse(stdout));
  const parse = finishFmParse(modelOutput, text, plan, now, currency);
  return { parse, useful: isUsefulDeviceParse(parse) };
}

/** What the app does with the parse the retry loop settled on
 *  (`classifyDeviceParse`, no `forceExpense`): the parse to score, or `null`
 *  for a refusal or a failure - both leave nothing logged, which is how the
 *  scorer reads a refusal case. Also returns the outcome kind for diagnostics. */
export function scoredParse(parse, text) {
  const outcome = classifyDeviceParse(parse, text);
  return { kind: outcome.kind, parse: outcome.kind === 'parsed' ? outcome.parse : null };
}

/** The one "pass rule" both `runFM` (via gates.mjs/score.mjs downstream) and
 *  `replay-orders.mjs` apply to a `scoreCase` result: a fail-to-parse case
 *  (ground truth `expected: null`) is scored on `correct` (did the engine
 *  also return null), every other case on `overall` (every scored field
 *  matched). Also surfaces which fields were wrong, for reporting. */
export function scoreParse(expected, parse) {
  const scored = scoreCase(expected ?? null, parse);
  return {
    passed: scored.failToParseCase ? scored.correct : scored.overall,
    wrongFields: scored.fields ? Object.keys(scored.fields).filter((f) => !scored.fields[f]) : [],
  };
}

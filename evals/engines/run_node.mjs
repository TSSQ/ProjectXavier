#!/usr/bin/env node
/**
 * Node engine runner for the parse eval harness (dev tooling — never ships).
 *
 * THE #1 RULE: this file imports and calls the REAL production parse code —
 * it never re-implements parse/prompt logic. Specifically:
 *   - `heuristic` calls the actual `src/domain/localParse.ts`.
 *   - `openai` and `anthropic` BOTH call the app's REAL shipping BYOK
 *     transports — `openaiParse` (`src/features/ai/engines/openai.ts`, a raw
 *     `fetch` to `POST /v1/chat/completions` with a `json_schema` response
 *     format) and `anthropicParse` (`src/features/ai/engines/anthropic.ts`, a
 *     raw `fetch` to `POST /v1/messages` forcing the `record_expense` tool) —
 *     NOT the Vercel AI SDK's `generateObject` (its HTTP path depends on
 *     web-streams Hermes/React Native doesn't provide, so the app never ships
 *     it — see `docs/design/byok-raw-fetch-spec.md`). Each internally runs the
 *     same normalize/guard/date-override/re-validate pipeline via
 *     `runCloudParse` (`src/features/ai/engines/shared.ts`); only the
 *     provider's HTTP shape differs. This makes both cloud tiers a TRUE
 *     integration test of the shipping code, not a re-implementation.
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
 *   { id, engine, status: 'ok'|'skipped'|'error', parse: AiParsedExpense|null,
 *     reason?, error?, diagnostics? }
 * `diagnostics` (fm only) is `{ attempts, threw, firstAttemptUseful,
 * fieldOrders, attemptsDetail, orderUnavailable }`, where `attemptsDetail` is
 * `[{ order, useful }]` — one entry per probe invocation, pairing that
 * invocation's schema property order with whether IT (not just the case
 * overall) produced a useful parse — and `orderUnavailable` counts attempts
 * where the order couldn't be extracted at all — see `runFM`'s own doc
 * comment and evals/README.md's "Cold vs. warm"/"Schema-order diagnostics"
 * sections.
 *
 * `parse` is JSON `null` whenever the engine did not produce a *usable* parse
 * — same rule the app itself uses to decide whether to keep a parse
 * (`isUsefulDeviceParse`, imported below, not reimplemented): schema-invalid
 * output, or a schema-valid parse with no positive amount, both become null.
 * This is also how "fail-to-parse" ground truth (`expected: null` in the
 * dataset) is checked by scoring.py.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// `zodSchema` is the SAME function `ai`'s own `generateObject` uses to derive
// a JSON Schema from a zod schema (re-exported from `@ai-sdk/provider-utils`:
// `generateObject`'s `getOutputStrategy({output:'object', schema}) ->
// objectOutputStrategy(asSchema(schema))`, where `asSchema` on a zod schema
// calls this same `zodSchema()`). Calling it directly on `deviceParseSchema`
// below therefore produces the BYTE-IDENTICAL JSON Schema the app's real
// `generateObject({schema: deviceParseSchema, ...})` call sends to
// `@react-native-ai/apple`. This repo's installed zod's "." export resolves
// to the v3 API (`zod/src/index.ts` -> `./v3/external.js`), so `zodSchema()`'s
// `isZod4Schema` check (`"_zod" in zodSchema2`) is false here and the real
// path is `zod3Schema` -> `zod3ToJsonSchema` (provider-utils' own vendored
// zod-to-json-schema port). Both this call site and the app's real
// `generateObject` call run the exact same `zodSchema()` function regardless
// of which internal v3/v4 branch a future zod upgrade takes it down — that's
// what keeps this byte-identical, not the specific branch. See `attempt()`'s
// doc comment below for how `generateObject`'s VALIDATION side (not just its
// JSON-Schema derivation) is also mirrored.
import { zodSchema } from 'ai';

// Pin the clock's timezone before anything constructs a Date, so relative/
// absolute date resolution (both in localParse's "now" and
// deviceParsePrompt's resolveRelativeDate/resolveAbsoluteDate/toLocalDateString)
// is reproducible across machines — mirrors tests/jest.config.js's TZ pin for
// the app's own BDD suite.
process.env.TZ = process.env.TZ || 'UTC';

// Load .env (local-dev convenience) so OPENAI_API_KEY / ANTHROPIC_API_KEY /
// OPENAI_MODEL / ANTHROPIC_MODEL are picked up without a manual `export`.
// Tolerant of a missing file — CI has no .env and injects keys via the job's
// `env:` block, and the no-key path already skips cleanly (see runOpenAI/
// runAnthropic). Resolved relative to cwd, which is always the repo root for
// both `npm run eval*` and the documented direct invocation.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env present (e.g. CI) — the process env is authoritative.
}

// ─── REAL production modules — imported directly, never re-implemented ─────
import { localParse } from '../../src/domain/localParse.ts';
import {
  deviceParseSchema,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
  normalizeDeviceParseOutput,
  applyGroundingGuards,
  isUsefulDeviceParse,
  resolveTypedDate,
} from '../../src/domain/deviceParsePrompt.ts';
// Shared with src/features/ai/deviceParse.ts's deviceParse() — see that
// module's doc comment. The ONE retry loop both the app and this harness
// run, so they can never hand-drift apart.
import { runDeviceParseAttempts } from '../../src/domain/deviceParseAttempts.ts';
import { aiParsedExpenseSchema } from '../../src/lib/validation.ts';
import { anthropicParse } from '../../src/features/ai/engines/anthropic.ts';
import { openaiParse } from '../../src/features/ai/engines/openai.ts';
// Both BYOK engines take the parse contract as a REQUIRED 5th argument (added
// with chat-driven account creation, 1ba1abb — the same transport now also
// serves the account/account-update/transaction-op contracts). This dataset
// only ever exercises the expense contract; omitting it made every openai/
// anthropic case fail with "Cannot read properties of undefined (reading
// 'normalize')", which the runner reports as `status: 'error'` — i.e. a silent
// 0% for both cloud tiers rather than a crash.
import { EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared.ts';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';

/** Wall-clock ceiling for one probe invocation. A hang here (rather than a
 *  clean non-zero exit) would otherwise wedge the whole `npm run eval:fm`
 *  run; a timeout is classified as a HARNESS fault (`status: 'error'`), same
 *  as a bad-args/bad-JSON exit — never scored as a model miss. */
const FM_PROBE_TIMEOUT_MS = 60_000;

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

// ─── openai engine — real raw-fetch transport (not generateObject) ─────────

/**
 * Real shipping path: `openaiParse` (`src/features/ai/engines/openai.ts`) does
 * the raw `fetch` to `POST /v1/chat/completions` with a `json_schema` response
 * format, then runs the same `runCloudParse` normalize/guard/date-override/
 * re-validate pipeline as the app — returning a validated `AiParsedExpense` or
 * `null` on ANY failure. Structurally identical to `runAnthropic` below (only
 * the engine function differs); `runCloudParse` does NOT apply
 * `isUsefulDeviceParse`, so — exactly like the app's real caller
 * (`app/(tabs)/index.tsx`) — that extra gate is applied here via
 * `usableOrNull`.
 */
async function runOpenAI({ text, context }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { status: 'skipped', reason: 'no key', parse: null };
  }
  const modelId = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const { categories, payees, accounts, now } = buildFixtures(context);
  const ctx = { categories, payees, accounts, now };
  try {
    const parsed = await openaiParse(text, ctx, apiKey, modelId, EXPENSE_PARSE_CONTRACT);
    return { status: 'ok', parse: usableOrNull(parsed) };
  } catch (e) {
    return { status: 'error', error: String(e?.message ?? e), parse: null };
  }
}

// ─── anthropic engine — real raw-fetch transport (not generateObject) ──────

/**
 * Real shipping path: `anthropicParse` already runs `fetchAnthropicRaw` →
 * `extractAnthropicToolInput` → `runCloudParse`'s normalize/guard/date-
 * override/re-validate pipeline (`aiParsedExpenseSchema`), returning either a
 * validated `AiParsedExpense` or `null` on ANY failure. Note: `runCloudParse`
 * does NOT itself apply `isUsefulDeviceParse` — the app's real caller does
 * (`app/(tabs)/index.tsx`'s `runCloudParse` helper, right after invoking
 * `anthropicParse`/`openaiParse`), so this mirrors that same extra gate here
 * rather than double-filtering inside `runCloudParse` itself.
 */
async function runAnthropic({ text, context }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { status: 'skipped', reason: 'no key', parse: null };
  }
  const modelId = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const { categories, payees, accounts, now } = buildFixtures(context);
  const ctx = { categories, payees, accounts, now };
  try {
    const parsed = await anthropicParse(text, ctx, apiKey, modelId, EXPENSE_PARSE_CONTRACT);
    return { status: 'ok', parse: usableOrNull(parsed) };
  } catch (e) {
    return { status: 'error', error: String(e?.message ?? e), parse: null };
  }
}

// ─── Foundation Models (native, Mac-side Swift probe) ───────────────────────

/** Lazily computed, cached — `deviceParseSchema`'s JSON Schema doesn't depend
 *  on the case text/context, only on the schema itself, so it's derived once
 *  per process rather than once per probe invocation. See the `zodSchema`
 *  import's doc comment above for the exact call chain this reproduces (the
 *  same one `generateObject({schema: deviceParseSchema, ...})` runs inside
 *  `deviceParse.ts`). */
let deviceParseJsonSchemaPromise = null;
function getDeviceParseJsonSchema() {
  if (!deviceParseJsonSchemaPromise) {
    deviceParseJsonSchemaPromise = zodSchema(deviceParseSchema).jsonSchema;
  }
  return deviceParseJsonSchemaPromise;
}

/** Classifies one probe invocation's `spawnSync` result — model errors vs
 *  harness faults:
 *   - `'ok'`      — exit 0, stdout is the parse-shaped JSON.
 *   - `'generation'` — exit 2: the probe's own `session.respond` call threw
 *     or its output failed to decode — a MODEL/generation failure, the same
 *     bucket as `deviceParseUnsafe`'s `generateObject` throwing in the app.
 *   - `'harness'`  — anything else: a spawn failure (`res.error`, e.g. the
 *     probe binary is missing), a timeout/signal kill, exit 1 (bad args/bad
 *     JSON/model unavailable — see probe.swift's exit-code contract), or any
 *     unexpected exit code. Never silently treated as a model miss. */
function classifyProbeResult(res) {
  if (res.error) return 'harness';
  if (res.signal) return 'harness';
  if (res.status === 0) return 'ok';
  if (res.status === 2) return 'generation';
  return 'harness';
}

/**
 * FM runs natively only (Apple Foundation Models has no Node binding). If
 * `FM_PROBE_PATH` points at a compiled probe binary, shell out to it over
 * stdin — see README "The FM Swift probe" and `evals/fm/probe.swift`'s own
 * header for how the probe now runs the app's REAL dynamic-schema path
 * (`AppleLLMSchemaParser`, vendored verbatim from the installed
 * `@react-native-ai/apple` binding) rather than a hand-copied static
 * `@Generable` struct (step 1a.2 — closes the schema-path gap step 1a left
 * open). The three inputs sent to the probe are built here from the REAL TS
 * functions — `buildDeviceParseInstructions()`, `buildDeviceParsePrompt(text,
 * ctx)`, and `deviceParseSchema`'s own JSON Schema (`getDeviceParseJsonSchema`,
 * above) — never re-typed by hand.
 *
 * The retry loop is `runDeviceParseAttempts` (src/domain/deviceParseAttempts.ts),
 * the SAME helper `deviceParse.ts` calls — so the two can never hand-drift
 * apart. `attempt()` below plays the same role `deviceParseUnsafe` plays for
 * the app: it throws on a MODEL/generation failure (probe exit 2, caught and
 * retried by `runDeviceParseAttempts` exactly like a `generateObject` throw),
 * and returns the same normalize/guard/date-override/re-validate pipeline
 * result on success. A HARNESS fault (see `classifyProbeResult`) is NOT fed
 * into that normal retry-and-continue path — it's recorded in the enclosing
 * closure and turned into `status: 'error'` for the whole case once
 * `runDeviceParseAttempts` returns, so a broken probe can never silently
 * shrink or flatter the score — `runFM` reports `status: 'error'` ONLY for
 * harness faults, never because the model threw.
 */
async function runFM({ text, context }) {
  const probePath = process.env.FM_PROBE_PATH;
  if (!probePath) {
    return { status: 'skipped', reason: 'no probe (set FM_PROBE_PATH)', parse: null };
  }
  const { categories, payees, accounts, now } = buildFixtures(context);
  const ctx = { categories, payees, accounts, now };
  // Mirrors deviceParse.ts's DeviceParseInput.currency: the app's current
  // single-currency setting, defaulting to 'USD'. The dataset's `context` may
  // carry its own `currency` (no case does today, but a future one could);
  // absent that, the app's own default applies — never the functions' own
  // internal default, so a non-USD case would be scored faithfully.
  const currency = context.currency ?? 'USD';

  const instructions = buildDeviceParseInstructions();
  const prompt = buildDeviceParsePrompt(text, ctx);
  const schema = await getDeviceParseJsonSchema();

  let harnessFault = null;
  // One entry per probe invocation made for this case — the property order
  // logged by the probe's `logGenerationSchemaPropertyOrder`, extracted from
  // the ACTUAL constructed `GenerationSchema`'s `debugDescription` "x-order"
  // field (the same schema object `AppleLLMSchemaParser` built and handed to
  // `session.respond`, not a second independent dictionary cast — see
  // evals/README.md's "Schema-order diagnostics" for why that distinction
  // matters). Swift Dictionary/NSDictionary iteration order is randomized
  // per call/cast, not merely per process — and the app's real RN bridge
  // hands `AppleLLMSchemaParser` a fresh NSDictionary on every real call
  // too, so this instability is a genuine property of the shipped app, not
  // only an eval-harness artifact. Kept alongside `attemptsDetail` (below)
  // for backward-compatible callers; `attemptsDetail` is the one that ties a
  // specific order to a specific attempt's outcome.
  const fieldOrders = [];
  // One entry per probe invocation, `{ order, useful }`: `order` is the SAME
  // array pushed to `fieldOrders` for that invocation (or `null` if the
  // probe produced no "schema property order:" line at all — see
  // `orderUnavailable` below), `useful` is whether that ONE attempt produced
  // a useful parse (`isUsefulDeviceParse`) — never rethrown/coerced by the
  // retry loop, so this is the only place per-ATTEMPT (as opposed to
  // per-case) order/outcome pairing survives. gates.mjs's
  // buildCaseDiagnostics threads this into each sample's `attempts` array.
  // Every real probe invocation below (anything that reaches `spawnSync`)
  // pushes EXACTLY one entry here, via the `finally` in `attempt()` — even
  // when `deviceParseSchema.parse(...)` itself throws, so an invocation's
  // attemptsDetail entry can never go missing while its order still shows up
  // in `fieldOrders`.
  const attemptsDetail = [];
  // Count of attempts where the probe actually ran (not a harness fault) but
  // logged no extractable schema property order at all — whether via the
  // distinct "schema property order UNAVAILABLE:" fallback line (probe.swift's
  // `logGenerationSchemaPropertyOrder`) or no order line at all. Surfaced
  // per-case here; run-eval.mjs sums it across every case/sample into a
  // RUN-level total, warns on stdout when non-zero, and records it in the
  // committed artifact.
  let orderUnavailable = 0;

  /** One probe invocation, through the same normalize/guard/date-override/
   *  re-validate pipeline as `deviceParseUnsafe`. Throws on a MODEL/generation
   *  failure — either the probe's own exit 2, or a raw response that fails
   *  `deviceParseSchema.parse(JSON.parse(...))` below — mirroring
   *  `deviceParseUnsafe`'s `generateObject` call, which `runDeviceParseAttempts`
   *  catches per-attempt in BOTH cases. A HARNESS fault (spawn failure,
   *  timeout, unexpected exit code) instead sets `harnessFault` (closure
   *  variable, checked after the retry loop, and short-circuits every
   *  further attempt without re-invoking the probe) in addition to throwing,
   *  since `runDeviceParseAttempts` itself has no concept of "harness fault"
   *  (it's the same helper the app's real, harness-free `deviceParse.ts`
   *  uses). */
  const attempt = () => {
    if (harnessFault) throw new Error(harnessFault);

    const res = spawnSync(probePath, [], {
      input: JSON.stringify({ instructions, prompt, schema }),
      encoding: 'utf8',
      timeout: FM_PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });

    const orderMatch = /^schema property order: (.+)$/m.exec(res.stderr ?? '');
    const order = orderMatch ? orderMatch[1].split(',').map((s) => s.trim()) : null;
    if (order) fieldOrders.push(order);

    const kind = classifyProbeResult(res);
    // A harness fault is excluded: the probe may never have reached schema
    // construction at all, so "no order" there says nothing about x-order
    // extraction — only an attempt where the probe actually ran (`kind !==
    // 'harness'`) counts toward orderUnavailable.
    if (!order && kind !== 'harness') orderUnavailable += 1;

    // Every branch below pushes exactly one attemptsDetail entry for this
    // invocation via `finally`, including the `deviceParseSchema.parse(...)`
    // throw path, which previously left an invocation with an order recorded
    // in `fieldOrders` but no matching attemptsDetail entry.
    let useful = false;
    try {
      if (kind === 'harness') {
        const reason = res.error
          ? String(res.error.message ?? res.error)
          : res.signal
            ? `probe killed by ${res.signal} (timeout after ${FM_PROBE_TIMEOUT_MS}ms?)`
            : (res.stderr || `probe exited with status ${res.status}`).trim();
        harnessFault = reason;
        throw new Error(reason);
      }
      if (kind === 'generation') {
        // Mirrors deviceParseUnsafe's generateObject throw — swallowed by
        // runDeviceParseAttempts exactly like a real model failure.
        throw new Error((res.stderr || 'probe exited with status 2 (generation failure)').trim());
      }

      // The probe prints the RAW text the binding handed back
      // (`extractRawModelText`, mirroring `toModelMessages()`/`ai`'s own
      // `extractTextContent`), never a hand-decoded shape. `attempt()` here
      // mirrors `generateObject`'s own validation EXACTLY —
      // `parseAndValidateObjectResult` in node_modules/ai/dist/index.js does
      // `safeParseJSON({text: result})` (JSON.parse, throwing
      // `NoObjectGeneratedError` on failure) then
      // `outputStrategy.validateFinalResult(value)` ->
      // `safeValidateTypes({value, schema})` -> (this repo's zod3 branch, see
      // the `zodSchema` import's doc comment above) `schema.safeParseAsync(value)`,
      // throwing `NoObjectGeneratedError` on a schema mismatch.
      // `deviceParseSchema.parse(JSON.parse(...))` below reproduces both steps
      // as one throw, caught by `runDeviceParseAttempts` as a normal MODEL
      // generation failure — never a harness fault, since the probe itself
      // succeeded; it's the model's own output that didn't validate. A later
      // schema field change needs zero probe edits: the probe only ever hands
      // back raw text, never a hand-decoded shape.
      const modelOutput = deviceParseSchema.parse(JSON.parse(res.stdout));
      const normalized = applyGroundingGuards(
        normalizeDeviceParseOutput(modelOutput, currency),
        text,
        currency
      );
      // Mirrors deviceParse.ts: the user's own words, else today — never the model's date.
      normalized.occurredAt = resolveTypedDate(text, now) ?? now;
      const validated = aiParsedExpenseSchema.safeParse(normalized);
      const parsed = validated.success ? validated.data : null;
      useful = isUsefulDeviceParse(parsed);
      return parsed;
    } finally {
      attemptsDetail.push({ order, useful });
    }
  };

  const { parse, attempts, threw } = await runDeviceParseAttempts(text, attempt);

  if (harnessFault) {
    return { status: 'error', error: harnessFault, parse: null };
  }

  return {
    status: 'ok',
    parse: usableOrNull(parse),
    // Cold-vs-warm + schema-order diagnostics (see README). `firstAttemptUseful`
    // mirrors isUsefulDeviceParse's own rule: true only when the FIRST (and,
    // since it returned early, only) attempt was already useful — no retry
    // was needed.
    diagnostics: {
      attempts,
      threw,
      firstAttemptUseful: attempts === 1 && isUsefulDeviceParse(parse),
      fieldOrders,
      attemptsDetail,
      orderUnavailable,
    },
  };
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

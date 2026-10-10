#!/usr/bin/env node
/**
 * Node engine runner for the parse eval harness (dev tooling — never ships).
 *
 * THE #1 RULE: this file imports and calls the REAL production parse code —
 * it never re-implements parse/prompt logic. Specifically:
 *   - `heuristic` calls the actual `src/domain/localParse.ts`.
 *   - `openai` and `anthropic` BOTH call the app's REAL shipping BYOK
 *     transports — `openaiParseResult` (`src/features/ai/engines/openai.ts`,
 *     a raw `fetch` to `POST /v1/chat/completions` with a per-text
 *     `json_schema` response format) and `anthropicParseResult`
 *     (`src/features/ai/engines/anthropic.ts`, a raw `fetch` to
 *     `POST /v1/messages` forcing the `record_expense` tool) — NOT the Vercel
 *     AI SDK's `generateObject` (its HTTP path depends on web-streams
 *     Hermes/React Native doesn't provide, so the app never ships it — see
 *     `docs/design/byok-raw-fetch-spec.md`). Each runs the step-2/3 expense
 *     contract (the on-device tier's refuse rule, closed category and
 *     code-read amount) via `runCloudParse` (`src/features/ai/engines/
 *     shared.ts`); only the provider's HTTP shape differs. The cue gate and
 *     the refusal classification are the app's own too (`runCloud` below).
 *     This makes both cloud tiers a TRUE integration test of the shipping
 *     code, not a re-implementation.
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
  isUsefulDeviceParse,
  buildFmParseInstructions,
  buildFmParsePrompt,
} from '../../src/domain/deviceParsePrompt.ts';
// Shared with src/features/ai/deviceParse.ts's deviceParse() — see that
// module's doc comment. The ONE retry loop both the app and this harness
// run, so they can never hand-drift apart.
import { runDeviceParseAttempts } from '../../src/domain/deviceParseAttempts.ts';
// The SAME helper deviceSchemas.ts' `deviceParseSchemaFor` builds the app's
// schema from — see deviceParseSchemaOrder.ts's doc comment: this is the one
// place "x-order" (step 1a.5's deterministic field-order patch) gets added, so
// an eval run mirrors the app's real schema object exactly.
import { getDeviceParseOrderedJsonSchema } from '../../src/domain/deviceParseSchemaOrder.ts';
// Step 3: the per-text amount plan (code reads the amount where it can) and the
// app's own classification of what the retry loop settled on.
import { planFmAmount } from '../../src/domain/fmAmountPlan.ts';
import { isRefusalVerdict } from '../../src/domain/fmRefusal.ts';
// The deterministic not-a-transaction check `deviceParse` runs BEFORE the model
// (src/features/ai/deviceParse.ts): the SAME module, so a cue refusal here is
// the one the app makes. No `forceExpense` in the eval (it scores the default
// path), so the gate is `cueRefusal(text)`.
import { cueRefusal } from '../../src/domain/notTransactionCues.ts';
import { aiParsedExpenseSchema } from '../../src/lib/validation.ts';
import { anthropicParseResult } from '../../src/features/ai/engines/anthropic.ts';
import { openaiParseResult } from '../../src/features/ai/engines/openai.ts';
// The app's own classification of a cloud contract result (the same function
// `app/(tabs)/index.tsx`'s runCloudParse applies): `isTransaction: false` on
// amount-bearing text is a refusal, a transaction with no amount is `failed`.
import { classifyDeviceParse } from '../../src/domain/fmRefusal.ts';
// Both BYOK engines take the parse contract as a REQUIRED 5th argument (added
// with chat-driven account creation, 1ba1abb — the same transport now also
// serves the account/account-update/transaction-op contracts). This dataset
// only ever exercises the expense contract; omitting it made every openai/
// anthropic case fail with "Cannot read properties of undefined (reading
// 'normalize')", which the runner reports as `status: 'error'` — i.e. a silent
// 0% for both cloud tiers rather than a crash.
import { EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared.ts';
// The shared FM-probe pipeline (step 1a.5) — see evals/fm/pipeline.mjs's own
// header for why `runFM` and `evals/fm/replay-orders.mjs` both call into
// this instead of each hand-rolling their own copy.
import {
  buildFixtures,
  classifyProbeResult,
  extractLoggedOrder,
  runPipeline,
  scoredParse,
  FM_PROBE_TIMEOUT_MS,
} from '../fm/pipeline.mjs';

// Mirrors DEFAULT_BYOK_MODEL.openai (src/features/settings/repository.ts):
// gpt-4.1-mini, the current small non-reasoning GPT model. gpt-4o-mini (the
// 2026-10-01 reference run) stays selectable via OPENAI_MODEL.
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';

// ─── dataset → real src input shapes ────────────────────────────────────────

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

// ─── cloud engines — real raw-fetch transport (not generateObject) ─────────

/**
 * Real shipping path for both BYOK engines: `openaiParseResult`
 * (`src/features/ai/engines/openai.ts`, a raw `fetch` to
 * `POST /v1/chat/completions` with a per-text `json_schema` response format)
 * and `anthropicParseResult` (`src/features/ai/engines/anthropic.ts`, a raw
 * `fetch` to `POST /v1/messages` forcing the `record_expense` tool), each
 * running the step-2/3 expense contract (`EXPENSE_PARSE_CONTRACT`,
 * src/features/ai/engines/shared.ts — the on-device tier's instructions,
 * per-text schema and `finishFmParse`) via `runCloudParse`. Mirrors the app's
 * caller (`app/(tabs)/index.tsx`'s `runCloudParse`) step for step:
 *   1. `cueRefusal(text)` BEFORE the request — a cue hit is a refusal with no
 *      network call (scored as a refusal, costs nothing), exactly as `runFM`.
 *   2. The provider call. A transport/key failure (`auth`, `not_found`,
 *      `rate_limited`, `network`) is reported as `status: 'error'` naming the
 *      reason, so a dead key reads as a harness error in the report instead of
 *      a silent near-0% "model" score; `bad_output` (the model answered, the
 *      answer failed extraction/validation) stays a scored miss (`parse: null`).
 *   3. `classifyDeviceParse` on the validated result: `parsed` -> the parse,
 *      `refused` / `failed` -> `parse: null` (the app shows a refusal / falls
 *      through; either way nothing is logged, which is what `expected: null`
 *      cases score on).
 * `diagnostics.outcome` carries the classification for post-hoc reading; the
 * cold-start fields are the fixed single-attempt values (one request per case).
 */
async function runCloud(engine, parseResult, apiKey, modelId, { text, context }) {
  const amountMode = planFmAmount(text).mode;
  const diagnostics = (extra) => ({
    attempts: 1,
    threw: 0,
    firstAttemptUseful: extra.outcome === 'parsed',
    fieldOrders: [],
    attemptsDetail: [],
    orderUnavailable: 0,
    amountMode,
    ...extra,
  });
  const cueHit = cueRefusal(text);
  if (cueHit) {
    return {
      status: 'ok',
      parse: null,
      diagnostics: { ...diagnostics({ outcome: 'refused', cue: cueHit.cue }), attempts: 0, latencyMs: 0 },
    };
  }
  const { categories, payees, accounts, now, usage } = buildFixtures(context);
  // The app's active currency (CloudParseContext.currency, required) — same
  // rule as runFM below: the case's own `context.currency`, else the app's
  // 'USD' default. It scales the amount into minor units. `usage` feeds the
  // grounding-list caps (src/domain/groundingSelection.ts) as in runFM.
  const ctx = { categories, payees, accounts, now, currency: context.currency ?? 'USD', usage };
  try {
    const started = Date.now();
    const result = await parseResult(text, ctx, apiKey, modelId, EXPENSE_PARSE_CONTRACT);
    const latencyMs = Date.now() - started;
    if (!result.ok) {
      if (result.reason === 'bad_output') {
        return { status: 'ok', parse: null, diagnostics: diagnostics({ outcome: 'failed', reason: result.reason, latencyMs }) };
      }
      return { status: 'error', error: `${engine} request failed: ${result.reason}`, parse: null };
    }
    const outcome = classifyDeviceParse(result.value, text);
    return {
      status: 'ok',
      parse: outcome.kind === 'parsed' ? outcome.parse : null,
      diagnostics: diagnostics({ outcome: outcome.kind, latencyMs }),
    };
  } catch (e) {
    return { status: 'error', error: String(e?.message ?? e), parse: null };
  }
}

async function runOpenAI(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { status: 'skipped', reason: 'no key', parse: null };
  }
  const modelId = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  return runCloud('openai', openaiParseResult, apiKey, modelId, input);
}

async function runAnthropic(input) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { status: 'skipped', reason: 'no key', parse: null };
  }
  const modelId = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  return runCloud('anthropic', anthropicParseResult, apiKey, modelId, input);
}

// ─── Foundation Models (native, Mac-side Swift probe) ───────────────────────

/**
 * FM runs natively only (Apple Foundation Models has no Node binding). If
 * `FM_PROBE_PATH` points at a compiled probe binary, shell out to it over
 * stdin — see README "The FM Swift probe" and `evals/fm/probe.swift`'s own
 * header for how the probe now runs the app's REAL dynamic-schema path
 * (`AppleLLMSchemaParser`, vendored verbatim from the installed
 * `@react-native-ai/apple` binding) rather than a hand-copied static
 * `@Generable` struct (step 1a.2 — closes the schema-path gap step 1a left
 * open). The three inputs sent to the probe are built here from the REAL TS
 * functions — `buildFmParseInstructions()`, `buildFmParsePrompt(text,
 * ctx)`, and `deviceParseSchema`'s own JSON Schema (`getDeviceParseOrderedJsonSchema(plan)`) — never re-typed by hand.
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
  // Exactly as `deviceParse`: a cue refusal is returned with NO model call, so
  // it is scored as a refusal (nothing logged) and costs no probe time.
  const cueHit = cueRefusal(text);
  if (cueHit) {
    return {
      status: 'ok',
      parse: null,
      diagnostics: {
        attempts: 0,
        threw: 0,
        firstAttemptUseful: false,
        fieldOrders: [],
        attemptsDetail: [],
        orderUnavailable: 0,
        outcome: 'refused',
        cue: cueHit.cue,
        amountMode: planFmAmount(text).mode,
        latencyMs: 0,
      },
    };
  }
  const { categories, payees, accounts, now, usage } = buildFixtures(context);
  const ctx = { categories, payees, accounts, now, usage };
  // Mirrors deviceParse.ts's DeviceParseInput.currency: the app's current
  // single-currency setting, defaulting to 'USD'. The dataset's `context` may
  // carry its own `currency` (no case does today, but a future one could);
  // absent that, the app's own default applies — never the functions' own
  // internal default, so a non-USD case would be scored faithfully.
  const currency = context.currency ?? 'USD';

  const instructions = buildFmParseInstructions();
  const prompt = buildFmParsePrompt(text, ctx);
  // Per text (step 3), exactly as deviceParseUnsafe: the schema depends on
  // whether code found one amount, several, or none.
  const plan = planFmAmount(text);
  const schema = getDeviceParseOrderedJsonSchema(plan);
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
  // Wall-clock of every probe invocation for this case (process start, model
  // load and generation together), summed over its attempts. Speed is a cost
  // of step 3's per-text schema and extra field; see README "Step 3".
  let latencyMs = 0;

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

    const startedAt = performance.now();
    const res = spawnSync(probePath, [], {
      input: JSON.stringify({ instructions, prompt, schema }),
      encoding: 'utf8',
      timeout: FM_PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    latencyMs += performance.now() - startedAt;

    const order = extractLoggedOrder(res.stderr);
    if (order) fieldOrders.push(order);

    const kind = classifyProbeResult(res);
    // A harness fault is excluded: the probe may never have reached schema
    // construction at all, so "no order" there says nothing about x-order
    // extraction — only an attempt where the probe actually ran (`kind !==
    // 'harness'`) counts toward orderUnavailable.
    if (!order && kind !== 'harness') orderUnavailable += 1;

    // Every branch below pushes exactly one attemptsDetail entry for this
    // invocation via `finally`, including the shared pipeline's
    // `deviceParseSchema.parse(...)` throw path, which previously left an
    // invocation with an order recorded in `fieldOrders` but no matching
    // attemptsDetail entry.
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
      // `extractTextContent`), never a hand-decoded shape.
      // `runPipeline` (evals/fm/pipeline.mjs) mirrors `generateObject`'s own
      // validation EXACTLY — see src/domain/deviceParseSchemaOrder.ts's own
      // doc comment ("THE ZOD-TO-JSON-SCHEMA CALL-CHAIN") for the full
      // call-chain proof — and throws on a malformed/schema-invalid
      // response, caught by `runDeviceParseAttempts` as a normal MODEL
      // generation failure, never a harness fault, since the probe itself
      // succeeded; it's the model's own output that didn't validate. A later
      // schema field change needs zero probe edits: the probe only ever hands
      // back raw text, never a hand-decoded shape.
      const { parse: parsed, useful: wasUseful } = runPipeline(res.stdout, { text, now, currency, plan, accounts });
      useful = wasUseful;
      return parsed;
    } finally {
      attemptsDetail.push({ order, useful });
    }
  };

  const { parse, attempts, threw } = await runDeviceParseAttempts(text, attempt, isRefusalVerdict);

  if (harnessFault) {
    return { status: 'error', error: harnessFault, parse: null };
  }

  // The app's own classification of the settled parse: a refusal or a failure
  // leaves nothing logged, which is what scores a refusal case as correct.
  const { kind, parse: scored } = scoredParse(parse, text);

  return {
    status: 'ok',
    parse: usableOrNull(scored),
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
      outcome: kind,
      amountMode: plan.mode,
      latencyMs: Math.round(latencyMs),
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

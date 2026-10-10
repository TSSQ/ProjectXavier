#!/usr/bin/env node
/**
 * Fixed field-order replay experiment for the FM probe (dev tooling — never
 * ships, never part of `npm run eval*` or any gate; its results are never
 * committed). See evals/README.md's "Replaying fixed field orders" section
 * for the full usage/contract.
 *
 * Runs chosen dataset cases under chosen fixed schema-property orders, R
 * times each, through the SAME helpers `runFM` (evals/engines/run_node.mjs)
 * uses for a real gated run: `buildFmParseInstructions()`/
 * `buildFmParsePrompt()`, `getDeviceParseOrderedJsonSchema()` (step
 * 1a.5 — src/domain/deviceParseSchemaOrder.ts) for the JSON Schema +
 * "x-order", and `evals/fm/pipeline.mjs`'s shared "probe stdout -> parse ->
 * normalize -> guards -> date override -> validate -> useful -> score"
 * pipeline (never a hand-rolled comparison). The only difference from a
 * normal `fm` run is that THIS script overrides "x-order" per spec entry
 * (the native parser — patched, see patches/@react-native-ai+apple+*.patch —
 * honours it exactly like it would for the app's own pinned order) and
 * makes exactly ONE probe invocation per (case, order, repeat) cell — no
 * cold-start retry loop, since the point here is to isolate the effect of
 * field order, not to reproduce the app's retry behaviour.
 *
 * Every probe stdout is sha256-hashed two ways and reported: a CANONICAL
 * (key-sorted) hash, which is what `hashIdentical` actually checks, and the
 * raw stdout hash as an extra diagnostic field only — the model's own JSON
 * key-order in its OUTPUT is a per-call Swift Dictionary artifact unrelated
 * to "x-order" (which controls generation-time property order, not
 * serialization order), so two byte-different stdouts with the same
 * canonical hash are key-order noise, not a real divergence.
 *
 * Usage (run under `tsx`, not plain `node` — it imports `.ts` production
 * modules directly, same as `evals/engines/run_node.mjs`):
 *   bash evals/fm/build.sh
 *   FM_PROBE_PATH=$PWD/evals/fm/probe npx tsx evals/fm/replay-orders.mjs \
 *     --spec path/to/spec.json [--out path/to/results.json] [--split=dev|holdout|holdout2|all] \
 *     [--confirm-holdout --purpose="..."]   # required for --split=holdout or --split=all
 *
 * `--split` (default `dev`, review B1) filters the spec's own `cases` by the
 * DATASET's "split" field (evals/split.mjs) before running anything — `dev`
 * (the selection/tuning population) is the right choice for an
 * order-selection replay; `holdout`/`all` should only be used for a
 * deliberate, recorded final check (see evals/README.md's
 * holdout-discipline note), never while still iterating on a spec — and
 * (review X2) REFUSE to run at all without `--confirm-holdout
 * --purpose="..."`, the exact same guard `run-eval.mjs` enforces
 * (`guardAndLogHoldoutLook`, evals/split.mjs), logged to the same
 * `evals/holdout-looks.json`.
 *
 * `--spec` (required): a JSON file
 *   { "repeats": R, "cases": [{ "caseId": "large-01", "orders": [[...], ...] }, ...] }
 * `caseId` must match an id in evals/dataset.jsonl; each order must be an
 * EXACT permutation of the schema's property keys — checked up front
 * (`assertValidOrders`, below `main()`), failing loudly before a single
 * probe is spawned, rather than falling back to the native parser's own
 * sorted-key fallback for an invalid "x-order" and silently turning a
 * typo'd spec into a no-op. `--out` (optional) writes the full per-cell
 * JSON results, including every stdout hash; a summary table always prints
 * to stdout. Put spec/results files used for one-off investigation in the
 * scratchpad, never the repo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

process.env.TZ = process.env.TZ || 'UTC';

// ─── REAL production modules — imported directly, never re-implemented ─────
import { buildFmParseInstructions, buildFmParsePrompt } from '../../src/domain/deviceParsePrompt.ts';
// The SAME helper deviceParse.ts/run_node.mjs call to build the JSON Schema
// — see that module's own doc comment. `order` lets this script override
// "x-order" per spec entry (see main()'s pre-flight permutation check below).
import { getDeviceParseOrderedJsonSchema, fieldOrderFor } from '../../src/domain/deviceParseSchemaOrder.ts';
import { planFmAmount } from '../../src/domain/fmAmountPlan.ts';
// The shared FM-probe pipeline (step 1a.5) — see evals/fm/pipeline.mjs's own
// header for why this script and run_node.mjs's runFM both call into this
// instead of each hand-rolling their own copy of buildFixtures/the parse
// pipeline/the pass rule.
import {
  buildFixtures,
  classifyProbeResult,
  extractLoggedOrder,
  runPipeline,
  scoredParse,
  scoreParse,
  sha256,
  FM_PROBE_TIMEOUT_MS,
} from './pipeline.mjs';
// Shared split helpers (review B3) — the one definition of `loadCases(split)`/
// `parseSplitArg`, also used by evals/run-eval.mjs. `guardAndLogHoldoutLook`/
// `gitSha` (review X2) — this script previously had NO holdout guard at all:
// `--split=holdout`/`--split=all` ran with no confirmation and no log, a
// silent back door around the protection `run-eval.mjs` enforced.
import { loadCases, parseSplitArg, guardAndLogHoldoutLook, isGuardedSplit } from '../split.mjs';

/** Canonical (key-sorted) JSON — used for `hashIdentical` so two stdouts
 *  that carry the exact same values but a different JSON key order (a
 *  per-call Swift Dictionary artifact unrelated to field order, which
 *  "x-order" doesn't control on the OUTPUT side, only the generation-time
 *  property order) aren't mistaken for a real divergence. The raw stdout
 *  hash is still reported alongside it, as a diagnostic field only — see
 *  README's "Replaying fixed field orders" section. */
function canonicalJSONString(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSONString).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSONString(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Strict flag parsing (review B3): `--spec`/`--out` (two-token form only,
 *  matching this script's existing convention) plus `--split` via the
 *  shared `parseSplitArg` (both `--split=dev` and `--split dev` forms), and
 *  (review X2) `--confirm-holdout`/`--purpose=...` — the same two flags
 *  `run-eval.mjs` parses, needed to pass `guardAndLogHoldoutLook` for a
 *  `--split=holdout`/`--split=all` run — anything else fails loudly.
 *  Default split is `'dev'` (review B1), matching `run-eval.mjs`: an
 *  order-selection replay should default to the tuning-safe population,
 *  never touching holdout unless asked explicitly. */
function parseArgs(argv) {
  let specPath = null;
  let outPath = null;
  let confirmHoldout = false;
  let purpose = null;
  const remaining = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec') specPath = argv[++i];
    else if (argv[i] === '--out') outPath = argv[++i];
    else if (argv[i] === '--confirm-holdout') confirmHoldout = true;
    else if (argv[i].startsWith('--purpose=')) purpose = argv[i].slice('--purpose='.length);
    else remaining.push(argv[i]);
  }
  let split;
  let unknown;
  try {
    ({ split, rest: unknown } = parseSplitArg(remaining, { default: 'dev' }));
  } catch (e) {
    console.error(`replay-orders: ${e.message}`);
    process.exit(1);
  }
  if (unknown.length > 0) {
    console.error(`replay-orders: unknown flag(s): ${unknown.join(', ')}`);
    process.exit(1);
  }
  if (!specPath) {
    console.error(
      'usage: node evals/fm/replay-orders.mjs --spec <file> [--out <file>] [--split=dev|holdout|all] ' +
        '[--confirm-holdout --purpose="..."]'
    );
    process.exit(1);
  }
  return { specPath, outPath, split, confirmHoldout, purpose };
}

/** Human-readable command string recorded in the holdout-look log (review
 *  X1/X2 — same "always state the split, include the holdout flags that
 *  were actually needed" convention as run-eval.mjs's `commandFor`). */
function commandForReplay(specPath, outPath, split, purpose) {
  const outFlag = outPath ? ` --out ${outPath}` : '';
  const holdoutFlags =
    isGuardedSplit(split) && purpose ? ` --confirm-holdout --purpose="${purpose}"` : '';
  return (
    `FM_PROBE_PATH=$PWD/evals/fm/probe npx tsx evals/fm/replay-orders.mjs --spec ${specPath}` +
    `${outFlag} --split=${split}${holdoutFlags}`
  );
}

/** One (case, order) cell, repeated `repeats` times. Each real probe
 *  invocation is independent — no retry loop — so a `generation`/`harness`
 *  outcome is recorded as its own repeat result, never swallowed. The forced
 *  order is sent as the schema's own `"x-order"` key (`getDeviceParseOrderedJsonSchema`,
 *  step 1a.5) — the same key the shipping app/eval schema carries — so the
 *  probe runs exactly the shipping `AppleLLMSchemaParser` code path, never a
 *  separate dev-only forcing mechanism. */
async function runCell(probePath, datasetCase, order, repeats) {
  const { categories, payees, accounts, now } = buildFixtures(datasetCase.context);
  const ctx = { categories, payees, accounts, now };
  const currency = datasetCase.context.currency ?? 'USD';
  const instructions = buildFmParseInstructions();
  const prompt = buildFmParsePrompt(datasetCase.text, ctx);
  // Step 3: the schema depends on the text. A `single` plan has no `amount`
  // field, so the order actually sent is `order` without it (the spec's orders
  // are permutations of the FULL key set, checked up front).
  const plan = planFmAmount(datasetCase.text);
  const schema = getDeviceParseOrderedJsonSchema(plan, order);
  const sentOrder = fieldOrderFor(plan, order);

  const repeatResults = [];
  for (let i = 0; i < repeats; i++) {
    const res = spawnSync(probePath, [], {
      input: JSON.stringify({ instructions, prompt, schema }),
      encoding: 'utf8',
      timeout: FM_PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });

    const loggedOrder = extractLoggedOrder(res.stderr);
    const forcingWorked = loggedOrder != null && JSON.stringify(loggedOrder) === JSON.stringify(sentOrder);

    const kind = classifyProbeResult(res);
    // Raw stdout hash kept as a diagnostic field only (see README); the
    // CANONICAL (key-sorted) hash below is what `hashIdentical` actually
    // checks, so a per-call JSON key-order artifact in the probe's own
    // output encoding can never register as a real divergence.
    const stdoutHash = kind === 'ok' ? sha256(res.stdout) : null;
    let canonicalHash = null;

    let parse = null;
    let scoreError = null;
    if (kind === 'ok') {
      try {
        canonicalHash = sha256(canonicalJSONString(JSON.parse(res.stdout)));
        // No retry loop here (by design — see this function's own doc
        // comment), so nothing else ever applies `runFM`'s `usableOrNull`
        // gate to this single attempt's result; apply it directly, exactly
        // like the app's own retry loop does on its FINAL result
        // (`deviceParse.ts`'s `usableOrNull`/`runDeviceParseAttempts`'s own
        // `isUsefulDeviceParse` check) — a schema-valid-but-unusable parse
        // (e.g. amount: null) must score as a miss against a real case and
        // as a correct refusal against a fail-to-parse one, never as "the
        // engine returned a parse".
        const { parse: rawParse } = runPipeline(res.stdout, {
          text: datasetCase.text,
          now,
          currency,
          plan,
          accounts,
        });
        // The app's own classification (a refusal or a failure logs nothing).
        parse = scoredParse(rawParse, datasetCase.text).parse;
      } catch (e) {
        scoreError = String(e?.message ?? e);
      }
    }

    const { passed, wrongFields } = scoreParse(datasetCase.expected, parse);

    repeatResults.push({
      repeat: i,
      kind,
      loggedOrder,
      forcingWorked,
      stdoutHash,
      canonicalHash,
      stderr: kind !== 'ok' ? (res.stderr ?? '').trim() : null,
      scoreError,
      parse,
      passed,
      wrongFields,
    });
  }
  return repeatResults;
}

function summarizeCell(repeatResults) {
  const passed = repeatResults.filter((r) => r.passed).length;
  const hashes = new Set(repeatResults.map((r) => r.canonicalHash).filter(Boolean));
  const hashIdentical = repeatResults.every((r) => r.kind === 'ok') && hashes.size <= 1;
  const wrongFieldsUnion = [...new Set(repeatResults.flatMap((r) => r.wrongFields))];
  const forcingWorked = repeatResults.every((r) => r.forcingWorked);
  return { passed, total: repeatResults.length, hashIdentical, wrongFieldsUnion, forcingWorked };
}

/** Pre-flight: every order in the spec must be an exact permutation of the
 *  schema's own property keys (same set, same count, no duplicates) — fails
 *  loudly here, before spawning a single probe, rather than letting a typo'd
 *  order silently fall back to sorted-key order (the patched native parser's
 *  own fallback for an invalid "x-order" — correct for the app, but it would
 *  silently turn a mis-typed replay spec into a no-op experiment). */
function assertValidOrders(spec, schemaPropertyKeys) {
  const expected = new Set(schemaPropertyKeys);
  const failures = [];
  for (const specCase of spec.cases) {
    for (const order of specCase.orders) {
      const actual = new Set(order);
      const isPermutation = actual.size === order.length && actual.size === expected.size &&
        order.every((k) => expected.has(k));
      if (!isPermutation) {
        failures.push(`${specCase.caseId}: order [${order.join(', ')}] is not an exact permutation of [${schemaPropertyKeys.join(', ')}]`);
      }
    }
  }
  if (failures.length > 0) {
    console.error('replay-orders: FAIL — invalid order(s) in spec:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

async function main() {
  const { specPath, outPath, split, confirmHoldout, purpose } = parseArgs(process.argv.slice(2));
  // Review X2 — logged BEFORE the FM_PROBE_PATH check / probe spawn below,
  // same ordering as run-eval.mjs's main(): a run that goes on to fail the
  // probe check (or crash mid-spec) still counts as a deliberate look, see
  // guardAndLogHoldoutLook's own doc comment (evals/split.mjs).
  guardAndLogHoldoutLook({
    split,
    confirmHoldout,
    purpose,
    engine: 'fm',
    command: commandForReplay(specPath, outPath, split, purpose),
  });
  const probePath = process.env.FM_PROBE_PATH;
  if (!probePath) {
    console.error('FM_PROBE_PATH is not set — build the probe first (bash evals/fm/build.sh).');
    process.exit(1);
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const repeats = spec.repeats ?? 3;
  const dataset = loadCases(split);
  const byId = new Map(dataset.map((c) => [c.id, c]));

  const schemaPropertyKeys = Object.keys(getDeviceParseOrderedJsonSchema().properties);
  assertValidOrders(spec, schemaPropertyKeys);

  const results = [];
  for (const specCase of spec.cases) {
    const datasetCase = byId.get(specCase.caseId);
    if (!datasetCase) {
      console.error(`skipping case id in spec that is unknown or outside --split=${split}: ${specCase.caseId}`);
      continue;
    }
    // `--split` (default 'dev', review B1) filters which spec cases actually
    // run, by the DATASET's own "split" field — never the spec file's own
    // order, so an order-selection replay run can be scoped away from
    // "holdout" cases (see evals/README.md's holdout-discipline note) the
    // same way `run-eval.mjs --split` scopes a normal gated run.
    if (split !== 'all' && datasetCase.split !== split) {
      console.log(`skipping ${specCase.caseId} — split "${datasetCase.split}" does not match --split=${split}`);
      continue;
    }
    for (const order of specCase.orders) {
      console.log(`\n=== ${specCase.caseId} — order: ${order.join(', ')} (${repeats}x) ===`);
      const repeatResults = await runCell(probePath, datasetCase, order, repeats);
      const summary = summarizeCell(repeatResults);
      results.push({ caseId: specCase.caseId, order, repeatResults, summary });
      console.log(
        `  pass ${summary.passed}/${summary.total}  hash-identical: ${summary.hashIdentical}  ` +
          `forcing-worked: ${summary.forcingWorked}` +
          (summary.wrongFieldsUnion.length ? `  wrongFields: ${summary.wrongFieldsUnion.join(',')}` : '')
      );
    }
  }

  console.log('\n\n=== Summary table ===');
  console.log('case'.padEnd(18) + 'pass'.padEnd(8) + 'hash-id'.padEnd(10) + 'order');
  for (const r of results) {
    console.log(
      r.caseId.padEnd(18) +
        `${r.summary.passed}/${r.summary.total}`.padEnd(8) +
        `${r.summary.hashIdentical}`.padEnd(10) +
        r.order.join(',')
    );
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');
    console.log(`\nWrote full results to ${outPath}`);
  }
}

main();

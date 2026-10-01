#!/usr/bin/env node
/**
 * Fixed field-order replay experiment for the FM probe (dev tooling — never
 * ships, never part of `npm run eval*` or any gate; its results are never
 * committed). See evals/README.md's "Replaying fixed field orders" section
 * for the full usage/contract.
 *
 * Runs chosen dataset cases under chosen fixed schema-property orders, R
 * times each, through the SAME helpers `runFM` (evals/engines/run_node.mjs)
 * uses for a real gated run: `buildDeviceParseInstructions()`/
 * `buildDeviceParsePrompt()`, `getDeviceParseOrderedJsonSchema()` (step
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
 *     --spec path/to/spec.json [--out path/to/results.json]
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.TZ = process.env.TZ || 'UTC';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const DATASET_PATH = path.join(REPO_ROOT, 'evals', 'dataset.jsonl');

// ─── REAL production modules — imported directly, never re-implemented ─────
import { buildDeviceParseInstructions, buildDeviceParsePrompt } from '../../src/domain/deviceParsePrompt.ts';
// The SAME helper deviceParse.ts/run_node.mjs call to build the JSON Schema
// — see that module's own doc comment. `order` lets this script override
// "x-order" per spec entry (see main()'s pre-flight permutation check below).
import { getDeviceParseOrderedJsonSchema } from '../../src/domain/deviceParseSchemaOrder.ts';
// The shared FM-probe pipeline (step 1a.5) — see evals/fm/pipeline.mjs's own
// header for why this script and run_node.mjs's runFM both call into this
// instead of each hand-rolling their own copy of buildFixtures/the parse
// pipeline/the pass rule.
import {
  buildFixtures,
  classifyProbeResult,
  extractLoggedOrder,
  runPipeline,
  scoreParse,
  sha256,
  FM_PROBE_TIMEOUT_MS,
} from './pipeline.mjs';

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

function loadDataset() {
  return readFileSync(DATASET_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function parseArgs(argv) {
  let specPath = null;
  let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spec') specPath = argv[++i];
    if (argv[i] === '--out') outPath = argv[++i];
  }
  if (!specPath) {
    console.error('usage: node evals/fm/replay-orders.mjs --spec <file> [--out <file>]');
    process.exit(1);
  }
  return { specPath, outPath };
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
  const instructions = buildDeviceParseInstructions();
  const prompt = buildDeviceParsePrompt(datasetCase.text, ctx);
  const schema = getDeviceParseOrderedJsonSchema(order);

  const repeatResults = [];
  for (let i = 0; i < repeats; i++) {
    const res = spawnSync(probePath, [], {
      input: JSON.stringify({ instructions, prompt, schema }),
      encoding: 'utf8',
      timeout: FM_PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });

    const loggedOrder = extractLoggedOrder(res.stderr);
    const forcingWorked = loggedOrder != null && JSON.stringify(loggedOrder) === JSON.stringify(order);

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
        parse = runPipeline(res.stdout, { text: datasetCase.text, now, currency }).parse;
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
  const { specPath, outPath } = parseArgs(process.argv.slice(2));
  const probePath = process.env.FM_PROBE_PATH;
  if (!probePath) {
    console.error('FM_PROBE_PATH is not set — build the probe first (bash evals/fm/build.sh).');
    process.exit(1);
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const repeats = spec.repeats ?? 3;
  const dataset = loadDataset();
  const byId = new Map(dataset.map((c) => [c.id, c]));

  const schemaPropertyKeys = Object.keys(getDeviceParseOrderedJsonSchema().properties);
  assertValidOrders(spec, schemaPropertyKeys);

  const results = [];
  for (const specCase of spec.cases) {
    const datasetCase = byId.get(specCase.caseId);
    if (!datasetCase) {
      console.error(`skipping unknown case id in spec: ${specCase.caseId}`);
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

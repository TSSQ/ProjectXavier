#!/usr/bin/env node
/**
 * Fixed field-order replay experiment for the FM probe (dev tooling — never
 * ships, never part of `npm run eval*` or any gate; its results are never
 * committed). See evals/README.md's "Replaying fixed field orders" section
 * for the full usage/contract.
 *
 * Runs chosen dataset cases under chosen fixed schema-property orders, R
 * times each, through the SAME path `runFM` (evals/engines/run_node.mjs)
 * uses for a real gated run: the real `buildDeviceParseInstructions()`/
 * `buildDeviceParsePrompt()`/`deviceParseSchema` JSON Schema inputs,
 * `JSON.parse` + `deviceParseSchema.parse` on the probe's raw stdout, the
 * same normalize/guard/date-override/re-validate pipeline, and the real
 * scorer (`scoreCase`, evals/score.mjs) — never a hand-rolled comparison.
 * The only difference from a normal `fm` run is the extra `fixedOrder` field
 * sent to the probe (see probe.swift's "Fixed-order mode"), and that this
 * script makes exactly ONE probe invocation per (case, order, repeat) cell —
 * no cold-start retry loop, since the point here is to isolate the effect of
 * field order, not to reproduce the app's retry behaviour.
 *
 * Every raw stdout is sha256-hashed and reported, so determinism is checked
 * at the byte level, not just pass/fail.
 *
 * Usage (run under `tsx`, not plain `node` — it imports `.ts` production
 * modules directly, same as `evals/engines/run_node.mjs`):
 *   bash evals/fm/build.sh
 *   FM_PROBE_PATH=$PWD/evals/fm/probe npx tsx evals/fm/replay-orders.mjs \
 *     --spec path/to/spec.json [--out path/to/results.json]
 *
 * `--spec` (required): a JSON file
 *   { "repeats": R, "cases": [{ "caseId": "large-01", "orders": [[...], ...] }, ...] }
 * `caseId` must match an id in evals/dataset.jsonl; each order must name
 * exactly that case's schema properties (the probe fails loudly — a harness
 * fault — if it doesn't). `--out` (optional) writes the full per-cell JSON
 * results, including every raw stdout hash; a summary table always prints to
 * stdout. Put spec/results files used for one-off investigation in the
 * scratchpad, never the repo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodSchema } from 'ai';

process.env.TZ = process.env.TZ || 'UTC';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const DATASET_PATH = path.join(REPO_ROOT, 'evals', 'dataset.jsonl');

try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  // No .env present — fine, this script needs no API keys.
}

// ─── REAL production modules — imported directly, never re-implemented ─────
import {
  deviceParseSchema,
  buildDeviceParseInstructions,
  buildDeviceParsePrompt,
  normalizeDeviceParseOutput,
  applyGroundingGuards,
  isUsefulDeviceParse,
  resolveTypedDate,
} from '../../src/domain/deviceParsePrompt.ts';
import { aiParsedExpenseSchema } from '../../src/lib/validation.ts';
import { scoreCase } from '../score.mjs';

const FM_PROBE_TIMEOUT_MS = 60_000;

/** Mirrors run_node.mjs's buildFixtures exactly (same dataset `context`
 *  shape) — kept as its own small copy here rather than importing
 *  run_node.mjs, which is a CLI script that calls `main()` as a side effect
 *  of being loaded and isn't set up to be imported as a module. */
function buildFixtures(context) {
  const categories = context.categories.map((c, i) => ({ id: `cat-${i}`, name: c.name, kind: c.kind }));
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

let deviceParseJsonSchemaPromise = null;
function getDeviceParseJsonSchema() {
  if (!deviceParseJsonSchemaPromise) {
    deviceParseJsonSchemaPromise = zodSchema(deviceParseSchema).jsonSchema;
  }
  return deviceParseJsonSchemaPromise;
}

function classifyProbeResult(res) {
  if (res.error) return 'harness';
  if (res.signal) return 'harness';
  if (res.status === 0) return 'ok';
  if (res.status === 2) return 'generation';
  return 'harness';
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** One (case, order) cell, repeated `repeats` times. Each real probe
 *  invocation is independent — no retry loop — so a `generation`/`harness`
 *  outcome is recorded as its own repeat result, never swallowed. */
async function runCell(probePath, datasetCase, order, repeats) {
  const { categories, payees, accounts, now } = buildFixtures(datasetCase.context);
  const ctx = { categories, payees, accounts, now };
  const currency = datasetCase.context.currency ?? 'USD';
  const instructions = buildDeviceParseInstructions();
  const prompt = buildDeviceParsePrompt(datasetCase.text, ctx);
  const schema = await getDeviceParseJsonSchema();

  const repeatResults = [];
  for (let i = 0; i < repeats; i++) {
    const res = spawnSync(probePath, [], {
      input: JSON.stringify({ instructions, prompt, schema, fixedOrder: order }),
      encoding: 'utf8',
      timeout: FM_PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });

    const orderMatch = /^schema property order: (.+)$/m.exec(res.stderr ?? '');
    const loggedOrder = orderMatch ? orderMatch[1].split(',').map((s) => s.trim()) : null;
    const forcingWorked = loggedOrder != null && JSON.stringify(loggedOrder) === JSON.stringify(order);

    const kind = classifyProbeResult(res);
    const stdoutHash = kind === 'ok' ? sha256(res.stdout) : null;

    let parse = null;
    let scoreError = null;
    if (kind === 'ok') {
      try {
        const modelOutput = deviceParseSchema.parse(JSON.parse(res.stdout));
        const normalized = applyGroundingGuards(
          normalizeDeviceParseOutput(modelOutput, currency),
          datasetCase.text,
          currency
        );
        normalized.occurredAt = resolveTypedDate(datasetCase.text, now) ?? now;
        const validated = aiParsedExpenseSchema.safeParse(normalized);
        parse = validated.success ? validated.data : null;
        parse = isUsefulDeviceParse(parse) ? parse : null;
      } catch (e) {
        scoreError = String(e?.message ?? e);
      }
    }

    const scored = scoreCase(datasetCase.expected ?? null, parse);

    repeatResults.push({
      repeat: i,
      kind,
      loggedOrder,
      forcingWorked,
      stdoutHash,
      stderr: kind !== 'ok' ? (res.stderr ?? '').trim() : null,
      scoreError,
      parse,
      passed: scored.failToParseCase ? scored.correct : scored.overall,
      wrongFields: scored.fields
        ? Object.keys(scored.fields).filter((f) => !scored.fields[f])
        : [],
    });
  }
  return repeatResults;
}

function summarizeCell(repeatResults) {
  const passed = repeatResults.filter((r) => r.passed).length;
  const hashes = new Set(repeatResults.map((r) => r.stdoutHash).filter(Boolean));
  const hashIdentical = repeatResults.every((r) => r.kind === 'ok') && hashes.size <= 1;
  const wrongFieldsUnion = [...new Set(repeatResults.flatMap((r) => r.wrongFields))];
  const forcingWorked = repeatResults.every((r) => r.forcingWorked);
  return { passed, total: repeatResults.length, hashIdentical, wrongFieldsUnion, forcingWorked };
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

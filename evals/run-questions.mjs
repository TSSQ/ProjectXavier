#!/usr/bin/env node
/**
 * The question eval runner (dev tooling — never ships; see evals/README.md
 * "Questions"). Measures the Ask-Xavier question path end to end over
 * `evals/questions.jsonl`, answering against the fixed ledger
 * `evals/questions-ledger.json`. Runs under `tsx` (it imports the app's
 * TypeScript directly — see evals/questions-engines.mjs for each engine).
 *
 *   npm run eval:questions          # gate + floor, dev, the 100% deterministic bar
 *   npm run eval:questions:cloud    # anthropic + openai, dev (keys from evals/.env; skipped without)
 *   npm run eval:questions:fm       # the on-device selection through the Swift probe (Mac only)
 *
 * Flags: --engine=gate,floor,fm,anthropic,openai (comma list)
 *        --split=dev|holdout|all (holdout/all need --confirm-holdout --purpose="...", logged
 *          to evals/holdout-looks.json like every holdout look)
 *        --limit=N (first N cases, a cheap smoke run; never writes an artifact)
 *        --fm-arm=baseline|known-categories (the on-device prompt A/B arm, D4)
 *        --no-write (print only)
 *
 * Writes `evals/results/questions.<engine>.<split>.json` (the scored artifact,
 * same provenance fields as run-eval.mjs: gitSha, dirty, command, datasetSplit)
 * and, for a model engine, `evals/results/raw/questions.<engine>.<split>.jsonl`
 * (per-case calls and statuses, so a label fix can be re-checked without a
 * paid re-run). An artifact identical to the committed one except for
 * gitSha/generatedAt is not rewritten.
 *
 * Exit code: gate/floor on `dev` are a 100% bar — every case passes, except a
 * case whose `knownGaps` names that engine, which must FAIL (a gap that now
 * passes is stale and fails the bar until it is removed from the dataset).
 * Model engines are report-only (exit 0); their misses are the measurement.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitSha, guardAndLogHoldoutLook, parseSplitArg } from './split.mjs';
import { isRepoDirty, isArtifactUnchanged } from './gates.mjs';
import { validateQuestionCases } from './questions-schema.mjs';
import {
  QUESTIONS_TZ,
  loadQuestionCases,
  loadLedger,
  scoreCase,
  gateMetrics,
  axisBreakdown,
  gateRouteOk,
} from './questions-score.mjs';
import { ENGINES, MODEL_ENGINES, runEngine, engineModel, engineUnavailable } from './questions-engines.mjs';
import { FM_ARMS, fmPromptForArm } from './questions-fm-arms.mjs';

process.env.TZ = QUESTIONS_TZ;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const RAW_DIR = path.join(RESULTS_DIR, 'raw');

/** The files whose text decides what a question engine does. */
export const QUESTION_PIPELINE_FILES = [
  'src/domain/intentGate.ts',
  'src/domain/queryIntent.ts',
  'src/domain/queryFloor.ts',
  'src/domain/periodRange.ts',
  'src/domain/queryTools.ts',
  'src/domain/queryFilterResolution.ts',
  'src/domain/queryToolSelection.ts',
  'src/domain/deviceSchemas.ts',
  'src/domain/queryLoopPrompt.ts',
  'src/features/ai/queryLoop.ts',
  'evals/questions-fm-arms.mjs',
];

function pipelineSha() {
  const h = createHash('sha256');
  for (const rel of QUESTION_PIPELINE_FILES) h.update(`${rel}\n${readFileSync(path.join(REPO_ROOT, rel), 'utf8')}\n`);
  return h.digest('hex').slice(0, 16);
}

function labelSha(cases) {
  const lines = cases.map((c) => `${c.id}\t${c.text}\t${JSON.stringify(c.expect)}\t${JSON.stringify(c.knownGaps ?? [])}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

function loadEnvIfPresent() {
  for (const p of [path.join(__dirname, '.env'), path.join(REPO_ROOT, '.env')]) {
    try {
      process.loadEnvFile(p);
      return;
    } catch {
      // missing file: the process env is authoritative
    }
  }
}

function parseArgs(argv) {
  const { split, rest } = parseSplitArg(argv, { default: 'dev' });
  const opts = { split, engines: ['gate', 'floor'], limit: null, write: true, confirmHoldout: false, purpose: null, fmArm: 'baseline' };
  for (const arg of rest) {
    if (arg.startsWith('--engine=')) opts.engines = arg.slice(9).split(',').filter(Boolean);
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice(8));
    else if (arg === '--no-write') opts.write = false;
    else if (arg === '--confirm-holdout') opts.confirmHoldout = true;
    else if (arg.startsWith('--purpose=')) opts.purpose = arg.slice(10);
    else if (arg.startsWith('--fm-arm=')) opts.fmArm = arg.slice(9);
    else throw new Error(`unknown flag ${arg}`);
  }
  for (const e of opts.engines) if (!ENGINES.includes(e)) throw new Error(`unknown engine "${e}" (one of ${ENGINES.join('|')})`);
  if (!FM_ARMS.includes(opts.fmArm)) throw new Error(`--fm-arm must be one of ${FM_ARMS.join('|')}`);
  if (opts.limit !== null && !(Number.isInteger(opts.limit) && opts.limit > 0)) throw new Error('--limit must be a positive integer');
  return opts;
}

function casesForSplit(all, split) {
  if (split === 'all') return all;
  if (split === 'holdout2') throw new Error('questions have no holdout2 split');
  return all.filter((c) => c.split === split);
}

/** Pass/fail of one case for one engine (see the module header). */
export function casePass(engine, c, row) {
  if (engine === 'gate') return gateRouteOk(c.expect.intent, row.gate);
  if (engine === 'floor' && c.expect.intent === 'query' && c.expect.floor === 'stand_aside') {
    return row.gate === 'query' && (row.served === null || row.score.pass);
  }
  return row.score.pass;
}

/** The known gap that excuses `engine` on `c`. The floor runs behind the
 *  gate, so a gate gap excuses the floor too. */
function gapFor(engine, c) {
  const gaps = c.knownGaps ?? [];
  const own = gaps.find((g) => g.engine === engine);
  if (own || engine !== 'floor') return own ?? null;
  return gaps.find((g) => g.engine === 'gate') ?? null;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);

function summarise(engine, cases, rows) {
  const scored = rows.filter((r) => r.status !== 'error');
  const passCount = scored.filter((r) => r.pass).length;
  const byGroup = (key) => {
    const m = {};
    for (const r of scored) {
      const k = key(r);
      if (k == null) continue;
      m[k] ??= { correct: 0, total: 0 };
      m[k].total++;
      if (r.pass) m[k].correct++;
    }
    for (const v of Object.values(m)) v.accuracy = v.correct / v.total;
    return m;
  };
  const queryRows = scored.filter((r) => r.case.expect.intent === 'query');
  const summary = {
    overall: { correct: passCount, total: scored.length, accuracy: scored.length ? passCount / scored.length : null },
    queries: {
      correct: queryRows.filter((r) => r.pass).length,
      total: queryRows.length,
      accuracy: queryRows.length ? queryRows.filter((r) => r.pass).length / queryRows.length : null,
    },
    perAxis: axisBreakdown(scored),
    perIntent: byGroup((r) => r.case.expect.intent),
    perTool: byGroup((r) => r.case.expect.tool),
    perStyle: byGroup((r) => r.case.style),
    gateMetrics: gateMetrics(rows),
    errors: rows.filter((r) => r.status === 'error').map((r) => ({ id: r.case.id, error: r.error })),
  };
  if (MODEL_ENGINES.includes(engine)) {
    const fb = queryRows.filter((r) => r.pass || r.floorFallbackPass).length;
    summary.withFloorFallback = { correct: fb, total: queryRows.length, note: 'queries answered correctly by the engine, or by the floor the app falls back to when the engine serves nothing' };
  }
  return summary;
}

function printReport(engine, split, summary, rows, bar) {
  console.log(`\n=== questions · ${engine} · split=${split} · ${engineModel(engine)} ===`);
  const s = summary;
  console.log(`cases: ${s.overall.total}${s.errors.length ? ` (+${s.errors.length} errors, not scored)` : ''}`);
  console.log(`pass: ${s.overall.correct}/${s.overall.total} (${pct(s.overall.accuracy)})   queries: ${s.queries.correct}/${s.queries.total} (${pct(s.queries.accuracy)})`);
  const g = s.gateMetrics;
  console.log(`gate: precision ${pct(g.precision)}  recall ${pct(g.recall)}  (questions sent to the expense ladder: ${g.questionsToExpenseLadder})`);
  if (engine !== 'gate') {
    console.log('per axis:');
    for (const [axis, v] of Object.entries(s.perAxis)) console.log(`  ${axis.padEnd(8)} ${v.correct}/${v.total} (${pct(v.accuracy)})`);
    console.log('per tool:');
    for (const [tool, v] of Object.entries(s.perTool).sort()) console.log(`  ${tool.padEnd(22)} ${v.correct}/${v.total}`);
  }
  console.log('per intent:', Object.entries(s.perIntent).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(' · '));
  console.log('per style: ', Object.entries(s.perStyle).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(' · '));
  if (s.withFloorFallback) console.log(`with the app's floor fallback: ${s.withFloorFallback.correct}/${s.withFloorFallback.total}`);
  if (s.errors.length) {
    console.log(`errors (${s.errors.length}, harness/transport — not model misses):`);
    for (const e of s.errors.slice(0, 10)) console.log(`  ${e.id}: ${e.error}`);
  }
  const misses = rows.filter((r) => r.status !== 'error' && !r.pass && !r.gap);
  if (misses.length) {
    console.log(`misses (${misses.length}):`);
    for (const r of misses) {
      const wrong = r.score ? Object.entries(r.score.axes).filter(([, v]) => v === false).map(([k]) => k) : [];
      const a = r.score?.actual;
      console.log(
        `  ${r.case.id} ${JSON.stringify(r.case.text)} gate=${r.gate} wrong=[${wrong.join(',')}]` +
          (a ? ` got ${a.tool} ${JSON.stringify(a.period)} ${JSON.stringify(a.filters)} ${a.answerMinor} want ${r.case.expect.tool} ${JSON.stringify(r.case.expect.period)} ${JSON.stringify(r.case.expect.filters)} ${r.case.expect.answerMinor}` : '')
      );
    }
  }
  const gaps = rows.filter((r) => r.gap);
  if (gaps.length) console.log(`known gaps (${gaps.length}, expected to fail on ${engine}): ${gaps.map((r) => r.case.id).join(', ')}`);
  if (bar) {
    if (bar.failures.length) {
      console.log(`\nFAIL — ${bar.failures.length} case(s) break the 100% bar:`);
      for (const f of bar.failures) console.log(`  ${f.id} ${JSON.stringify(f.text)}: ${f.why}`);
    } else console.log(`\nPASS — ${engine} meets the 100% bar on ${split} (${gaps.length} known gap(s) still failing as recorded).`);
  }
}

function writeArtifact(engine, split, payload) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `questions.${engine}.${split}.json`);
  const out = {
    engine,
    model: engineModel(engine),
    gitSha: gitSha(),
    generatedAt: new Date().toISOString(),
    dirty: isRepoDirty(REPO_ROOT),
    datasetFile: 'evals/questions.jsonl',
    ledgerFile: 'evals/questions-ledger.json',
    metric:
      'Per case: intent (the unified gate) on every case; tool, period (after the code override), filters (resolved entity names, set equality) and answer (headlineMinor, exact) on question cases. A case passes when every applicable axis is right. Errors (harness/transport) are listed, never scored.',
    ...payload,
  };
  let existing = null;
  try {
    existing = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch {
    existing = null;
  }
  if (isArtifactUnchanged(existing, out)) {
    console.log(`questions: ${path.relative(REPO_ROOT, outPath)} unchanged (only gitSha/generatedAt would differ) — not rewriting.`);
    return;
  }
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`questions: wrote ${path.relative(REPO_ROOT, outPath)}`);
}

function writeRawFile(engine, split, header, rows) {
  mkdirSync(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, `questions.${engine}.${split}.jsonl`);
  const lines = [JSON.stringify({ _header: true, ...header })];
  for (const r of rows) {
    lines.push(
      JSON.stringify({
        id: r.case.id,
        status: r.status,
        gate: r.gate,
        ...(r.error ? { error: r.error } : {}),
        calls: (r.served?.calls ?? []).map((k) => ({ tool: k.tool, params: k.params, result: k.result })),
        ...(r.diagnostics ? { diagnostics: r.diagnostics } : {}),
      })
    );
  }
  writeFileSync(file, lines.join('\n') + '\n');
  console.log(`questions: raw per-case calls -> ${path.relative(REPO_ROOT, file)}`);
}

export async function runQuestions(argv) {
  const opts = parseArgs(argv);
  loadEnvIfPresent();
  const all = loadQuestionCases();
  const problems = validateQuestionCases(all);
  if (problems.length) {
    for (const p of problems) console.error(`  ${p.id}: ${p.issues.join('; ')}`);
    throw new Error(`questions.jsonl: ${problems.length} invalid case(s)`);
  }
  let cases = casesForSplit(all, opts.split);
  if (opts.limit) cases = cases.slice(0, opts.limit);
  const ledger = loadLedger();
  const command = `npx tsx evals/run-questions.mjs ${argv.join(' ')}`.trim();
  let ok = true;

  // One look per invocation, logged before any engine runs (split.mjs's rule).
  const runnable = opts.engines.filter((e) => !engineUnavailable(e));
  if (runnable.length) {
    guardAndLogHoldoutLook({ split: opts.split, confirmHoldout: opts.confirmHoldout, purpose: opts.purpose, engine: `questions:${runnable.join(',')}`, command });
  }

  for (const engine of opts.engines) {
    const unavailable = engineUnavailable(engine);
    if (unavailable) {
      console.log(`\n=== questions · ${engine}: ${unavailable} ===`);
      continue;
    }
    const engineOpts = engine === 'fm' ? { arm: opts.fmArm } : {};
    const concurrency = engine === 'anthropic' || engine === 'openai' ? 4 : 1;
    const rows = await mapLimit(cases, concurrency, async (c) => {
      const prompt = engine === 'fm' ? fmPromptForArm(opts.fmArm, c, ledger) : undefined;
      const r = await runEngine(engine, ledger, c, prompt === undefined ? {} : { prompt });
      const row = { case: c, gate: r.gate, status: r.status, error: r.error, served: r.served ?? null, diagnostics: r.diagnostics };
      if (row.status !== 'error') {
        row.score = scoreCase(c, { gate: row.gate, served: row.served });
        row.pass = casePass(engine, c, row);
        if (MODEL_ENGINES.includes(engine) && !row.pass && row.served === null && c.expect.intent === 'query') {
          const floor = await runEngine('floor', ledger, c);
          row.floorFallbackPass = floor.served ? scoreCase(c, { gate: floor.gate, served: floor.served }).pass : false;
        }
      }
      const gap = gapFor(engine, c);
      if (gap) row.gap = gap;
      return row;
    });

    const deterministic = engine === 'gate' || engine === 'floor';
    let bar = null;
    if (deterministic && (opts.split === 'dev' || opts.split === 'all')) {
      const failures = [];
      for (const r of rows) {
        if (r.gap && r.pass) failures.push({ id: r.case.id, text: r.case.text, why: `stale known gap (${engine} now passes) — remove it from knownGaps` });
        else if (!r.gap && !r.pass) failures.push({ id: r.case.id, text: r.case.text, why: 'fails' });
      }
      bar = { failures };
      if (failures.length) ok = false;
    }

    const summary = summarise(engine, cases, rows);
    printReport(engine, opts.split, summary, rows, bar);

    if (opts.write && !opts.limit) {
      const payload = {
        datasetSplit: opts.split,
        command,
        caseCount: cases.length,
        datasetLabelSha: labelSha(cases),
        pipelineSha: pipelineSha(),
        ...(engine === 'fm' ? { fmArm: opts.fmArm } : {}),
        status: 'ok',
        ...(bar ? { bar: { type: 'deterministic-100', passed: bar.failures.length === 0, failures: bar.failures } } : {}),
        ...summary,
        knownGaps: rows.filter((r) => r.gap).map((r) => ({ id: r.case.id, reason: r.gap.reason, stillFailing: !r.pass })),
        cases: rows.map((r) => ({
          id: r.case.id,
          status: r.status,
          pass: r.pass ?? null,
          gate: r.gate,
          ...(r.score ? { axes: r.score.axes } : {}),
          ...(r.score?.actual ? { actual: r.score.actual } : {}),
          ...(r.error ? { error: r.error } : {}),
        })),
      };
      const artifactEngine = engine === 'fm' && opts.fmArm !== 'baseline' ? `fm-${opts.fmArm}` : engine;
      writeArtifact(artifactEngine, opts.split, payload);
      if (MODEL_ENGINES.includes(engine)) {
        writeRawFile(artifactEngine, opts.split, { engine, model: engineModel(engine), datasetSplit: opts.split, gitSha: gitSha(), generatedAt: new Date().toISOString(), command, pipelineSha: pipelineSha(), ...(opts.split !== 'dev' ? { warning: 'contains per-case model outputs; reading this while tuning contaminates the holdout' } : {}) }, rows);
      }
    }
  }
  return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runQuestions(process.argv.slice(2))
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => {
      console.error(`questions: ${e.message}`);
      process.exit(1);
    });
}

/**
 * Measure note extraction end-to-end: a real engine's output, through the real
 * `applyGroundingGuards`/`groundedNote`, exactly as the app runs it.
 *
 * Like the rest of evals/, this NEVER re-implements the parse path — it shells
 * out to evals/engines/run_node.mjs, the same runner the scored eval uses.
 *
 *   node evals/note/run.mjs                          # fm, 3 runs
 *   node evals/note/run.mjs --engine=openai --n=1    # BYOK (needs OPENAI_API_KEY)
 *
 * `fm` needs the Swift probe built first: bash evals/fm/build.sh
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, CTX } from './corpus.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let engine = 'fm';
let runs = 3;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--engine=')) engine = arg.slice('--engine='.length);
  if (arg.startsWith('--n=')) runs = Math.max(1, Number(arg.slice('--n='.length)) || 1);
}

const dataset = path.join(mkdtempSync(path.join(tmpdir(), 'note-eval-')), 'corpus.jsonl');
writeFileSync(
  dataset,
  CASES.map((c) =>
    JSON.stringify({
      id: c.id,
      axis: 'note',
      text: c.text,
      context: CTX,
      // The scored eval's fields; unused here (this script scores `note`
      // itself, which the main scorer does not look at) but kept so the same
      // runner can consume the file.
      expected: { amountMinor: null, sign: 'expense', dateISO: '2026-08-17', category: null, payee: null },
    })
  ).join('\n') + '\n'
);

const results = new Map(CASES.map((c) => [c.id, []]));
for (let i = 0; i < runs; i++) {
  const stdout = execFileSync('npx', ['tsx', 'evals/engines/run_node.mjs', engine, dataset], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, FM_PROBE_PATH: process.env.FM_PROBE_PATH ?? `${REPO_ROOT}/evals/fm/probe` },
  });
  for (const r of JSON.parse(stdout)) results.get(r.id)?.push((r.parse ?? {}).note ?? null);
}

const filled = (v) => v != null && String(v).trim() !== '';
let kept = 0, keptTotal = 0, leaked = 0, leakTotal = 0;

console.log(`\nengine=${engine}  runs=${runs}\n`);
console.log(`${'case'.padEnd(5)} ${'want'.padEnd(24)} got`);
console.log('-'.repeat(92));
for (const c of CASES) {
  const got = results.get(c.id) ?? [];
  const n = got.filter(filled).length;
  if (c.want == null) { leakTotal += runs; leaked += n; }
  else { keptTotal += runs; kept += n; }
  const flag = c.want == null ? (n ? '  <- LEAK' : '') : n === runs ? '' : '  <- MISS';
  console.log(
    `${c.id.padEnd(5)} ${String(c.want ?? '(none)').slice(0, 23).padEnd(24)} ` +
      got.map((g) => JSON.stringify(g)).join(' | ').slice(0, 56) + flag
  );
}
console.log('-'.repeat(92));
console.log(`recall  (note-bearing cases): ${kept}/${keptTotal}`);
console.log(`leaked  (traps, want 0):      ${leaked}/${leakTotal}`);
console.log(
  '\nPrecision is the gate: a leak means rubbish reached a transaction. A miss\n' +
    'only means a note the user can still type themselves.'
);

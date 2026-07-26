#!/usr/bin/env node
/**
 * Human-readable eval surface for the deterministic intent gate
 * (docs/design/ask-xavier-queries-spec.md §4 point 3) — reads the SAME
 * tests/intent-corpus.jsonl the jest suite (tests/__steps__/intent-corpus.
 * steps.ts) asserts against, runs every case through the unified gate
 * (src/domain/intentGate.ts's `detectIntent`), and prints a per-class
 * pass/fail table. Exits non-zero on ANY failure — this is a 100% bar (the
 * gate is deterministic), not a statistical threshold, so "npm run
 * eval:intent" is the thing to run green before landing any gate change
 * (see the "no gate change without corpus cases added first" rule in
 * src/domain/queryIntent.ts's and src/domain/accountIntent.ts's headers).
 *
 * Run with `npm run eval:intent` (wired to `tsx` so it can import the
 * TypeScript domain modules directly, no build step).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectIntent } from '../src/domain/intentGate.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.resolve(__dirname, '../tests/intent-corpus.jsonl');

function loadCorpus() {
  const raw = fs.readFileSync(CORPUS_PATH, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const CLASSES = ['create', 'update', 'delete', 'query', 'null'];

function main() {
  const corpus = loadCorpus();
  const totals = Object.fromEntries(CLASSES.map((c) => [c, { pass: 0, total: 0 }]));
  const failures = [];

  for (const { text, expect: expectLabel, note } of corpus) {
    const expected = expectLabel === 'null' ? null : expectLabel;
    const actual = detectIntent(text);
    const bucket = totals[expectLabel];
    if (!bucket) {
      failures.push({ text, expectLabel, actual, note: `unrecognised expect label "${expectLabel}"` });
      continue;
    }
    bucket.total++;
    if (actual === expected) {
      bucket.pass++;
    } else {
      failures.push({ text, expectLabel, actual, note });
    }
  }

  console.log('Intent gate eval — tests/intent-corpus.jsonl\n');
  console.log('class     pass/total');
  console.log('--------  -----------');
  for (const cls of CLASSES) {
    const { pass, total } = totals[cls];
    console.log(`${cls.padEnd(8)}  ${pass}/${total}`);
  }
  console.log('');

  if (failures.length > 0) {
    console.log(`FAILURES (${failures.length}):\n`);
    for (const f of failures) {
      console.log(`  "${f.text}"`);
      console.log(`    expected: ${f.expectLabel}  actual: ${f.actual ?? 'null'}`);
      console.log(`    note: ${f.note}\n`);
    }
    console.log(`FAIL — ${failures.length}/${corpus.length} case(s) failed.`);
    process.exit(1);
  }

  console.log(`PASS — ${corpus.length}/${corpus.length} cases.`);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * Runs the not-a-transaction cue check (src/domain/notTransactionCues.ts) over
 * the DEV split and prints what it hit (dev tooling - never ships, no model).
 *
 *   npx tsx evals/fm/cue-hits.mjs          # human table
 *   npx tsx evals/fm/cue-hits.mjs --json   # machine-readable (test-cues.mjs)
 *
 * `falsePositives` must stay empty: a cue that fires (with the app's amount
 * gate) on a case whose expected label is a transaction. Dev only: it never
 * reads holdout or holdout2 cases.
 */
import { loadCases } from '../split.mjs';
import { cueRefusal } from '../../src/domain/notTransactionCues.ts';

export function cueHitsOnDev() {
  const cases = loadCases('dev');
  const falsePositives = [];
  const bySubtype = {};
  const missedRefusals = [];
  for (const c of cases) {
    const hit = cueRefusal(c.text);
    if (c.expected !== null) {
      if (hit) falsePositives.push({ id: c.id, text: c.text, cue: hit.cue });
      continue;
    }
    const st = c.subtype ?? 'unspecified';
    bySubtype[st] ??= { hits: 0, total: 0, cues: {} };
    bySubtype[st].total += 1;
    if (hit) {
      bySubtype[st].hits += 1;
      bySubtype[st].cues[hit.cue] = (bySubtype[st].cues[hit.cue] ?? 0) + 1;
    } else if (st === 'finance-near-miss') {
      missedRefusals.push({ id: c.id, text: c.text });
    }
  }
  return { cases: cases.length, falsePositives, bySubtype, missedRefusals };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const r = cueHitsOnDev();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
  else console.log(JSON.stringify(r, null, 2));
}

#!/usr/bin/env node
/**
 * Runs the deterministic sign reader (src/domain/signReader.ts) and the
 * transaction affirmation (src/domain/fmRefusal.ts, `affirmsTransaction`) over
 * the DEV split and prints what they decide (dev tooling - never ships, no
 * model). Guarded by evals/test-sign.mjs (part of `npm run eval`).
 *
 *   npx tsx evals/fm/sign-hits.mjs          # human table
 *   npx tsx evals/fm/sign-hits.mjs --json   # machine-readable (test-sign.mjs)
 *
 *  - `signWrong` must stay empty: a sign the reader decides on a parse case
 *    must equal the case's `sign` label (the reader decides only where the
 *    words are unambiguous, so a disagreement is a bug, not a judgment call);
 *  - `demotedTransfers` must stay empty: `resolveSign` must never turn a
 *    labelled transfer into something else when the model answered transfer;
 *  - `affirmedRefusals` must stay empty: the affirmation must not fire on a
 *    case whose label is a refusal (a false log is the costly error);
 *  - `affirmedSpends` counts the parse cases the affirmation WOULD keep had the
 *    model refused them (so a broken rule that never fires cannot pass).
 * Dev only: it never reads holdout or holdout2 cases.
 */
import { loadCases } from '../split.mjs';
import { buildFixtures } from './pipeline.mjs';
import { readSign, resolveSign } from '../../src/domain/signReader.ts';
import { affirmsTransaction } from '../../src/domain/fmRefusal.ts';
import { planFmAmount } from '../../src/domain/fmAmountPlan.ts';

export function signHitsOnDev() {
  const cases = loadCases('dev');
  const signWrong = [];
  const demotedTransfers = [];
  const affirmedRefusals = [];
  const byRule = {};
  let decided = 0;
  let parseCases = 0;
  let affirmedSpends = 0;
  const affirmedBy = {};
  for (const c of cases) {
    const { accounts } = buildFixtures(c.context);
    const plan = planFmAmount(c.text);
    const affirmed = affirmsTransaction(c.text, plan);
    if (c.expected === null) {
      if (affirmed) affirmedRefusals.push({ id: c.id, text: c.text, reason: affirmed });
      continue;
    }
    parseCases += 1;
    if (affirmed) {
      affirmedSpends += 1;
      affirmedBy[affirmed] = (affirmedBy[affirmed] ?? 0) + 1;
    }
    const read = readSign(c.text, accounts);
    if (read) {
      decided += 1;
      byRule[read.rule] = (byRule[read.rule] ?? 0) + 1;
      if (read.type !== c.expected.sign) {
        signWrong.push({ id: c.id, text: c.text, label: c.expected.sign, read: read.type, rule: read.rule });
      }
    }
    if (c.expected.sign === 'transfer') {
      const resolved = resolveSign(c.text, 'transfer', accounts);
      if (resolved.type !== 'transfer') demotedTransfers.push({ id: c.id, text: c.text, resolved });
    }
  }
  return { cases: cases.length, parseCases, decided, byRule, signWrong, demotedTransfers, affirmedSpends, affirmedBy, affirmedRefusals };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const r = signHitsOnDev();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
  else console.log(JSON.stringify(r, null, 2));
}

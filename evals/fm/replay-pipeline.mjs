#!/usr/bin/env node
/**
 * Offline replay of a stored FM raw file through the CURRENT post-model
 * pipeline (dev tooling - never ships; calls no model, spends no holdout look).
 *
 *   npx tsx evals/fm/replay-pipeline.mjs evals/results/raw/fm.dev.jsonl
 *   npx tsx evals/fm/replay-pipeline.mjs <raw> --json
 *
 * WHY. The pipeline after `generateObject` (src/domain/fmParse.ts
 * `finishFmParse`: the sign reader, the transaction affirmation, the grounding
 * guards) can change on a machine that cannot run Apple Foundation Models. A
 * raw file (evals/raw.mjs) stores each case's FINISHED parse, not the model's
 * raw object, so this script rebuilds an approximate model object from the
 * stored parse and runs it through `finishFmParse` again:
 *   - a `parsed` row becomes `isTransaction: true` with the stored type, payee,
 *     category, account and note (all of which the old pipeline had already
 *     grounded, so a guard that would have dropped them already did);
 *   - a `refused` row becomes `isTransaction: false` with the sentinel fields.
 *     The refusing model's own type/category/payee were never stored, so an
 *     affirmed row carries "" for them: its `sign` is what the sign reader or
 *     the model's default decides, and a category/payee the label asserts is
 *     scored as a miss here even if the real model would have filled it.
 * It is therefore a LOWER BOUND for the new pipeline on affirmed rows and exact
 * for the sign/payee rules on parsed rows. It prints the per-case flips and the
 * before/after pass counts; it never writes an artifact.
 *
 * Dev only by contract: refuse a guarded (holdout) raw file, whose per-case
 * outputs must not be read while tuning (README, "Holdout discipline").
 */
import path from 'node:path';
import { loadCases, isGuardedSplit } from '../split.mjs';
import { readRaw } from '../raw.mjs';
import { buildFixtures, scoreParse } from './pipeline.mjs';
import { finishFmParse } from '../../src/domain/fmParse.ts';
import { planFmAmount } from '../../src/domain/fmAmountPlan.ts';
import { candidateLabel } from '../../src/domain/amountCandidates.ts';
import { classifyDeviceParse } from '../../src/domain/fmRefusal.ts';

const SENTINELS = { currency: '', type: 'expense', category: '', payee: '', account: '', note: '', occurredOn: '', confidence: 0.5, pending: false };

/** The model object the stored row most plausibly came from (see header). */
export function modelObjectFrom(row, plan, currency) {
  const p = row.parse;
  if (!p || row.diagnostics?.outcome === 'refused') {
    const o = { ...SENTINELS, isTransaction: false };
    if (plan.mode === 'choice') o.amount = candidateLabel(plan.values[0]);
    else if (plan.mode === 'model') o.amount = 0;
    return o;
  }
  const major = p.amount == null ? 0 : p.amount / 10 ** (currency === 'JPY' ? 0 : 2);
  const o = {
    ...SENTINELS,
    isTransaction: true,
    type: p.type ?? 'expense',
    category: p.category ?? '',
    payee: p.payee ?? '',
    account: p.account ?? '',
    note: p.note ?? '',
    currency: p.currency ?? '',
    confidence: p.confidence ?? 0.5,
    pending: p.pending ?? false,
  };
  if (plan.mode === 'choice') o.amount = candidateLabel(major);
  else if (plan.mode === 'model') o.amount = major;
  return o;
}

/** Replays `rawFile` and returns per-run before/after scores and the flips. */
export function replayPipeline(rawFile) {
  const { header, runs } = readRaw(rawFile);
  if (isGuardedSplit(header.datasetSplit)) {
    throw new Error(`refusing to replay ${header.datasetSplit}: a holdout raw file is not read while tuning`);
  }
  const cases = new Map(loadCases(header.datasetSplit).map((c) => [c.id, c]));
  const perRun = [];
  const flips = [];
  const stillFailing = [];
  runs.forEach((results, run) => {
    let before = 0;
    let after = 0;
    let scored = 0;
    for (const row of results) {
      const c = cases.get(row.id);
      if (!c || row.status !== 'ok') continue;
      scored += 1;
      const wasPassing = scoreParse(c.expected, row.parse).passed;
      const { accounts, now } = buildFixtures(c.context);
      const currency = c.context.currency ?? 'USD';
      const plan = planFmAmount(c.text);
      let parse = null;
      let affirmed = null;
      let sign = null;
      if (row.diagnostics?.outcome === 'refused' || row.parse) {
        const finished = finishFmParse(modelObjectFrom(row, plan, currency), c.text, plan, now, currency, accounts);
        affirmed = finished?.affirmed ?? null;
        sign = finished?.type ?? null;
        const outcome = classifyDeviceParse(finished, c.text);
        parse = outcome.kind === 'parsed' ? outcome.parse : null;
      }
      const nowScore = scoreParse(c.expected, parse);
      if (wasPassing) before += 1;
      if (nowScore.passed) after += 1;
      else stillFailing.push({ run, id: c.id, text: c.text, wrongFields: nowScore.wrongFields, affirmed });
      if (wasPassing !== nowScore.passed || (row.parse && parse && row.parse.type !== parse.type)) {
        flips.push({
          run,
          id: c.id,
          text: c.text,
          was: wasPassing ? 'pass' : 'fail',
          now: nowScore.passed ? 'pass' : 'fail',
          wrongFields: nowScore.wrongFields,
          typeBefore: row.parse?.type ?? null,
          typeAfter: sign,
          affirmed,
        });
      }
    }
    perRun.push({ run, scored, before, after });
  });
  return { header, perRun, flips, stillFailing };
}

function main() {
  const args = process.argv.slice(2);
  const rawFile = args.find((a) => !a.startsWith('--'));
  if (!rawFile) {
    console.error('usage: npx tsx evals/fm/replay-pipeline.mjs <raw.jsonl> [--json]');
    process.exit(2);
  }
  const r = replayPipeline(path.resolve(rawFile));
  if (args.includes('--json')) {
    console.log(JSON.stringify(r));
    return;
  }
  console.log(`replay-pipeline: ${r.header.engine} (${r.header.model}) split=${r.header.datasetSplit} recorded at ${r.header.gitSha}`);
  for (const p of r.perRun) console.log(`  run ${p.run}: ${p.before}/${p.scored} passing before -> ${p.after}/${p.scored} after`);
  for (const f of r.flips) {
    const type = f.typeBefore !== f.typeAfter ? ` type ${f.typeBefore ?? 'none'} -> ${f.typeAfter ?? 'none'}` : '';
    const aff = f.affirmed ? ` affirmed(${f.affirmed})` : '';
    const wrong = f.wrongFields.length ? ` still wrong: ${f.wrongFields.join(',')}` : '';
    console.log(`  run ${f.run} ${f.id} "${f.text}": ${f.was} -> ${f.now}${type}${aff}${wrong}`);
  }
  console.log('  still failing:');
  for (const f of r.stillFailing) {
    const aff = f.affirmed ? ` (affirmed: ${f.affirmed}; the refusing model's category/payee are not stored)` : '';
    console.log(`    run ${f.run} ${f.id} "${f.text}": ${f.wrongFields.join(',')}${aff}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();

#!/usr/bin/env node
/**
 * Safety-check screen for the FM prompt (dev tooling - never ships, not a
 * gate). Foundation Models' safety check ("May contain sensitive content")
 * fires on some instruction wordings for ordinary texts, apparently at random
 * (evals/README.md, step 3). A thrown generation is a `failed`, so every edit to
 * the FM instructions, user-turn prompt or schema descriptions must be screened:
 * this runs every DEV text through the probe once, with the exact instructions,
 * prompt and schema the app would send (`planFmAmount` -> `getDeviceParseOrderedJsonSchema`),
 * and lists the texts whose generation did not succeed. Require zero.
 *
 *   bash evals/fm/build.sh
 *   FM_PROBE_PATH=$PWD/evals/fm/probe npx tsx evals/fm/screen-throws.mjs
 *
 * Dev split only: it never reads holdout or holdout2 cases.
 */
import { spawnSync } from 'node:child_process';
import { buildFmParseInstructions, buildFmParsePrompt } from '../../src/domain/deviceParsePrompt.ts';
import { getDeviceParseOrderedJsonSchema } from '../../src/domain/deviceParseSchemaOrder.ts';
import { planFmAmount } from '../../src/domain/fmAmountPlan.ts';
import { loadCases } from '../split.mjs';
import { buildFixtures, classifyProbeResult, FM_PROBE_TIMEOUT_MS } from './pipeline.mjs';

const probePath = process.env.FM_PROBE_PATH;
if (!probePath) {
  console.error('set FM_PROBE_PATH to the compiled probe (bash evals/fm/build.sh)');
  process.exit(1);
}

const instructions = buildFmParseInstructions();
const thrown = [];
const cases = loadCases('dev');
for (const c of cases) {
  const { categories, payees, accounts, now, usage } = buildFixtures(c.context);
  const res = spawnSync(probePath, [], {
    input: JSON.stringify({
      instructions,
      prompt: buildFmParsePrompt(c.text, { categories, payees, accounts, now, usage }),
      schema: getDeviceParseOrderedJsonSchema(planFmAmount(c.text)),
    }),
    encoding: 'utf8',
    timeout: FM_PROBE_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (classifyProbeResult(res) !== 'ok') thrown.push(c.id);
}
console.log(`screened ${cases.length} dev texts: ${thrown.length} did not generate${thrown.length ? ` (${thrown.join(', ')})` : ''}`);
process.exit(thrown.length ? 1 : 0);

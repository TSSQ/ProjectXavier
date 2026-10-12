#!/usr/bin/env node
/**
 * Hashes of the FM user-turn prompt for every DEV case whose context carries no
 * usage data (every dev case before Package B2's `dv-cap-*`), built exactly as
 * `run_node.mjs` builds it: `buildFmParsePrompt(fmPromptText(text, now), ctx)`.
 * Dev tooling - never ships, not a gate.
 *
 * It writes `tests/fixtures/fm-prompt-sha.main.json`, which the BDD suite
 * (`grounding-selection.feature`) compares with the current builder, so a
 * change to the grounding selector cannot silently change the prompt of a
 * small-context case again (the first B2 FM dev run lost six such cases to a
 * name sort alone; evals/README.md "Package B2"). Regenerate it from the tree
 * the comparison should be against, e.g. main before the caps:
 *
 *   git archive <ref> src | tar -x -C .prompt-ref
 *   npx tsx evals/fm/prompt-hashes.mjs --src=.prompt-ref --ref=<ref> --out=tests/fixtures/fm-prompt-sha.main.json
 *   rm -rf .prompt-ref
 *
 * `--src` must sit inside the repo so the extracted tree resolves `zod` from
 * its node_modules. The dataset and `buildFixtures` always come from THIS
 * tree. Dev split only: it never reads holdout or holdout2 cases.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCases } from '../split.mjs';
import { buildFixtures } from './pipeline.mjs';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const src = path.resolve(repo, arg('src', '.'));
const { buildFmParsePrompt, fmPromptText } = await import(
  pathToFileURL(path.join(src, 'src/domain/deviceParsePrompt.ts')).href
);

const hashes = {};
for (const c of loadCases('dev')) {
  if (c.context.payeeUsage || c.context.categoryUsage) continue;
  const { categories, payees, accounts, now } = buildFixtures(c.context);
  const prompt = buildFmParsePrompt(fmPromptText(c.text, now), { categories, payees, accounts, now });
  hashes[c.id] = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

const out = { ref: arg('ref', 'working tree'), caseCount: Object.keys(hashes).length, hashes };
const file = arg('out');
if (file) writeFileSync(path.resolve(repo, file), JSON.stringify(out, null, 2) + '\n');
else process.stdout.write(JSON.stringify(out, null, 2) + '\n');
console.error(`${out.caseCount} dev prompts hashed from ${src}`);

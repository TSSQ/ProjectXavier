#!/usr/bin/env node
/**
 * Self-tests for the cloud eval's worked-examples arm (evals/worked-examples.mjs;
 * README "Worked examples"). Runs under tsx (imports the app's TS), and is run by
 * `npm run eval`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syntheticWorkedExamples, contextKey } from './worked-examples.mjs';
import { commandFor } from './command.mjs';
import { phraseKey } from '../src/domain/phraseMemory.ts';
import { MAX_WORKED_EXAMPLES } from '../src/domain/workedExamples.ts';
import { buildCloudParsePrompt } from '../src/domain/deviceParsePrompt.ts';

const dataset = readFileSync(new URL('./dataset.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const byId = new Map(dataset.map((c) => [c.id, c]));
const nowOf = (c) => Date.parse(c.context.nowISO);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const CTX = { categories: [{ name: 'Food', kind: 'expense' }], payees: ['Ya Kun'], accounts: ['Cash'], nowISO: '2026-07-16T12:00:00+08:00' };
const OTHER_CTX = { ...CTX, payees: ['Grab'] };
const mk = (id, text, expected, { split = 'dev', context = CTX } = {}) => ({ id, split, text, context, expected });
const tx = (category, payee, sign = 'expense') => ({ amountMinor: 100, sign, dateISO: '2026-07-16', category, payee });

test('never_the_case_itself_its_own_phrase_holdout_another_context_a_refusal_or_an_unasserted_label', () => {
  const c = mk('c', 'kopi 2', tx('Food', 'Ya Kun'));
  const pool = [
    c,
    mk('same-phrase', 'kopi 3.50', tx('Food', null)),
    mk('holdout', 'teh 2', tx('Food', null), { split: 'holdout' }),
    mk('holdout2', 'milo 2', tx('Food', null), { split: 'holdout2' }),
    mk('other-ctx', 'grab home 12', tx(null, 'Grab'), { context: OTHER_CTX }),
    mk('refusal', 'how much on food 5', null),
    mk('unasserted', 'lunch 8', tx(null, null)),
    mk('ok', 'toast at ya kun 6', tx('Food', 'Ya Kun')),
  ];
  assert.deepEqual(syntheticWorkedExamples(c, pool), [
    { phrase: 'toast at ya kun', type: 'expense', category: 'Food', payee: 'Ya Kun', account: '' },
  ]);
});

test('at_most_five_in_a_fixed_per_case_order', () => {
  const pool = Array.from({ length: 12 }, (_, i) => mk(`p${i}`, `thing ${String.fromCharCode(97 + i)} 5`, tx('Food', null)));
  const c = mk('c', 'kopi 2', tx('Food', null));
  const a = syntheticWorkedExamples(c, pool);
  assert.equal(a.length, MAX_WORKED_EXAMPLES);
  assert.deepEqual(syntheticWorkedExamples(c, [...pool].reverse()), a, 'order does not depend on the pool order');
  const d = syntheticWorkedExamples(mk('d', 'kopi 2', tx('Food', null)), pool);
  assert.notDeepEqual(d.map((e) => e.phrase), a.map((e) => e.phrase), 'a different case draws a different set');
});

test('over_the_real_dataset_every_example_comes_from_another_dev_case_with_the_same_context', () => {
  let withExamples = 0;
  for (const c of dataset) {
    const examples = syntheticWorkedExamples(c, dataset);
    assert.ok(examples.length <= MAX_WORKED_EXAMPLES);
    if (examples.length) withExamples++;
    const own = phraseKey(c.text, nowOf(c));
    for (const e of examples) {
      assert.notEqual(e.phrase, own, c.id);
      const sources = dataset.filter(
        (o) => o.id !== c.id && o.split === 'dev' && o.expected && contextKey(o.context) === contextKey(c.context) && phraseKey(o.text, nowOf(o)) === e.phrase
      );
      assert.ok(sources.length > 0, `${c.id}: example "${e.phrase}" has no dev source with the same context`);
    }
  }
  assert.ok(withExamples > dataset.length / 2, `only ${withExamples} cases get any example`);
});

test('the_examples_reach_the_cloud_prompt_the_arm_sends', () => {
  const c = byId.get('plain-03') ?? dataset.find((x) => x.split === 'dev' && x.expected);
  const examples = syntheticWorkedExamples(c, dataset);
  assert.ok(examples.length > 0);
  const ctx = { categories: [], payees: [], accounts: [], now: nowOf(c) };
  const prompt = buildCloudParsePrompt(c.text, { ...ctx, workedExamples: examples });
  for (const e of examples) assert.ok(prompt.includes(`Example: ${e.phrase} → ${e.type}/`), e.phrase);
  assert.ok(!buildCloudParsePrompt(c.text, ctx).includes('Example:'));
});

test('the_recorded_command_names_the_arm', () => {
  assert.equal(commandFor('anthropic', 1, 'dev', { examples: true }), 'npm run eval:cloud:examples -- --split=dev');
  assert.equal(commandFor('anthropic', 1, 'dev'), 'npm run eval:cloud -- --split=dev');
  assert.equal(commandFor('openai', 1, 'dev', { examples: true }), 'node evals/run-eval.mjs --engine=openai --examples --split=dev');
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);

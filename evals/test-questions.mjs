#!/usr/bin/env node
/**
 * Self-tests for the question eval (dev tooling — never ships; see
 * evals/README.md "Questions"). Runs under tsx (`npx tsx evals/test-questions.mjs`,
 * also run by `npm run eval` and `npm run eval:questions`): the dataset is
 * valid and complete, every label's `answerMinor` is what its expected call
 * yields over the ledger, the ledger matches its builder, the split is locked,
 * the scorer and the engines behave (cloud with a mocked fetch, fm with a fake
 * probe — no key, no Mac), and gate + floor meet the deterministic bar on dev.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateQuestionCases } from './questions-schema.mjs';
import {
  QUESTIONS_TZ,
  loadQuestionCases,
  loadLedger,
  expectedAnswerMinor,
  contextFromLedger,
  scoreCase,
  headlineMinor,
  gateMetrics,
} from './questions-score.mjs';
import { runCloud, runFm, transportFailure, fmProbeInput } from './questions-engines.mjs';
import { ledgerJson, LEDGER_PATH } from './questions-ledger-build.mjs';
import { questionSplitProblems, QUESTIONS_SPLIT_LOCK_PATH } from './questions-split.mjs';
import { loadSplitLock } from './split.mjs';
import { questionCorrectionsToCases } from './corrections/fold-questions.mjs';
import { runQuestions, scoringLabelSha, changedScoringIds } from './run-questions.mjs';
import { buildQuestionCorrectionCase } from '../src/domain/parseCorrection.ts';
import { resolvePeriodFromText } from '../src/domain/periodRange.ts';
import { cloudOptionsForArm, fmPromptForArm } from './questions-fm-arms.mjs';
import { compositeRow, rowFromArtifactCase, loadInnerArtifact } from './questions-composite.mjs';

process.env.TZ = QUESTIONS_TZ;

const cases = loadQuestionCases();
const ledger = loadLedger();
const byText = (t) => cases.find((c) => c.text === t);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('every_case_matches_the_schema_with_no_duplicate_ids_or_texts', () => {
  assert.deepEqual(validateQuestionCases(cases), []);
});

test('the_dataset_is_big_enough_and_has_near_misses_of_every_kind', () => {
  assert.ok(cases.length >= 150, `${cases.length} cases`);
  const nearMiss = cases.filter((c) => c.expect.intent !== 'query');
  assert.ok(nearMiss.length >= 30, `${nearMiss.length} near-misses`);
  for (const intent of ['expense', 'refuse', 'account']) assert.ok(nearMiss.some((c) => c.expect.intent === intent), intent);
  for (const style of ['terse', 'full']) assert.ok(cases.some((c) => c.style === style), style);
  for (const tool of ['total_spent', 'total_income', 'spending_by_category', 'spending_over_time', 'top_payees', 'net_worth', 'search_transactions']) {
    assert.ok(cases.some((c) => c.expect.tool === tool), tool);
  }
});

test('every_answer_label_is_what_its_expected_call_yields_over_the_ledger', () => {
  for (const c of cases.filter((k) => k.expect.intent === 'query')) {
    assert.equal(expectedAnswerMinor(ledger, c), c.expect.answerMinor, `${c.id} ${c.text}`);
  }
});

test('every_case_context_is_the_ledger_context', () => {
  for (const c of cases) assert.deepEqual(c.context, contextFromLedger(ledger, c.context.nowISO), c.id);
});

test('the_ledger_matches_its_seeded_builder', () => {
  assert.equal(readFileSync(LEDGER_PATH, 'utf8'), ledgerJson());
});

test('the_ledger_has_rows_aggregates_must_leave_out', () => {
  assert.ok(ledger.transactions.some((t) => t.pending), 'a pending row');
  const now = Date.parse(ledger.nowISO);
  assert.ok(ledger.transactions.some((t) => t.occurredAt > now && !t.pending), 'a future-dated row');
  assert.ok(ledger.transactions.some((t) => t.type === 'transfer'), 'a transfer');
  assert.ok(ledger.payees.length > 20, 'more payees than the grounding cap');
});

test('the_split_is_assigned_and_locked', () => {
  assert.deepEqual(questionSplitProblems(cases, loadSplitLock(QUESTIONS_SPLIT_LOCK_PATH)), []);
  const holdout = cases.filter((c) => c.split === 'holdout').length;
  assert.ok(holdout > 20 && holdout < cases.length / 2, `${holdout} holdout`);
});

// ─── scorer ─────────────────────────────────────────────────────────────────

const call = (tool, params, result) => ({ tool, params, result });

test('a_fully_right_call_passes_and_each_wrong_axis_is_named', () => {
  const c = byText('how much did I spend on food this month');
  const right = { calls: [call('total_spent', { period: 'this_month' }, { amountMinor: c.expect.answerMinor, resolvedCategory: 'Food' })] };
  assert.equal(scoreCase(c, { gate: 'query', served: right }).pass, true);
  const unfiltered = { calls: [call('total_spent', { period: 'this_month' }, { amountMinor: 1 })] };
  const s = scoreCase(c, { gate: 'query', served: unfiltered });
  assert.deepEqual(s.axes, { intent: true, tool: true, period: true, filters: false, answer: false });
  assert.equal(scoreCase(c, { gate: 'other', served: right }).axes.intent, false);
  assert.equal(scoreCase(c, { gate: 'query', served: null }).pass, false);
});

test('a_union_is_scored_on_the_sum_over_its_calls_and_the_union_of_filters', () => {
  const c = byText('how much on food and groceries this month');
  const ctx = c.expect.answerMinor;
  const served = {
    calls: [
      call('total_spent', { period: 'this_month' }, { amountMinor: ctx - 100, resolvedCategory: 'Food' }),
      call('total_spent', { period: 'this_month' }, { amountMinor: 100, resolvedCategory: 'Groceries' }),
    ],
  };
  assert.equal(scoreCase(c, { gate: 'query', served }).pass, true);
});

test('a_non_query_case_is_scored_on_intent_only', () => {
  const c = byText('spent 20 on lunch');
  assert.equal(scoreCase(c, { gate: 'other', served: null }).pass, true);
  assert.equal(scoreCase(c, { gate: 'query', served: null }).pass, false);
  assert.equal(scoreCase(byText('rename my wallet to Cash'), { gate: 'account', served: null }).pass, true);
});

test('headline_minor_ignores_free_model_choices', () => {
  assert.equal(headlineMinor('top_payees', { rows: [{ amountMinor: 9 }, { amountMinor: 3 }] }), 9);
  assert.equal(headlineMinor('spending_over_time', { series: [{ amountMinor: 2 }, { amountMinor: 5 }] }), 7);
  assert.equal(headlineMinor('net_worth', { series: [{ amountMinor: 1 }, { amountMinor: 4 }] }), 4);
  assert.equal(headlineMinor('search_transactions', { rows: [] }), 0);
});

test('gate_metrics_count_the_costly_direction', () => {
  const q = { case: { expect: { intent: 'query' } } };
  const x = { case: { expect: { intent: 'expense' } } };
  const m = gateMetrics([{ ...q, gate: 'query' }, { ...q, gate: 'other' }, { ...x, gate: 'query' }, { ...x, gate: 'other' }]);
  assert.equal(m.precision, 0.5);
  assert.equal(m.recall, 0.5);
  assert.equal(m.questionsToExpenseLadder, 1);
});

test('periods_are_compared_as_ranges_and_a_quarter_by_its_months', () => {
  const oct = byText('total oct');
  const asThisMonth = { calls: [call('total_spent', { period: 'this_month' }, { amountMinor: oct.expect.answerMinor })] };
  assert.equal(scoreCase(oct, { gate: 'query', served: asThisMonth }).axes.period, true, 'this_month is October on 2026-10-21');
  const q3 = byText('how much did i spend in q3');
  const months = [6, 7, 8].map((month) => call('total_spent', { period: { kind: 'month', year: 2026, month } }, { amountMinor: 0 }));
  months[0].result.amountMinor = q3.expect.answerMinor;
  assert.equal(scoreCase(q3, { gate: 'query', served: { calls: months } }).pass, true);
  const twoMonths = { calls: months.slice(0, 2) };
  assert.equal(scoreCase(q3, { gate: 'query', served: twoMonths }).axes.period, false);
});

test('an_exploratory_or_duplicate_call_does_not_inflate_a_union', () => {
  const c = byText('how much on food and groceries this month');
  const p = { period: 'this_month' };
  const food = call('total_spent', p, { amountMinor: c.expect.answerMinor - 100, filters: [{ names: ['Food'] }] });
  const groc = call('total_spent', p, { amountMinor: 100, filters: [{ names: ['Groceries'] }] });
  const unfiltered = call('total_spent', p, { amountMinor: 999999 });
  assert.equal(scoreCase(c, { gate: 'query', served: { calls: [unfiltered, food, groc, food] } }).axes.answer, true);
});

test('net_worth_point_vs_series_is_part_of_the_tool_axis', () => {
  const c = byText('show my net worth trend');
  const point = { calls: [call('net_worth', { series: false }, { amountMinor: c.expect.answerMinor })] };
  assert.equal(scoreCase(c, { gate: 'query', served: point }).axes.tool, false);
});

test('a_2xx_with_a_body_that_is_not_json_is_an_error_not_a_miss', async () => {
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const c = byText('how much did I spend this month');
  const bad = { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); }, clone() { return this; } };
  const r = await withFetch(async () => bad, () => runCloud('openai', ledger, c, { retries: 0 }));
  assert.equal(r.status, 'error');
  assert.match(r.error, /bad_body/);
});

// ─── engines ────────────────────────────────────────────────────────────────

test('transport_failures_are_classified_without_any_body', () => {
  assert.equal(transportFailure([{ status: 200 }]), null);
  assert.equal(transportFailure([{ status: 401 }]), 'auth');
  assert.equal(transportFailure([{ status: 429 }]), 'rate_limited');
  assert.equal(transportFailure([{ thrown: 'AbortError' }]), 'timeout');
  assert.equal(transportFailure([{ thrown: 'TypeError' }]), 'network');
});

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });

test('the_anthropic_engine_runs_the_real_loop_against_the_ledger', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  const c = byText('how much did I spend on food this month');
  let round = 0;
  const served = await withFetch(async (_url, init) => {
    round++;
    const body = JSON.parse(init.body);
    assert.ok(Array.isArray(body.tools) && body.tools.length > 0);
    if (round === 1) {
      return json(200, { content: [{ type: 'tool_use', id: 't1', name: 'total_spent', input: { period: 'this_month', category: 'Food' } }] });
    }
    return json(200, { content: [{ type: 'text', text: 'Done.' }] });
  }, () => runCloud('anthropic', ledger, c, { retries: 0 }));
  assert.equal(served.status, 'ok');
  assert.equal(scoreCase(c, { gate: 'query', served: served.served }).pass, true);
});

test('a_bad_key_is_an_error_status_never_a_scored_miss', async () => {
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const c = byText('how much did I spend this month');
  const r = await withFetch(async () => json(401, {}), () => runCloud('openai', ledger, c, { retries: 0 }));
  assert.equal(r.status, 'error');
  assert.match(r.error, /auth/);
  assert.doesNotMatch(r.error, /test-key/);
});

test('a_model_that_declines_is_ok_with_nothing_served', async () => {
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  const c = byText('how much did I spend this month');
  const r = await withFetch(
    async () => json(200, { choices: [{ message: { role: 'assistant', content: 'I cannot.' } }] }),
    () => runCloud('openai', ledger, c, { retries: 0 })
  );
  assert.equal(r.status, 'ok');
  assert.equal(r.served, null);
});

function fakeProbe(script) {
  const dir = mkdtempSync(path.join(tmpdir(), 'qprobe-'));
  const file = path.join(dir, 'probe');
  writeFileSync(file, `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(file, 0o755);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FM_PICK = JSON.stringify({ tool: 'total_spent', period: 'last_month', category: 'food', payee: '', account: '', granularity: 'unspecified', topN: 0, series: 'unspecified' });

test('the_fm_engine_mirrors_the_app_through_a_probe_with_the_period_override', () => {
  const p = fakeProbe(`cat > /dev/null; echo '${FM_PICK}'`);
  try {
    const c = byText('how much did I spend on food this month');
    const r = runFm(ledger, c, { probePath: p.file });
    assert.equal(r.status, 'ok');
    // The model said last_month; the text says this month — code wins.
    assert.equal(r.served.calls[0].params.period, 'this_month');
    assert.equal(scoreCase(c, { gate: 'query', served: r.served }).pass, true);
  } finally {
    p.cleanup();
  }
});

test('an_fm_generation_failure_retries_and_a_probe_crash_is_an_error', () => {
  const flaky = fakeProbe(`cat > /dev/null; f="$(dirname "$0")/n"; if [ -f "$f" ]; then echo '${FM_PICK}'; else touch "$f"; exit 2; fi`);
  const crash = fakeProbe('cat > /dev/null; exit 1');
  const garbage = fakeProbe(`cat > /dev/null; echo '{"tool":42}'`);
  try {
    const c = byText('how much did I spend on food this month');
    const r = runFm(ledger, c, { probePath: flaky.file });
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.diagnostics.attempts.map((a) => a.outcome), ['generation_failed', 'call']);
    assert.equal(runFm(ledger, c, { probePath: crash.file }).status, 'error');
    const g = runFm(ledger, c, { probePath: garbage.file });
    assert.equal(g.status, 'ok');
    assert.equal(g.served, null);
    assert.deepEqual(g.diagnostics.attempts.map((a) => a.outcome), ['invalid_output', 'invalid_output']);
  } finally {
    flaky.cleanup();
    crash.cleanup();
    garbage.cleanup();
  }
});

test('the_fm_probe_input_is_the_shipping_contract', () => {
  const input = fmProbeInput('food this month?');
  assert.equal(input.prompt, 'Question: food this month?');
  assert.ok(Array.isArray(input.schema['x-order']), 'pinned field order');
  assert.ok(input.instructions.length > 100);
});

test('the_cloud_closed_arm_sends_the_users_names_as_a_closed_choice_and_free_sends_free_text', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  const c = byText('how much did I spend eating out last month');
  for (const [arm, wantEnum] of [['closed', true], ['free', false]]) {
    const bodies = [];
    await withFetch(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return json(200, { content: [{ type: 'text', text: 'ok' }] });
    }, () => runCloud('anthropic', ledger, c, { retries: 0, loopOptions: cloudOptionsForArm(arm, ledger) }));
    const cat = bodies[0].tools.find((t) => t.name === 'total_spent').input_schema.properties.category;
    assert.equal(Array.isArray(cat.enum), wantEnum, arm);
    if (wantEnum) assert.ok(cat.enum.includes('Dining Out') && cat.enum.includes('unspecified'));
  }
});

test('the_fm_known_categories_arm_adds_one_capped_line_to_the_user_turn_only', () => {
  const c = byText('food this month?');
  assert.equal(fmPromptForArm('baseline', c, ledger), undefined);
  const prompt = fmPromptForArm('known-categories', c, ledger);
  const [q, line, ...rest] = prompt.split('\n');
  assert.equal(q, 'Question: food this month?');
  assert.match(line, /^Known categories: .*\bFood\b.*\bSalary\b/);
  assert.doesNotMatch(line, /Card Payment/, 'transfer categories are not offered');
  assert.deepEqual(rest, []);
  assert.equal(fmProbeInput(c.text, { prompt }).instructions, fmProbeInput(c.text).instructions, 'instructions never vary by arm');
});

test('every_labelled_explicit_period_is_what_the_code_reads_from_the_text', () => {
  for (const c of cases.filter((k) => k.expect.intent === 'query' && k.expect.period && typeof k.expect.period === 'object')) {
    assert.deepEqual(resolvePeriodFromText(c.text, Date.parse(c.context.nowISO)), c.expect.period, `${c.id} ${c.text}`);
  }
});

// ─── corrections ────────────────────────────────────────────────────────────

function appCorrection(text, corrected, expect, nonce, extra = {}) {
  return buildQuestionCorrectionCase({
    text,
    categories: ledger.categories,
    payeeNames: [...ledger.payees.map((p) => p.name), 'My Real Landlord'],
    accounts: ledger.accounts,
    now: Date.parse(ledger.nowISO),
    nonce,
    question: {
      engine: 'on_device',
      call: { tool: 'total_spent', params: { period: 'this_month' } },
      filters: [],
      corrected,
      dimensions: ['filter'],
      expect: { expectPeriod: 'this_month', expectCategory: null, expectPayee: null, ...expect },
      answer: { before: { amountMinor: 1, items: null }, after: { amountMinor: 2, items: null } },
      ...extra,
    },
  });
}

test('an_app_question_correction_folds_onto_the_fixture_and_a_foreign_name_is_refused', () => {
  const ok = appCorrection('grocery total this month please', { tool: 'total_spent', params: { period: 'last_month', category: 'grocery' } }, { expectTool: 'total_spent', expectPeriod: 'last_month', expectCategory: 'Groceries' }, 'aaaaaa');
  const foreign = appCorrection('how much at the corner shop', { tool: 'total_spent', params: { period: 'this_month' } }, { expectTool: 'total_spent', expectPayee: 'Corner Shop' }, 'bbbbbb');
  const comparison = appCorrection('food this month vs last', { tool: 'total_spent', params: { period: 'this_month' } }, { expectTool: 'total_spent', expectCategory: 'Food' }, 'cccccc', { fromComparison: true });
  const r = questionCorrectionsToCases([ok, foreign, comparison, { id: 'dv-parse', axis: 'user-correction', expected: null }], ledger);
  assert.equal(r.cases.length, 1);
  const c = r.cases[0];
  assert.match(c.id, /^dv-uq-/);
  assert.equal(c.expect.period, 'last_month', 'the period the user re-ran');
  assert.deepEqual(c.expect.filters, ['Groceries']);
  assert.equal(c.expect.answerMinor, expectedAnswerMinor(ledger, c));
  assert.ok(!JSON.stringify(c).includes('My Real Landlord'), 'the phone context is dropped');
  assert.deepEqual(validateQuestionCases([{ ...c, split: 'dev' }]), []);
  assert.equal(r.problems.length, 2);
  assert.ok(r.problems.some((p) => /not a fixture entity/.test(p.issues.join(' '))));
  assert.ok(r.problems.some((p) => /comparison/.test(p.issues.join(' '))));
});

// ─── composite (routing policy) ─────────────────────────────────────────────

test('the_composite_serves_the_floor_when_it_answers_and_the_inner_engine_otherwise', () => {
  const c = cases[0];
  const inner = rowFromArtifactCase(c, { id: c.id, status: 'ok', pass: true, gate: 'query', axes: { intent: true }, actual: { tool: 'total_spent' } });
  const floorServed = { case: c, gate: 'query', status: 'ok', served: { calls: [] }, pass: false, score: { axes: {}, pass: false } };
  const floorAside = { case: c, gate: 'query', status: 'ok', served: null, pass: true };
  // A served floor call is the answer even when it is wrong: the model never sees the question.
  assert.equal(compositeRow(floorServed, inner, 'fm').servedBy, 'floor');
  assert.equal(compositeRow(floorServed, inner, 'fm').pass, false);
  assert.equal(compositeRow(floorAside, inner, 'fm').servedBy, 'fm');
  assert.equal(compositeRow(floorAside, inner, 'fm').pass, true);
  const declined = rowFromArtifactCase(c, { id: c.id, status: 'ok', pass: false, gate: 'query', axes: { intent: true } });
  assert.equal(compositeRow(floorAside, declined, 'fm').servedBy, null);
  assert.equal(rowFromArtifactCase(c, undefined).status, 'error');
});

test('an_offline_composite_needs_an_artifact_scored_over_the_same_labels', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'q-composite-'));
  try {
    assert.match(loadInnerArtifact('fm', 'dev', { labelSha: 'x', pipelineSha: 'y', resultsDir: dir }).reason, /no committed artifact/);
    writeFileSync(path.join(dir, 'questions.fm.dev.json'), JSON.stringify({ datasetLabelSha: 'old', pipelineSha: 'y', cases: [] }));
    assert.match(loadInnerArtifact('fm', 'dev', { labelSha: 'x', pipelineSha: 'y', resultsDir: dir }).reason, /labels changed/);
    const ok = loadInnerArtifact('fm', 'dev', { labelSha: 'old', pipelineSha: 'z', resultsDir: dir });
    assert.ok(ok.artifact);
    assert.equal(ok.labels, 'all');
    assert.equal(ok.pipelineShaMatches, false);
    // Only floor/gate labels moved: the scoring labels still match (from git for an older artifact).
    const scoring = loadInnerArtifact('fm', 'dev', { labelSha: 'x', scoringLabelSha: 's', scoringLabelShaAt: () => 's', pipelineSha: 'y', resultsDir: dir });
    assert.equal(scoring.labels, 'scoring');
    assert.match(loadInnerArtifact('fm', 'dev', { labelSha: 'x', scoringLabelSha: 's', scoringLabelShaAt: () => 't', pipelineSha: 'y', resultsDir: dir }).reason, /labels changed/);
    writeFileSync(path.join(dir, 'questions.fm.dev.json'), JSON.stringify({ datasetLabelSha: 'old', scoringLabelSha: 's', pipelineSha: 'y', cases: [] }));
    assert.equal(loadInnerArtifact('fm', 'dev', { labelSha: 'x', scoringLabelSha: 's', pipelineSha: 'y', resultsDir: dir }).labels, 'scoring');
    // Scoring labels moved: the artifact comes back naming the relabelled cases.
    const partial = loadInnerArtifact('fm', 'dev', { labelSha: 'x', scoringLabelSha: 't', changedScoringIdsAt: () => ['q-080'], pipelineSha: 'y', resultsDir: dir });
    assert.equal(partial.labels, 'partial');
    assert.deepEqual(partial.changedIds, ['q-080']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changed_scoring_ids_names_relabelled_added_and_removed_cases_only', () => {
  const c = (id, filters, floor = 'answer') => ({ id, text: id, expect: { intent: 'query', tool: 'total_income', period: 'this_year', filters, answerMinor: 1, floor } });
  assert.deepEqual(changedScoringIds([c('a', []), c('b', ['Allowance']), c('d', [])], [c('a', [], 'stand_aside'), c('b', ['Mum']), c('e', [])]), ['b', 'd', 'e']);
  assert.equal(changedScoringIds(null, [c('a', [])]), null);
});

test('the_scoring_label_sha_ignores_floor_and_gate_only_fields', () => {
  const c = { id: 'q-x', text: 'how much', expect: { intent: 'query', tool: 'total_spent', period: 'this_month', filters: [], answerMinor: 1, floor: 'answer' } };
  const base = scoringLabelSha([c]);
  assert.equal(scoringLabelSha([{ ...c, knownGaps: [{ engine: 'floor', reason: 'r' }] }]), base);
  assert.equal(scoringLabelSha([{ ...c, expect: { ...c.expect, floor: 'stand_aside' } }]), base);
  assert.notEqual(scoringLabelSha([{ ...c, expect: { ...c.expect, filters: ['Food'] } }]), base);
});

test('the_floor_then_fm_composite_runs_offline_from_the_committed_artifact', async () => {
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  const probe = process.env.FM_PROBE_PATH;
  delete process.env.FM_PROBE_PATH;
  try {
    assert.equal(await runQuestions(['--engine=composite', '--composite-of=fm', '--no-write']), true);
  } finally {
    console.log = log;
    if (probe !== undefined) process.env.FM_PROBE_PATH = probe;
  }
  const out = lines.join('\n');
  assert.match(out, /composite-fm · split=dev/);
  assert.match(out, /served by: floor \d+ · fm \d+ · nothing \d+ +\(fm rows: offline from evals\/results\/questions\.fm\.dev\.json\)/);
});

// ─── the deterministic bar ──────────────────────────────────────────────────

test('gate_and_floor_meet_the_100_percent_bar_on_dev', async () => {
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(await runQuestions(['--engine=gate,floor', '--no-write']), true);
  } finally {
    console.log = log;
  }
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
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
process.exit(failed ? 1 : 0);

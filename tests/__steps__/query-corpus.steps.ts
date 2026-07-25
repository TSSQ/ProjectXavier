/**
 * Eval-driven suite for the layer AFTER the query gate says "query" — WHICH
 * TOOL the deterministic floor (`src/domain/queryFloor.ts`'s
 * `resolveFloorQueryCall`) picks, and WHICH PERIOD/CATEGORY it resolves —
 * mirroring `tests/__steps__/intent-corpus.steps.ts`'s eval-driven pattern
 * exactly (same "labeled corpus + plain jest suite + human-readable report"
 * shape, this time over `tests/query-corpus.jsonl`).
 *
 * The intent gate corpus already grades "is this a query at all"; NOTHING
 * graded what happens next — which tool, which period, which filter. Every
 * recent device bug (filters filled with the sentinel "none"; "how much
 * income for year 2026" answered this_month; "March 2025" silently becoming
 * the whole year) lived in exactly that ungraded gap. Since period + filter
 * resolution are DETERMINISTIC (`resolveFloorQueryCall`/
 * `resolvePeriodFromText`), they can be graded at a 100% bar for free.
 *
 * `npm run eval:query` (evals-lite/query-report.mjs) reads the SAME corpus
 * file for a human-readable per-dimension table; keep the two in sync (the
 * eval script reads this same .jsonl, so they can't drift on data — only on
 * assertion style, exactly like the intent-corpus pair).
 *
 * `expectTool: null` means "the floor legitimately can't/doesn't route this
 * text to a tool" — the tool assertion is SKIPPED for that line (only period/
 * category are graded); it is NOT a claim that `resolveFloorQueryCall`
 * literally returns `null` in every case (the "compare my spending this month
 * vs last month" line, for instance, actually resolves to `total_spent` —
 * an ACCEPTED single-shot-loop limitation documented in queryFloor.ts's own
 * header, not asserted here since it's not the point of that case). This
 * corpus previously also used `expectTool: null` to document two GENUINE
 * bugs without turning the suite red (the earn/earned income-verb gap, and
 * the spent/spending/spend regex's collision with trend-shaped questions) —
 * both are now FIXED in queryFloor.ts (see `INCOME_WORD_RE`/
 * `TREND_OR_AVERAGE_RE` there) and their corpus lines relabeled to assert the
 * ideal (now-real) behavior: total_income for the earn cases, and a REAL
 * (not skipped) `null` for the trend/average cases, since the floor now
 * genuinely stands aside on those rather than guessing.
 *
 * `expectCategory: null` similarly skips the category assertion (many tools —
 * spending_by_category, net_worth — never carry a category param at all).
 *
 * `expectPeriod` (unlike `expectTool`/`expectCategory`) is ALWAYS graded,
 * never skipped: `null` there is a real, meaningful assertion — "the text
 * states no period at all (or deliberately unmodelled ambiguity/comparison)",
 * per `resolvePeriodFromText`'s own contract.
 *
 * `NOW` is pinned to the SAME fixed instant `tests/__steps__/period-range.
 * steps.ts` and `tests/__steps__/query-floor.steps.ts` already use (15 July
 * 2026, mid-month/mid-year so no boundary is ambiguous), under jest.config.
 * js's default `TZ=UTC` — so "in March"/"this year" resolve identically here
 * and in those suites.
 *
 * ── TWO tool columns: `expectTool` (floor) vs `expectModelTool` (model tier) ─
 * `expectTool` grades ONLY the deterministic no-engine floor
 * (`resolveFloorQueryCall`, asserted by THIS suite). The floor is
 * deliberately narrow (no `top_payees`/`spending_over_time`/
 * `search_transactions` at all — see queryFloor.ts's header), so several
 * rows correctly have `expectTool: null` even though a MODEL tier (FM/BYOK,
 * which has every tool available) legitimately SHOULD route them somewhere.
 * `expectModelTool` (optional; read by `evals-lite/query-report.mjs`'s
 * `--engine=` model-tier grading, NOT by this jest suite) captures that ideal
 * — it defaults to `expectTool` when absent, and is set explicitly only on
 * the handful of rows where the two diverge (top_payees/spending_over_time/
 * search_transactions candidates, and the "compare my spending…" comparison
 * case). A row where NO tool is correct for anyone (bare period fragments
 * like "this month", non-query text) has both `expectTool` and
 * `expectModelTool` null and is skipped by both graders.
 */
import fs from 'fs';
import path from 'path';
import { resolveFloorQueryCall } from '../../src/domain/queryFloor';
import { QueryToolCall } from '../../src/domain/queryTools';
import { resolvePeriodFromText, PeriodSpec } from '../../src/domain/periodRange';

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

interface QueryCorpusLine {
  text: string;
  expectTool: string | null;
  /** Model-tier ideal, read by evals-lite/query-report.mjs only — see this
   *  file's header. Not asserted by this suite (the floor grading below only
   *  ever reads `expectTool`). */
  expectModelTool?: string | null;
  expectPeriod: PeriodSpec | null;
  expectCategory: string | null;
  note: string;
}

function loadCorpus(): QueryCorpusLine[] {
  const filePath = path.resolve(__dirname, '../query-corpus.jsonl');
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as QueryCorpusLine);
}

/** The category param actually present on `call`, if any — only
 *  `total_spent`/`total_income`/`spending_over_time`/`search_transactions`
 *  carry one; every other tool call has none. */
function categoryOf(call: QueryToolCall | null): string | undefined {
  if (!call) return undefined;
  const params = call.params as { category?: string };
  return params.category;
}

describe('query corpus — deterministic floor + period resolution (eval-driven)', () => {
  const corpus = loadCorpus();

  it('has a non-trivial, well-formed corpus', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(40);
    for (const c of corpus) {
      expect(typeof c.text).toBe('string');
      expect(c.text.length).toBeGreaterThan(0);
      expect(typeof c.note).toBe('string');
      expect(c.note.length).toBeGreaterThan(0);
    }
  });

  it.each(corpus.map((c) => [c.text, c] as const))('%s', (text, c) => {
    const call = resolveFloorQueryCall(text, NOW);
    const period = resolvePeriodFromText(text, NOW);

    // Period is ALWAYS graded — never skipped, even when expectTool/
    // expectCategory are null (see this file's header).
    expect({ text, period, note: c.note }).toEqual({ text, period: c.expectPeriod, note: c.note });

    if (c.expectTool !== null) {
      expect({ text, tool: call?.tool ?? null, note: c.note }).toEqual({
        text,
        tool: c.expectTool,
        note: c.note,
      });
    }

    if (c.expectCategory !== null) {
      expect({ text, category: categoryOf(call), note: c.note }).toEqual({
        text,
        category: c.expectCategory,
        note: c.note,
      });
    }
  });
});

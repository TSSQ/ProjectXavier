# Ship run: monthly-budgets

> Durable, committed record of one `/ship` run. Agent verdicts are pasted
> **verbatim**. Committed in stage 6 with the `Ship-Run: monthly-budgets` trailer.

- **Feature:** Monthly category budgets: dashboard budget card, Budget screen, and "can I afford it?" answered from the budget
- **Branch:** claude/monthly-budgets (cut from main @ eb814ef)
- **Spec:** docs/design/monthly-budgets-spec.md
- **Approved design:** https://claude.ai/artifact/Ue9kc84BbFs8YRodcYoUGS (Version 2, option A)
- **Started / finished:** 2026-10-03 / —

## Spec
Objective: a monthly budget per top-level expense category. Logged expenses count against it, scheduled bills (future-dated and recurring) are deducted up front, and "can I afford X" is answered from what's left. The user approved the design and the spec on 2026-10-03 and asked for the mockup to be built exactly. Decisions locked: budgets ignore the account filter; the dashboard card is hidden for year and custom date-range periods; no per-budget "paid up front" switch; the Assistant keeps its single-exchange layout, with chat history left to a separate /design.

Process note: the /ship skill's worktree (`.claude/worktrees/fm-spike`) and branch (`claude/phase2-byok`) aren't present in this cloud container, and CLAUDE.md's `claude/expense-tracker-app-y7rgas` is stale (July). The user chose a fresh `claude/monthly-budgets` branch from main, and CLAUDE.md was updated to match.

## Implement
- Round 0: the implementer stopped before writing code. Under the draft spec's 85% rule, Bills (92% committed, all bills) turned warn, which contradicted the approved mockup. Spec amended (bcc3164): the 85% test applies to flexible spending only, and rows sort by pace ratio.
- Round 1: full build, 153 suites / 2757 tests green. Reported `npm run eval` red only because the shallow clone lacked `bde1aeb`. After unshallowing, the coordinator re-ran it: PASS 45.4%, no case regressed.
- Round 2: currency relabel now rescales `budgets.amount`; the implementer had listed it as out of scope, and the coordinator sent it back. 154 suites / 2759 tests green.

## QA
Round 1, **verdict:** PASS-WITH-CONCERNS (verbatim summary of findings)

> **Verdict: PASS-WITH-CONCERNS.** No blocker; all re-run checks green (tsc 0, eslint 0, 154 suites / 2759 tests, eval:intent 229/229, eval:query 100%; budget suites 88/88 under UTC, America/New_York and Pacific/Kiritimati). Mutation testing: 12 mutants caught; 7 survived (flexibleUsed `flex > 0` guard; perDay `left > 0` guard; chip 10% boundary; QUESTION_START removal; detectSetBudget/detectAfford order; `s.archived` (equivalent); `target > 0` (unreachable)).
>
> 1. **Major (test gap)**, budgets-math.feature / src/domain/budgets.ts:356: the "skip 85% when budget − fixed ≤ 0" rule is untested (mutant survives). Add budget == fixed and fixed > budget scenarios, plus the chip boundary at target + 10%.
> 2. **Major (routing)**, src/domain/budgetIntent.ts:104-106: SET_RES pattern 2 hijacks real spends: "Lunch at Budget 12", "Taxi budget 12", "Dinner budget 45", "Hotel budget 120" and "coffee budget 4.50" all route to set-budget. Unresolved, they reply "I couldn't find a Lunch At category." and nothing is logged.
> 3. **Minor (routing)**, detectAfford: "can I afford 300 phone bought it yesterday" routes to afford; "Can I afford a $300 phone? I have 500 left" carries two amounts into the "Log it" subject.
> 4. **Minor**, index.tsx onAffordLog: the top-level preset overrides a more specific parsed subcategory.
> 5. **Minor (math)**, budgets.ts:401: `Math.max(0, spent)` clamp is undocumented (spec says a refund reduces spend, no floor).
> 6. **Minor (relabel/data safety)**, currencyRelabel.ts:~167 + budgetRowSchema `.positive()`: rescale can store 0 (USD 0.40 → JPY), which then fails zod on every read and on restore.
> 7. **Minor (test quality)**: the category-delete cascade is a source grep, not behavioural; applyBackupUnlocked's budgets insert is untested.
> 8. **Nit**: fits card "Dining · October" in the mockup vs "Oct" in the spec; afford uses extractAmountCandidates (disclosed).

Coordinator decisions: Majors 1–2 and Minors 3, 4, 6, 7 go back to the implementer. Minor 5: keep the floor at 0 and amend the spec (left never exceeds budget). Nit 8: use "Oct" on both cards, per the spec.

Fixes after round 1 (implementer report): M1 scenarios (budget == fixed, fixed > budget, chip boundary ±1 minor unit, over-budget per-day hidden, refund floor); M2 verbless set-budget needs an exact top-level expense category, and "at/with/from Budget" never routes, with 7 negatives; m3 past-tense guard + first-clause trim + explicit amount on "Log it"; m4 subcategory kept; m6 zero after relabel stores NULL; m7 behavioural cascade + applyBackup insert tests (node:sqlite). 155 suites / 2781 tests, tsc and eslint clean, eval:intent 229/229, eval:query 100%.

Round 2, **verdict:** PASS-WITH-CONCERNS (minor only), verbatim summary

> **Round 2 verdict: PASS-WITH-CONCERNS (minor only, no blocker/major).** All round-1 majors fixed; no regressions found from the fixes. Checks: tsc and eslint 0; 155 suites / 2781 tests; eval:intent 229/229; eval:query 100%; `npm run eval` PASS 45.4%, no case regressed. Mutants 1–3 (flex>0, perDay left>0, chip 10% boundary) are now caught; refund floor, verbless `explicit` guard, past-money guard and affordLogText guard caught. Still surviving: QUESTION_START, detect order, BRAND_BUDGET (redundant with exact-match), firstClause trim (no discriminating test).
> 1. Minor, budgetIntent.ts detectAfford/firstClause: the trim has no failing test. Add "can I afford 50. I have 20 left" (→ 50) and a "…. bought it yesterday" second-sentence case.
> 2. Minor (design trade-off), detectSetBudget: with an existing "Hotel" category, verbless "Hotel budget 120" routes to the budget confirm. Reversible. Document it.
> 3. Nit: QUESTION_START / BRAND_BUDGET are redundant guards.
> 4. Nit: presetCategoryName verified by reading plus a unit test, not through the UI.

Gate: PASSED (no Major open). Coordinator: #2 documented in spec §6.1; #1 and #3 tests go in with the review nits.

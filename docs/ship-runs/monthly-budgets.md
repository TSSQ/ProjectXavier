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

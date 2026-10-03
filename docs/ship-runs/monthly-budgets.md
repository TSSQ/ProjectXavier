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

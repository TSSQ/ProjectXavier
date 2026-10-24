# Ship run: duo-dashboard-grid

> Durable, committed record of one `/ship` run. Agent verdicts are pasted
> **verbatim**. Committed in stage 6 with the `Ship-Run: duo-dashboard-grid` trailer.

- **Feature:** iPhone Duo regular-width Dashboard: summary column + 2×2 chart grid at ≥600pt content width
- **Branch:** claude/duo-dashboard-grid (cut from main @ acfefe7, after #76 SDK 58 and #77 side insets)
- **Spec:** docs/design/duo-dashboard-grid-spec.md
- **Design:** https://claude.ai/artifact/LHjedrqBtcWk4DmQjugxYu ("Dashboard: the whole carousel at once", Recommended)
- **Started / finished:** 2026-10-24 / —

## Spec
Objective: when the Dashboard has ≥600pt of content width (Duo open, either orientation) it lays out as a summary column plus all four charts in a 2×2 grid; below that nothing changes. Pure `dashboardLayout(contentWidth)` helper, one shared `renderChartBody` for pager and grid. Product-shaped; proceeding on the user's "then we will do the duo optimizations" after seeing the mockup with this option marked Recommended. The mockup's weekly spend strip is out of scope.

Process note: the /ship skill's worktree (`.claude/worktrees/fm-spike`) and branch (`claude/phase2-byok`) are stale; per CLAUDE.md the work is on a fresh `claude/duo-dashboard-grid` branch from main in the cloud container. Stage 7 (build) and the Device Hub pass need the Mac.

## Implement
Round 1: built per spec. `src/domain/dashboardLayout.ts` (pure helper), `tests/__features__/duo-dashboard-layout.feature` + steps (11 scenarios pinning every spec-table row, the 599/600 threshold, NaN/negative/Infinity, and the column/tile arithmetic identities), and `app/(tabs)/dashboard.tsx` with one shared `renderChartBody(page, width, ring)` used by both the pager slides and the 2×2 grid tiles. Deviations the implementer called out: `contentOffset={{ x: chartPage * slideWidth, y: 0 }}` on the pager (the §4.5 fallback, since the pager unmounts in grid mode), `alignItems: 'flex-start'` on the two-column row, and `pb-3` on the figure card where the Overview header used `pb-1` (no pager beneath it).

Implementer's checks: tsc 0, eslint 0, 198 suites / 4303 tests. `npm run eval` failed only on `git show bde1aeb:…` in `evals/test-rescore.mjs` because the cloud clone was shallow; after `git fetch --unshallow` the coordinator re-ran it: **PASS — at or above baseline (split=dev, 56.1%), no case regressed.**

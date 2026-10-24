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

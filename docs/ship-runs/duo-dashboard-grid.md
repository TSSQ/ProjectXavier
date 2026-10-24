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

## QA
Round 1 — **verdict:** PASS-WITH-CONCERNS

> Verdict: PASS-WITH-CONCERNS
>
> I found no blocker in the new code. Typecheck, lint and the full test suite pass, and the helper matches spec §3 exactly. The one Major is an interaction between the new `contentOffset` and an existing slide-width bug. It shows up in the one-column path on any pose with a horizontal inset (Duo cover with the rail on the right, Split View), and I could not confirm it without a device.
>
> 1. **Major — `app/(tabs)/dashboard.tsx:966`.** `contentOffset={{ x: chartPage * slideWidth, y: 0 }}` can jump the pager after every swipe when insets are non-zero. In React Native 0.88 on iOS Fabric, `RCTScrollViewComponentView.mm:408-409` sets `_scrollView.contentOffset` whenever the prop value changes, not only on mount. The pager's viewport is the card width, `window − 48 − insets.left − insets.right`; `slideWidth` comes from `chartSlideLayout(screenWidth)` and is `window − 48`. Duo cover: window 466, right inset 84 → viewport 334, slideWidth 418. `pagingEnabled` snaps to multiples of 334; `onMomentumScrollEnd` computes `round(334/418) = 1`, the prop changes to x = 418, and the scroll view moves 84pt after the user lets go. The slide/viewport mismatch is already in HEAD (slides clipped, `Math.round(x/slideWidth)` mis-pages: x = 1002 → 2.4 → page 2 instead of 3); the new prop converts a latent bad-width bug into a visible jump. Spec §4.1 says to keep `chartSlideLayout(screenWidth)`, so the implementer followed the spec. The one-column carousel should size slides from `layout.leftWidth`.
> 2. **Minor — `src/domain/dashboardLayout.ts:51`.** No test distinguishes `Math.round` from `Math.floor` for `leftWidth` (621, 819 divide exactly; 600 → 265.45 rounds and floors the same). A width of 601 (265.9 → 266 vs 265) would catch the swap.
> 3. **Minor — `src/domain/dashboardLayout.ts:55`.** `Math.max(0, tileWidth - 32)` is unreachable (tileWidth ≥ 153 at the 600 minimum); harmless defensive code.
> 4. **Minor — `app/(tabs)/dashboard.tsx:843`.** The tile title carries an extra `mb-2` that spec §4.4 does not list; `netWorthCard` uses `pb-3` where the carousel header uses `pb-1`, a reasonable choice with no pager below it.
> 5. **Minor — no test covers the `48` gutter or the `insets` wiring.** Expected for RN screen code, which is excluded from the plain-Node suite.
> 6. **Minor — transient on first mount.** The nested `SafeAreaProvider` may report 0 insets for the first render; a pose where 0 insets give ≥600 but real insets give <600 would flash two columns, then one. No spec pose hits this.
>
> Mutation testing (17 mutants against the pinned values): caught round→ceil, floor→round for the tile, LEFT_SHARE 1/2 and 6/11, COLUMN_GAP 12, GRID_GAP 16, threshold `<=`, 599 and 601, tile padding 8, no negative clamp, no NaN guard, Infinity not treated as 0, donut from tileWidth, donut forced to 0. Survived: round→floor (finding 2) and removing the `max(0, …)` (finding 3).
>
> One column: the tree is identical to HEAD (pills, toggle, budget cards, chart card with `titleForChartPage` header, 26px figure, `pagingEnabled`, `onMomentumScrollEnd`, four slide wrappers with `onLayout`/`minHeight`/`justifyContent`/paddings, dots). Two columns: pills and toggle full width; left column `netWorthCard`, `budgetCards`, `statTiles`, `netCard`, `plannedSection`, `accountsSection`, `recurringLink` per §4.4; right column two rows with GRID_GAP, four tiles keyed by page with `CHART_TITLES[page]`; no dots, pager or `chartPage` reads; all hooks before the return. Width arithmetic uses the same nested-provider `insets` as `sideGutters`; window 334 with right inset 84 gives content 202 → one column, nothing negative.
>
> Checks: `tsc --noEmit` exit 0; `eslint . --ext .ts,.tsx` exit 0; `npm test` 198 suites / 4303 tests passed; `npm test -- duo-dashboard` 11/11.
>
> Not verified (needs a device or simulator): whether the pager actually jumps (finding 1) and what clipped slides look like on the Duo cover; live fold/unfold and rotation with period, filter and scroll kept (§5.5); visual fit of stat tiles, account rows and donut legends at 275pt / 159pt; whether the nested SafeAreaProvider reports 84 on the first render.

Coordinator action: the Major is real and in remit (the carousel's slide width must be the card's actual width, which since #77 is inset-adjusted). Spec §4.1 amended: feed `chartSlideLayout` the inset-adjusted width (`screenWidth − insets.left − insets.right`) so `slideWidth` equals the pager viewport in every pose. Sent back to the same implementer with findings 2 (601 scenario) and a large-width donut-cap scenario; finding 3 left as is (harmless); finding 4 accepted as the implementer's call.

Implement round 2 (after QA r1): `chartSlideLayout` is now fed `screenWidth − insets.left − insets.right`, so `slideWidth` equals the pager's real viewport (Duo cover: 334, not 418) and the §4.5 `contentOffset` is a no-op after `onMomentumScrollEnd`. Two scenarios added: width 601 (left 266 / right 319; pins round against floor) and width 1600 (tileDonut 190 = `DONUT_MAX`). tsc 0, eslint 0, 198 suites / 4305 tests. QA round 2 re-gate requested from the same qa-tester.

# iPhone Duo: regular-width Dashboard (summary column + chart grid) — spec

- **Status:** approved to build (see §8)
- **Design:** https://claude.ai/artifact/LHjedrqBtcWk4DmQjugxYu, section "Dashboard: the whole carousel at once" (the recommended option). Where this spec and the mockup disagree, the mockup wins on visuals and this spec wins on behaviour.
- **Ship run:** `docs/ship-runs/duo-dashboard-grid.md`
- **Depends on:** #76 (Expo SDK 58 / iOS 27.1 SDK) and #77 (horizontal safe-area insets), both on `main`.

## 1. Objective

On iPhone Duo's open display (669×951pt portrait, 951×669pt landscape) the Dashboard today is the phone layout stretched: one chart visible in a 600pt-wide carousel, three more behind swipes, and rows whose amount sits 600pt from its label. Apple's guidance for regular width is to show more, not stretch. When the Dashboard has at least 600pt of content width it lays out as two columns: the summary (figure, budget, stat tiles, net, planned, accounts) on the left and all four charts at once as a 2×2 grid on the right. Below that width nothing changes.

## 2. Scope

In scope:
1. A pure layout helper, `src/domain/dashboardLayout.ts`, that decides one or two columns from the available content width and hands back the column, tile and chart widths. BDD-tested.
2. `app/(tabs)/dashboard.tsx` renders the two-column layout when the helper says so, reusing today's components and the existing chart bodies; the carousel path is unchanged at compact width.
3. The chart grid reuses `donutSize` / `CHART_HEIGHT` from `src/domain/chartLayout.ts` so grid charts and carousel charts are drawn by the same rules.

Out of scope (follow-ups, each its own branch):
- The weekly spend strip drawn in the mockup (new data, not a layout change).
- Transactions list + detail, the Assistant live ledger, tab-bar sidebar placement, tabletop pose.
- Any change to the Dashboard's data loading, period/account filtering or the Overview figure's semantics.

## 3. Layout rule (pure, `src/domain/dashboardLayout.ts`)

```ts
export const REGULAR_CONTENT_MIN = 600;   // pt of content width
export const COLUMN_GAP = 16;
export const GRID_GAP = 12;
export const LEFT_SHARE = 5 / 11;          // mockup: 5fr / 6fr

export interface DashboardLayout {
  columns: 1 | 2;
  /** Width of the summary column (columns === 2) or the whole content (1). */
  leftWidth: number;
  /** Width of the chart column (0 when columns === 1). */
  rightWidth: number;
  /** Width of one chart tile in the 2×2 grid (0 when columns === 1). */
  tileWidth: number;
  /** Drawable width inside a tile: its 16pt side padding and 1pt border removed. */
  tileContentWidth: number;
  /** Ring diameter for the two category tiles (donutSize of tileContentWidth). */
  tileDonut: number;
}

export function dashboardLayout(contentWidth: number): DashboardLayout
```

- `contentWidth` = window width − `insets.left` − `insets.right` − 2 × 24 (the screen gutter). The screen computes it from `useWindowDimensions()` and `useSafeAreaInsets()` (the nested provider, which reports the vertical rail as `insets.right` = 84 on Duo, per the #77 Device Hub pass).
- `columns = contentWidth >= REGULAR_CONTENT_MIN ? 2 : 1`.
- Two columns: `leftWidth = round((contentWidth − COLUMN_GAP) × LEFT_SHARE)`, `rightWidth = contentWidth − COLUMN_GAP − leftWidth`, `tileWidth = floor((rightWidth − GRID_GAP) / 2)`, `tileContentWidth = max(0, tileWidth − 2 × (16 + 1))` (side padding plus the tile's 1pt `border`, since the chart is drawn inside the border), `tileDonut = donutSize(tileContentWidth)`.
- One column: `leftWidth = max(0, contentWidth)`, everything else 0.
- Never negative, NaN-safe (a non-finite width behaves as 0).

Reference values the tests pin (window → content → result):

| Pose | window | insets L/R | content | columns | left / right / tile |
|---|---|---|---|---|---|
| iPhone 17 Pro portrait | 402 | 0/0 | 354 | 1 | 354 / 0 / 0 |
| Duo cover (rail right) | 466 | 0/84 | 334 | 1 | 334 / 0 / 0 |
| Duo Split View half | 334 | 0/84 | 202 | 1 | — |
| Duo open portrait | 669 | 0/0 | 621 | 2 | 275 / 330 / 159 |
| Duo open landscape (rail right) | 951 | 0/84 | 819 | 2 | 365 / 438 / 213 |
| threshold | — | — | 599 → 1, 600 → 2 | | |

## 4. Screen changes (`app/(tabs)/dashboard.tsx`)

1. Compute `const layout = dashboardLayout(contentWidthFor(screenWidth, insets, 24))` (`contentWidthFor` from `src/domain/screenGutters.ts`: window − safe insets − 2 × gutter, never negative) next to the existing `chartSlideLayout` call. `chartSlideLayout` stays for the carousel path, but it must be fed the pager's real viewport width, `chartSlideLayout(contentWidthFor(screenWidth, insets, 0) - 2 * CARD_BORDER)` (`CARD_BORDER = 1`, the card's `border` class), so that `slideWidth` equals the viewport (the card's inner width, which since #77 excludes the side insets) in every pose. (QA round 1: with `chartSlideLayout(screenWidth)` the Duo cover pose had a 418pt slide in a 334pt viewport, which clipped slides, mis-paged `onMomentumScrollEnd`, and made the §4.5 `contentOffset` nudge the pager after each swipe.)
2. Extract the four slide BODIES (the JSX inside each `<View onLayout={onSlideLayout} …>` in the carousel: balances line chart + projection + account legend; cash-flow bars + legend; the two `CategoryDonutRow`s) into one local render function `renderChartBody(page: 0|1|2|3, contentWidth: number, donut: number)`. Both paths call it, so a chart never differs between the pager and the grid. The slide wrappers (`onLayout`, `minHeight`, padding) stay in the carousel path.
3. `layout.columns === 1`: the render tree is unchanged — pills, archived toggle, budget card, Overview card (header + figure + pager + dots), stat tiles, net card, planned, accounts, recurring link. The carousel's `onMomentumScrollEnd` → `chartPage` logic is untouched.
4. `layout.columns === 2`:
   - `AccountFilterPills` and `IncludeArchivedToggle` stay full width above the columns.
   - Below them a `View` row with `gap: COLUMN_GAP` holding two columns sized `leftWidth` / `rightWidth`.
   - **Left column**, in order: Overview figure card (same card chrome as today's Overview header: the `titleForChartPage`-driven title is replaced by the fixed `Net worth · {sel.label}{scope}` line and the net-worth figure, since there is no current page), budget card (same `budgetKind` switch), stat tiles, net card, planned, accounts, recurring link.
   - **Right column**: a 2×2 grid, two `View` rows with `gap: GRID_GAP`, each tile `width: tileWidth`, the Overview card's chrome (`bg-surface border border-border rounded-lg`), `paddingHorizontal: 16`, `paddingTop: 8`, `paddingBottom: 12`, and a title line in the header style (`text-muted text-xs font-semibold`) from `CHART_TITLES[page]`, then `renderChartBody(page, tileContentWidth, tileDonut)`. Tiles in a row stretch to the row height (default `alignItems: 'stretch'`), so the two rows stay rectangular without the measured floor the pager needs.
   - No page dots, no `chartPage` reads, no horizontal `ScrollView`.
5. Mode is derived on every render from live dimensions, so fold/unfold and rotation switch the layout without any effect or state reset. `chartPage`, the account filter, the period and scroll position are screen state and survive the switch. The pager re-seats itself on the remembered `chartPage` whenever its viewport WIDTH is (re)measured: its `onLayout` compares the measured width with the last one (kept in a ref, reset to 0 by the callback ref when the pager unmounts in two-column mode) and, on a change, calls `scrollTo({ x: chartPage * measuredWidth, animated: false })`. That covers the return from two columns (mount) and a fold or rotation that changes the card width while in one column (UIKit keeps the absolute x offset across a frame change, which would otherwise leave page n sitting n·oldWidth/newWidth pages in). A y-only layout change does nothing and a user's swipe is never touched. There is deliberately no `contentOffset` prop: Fabric re-applies a changed `contentOffset`, so any slide/viewport mismatch would become a nudge after each swipe. `onMomentumScrollEnd` divides by the viewport width the scroll event itself carries (`layoutMeasurement.width`).
6. `sideGutters(insets, 24)` from #77 stays on the scroll container; the columns live inside it.

## 5. Acceptance criteria

1. `dashboardLayout` returns the table in §3 exactly, and 599 → 1 column, 600 → 2 columns; negative/NaN widths give 1 column with non-negative numbers. (BDD, `tests/__features__/duo-dashboard-layout.feature`.)
2. At content width < 600 the rendered tree is today's: carousel, dots, `titleForChartPage` header. No visual change on any current iPhone in portrait.
3. At content width ≥ 600: two columns; four titled chart tiles visible at once with no horizontal pager and no dots; the left column holds the figure card, budget, stat tiles, net, planned, accounts and recurring link in that order; pills and the archived toggle span the full width above.
4. The chart drawn for a given page is produced by the same function in both modes (one `renderChartBody`), so legends, empty states and projection lines are identical.
5. Folding/unfolding and rotating on the Duo simulator switches modes live with the period, account filter and scroll position kept.
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run eval` green.

## 6. Constraints

- Framework-free helper in `src/domain/` (plain-Node BDD suite). No new queries, repositories or settings.
- Reuse existing components and tokens; no new colours or type sizes. Card chrome and type classes are the ones the Overview card uses today.
- Guardrail #2 untouched: nothing here renders before the biometric gate.
- Keep `chartSlideLayout`, `CHART_TITLES`, `titleForChartPage` and their tests as they are.

## 7. Edge cases

- Zero accounts / zero transactions: each tile shows the same empty label the slide shows today ("No accounts yet.", "No transactions this period.", "No expenses this period.", "No income this period.").
- Many categories: the donut legend wraps inside its tile; the row stretches to the taller tile.
- Split View half (content ≈ 200pt): one column, as today; nothing in this spec makes it narrower.
- Rail on the LEFT (Split View, app on the left half): `insets.left` is subtracted the same way; no side-specific logic.
- Dynamic Type at the 1.6 cap: titles wrap inside tiles; no fixed heights are introduced in the grid.

## 8. Approval

Product-shaped. The user saw the mockup with the Dashboard grid marked "Recommended" and then asked for the Duo optimisations to follow the SDK 58 upgrade, which is the approval this run proceeds on. The weekly spend strip in the mockup is deliberately left out (§2); say so if it should come back.

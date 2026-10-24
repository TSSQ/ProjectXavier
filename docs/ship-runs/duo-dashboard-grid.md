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

Round 2 — **verdict:** PASS-WITH-CONCERNS (no open Major)

> Verdict: PASS-WITH-CONCERNS
>
> Round 1's Major is closed on paper, and both Minors are closed with tests. The remaining concerns are things I can't check without a device.
>
> 1. **Round 1 Major, resolved by arithmetic (`app/(tabs)/dashboard.tsx:216-218`).** `chartSlideLayout(screenWidth - insets.left - insets.right)` subtracts 48 internally, so `slideWidth = window − L − R − 48`, exactly the pager's viewport. Duo cover 466/0-84 → 334 = 334; Split View rail right 334/0-84 → 202 = 202; Split View rail left 334/84-0 → 202 = 202; iPhone 17 Pro 402/0-0 → 354 = 354.
> 2. **`contentOffset` after `onMomentumScrollEnd`.** Paging snaps to multiples of the viewport, which equals `slideWidth`, so `round(x/slideWidth)` returns the right page for every page; the prop `chartPage * slideWidth` then equals where the user already is, so the Fabric set at `RCTScrollViewComponentView.mm:408-409` lands where the scroll view already is (read the iOS source; not run on iOS). On rotation or inset change `slideWidth` changes, so the prop re-seats the pager on the remembered page, which is the desired behaviour.
> 3. **Plain iPhone (insets 0).** `slideWidth`, `contentWidth` and `donut` are numerically unchanged; the one-column render tree is untouched by this diff.
> 4. **Minor, new, unverifiable.** Window dimensions and the nested `SafeAreaProvider` insets arrive through different channels; for one frame during a fold or rotation `slideWidth` could mix a new width with old insets. Self-corrects on the next render and only moves the pager if `chartPage` is non-zero.
> 5. **Round 1 Minor 2, closed.** 601 pins 266 / 319 / 153 / 121 / 63 — the round-to-floor mutant is now caught (round-to-ceil too). 1600 pins 720 / 864 / 426 / 394 / 190, so the `DONUT_MAX` cap is covered through `tileDonut`.
> 6. **Round 1 Minors 3 and 4 and finding 5**, accepted by the coordinator; not raised again.
> 7. **Housekeeping, Minor.** `.claude/pipeline/*` modified in the working tree — make sure they are intended in the commit. (They are: pipeline bookkeeping is committed with each stage.)
>
> Checks: `tsc --noEmit` exit 0; `eslint . --ext .ts,.tsx` exit 0; `npm test` 198 suites / 4305 tests; `npm test -- duo-dashboard` 13/13.
>
> Not verified (needs a device or simulator): pager stability after swipes on the Duo cover and in Split View, and whether the clipping is gone; the one-frame window/inset skew; whether the nested SafeAreaProvider reports 84 on first render; live fold/unfold/rotation with period, filter and scroll kept; visual fit at 275pt / 159pt and Dynamic Type wrapping. `npm run eval` not run.

Gate: PASS-WITH-CONCERNS with every Major resolved → QA passed. The device-only items go to the Mac's Device Hub pass (stage 8).

## Review
Round 1 — **verdict:** REQUEST-CHANGES

> Verdict: REQUEST-CHANGES
>
> The design is sound. `renderChartBody` really is the single source for all four chart bodies, the helper fits next to `chartLayout.ts` and `screenGutters.ts`, and the tests are clear. One correctness problem in the compact (phone) path should be fixed before merge. QA round 2 (`docs/ship-runs/duo-dashboard-grid.md`, the uncommitted part) says the `contentOffset` prop does nothing after a swipe. That is wrong by the width of the card's border, and it affects every iPhone, not only the Duo.
>
> 1. **Blocker: the pager is 2pt narrower than a slide, so `contentOffset` nudges it after every swipe on every phone.** `app/(tabs)/dashboard.tsx:218-220`, `:922`, `:963-973`.
>    - **Why the widths differ:** the chart card at `:922` is `border border-border`. The Tailwind default for `border` is 1px (`node_modules/tailwindcss/stubs/config.full.js:101-102`, and `tailwind.config.js` doesn't override it). Yoga lays children out inside the border, so the horizontal `ScrollView` is `cardWidth − 2` wide. `slideWidth` from `chartSlideLayout(screenWidth − L − R)` equals the full card width. So the viewport is `slideWidth − 2` in every pose. On iPhone 17 Pro that is 352 against 354.
>    - **What happens on a swipe:** `pagingEnabled` snaps to multiples of the scroll view's own width, so page n lands at `x = n·(slideWidth − 2)`. `onMomentumScrollEnd` rounds that to the correct page n. The new prop then becomes `{x: n·slideWidth}`. On RN 0.88 Fabric, `RCTScrollViewComponentView.mm:408-409` sets `_scrollView.contentOffset` whenever that prop changes (I read the source to confirm). The pager therefore jumps 2, 4 or 6pt after each swipe settles, and keeps jumping on later swipes because UIKit pages from the new position.
>    - **Why this is new:** on `main` the same 2pt mismatch only made slides drift slightly, with no jump. The `contentOffset` prop added at `:970` turns it into a visible twitch on the screen every user opens first. That breaks acceptance criterion 2 ("No visual change on any current iPhone in portrait").
>    - **Confidence:** this is from reading the source, not from a device. Each step (Yoga border layout, UIKit paging by viewport width, Fabric setting the offset on prop change) is standard behaviour.
>    - **Possible fixes, best first:**
>      - (a) Apply the offset only when the pager mounts, which is what the comment at `:968-969` says is intended. Use a ref and `scrollTo({ x: chartPage * slideWidth, animated: false })` in the pager's `onLayout`, or a small `ChartPager` child that captures the offset in `useState` on mount.
>      - (b) Measure the pager's own width with `onLayout` and use that as `slideWidth`, so the viewport is the single source of truth.
>      - (c) Subtract the border in the width you pass to `chartSlideLayout`. This works but adds another unexplained number.
>    - Whichever fix is chosen, the comment at `:968` should say why the prop is safe, because the reason (slide width must equal viewport width) is not obvious.
>
> 2. **Nit (close to Major for maintainability): the chart-height rule now lives in two places.** `app/(tabs)/dashboard.tsx:728` (`Math.max(CHART_HEIGHT, ring)`) repeats `src/domain/chartLayout.ts:87`. The screen no longer reads `chartSlideLayout().chartHeight`, so that tested field has no caller, and the version that actually runs is untested inline code. The two formulas agree today. If someone changes one, the pager and grid could quietly differ, which is the thing the shared `renderChartBody` was meant to prevent. Suggested fix: export `chartHeightFor(ring)` from `chartLayout.ts` and use it in both places, or add `tileChartHeight` to `DashboardLayout`.
>
> 3. **Nit: the 24pt gutter is written in three places, and the insets skip the clean-up `sideGutters` applies.** `app/(tabs)/dashboard.tsx:223` hard-codes `- 48`. `:878-879` uses `24` and `sideGutters(insets, 24)`. `chartLayout.ts` has its own `CARD_PADDING = 24`. `sideGutters` treats NaN or negative insets as 0, but the width maths at `:219` and `:223` uses the raw `insets.left/right`. Neither matters with real insets. A `contentWidthFor(windowWidth, insets, gutter)` in `screenGutters.ts` would hold this arithmetic in one tested place, and the Transactions list + detail screens will need the same thing.
>
> 4. **Nit: some comments now describe only the carousel.**
>    - `:735-740`: "The slides already equalise their own heights through the measured floor" is now inside a body that grid tiles also render, and the tiles have no floor.
>    - `:1074` and `:1087`: the `CategoryDonutRow` doc still says "carousel slides" and "derived from the slide width".
>    - `:923-941`: these moved comments describe a hidden, `aria-hidden` figure that the code no longer has. That was already true on `main`, but since the block was touched it's cheap to fix.
>
> 5. **Nit: small cleanups.**
>    - `:843`: `key={page}` isn't needed because the tiles aren't in an array. It's harmless.
>    - `:727` and `:841`: `0 | 1 | 2 | 3` is written twice. A `ChartPage` type next to `CHART_TITLES` in `src/domain/chartCarousel.ts` would remove the repeat.
>    - `:502-503`: two comments in a row say the same thing (carried over from `main`).
>    - `statTiles`, `netCard` and others wrap a single child in `<>` only so a comment can sit there.
>
> 6. **Nit (placement and API): `src/domain/dashboardLayout.ts` is in the right folder**, as a pure layout helper next to `chartLayout.ts` and `screenGutters.ts`. Its constants are documented and its NaN handling is clear. As an API it is specific to the Dashboard (tiles, ring sizes), which is fine for now. When Transactions list + detail starts, move `REGULAR_CONTENT_MIN` and an `isRegularWidth(contentWidth)` check into a shared module (for example `screenGutters.ts` or a new `regularWidth.ts`), so other screens don't import a threshold from `dashboardLayout`. Don't generalise it before then. `Math.max(0, tileWidth − 32)` at `:55` can never be reached, as QA noted; leaving it is fine.
>
> 7. **Nit (tests): `tests/__steps__/duo-dashboard-layout.steps.ts:35-41`.** `allWidths` registers its five `and` steps in a fixed order, and jest-cucumber matches steps by position. A future scenario that leaves out or reorders a width line will fail with a confusing step-mismatch error. Otherwise the feature file reads well and covers every spec row, the 599/600/601 threshold and the 1600 cap.
>
> 8. **Nit (scope and process):**
>    - The branch diff includes `.claude/pipeline/dashboard.html` and `state.json`. QA says this is the repo's usual practice, so it isn't a problem.
>    - The working tree still has uncommitted changes to `docs/ship-runs/duo-dashboard-grid.md` (the QA round 2 verdict) and the pipeline files. Commit them before merging or the record isn't kept.
>    - `app.config.ts:15` sets `orientation: 'portrait'`. Spec §3's Duo-landscape row and §5.5's "rotating" assume the app rotates. Check on the Duo whether the app actually rotates; if not, the landscape case can't happen.
>
> **What checks out:**
> - **Hooks:** all of them run before the return. `layout`, `renderChartBody` and `chartTile` are plain values and functions, not hooks.
> - **Shared chart bodies:** the four slide bodies moved into `renderChartBody` unchanged. The empty states and the projection gate match `main`, and `scopeSuffix` is identical to the old inline expression.
> - **Figure card:** it reads `Net worth · {sel.label}{scope}`, as spec §4.4 says. The carousel header still uses `titleForChartPage(chartPage)`.
> - **Insets:** they come from the nested `SafeAreaProvider` (`:147`, `:155`), the same source `sideGutters` uses.
> - **Width maths:**
>   - The columns plus the gap add up exactly to the content width.
>   - Split View 334 with an 84pt inset gives 202pt, so one column with nothing negative.
>   - Duo cover 466 with an 84pt inset gives a 334pt slide.
> - **Guardrails:** the diff adds no repository imports or queries and doesn't touch `app/_layout.tsx` or the biometric gate. The helper has no framework imports.
>
> **Checks (tails):**
> - `npm run typecheck` → `tsc --noEmit`, exit 0
> - `npm run lint` → `eslint . --ext .ts,.tsx`, exit 0
> - `npm test -- duo-dashboard` → `Test Suites: 1 passed, 1 total` / `Tests: 13 passed, 13 total`, exit 0
>
> **Not verified:**
> - No device or simulator run. Finding 1 (the jump after each swipe, and the 2pt of each slide hidden at its edge), live fold/unfold/rotation keeping state, how the 275pt column and 159pt tiles look (the projection lines and donut legends will likely wrap), Dynamic Type at 1.6, and the first-render insets on the nested provider all need a device.
> - I did not run the full `npm test` or `npm run eval`.
> - I did not redo QA's mutation testing.
> - I did not compare the screen against the Figma/artifact mockup.

Coordinator action: Blocker accepted (the `border` class is 1pt, so the pager viewport is `slideWidth − 2`; the `contentOffset` prop re-applies on every change and would twitch the pager on every phone). Fix chosen: option (a), restore the remembered page once on pager mount via a ref + `scrollTo`, and drop the `contentOffset` prop. Nits 2 (shared `chartHeightFor`), 3 (`contentWidthFor` in `screenGutters.ts`), 4 (stale comments) and 5 (`ChartPage` type, dead `key`) applied. Nit 8 on `orientation: 'portrait'`: the #76 Device Hub pass measured the open display at 951×669 in landscape (Apple: the inner display ignores the supported-orientation list), so the landscape case is real. Sent back to the implementer; re-review requested from the same reviewer.

Implement round 3 (after Review r1): `contentOffset` prop removed; the remembered page is restored once on pager mount via `pagerRef` + `scrollTo` in `onLayout` (reset while the pager is unmounted in two-column mode). `CARD_BORDER = 1` (the card's `border` class) is subtracted from the width fed to `chartSlideLayout`, so slides equal the pager viewport exactly. `chartHeightFor(ring)` exported from `chartLayout.ts` and used by both `chartSlideLayout` and `renderChartBody`; `contentWidthFor(window, insets, gutter)` added to `screenGutters.ts` (+4 scenarios) and used for the layout width; `ChartPage` type in `chartCarousel.ts`; stale carousel-only comments reworded or removed; dead `key` dropped. Spec §4.5 reworded. tsc 0, eslint 0, 198 suites / 4309 tests. Re-review requested.

Round 2 — **verdict:** REQUEST-CHANGES (Blocker closed; one new Major)

> Verdict: REQUEST-CHANGES
>
> Round 1's Blocker is closed: nothing moves the pager during or after a swipe any more. But the one-shot boolean that closes it causes a new problem in the fold/unfold case this feature exists for. I've rated it Major and am blocking on it because the fix is about six lines.
>
> **Traces you asked for** (`app/(tabs)/dashboard.tsx`)
> - **First mount on a plain iPhone:** the flag starts false. The pager's first `onLayout` sets it true and does not scroll, because `chartPage` is 0. Later `onLayout`s, such as the card moving down when the budget card loads, return early. Correct.
> - **Back from two columns with `chartPage` 2:** each two-column render sets the flag false (:232). The pager then mounts and its `onLayout` calls `scrollTo(2·slideWidth, animated:false)` once (:236). In Fabric, `scrollTo` limits the offset to the content size (`RCTScrollViewComponentView.mm:932-956`). The non-animated path calls `_handleFinishedScrolling`, which fires `onMomentumScrollEnd` (:1037-1040, :879), so `setChartPage(2)` runs and changes nothing. Correct, provided the window size and insets for the new pose arrive in the same render. See finding 1.
> - **A swipe:** scrolling doesn't change the ScrollView's frame, so `onLayout` doesn't fire. There is no `contentOffset` prop, and the only programmatic scroll is inside `onLayout`. Swipes are untouched. **Blocker closed.**
> - **Width change while in one column:** `onLayout` does fire, but the flag is already true, so nothing re-seats the pager. That is finding 1.
>
> 1. **Major, `app/(tabs)/dashboard.tsx:228-237` (with :970-976): after a width change the pager is left part-way into a slide, and folding the Duo is where this happens.**
>    - UIKit keeps the absolute x offset when the frame width changes. Page n therefore ends up at `n·oldWidth / newWidth` pages.
>    - QA round 2 #2 relied on the old `contentOffset` prop to re-seat the pager on width changes. That prop is gone, and the boolean prevents any second restore.
>    - QA round 2 #4's window/insets timing gap now persists instead of fixing itself on the next render. Example: fold from open to cover with `chartPage` 1.
>      - If the window update (466) arrives before the insets: content is 418, so one column; `slideWidth` is 416 and the pager restores to x=416. Then the insets arrive (0/84): `slideWidth` and the viewport become 332, with no re-seat. The pager now sits 84pt into slide 2 while the header and dots say page 1.
>      - If the insets arrive first: 669 − 84 − 48 = 537, also one column; `slideWidth` is 535, then 332, which leaves the pager about 1.6 pages in.
>    - Other ways to hit it: dragging the Split View divider while staying under 600pt, and rotating the cover screen if it rotates.
>    - This is not a regression against `main`, which never re-seats either. It is a regression against round 2, and it breaks the promise in spec §4.5 and acceptance criterion 5 for the main fold case. It fixes itself on the next swipe.
>    - Fix: base the restore on the pager's measured width instead of a boolean, and reset it when the pager actually unmounts.
>      ```ts
>      const pagerWidthRef = useRef(0);
>      const setPagerRef = useCallback((n: ScrollViewInstance | null) => {
>        pagerRef.current = n;
>        if (!n) pagerWidthRef.current = 0;
>      }, []);
>      const onPagerLayout = useCallback((e: LayoutChangeEvent) => {
>        const w = e.nativeEvent.layout.width;
>        if (w === pagerWidthRef.current) return; // a y-only move, or nothing changed
>        pagerWidthRef.current = w;
>        pagerRef.current?.scrollTo({ x: chartPage * w, animated: false });
>      }, [chartPage]);
>      ```
>    - This still never touches the offset during a swipe. It also replaces the ref write during render at :232. The restore uses the measured viewport, so it no longer depends on `CARD_BORDER` being right. Optionally, `onMomentumScrollEnd` (:978) could divide by `pagerWidthRef.current` too.
>
> 2. **Nit, `app/(tabs)/dashboard.tsx:232`: writing the ref during render.**
>    - It is acceptable here. The write is idempotent, so StrictMode's double render is harmless. The React Compiler is not enabled (`app.config.ts:134-136` has no `reactCompiler`, and `babel.config.js` has no compiler plugin). No react-hooks lint rule is configured. The screen uses no transitions or Suspense.
>    - It still breaks React's rule that render stays pure. If a two-column render were thrown away while the pager stayed mounted, the next `onLayout` would scroll again. That extra scroll would be harmless.
>    - The callback ref in finding 1 ties the reset to the real unmount and removes this. If finding 1 isn't taken, move it into `useEffect(() => { if (layout.columns === 2) pagerRestoredRef.current = false; }, [layout.columns])`.
>
> 3. **Nit, `app/(tabs)/dashboard.tsx:86-87` and `:935`: `CARD_BORDER` is correct but hard to find from the card.**
>    - The value is right. `border` resolves to Tailwind's `borderWidth.DEFAULT: '1px'` (`node_modules/tailwindcss/stubs/config.full.js:101-102`). `tailwind.config.js` doesn't override `borderWidth`. The NativeWind 4.1.23 preset only adds `hairline` (`node_modules/nativewind/dist/tailwind/native.js:212-213`). NativeWind maps px 1:1 to pt.
>    - The problem is that the constant's doc points to the card, but the card's `className` at :935 doesn't point back. Changing it to `border-2`, or removing the border, would quietly break the slide maths. Add a one-line comment at :935 naming `CARD_BORDER`.
>    - The constant is also declared between two `import` statements, copying `SLIDE_MIN_HEIGHT`.
>    - Finding 1's measured-width restore would make this constant matter only for slide sizing, not for paging.
>
> 4. **Nit, `app/(tabs)/dashboard.tsx:971-975` and spec §4.5 (`docs/design/duo-dashboard-grid-spec.md:77`): the reasoning is out of date.**
>    - Both say the prop was dropped because "the card's border makes the viewport narrower than a slide". The same commit makes them equal, so a reader will wonder why the prop can't come back.
>    - Suggested wording: "Fabric re-applies a changed `contentOffset`, so any slide/viewport mismatch becomes a nudge after each swipe."
>
> 5. **Nit, `app/(tabs)/dashboard.tsx:221-223` and `:226`: the gutter arithmetic is only partly shared (round 1 nit 3).**
>    - `layout` uses `contentWidthFor`, which ignores NaN insets. The carousel still computes `screenWidth - insets.left - insets.right - 2*CARD_BORDER` with raw insets, plus the 48 inside `chartSlideLayout`.
>    - In one-column mode `layout.leftWidth` already equals the card width. `chartSlideLayout(contentWidthFor(screenWidth, insets, 0) - 2 * CARD_BORDER)` would make the two consistent.
>    - The 24pt gutter literal still appears at :226, :891 and :892.
>
> 6. **Nit, `app/(tabs)/dashboard.tsx:855-861` with `src/domain/dashboardLayout.ts:55`: the tiles ignore their own border.**
>    - `tileContentWidth = tileWidth − 32` doesn't account for the tile's 1pt border, so each chart is drawn 2pt wider than its box and spills into the 16pt right padding.
>    - It won't be visible, but it is the same mistake this round fixed for the pager.
>
> 7. **Nit, round 1 nits mostly confirmed applied:**
>    - **One chart-height rule: yes.** `chartHeightFor` is at `src/domain/chartLayout.ts:78`, and both `:94` and `dashboard.tsx:741` use it.
>    - **One gutter helper: partly.** See finding 5.
>    - **`ChartPage` type and dead `key`: done.** `ChartPage` is at `src/domain/chartCarousel.ts:21`; the `key` is gone.
>    - **Comments:** the duplicate comment at :502, the `CategoryDonutRow` doc and the aria-hidden block are fixed. The comment at :750-754 is now true for both modes.
>      - One stale comment remains, carried over from `main` (`main:523`): `:936-938` says the header shows "net worth only on the two financial pages". It actually shows the category total on pages 2 and 3, as :946-956 explains.
>      - The `<View><>` wrapper at :944-945 is no longer needed.
>    - **Tests:** the `contentWidthFor` doc promises "a NaN window width yields 0", but no scenario covers it (`tests/__features__/duo-side-gutters.feature:59-78`).
>
> 8. **New in round 3, otherwise clean.** `ScrollViewInstance` is a real RN 0.88 type export (`node_modules/react-native/types_generated/index.d.ts:47`). The `onPagerLayout` dependencies (`chartPage`, `slideWidth`) are complete. The change stays in scope: no repository imports, nothing touches the biometric gate, and no SQL.
>
> **Checks (tails)**
> - `npm run typecheck` → `tsc --noEmit`, exit 0
> - `npm run lint` → `eslint . --ext .ts,.tsx`, exit 0
> - `npm test -- "duo-"` → `Test Suites: 2 passed, 2 total` / `Tests: 26 passed, 26 total`, exit 0
>
> **Not verified**
> - No device or simulator run. Still open:
>   - whether window size and insets actually arrive in separate renders on fold (finding 1 is from reading the code, and its size depends on that);
>   - the visual result of the restore;
>   - whether Fabric has the content size ready by the time the pager's `onLayout` handler runs. If not, `scrollTo` gets clamped to 0 and the follow-up `onMomentumScrollEnd` resets `chartPage` to 0. Mount ordering makes this unlikely.
> - I did not run the full `npm test` or `npm run eval`, and did not repeat QA's mutation testing.
> - The working tree has uncommitted `.claude/pipeline/dashboard.html` and `state.json`; commit them with the next stage.
>
> Files:
> - /home/user/ProjectXavier/app/(tabs)/dashboard.tsx
> - /home/user/ProjectXavier/src/domain/screenGutters.ts
> - /home/user/ProjectXavier/src/domain/chartLayout.ts
> - /home/user/ProjectXavier/src/domain/chartCarousel.ts
> - /home/user/ProjectXavier/src/domain/dashboardLayout.ts
> - /home/user/ProjectXavier/docs/design/duo-dashboard-grid-spec.md
> - /home/user/ProjectXavier/tests/__features__/duo-side-gutters.feature

Coordinator action (applied directly, ae1bed6 → this commit): Major fixed as proposed — the pager re-seats on its MEASURED viewport width (`pagerWidthRef`, callback ref resets it on unmount, `onLayout` scrolls to `chartPage * width` only when the width changed), which covers mount, fold and rotation and removes the render-time ref write; `onMomentumScrollEnd` divides by the measured width. Nits: card className comment names `CARD_BORDER`; `CARD_BORDER` moved below the imports; stale pager/spec reasoning reworded (Fabric re-applies `contentOffset`); carousel width now `contentWidthFor(screenWidth, insets, 0) − 2·CARD_BORDER`; tiles subtract their own 1pt border (`TILE_BORDER`, spec §3 and the pinned test values updated: 621 → 125/65, 819 → 179/93, 600/601 → 119/62, 1600 → 392/190); stale header comment and the `<View><>` wrapper removed; NaN-window scenario added for `contentWidthFor`. tsc 0, eslint 0, duo suites 27/27. Round 3 review requested.

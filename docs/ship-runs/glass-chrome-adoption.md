# Ship run: glass-chrome-adoption

> Durable, committed record of one `/ship` run. Agent verdicts are pasted
> verbatim. Committed in stage 6 with the `Ship-Run: glass-chrome-adoption`
> commit trailer.

- **Feature:** Liquid Glass chrome adoption — completion of approved steps 0–3 (avatar halo + swatch, sticky glass ScreenHeader with one PeriodPill, clear-glass quick chips + "Add manually", glow retired on glass controls)
- **Branch:** claude/liquid-glass-ui
- **Spec:** docs/design/glass-chrome-adoption-spec.md
- **Started / finished:** 2026-09-06 / 2026-09-06

## Spec
Objective: finish the approved "Xavier on Glass" (Option A · NativeTabs) steps 0–3; Phase 1 (`d09ce4e`) and Phase 2 (`ab31e79`) on this branch already landed step 1, edge-to-edge, the composer/Send/FAB glass and (ahead of its gate) the sheet, so this run ships only the remaining delta (§3 of the spec). Auto-passed: the design and the tab-bar fork were approved by the user on 2026-08-25 and the `/ship` arguments scope the steps; the only judgment calls are the delta mapping (§2) and two micro-decisions recorded in §4 ("Add manually" → `/transactions?add=1`; per-look light halo hues from the light-mode handoff).

## QA
Round 1 — **verdict:** PASS-WITH-CONCERNS

> ## Verdict: PASS-WITH-CONCERNS
>
> **Test + build results:** `npm run typecheck` → clean. `npm run lint` → `ESLint: No issues found`. `npm test` → `Test Suites: 109 passed, 109 total`, `Tests: 1909 passed, 1909 total`. `npm run eval` → `Overall: 21/32 (65.6%)`, `PASS — at or above baseline (65.6%), no case regressed`. Acceptance criterion "`project.pbxproj` SHA stays `431aa662…`" **does not currently hold**: `shasum` returns `3b18a2bf5b333f728afa06a207f010d0dc689486`. `ios/` is gitignored so this can't be attributed to the 12-file diff under review, but the stated criterion is false as written. `package.json` unchanged — confirmed.
>
> **Major — `?add=1` deep link can silently discard in-progress form data on tab-switch-away-and-back.** `app/(tabs)/transactions.tsx:291-298`. `openAdd()` (`:277-284`) is **not** the "just sets sheetOpen true" idempotent helper the code comment and spec §7 claim it is — it also calls `setInitial(emptyInitial(...))`, `setMeta(emptyMeta())`, `setError(null)`, `setOpenRowId(null)`, unconditionally resetting any in-progress form state. The only guard against re-firing is `router.setParams({ add: undefined })` clearing the param. But the **same file's own sibling implementation** for the analogous `?focus=1`/`?scan=1` widget deep links (`app/(tabs)/index.tsx:2838-2863`) explicitly does **not** rely on clearing params, and says why: *"expo-router keeps query params around across tab switches, so without the ref guards going Home → another tab → Home would re-focus/re-open the sheet forever."* It uses persistent `useRef` guards instead. The new `add=1` handler has no such ref. Concrete repro: tap "Add manually" chip on Assistant → Transactions Add sheet opens → user types an amount/note → user switches to Dashboard tab and back to Transactions before/without the param durably clearing → `useFocusEffect` refires, `openAdd()` runs again, wiping the user's unsaved entry. Spec's claim this is "the exact pattern index.tsx already uses" is incorrect.
>
> **Major — unkeyed height changes leave part of the glass header unblurred, and this class of bug has already manifested once.** `src/components/ui/ScreenHeader.tsx:38-90` keys the `Glass` remount only on `below`'s presence, because expo-glass-effect's native blur applies exactly once at first `layoutSubviews`. Nothing keys **large Dynamic Type causing the title to wrap above the pill** — an edge case spec §7 explicitly anticipates (`flexWrap:'wrap'`) but never re-addresses for the same first-layout-only hazard. Separately, `headerHeight` state starts at `0` in both `dashboard.tsx` and `transactions.tsx`, so the very first render commits `paddingTop: 12` before `onHeight` fires — a real frame where content sits under the header before the corrected padding snaps in. This exact class of defect is documented as already having occurred once (`transactions-search-scroll-light-BUG-before-fix.png`).
>
> **Minor — acceptance-criterion drift on `project.pbxproj`.** The criterion as literally stated in the spec is false right now; since `ios/` is gitignored this can never be verified from a diff review — worth re-baselining or dropping.
>
> **Minor — pre-existing sub-44pt tap targets carried through unchanged.** `src/domain/scaleMath.ts:96`: `QUICK_CHIP_HEIGHT = [40, 42, 46]` — two of three width tiers are below Apple's 44pt HIG minimum. Not a regression, but D3.1 touched every quick chip and didn't fix this known shortfall.
>
> **Minor — weak luminance-test coverage for `slate`.** `slate.glowLight` reuses `to` verbatim; the new luminance assertion passes trivially for `slate` since `to` is darker than `from` by construction.
>
> Verified as correct (probed, no bug): nativewind `useColorScheme` agrees with `useThemeColors`/`useGlass`; angry-glow interpolation from `haloFrom` is necessary, not a regression; `accentGlow` retired on exactly the 3 glass sites and kept on exactly the 3 solid `bg-primaryFill` buttons; "Overview" exists once; `AvatarSwatch` pupils `=== darkColors.bg`; search remount only at open/close, never mid-typing; zIndex 1 vs 10 no conflict; `ListHeaderComponent` correctly kept; `AvatarLook` typing complete.

Resolution (main agent, before round 2): chip pushes `/transactions?add=<Date.now()>` and `transactions.tsx` keeps the last handled token in a ref (`addHandledRef`) — stale tokens ignored, new tokens open once; `ScreenHeader` re-worked to a childless `Glass` sized off the measured content height and keyed on it (BottomSheet pattern) with a solid `chrome.fallback` wrapper until measured; screens seed `headerHeight` with `insets.top + SCREEN_HEADER_ESTIMATE`; `QUICK_CHIP_HEIGHT` → `[44, 44, 48]`; spec §5 re-baselined the pbxproj SHA to `3b18a2bf…` (= `431aa662…` + the build-100 bump) with the reason; slate accepted as spec-sanctioned.

Round 2 — **verdict:** PASS-WITH-CONCERNS

> ## Verdict: PASS-WITH-CONCERNS
>
> **Test + build results:** `npm run typecheck` → clean. `npm run lint` → `ESLint: No issues found`. `npm test` → `Test Suites: 109 passed, 109 total`, `Tests: 1909 passed, 1909 total`. `npm run eval` → `Overall: 21/32 (65.6%)`, `PASS — at or above baseline (65.6%), no case regressed`. `shasum -a 1 ios/ProjectXavier.xcodeproj/project.pbxproj` → `3b18a2bf5b333f728afa06a207f010d0dc689486`, matching the spec's re-baselined value exactly. `git diff -- package.json` → empty.
>
> **Round-1 majors — both genuinely fixed, verified by code walkthrough:** (1) `?add=1` refire / form-reset — fixed. `openAdd()` still unconditionally resets the form — it is *not* idempotent, contrary to its own comment — but that no longer matters because `addHandledRef` blocks re-invocation for an already-seen token, and `index.tsx` now sends a fresh `Date.now()` token per tap. Traced `router.setParams({add: undefined})` against `expo-router@6.0.24`'s `useLocalSearchParams` and `@react-navigation/core`'s `useFocusEffect` — the guard fires exactly once per token. (2) Unkeyed height / frame-0 zero padding — fixed. `ScreenHeader.tsx` keys the absolutely-positioned `Glass` on the *measured pixel height* itself, so any height-changing event gets a fresh `GlassView` at final size; the keyed `Glass` is a sibling of the `onLayout`-tracked content, so no remount loop is possible by construction. `headerHeight` now seeds from `insets.top + SCREEN_HEADER_ESTIMATE`. (3) `pbxproj` criterion and `QUICK_CHIP_HEIGHT` — both fixed.
>
> Adversarial probes clean: same-millisecond double tap; stale param + different token; app relaunch with a stale `add` param (no cold-start vector — only ever produced by an in-process `router.push`); `pointerEvents` box-none/none — pill and search still tappable, content below the header reachable; no Reanimated animation wraps `ScreenHeader`; sheets render through the root `Portal` above `zIndex: 10`; per-keystroke re-renders never remount the search `TextInput` or the `Glass`; `accentGlow` scoped correctly.
>
> **Gaps & risks:**
> - **Major (verification gap, not a functional bug):** Neither of the two behaviors that were round-1 blockers — the token/ref guard in `app/(tabs)/transactions.tsx` and the height-keyed `Glass` in `src/components/ui/ScreenHeader.tsx` — has any automated test. A future edit that reintroduces the exact class of bug this round fixed would sail through `typecheck`/`lint`/`test`/`eval` with zero signal — the only backstop is the spec §5 manual-simulator checklist.
> - **Minor:** `SCREEN_HEADER_ESTIMATE = 62` is a hand-picked constant with no assertion tying it to the header's real rendered height; at large Dynamic Type the true first-layout height can exceed it for one frame before `onHeight` corrects it. Self-correcting.
> - **Minor (carried forward by design):** `slate.glowLight` reuses `to`; the luminance assertion passes trivially. Spec-sanctioned.

Resolution (main agent): the two behaviours are now plain-Node domain helpers with BDD coverage — `src/domain/deepLinkToken.ts` (`takeDeepLinkToken`, 4 scenarios in `tests/__features__/deep-link-token.feature`: new token handled once and remembered, same token ignored, fresh token handled, no token keeps memory) and `src/domain/layoutSettle.ts` (`settleMeasuredHeight`, 3 scenarios in `tests/__features__/layout-settle.feature`: ceil, same height returns the previous value, taller layout produces a new one); `transactions.tsx` and `ScreenHeader.tsx` call them. Suite now 111 suites / 1916 tests. `SCREEN_HEADER_ESTIMATE` and slate accepted as noted. A headless sim pass on the reworked header (search grow, large Dynamic Type, `?add` tab-switch, Reduce Transparency) was run alongside round 2 — result recorded below.

Headless sim pass (alongside round 2; general-purpose agent, iPhone 17 Pro / iOS 26.5, screenshots `scratchpad/glass-chrome/round2/`):

> **1. Transactions + Dashboard at rest / scrolled — PASS (dark and light, cold start).** Row under header is a soft smear, title crisp; first frame after tab tap shows the header with glass and nothing crisp above it at ~200 ms granularity. **2. Transactions search — PASS (light + dark).** Whole grown header is glass; typing kept focus after the glass re-key; close shrinks, still glass. **3. Large Dynamic Type — PASS at XXXL cold start; AX-XL PASS with a minor**: title truncates to "Transac…" and the search button lands 2pt past the screen edge. **4. `?add` guard — PASS (via deep link)**: sheet still open with −42 after tab-away-and-back, stays closed after close, reopens on a fresh token. Observed: right after a cold start the chip-opened form shows "Account: Choose account" — `openAdd()` ran before accounts had loaded. Minor. **5. Quick chips — PASS.** All four chips h=44 at medium and XXXL. **6. Reduce Transparency — PASS (dark + light).** Header solid `surface`, rows fully hidden; chips solid `surfaceAlt`; glass back after RT off.
>
> **A. FAIL — appearance change kills glass on the mounted background tab (reproduced 4×).** Switch dark↔light while a tab is mounted but not visible → on the *first* return to that tab every GlassView on it renders nothing: header transparent with crisp rows/cards through the title, FAB reduced to a bare "+" with no disc, Assistant Send loses its tint. Foreground tab is unaffected. Recovers on the *second* return, or when the header re-keys. Real-world trigger: automatic sunset/sunrise theme switch. Likely mechanism: `Glass` re-supplies `tintColor` to the same GlassView instance while its screen is detached.
> **B. Bug (probably pre-existing) — closing search with pending autocorrect leaves a stale query.** Type "abc" → Close: list shows "No matching transactions."; reopening shows the field holding "ABC".

Resolution (main agent): A is pre-existing since Phase 2 (build 100 has it) and is fixed at the source — `Glass.tsx` keys its `GlassView` on the colour scheme, so a scheme change remounts the material and its first layout happens on attach (the path that always works; confirmed against `GlassView.swift`: `setTintColor → updateEffect` re-assigns the effect on the same instance). B fixed: the list filters on `searchOpen ? query : ''` and Open resets the query. The AX-XL overflow fixed with `flexShrink` on the right cluster and the pill. Cold-start "Choose account" and runtime Dynamic Type artefacts recorded as follow-ups (spec §8). A third sim pass on these three fixes was run before closing the QA gate — result below.

Third headless sim pass (on the three fixes; screenshots `scratchpad/glass-chrome/round3/`):

> **A. Theme switch on a background tab — PASS in all four directions.** (i) Assistant →light, tap Transactions: row under the header is a diffuse pink blob, title crisp; FAB has its blue disc. (ii) Dashboard →dark, tap Transactions: dark-red smear under the header, moves with a further scroll, still blurred; FAB disc present. (iii) Transactions →light, tap Dashboard: hero figure ghosted under the header; the chart's line is crisp only below the header's bottom edge. (iv) Dashboard →dark, tap Assistant: Send has its blue disc, tray translucent, four chips glass. Visible tab right after each switch also still glass — no regression from the keyed remount. **B. Search autocorrect — PASS.** After Close the full list is back; reopen shows the placeholder. **C. AX-XL header — PASS.** Search button right edge 378.0 (limit 378); pill label truncated to "September 2…".
>
> Observations outside the three fixes (pre-existing): at the default text size the Transactions header already wraps (title 178 + pill 177 + search 32 > 354pt padded width), so the pill+search cluster sits on a second row; at AX-XL transaction rows wrap character-by-character (row layout); a Dashboard with one account has no scroll.

QA gate closed: every Major from both rounds resolved in code with automated coverage where the code is plain-Node, and every sim finding fixed and re-verified. Carried to spec §8: cold-start "Choose account", runtime Dynamic Type artefact, the two-row Transactions header at default size (a label-length question, not a glass one).

## Review
**verdict:** APPROVE-WITH-NITS

> ## Verdict: APPROVE-WITH-NITS
>
> Checks re-run in the worktree: `npm run typecheck` clean, `npm run lint` → `ESLint: No issues found`, `npm test` → **111 suites / 1916 tests** passed. `package.json`, `ios/`, no new deps, no PII, no function-form `style` — all clean. Round-1 and round-2 QA resolutions are genuinely present in the code (`addHandledRef` + `takeDeepLinkToken`, `key={height}` childless Glass, `insets.top + SCREEN_HEADER_ESTIMATE` seed, `QUICK_CHIP_HEIGHT [44,44,48]`, `activeQuery`, `Glass key={scheme}`, `flexShrink` on the pill and right cluster, `accentGlow` on exactly the three solid `bg-primaryFill` buttons).
>
> ### Blocking issues
> None. No correctness, security, or data-integrity defect found.
>
> ### Should fix before merge (comments/records — no runtime behaviour)
> 1. **`app/(tabs)/transactions.tsx:295` — the comment asserts the exact falsehood QA disproved twice.** `openAdd() is idempotent (just sets sheetOpen true)` — `openAdd` calls `setInitial`, `setMeta`, `setError`, `setOpenRowId` — it wipes an in-progress entry. The behaviour is correct today only because `addHandledRef` prevents re-invocation. Same falsehood is durable in the spec §7. Also `:136` and `:293` still say `?add=1` when the sender is `?add=${Date.now()}`.
> 2. **`src/components/ui/ScreenHeader.tsx:131` — comment claims a 44pt target that isn't there.** The `PeriodPill` Pressable carries only `flexShrink: 1`; effective height ≈ 32pt, no `minHeight`, no `hitSlop`. Either add `minHeight: 44` / `hitSlop` or delete the claim.
> 3. **`src/theme/tokens.ts:57` — rewritten comment left a stale count** ("identical in all six copies" — three were just retired).
> 4. **`docs/ship-runs/glass-chrome-adoption.md:60` — the third sim pass verdict is missing.** [Reviewer read the file before the write landed; it is present.]
>
> ### Non-blocking
> 5. **`src/components/ui/Glass.tsx:24-33` vs `:100-107` — the canonical comment now contradicts the fix nine lines below it** (header: re-supplying `tintColor` "does NOT recover it"; key comment: `setTintColor → updateEffect` does re-assign the effect, it just renders nothing while detached). It also doesn't mention that `Glass` now keys itself internally.
> 6. **`src/components/ui/Glass.tsx:108` — `key={scheme}` makes every Glass in the app remount at a moment no caller controls** — a sunset switch can land mid-animation; narrow window, the alternative is worse, but it deserves a sentence in the header comment. State-holding callers checked: `BottomSheet`'s Glass is childless, so open sheets survive a theme switch; the only stateful child under a Glass is the composer `TextInput`, whose `draft` lives outside it.
> 7. **`src/components/ui/ScreenHeader.tsx:59-95` — height-keyed glass necessarily has a 2-3 frame stale window on growth/shrink.** Worth one line of comment, not a code change.
> 8. **`src/domain/layoutSettle.ts:11-14` — the extraction is ceremony; the useful part is `Math.ceil`.** The `prev` parameter has no observable effect; the "same value as before" scenario is a tautology. `takeDeepLinkToken` is the opposite — three real branches, a contract worth pinning.
> 9. **`docs/design/glass-chrome-adoption-spec.md:157` — §5 ends mid-sentence.**
>
> ### Nitpicks
> `keyboard: 'type'` naming (ignore); `pointerEvents="box-none"` on the header wrapper is effectively a no-op; wrapper hairline vs Glass bottom edge sub-pixel; `luminance` duplicated in `avatar-look.steps.ts` (spec-sanctioned); Dashboard's `ScrollView` has no `scrollIndicatorInsets`, so the indicator runs under the glass bar.

Applied (main agent): 1 (comments + spec §7 corrected — `openAdd()` is NOT idempotent, the token guard is why it's safe; `?add=<token>` wording), 2 (`hitSlop={6}` on the pill, comment corrected), 3, 5 + 6 (Glass header rewritten as the canonical, precise description incl. the scheme key and its window), 7 (comment), 8 (`settleMeasuredHeight(raw)` = ceil only; feature reworded to the real contract — sub-point jitter keys the same), 9, and the `scrollIndicatorInsets` nitpick on both screens. 4 was a read-before-write race. Skipped: `box-none` (harmless), hairline, `luminance` duplication, `keyboard` naming.

## Verify
```
$ npm run typecheck && npm run lint && npm test && npm run eval   (worktree fm-spike, claude/liquid-glass-ui, 2026-09-06)
tsc --noEmit: clean
Test Suites: 111 passed, 111 total
Tests:       1916 passed, 1916 total
Overall: 21/32 (65.6%)   Fail-to-parse: 7/7 (100.0%)
PASS — at or above baseline (65.6%), no case regressed.
```
Eval provenance artifact(s): evals/results/heuristic.json (gitSha a5437f0 → this commit). `project.pbxproj` SHA `3b18a2bf5b333f728afa06a207f010d0dc689486`; `package.json` unchanged.

## Build
_pending_

## Result
_pending_

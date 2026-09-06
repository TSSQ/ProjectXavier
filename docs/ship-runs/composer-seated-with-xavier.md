# Ship run: composer-seated-with-xavier

> Durable, committed record of one `/ship` run. Agent verdicts are pasted
> verbatim. Committed in stage 6 with the `Ship-Run: composer-seated-with-xavier`
> commit trailer.

- **Feature:** Re-seat the Assistant composer so it stops reading as a second tab bar — Messages grammar ("+" · field · morphing trailing slot), mounted in the hero under Xavier's greeting, quick-action chips retired into the "+" menu
- **Branch:** claude/liquid-glass-ui
- **Spec:** docs/design/composer-seated-with-xavier-spec.md
- **Mockup:** https://claude.ai/code/artifact/20d2f3b4-ca02-4d90-8f3d-98016029b274 (Option D, approved)
- **Started / finished:** 2026-09-06 / —

## Spec
Objective: the build-102 composer is a chrome-glass capsule at the tab bar's own inset and silhouette, 12.6pt above it, with four materials nested inside — it reads as a second tab bar. Option D takes Messages' grammar, moves the composer into the hero group under the greeting, and retires the four quick-action chips into a "+" menu built from the existing `SlashMenu`. Scope C1–C5.

Auto-passed: the design fork was already decided by the user in the `/design` session that produced the mockup (Option D = A + B, no chips), and the spec names its own fallback up front — mount the same `Composer` in the bottom band and restore the chips from git if device confirm rejects reach or discoverability. No open product question for this run to put back to the user.

## QA
Round 1 — **verdict:** PASS-WITH-CONCERNS

> ## Verdict: PASS-WITH-CONCERNS
>
> Typecheck, lint, tests and eval are genuinely green (verified myself, not taking the implementer's word), and the core spec contract (`composerState`, `plusMenuRows`, chip retirement, focus-ring-as-overlay) is implemented correctly and well-tested. But I found one **confirmed, code-provable regression** in a shipped entry point and one **confirmed, visually-evidenced acceptance-criterion failure**.
>
> `npm run typecheck` clean · `npm run lint` "ESLint: No issues found" · `npm test` 113 suites / 1929 tests · `npm run eval` 21/32 (65.6%) PASS. `package.json` and `ios/` untouched.
>
> **Priority 1 — `?focus=1`. This is a real, code-provable regression, but narrower than the implementer's blanket claim.** The deep-link effect and its guard refs are byte-identical to `git show HEAD`. What changed (C2) is that the `TextInput` moved from unconditionally mounted (old `inputBar`, rendered after `</ScrollView>` regardless of state) to `{composer.visible && <Composer inputRef={inputRef} .../>}`, where `composer.visible = !pending && !pendingAccount`. On a genuine cold launch `composer.visible` is true on the first render, so the plain idle case has the same timing as before and I found no mechanism that breaks it. But whenever a draft or account-confirm card **is** showing — plausible if the user backgrounds the app mid-flow and later taps the widget — `<Composer>` doesn't exist, `inputRef.current` is null, and the guard is set **before** the null-safe `.focus()`, so the deep link permanently no-ops for the rest of the session. **Squarely attributable to C2**, not pre-existing. Separately, `[deepLinkParams.focus]` will not re-fire on a second identical `?focus=1` while the process stays warm — a pre-existing, unrelated limitation, and most of the implementer's failing screenshots are consistent with that one-shot design rather than with the idle case being broken. Severity: **Critical/blocker**.
>
> **Priority 2.** `keyboardVerticalOffset={-insets.top}` is empirically fit with a documented 4pt residual on the calibration device; it is a formula, not a magic number, but only measured on one Dynamic-Island device, and nothing explains why the shortfall would be proportional to the top inset. Landscape is moot (portrait-locked). Severity: **Major**. The `composerFocused` reset effect only handles `composer.visible → false`; there is no `useFocusEffect`/`useIsFocused` handling, so a tab switch mid-focus leaves it stuck true and the hero docked with the small avatar on return — **Major**, knowingly shipped without a fix.
>
> **Priority 3.** `composerState` implements §4.3 exactly, verified line by line; the 8 scenarios pin behaviour rather than restate the implementation; `plusMenuRows` order is pinned; `QuickActionChips`/`showQuickActions`/`openAllCommands` are fully gone with zero live references; the typed-`/` contract is untouched; the focus ring is a plain overlay and there is no `Animated.View`/`entering`/`LayoutAnimation` anywhere near a Glass. **Gap:** `showCamera` doesn't gate on `busy`, so the stable post-Send render shows a camera glyph beside the busy spinner (confirmed in `09-after-send-button.png`); it no-ops when tapped. **Minor**, untested branch.
>
> **Priority 4.** Tab-switch stuck focus confirmed real and unaddressed. `onScan`'s `{x:0,y:0}` fallback: I ran the actual placement math against a 393×852 screen — result `{left:12, top:16}`, the top-left corner, not the centre. **Visually confirmed** in `67-deeplink-scan.png`. This directly contradicts the code's own comment and the spec's written acceptance criterion 7. Pre-existing code, but this diff's spec newly promotes it into a printed, unmet acceptance criterion. **Major**, trivial fix.

Resolution (main agent): all four actionable findings fixed — the deep-link guard is consumed only when the ref is live, with `composer.visible` as a dep so it retries when the card clears; a `useFocusEffect` cleanup resets `composerFocused` on tab blur; `onScan`'s fallback is the real screen centre; `showCamera` gates on `busy`, with a new scenario. The keyboard offset is accepted with a caveat recorded in spec §9: it is a formula, its failure mode on a smaller top inset is a larger gap and never an overlap, and the app is portrait-locked and ships to a Dynamic-Island device. Checks after the fixes: 113 suites / 1930 tests.


## Review
**verdict:** APPROVE-WITH-NITS

> ## Verdict: APPROVE-WITH-NITS
>
> Typecheck and lint re-run clean on the post-fix tree. No new deps, nothing under `ios/`, `package.json` untouched, no function-form `style`, no PII. Diff is confined to the ticket — no scope creep.
>
> **The four post-QA fixes — all correct.** (1) `?focus=1` guard: retry is genuinely reachable — `composer.visible` is exactly the mount condition of `<Composer>`, and React attaches refs during commit before passive effects, so on the false→true transition the ref is live. No double-consume. (2) `useFocusEffect` cleanup: no race with arrival — the callback body is empty, only the cleanup runs, and cleanup runs on blur/unmount, never on focus. (3) `onScan` centre fallback: correct — against `computeMenuPlacement` a 393×852 centre places the menu above the point and clamps on-screen; the old `{0,0}` hit the `EDGE_MARGIN` floor in both axes. (4) `showCamera` gates `busy`: the empty trailing slot appears in exactly two states, both deliberate.
>
> `keyboardVerticalOffset={-insets.top}`: I agree with §9's acceptance. Under the installed library's formula, a smaller top inset makes the offset less negative → more padding → bigger gap. Overlap needs a larger top inset than the calibration device, which doesn't exist in the shipping set.
>
> **Blocking issues: none.**
>
> **NB-1** — `?focus=1` still burns the guard when `busy`: the field is `editable={false}` then and cannot become first responder, yet the guard is consumed. Same failure class QA blocked on, one gate over. **NB-2** — typed "/x" no longer reaches "What can I ask?", and the docstring says it still does: the added `matchCommands(draft).length > 0` closed the branch that kept the pinned examples row reachable on a zero-match filter; the spec claimed the typed path was untouched, which isn't accurate, and the BDD contract covers the pure functions, not the gate. **NB-3** — the KAV comment mis-states its own mechanism: a negative offset *reduces* padding, so the view over-pads rather than falling short; the number is right and it docks, but the causal story is inverted. Also `automaticOffset` exists in the installed 1.21.13 and would retire the calibration. **NB-4** — `composerState.showSend` is dead in production and `Composer` re-derives the same rule: two sources of truth, and the feature file pins a rule no shipping code reads. **NB-5** — outside-tap dismissal is hero-scoped, not the full-screen `Pressable` §4.4 called for; also `plusOpen` survives a Send, floating the menu over the greeting anchored to a "+" that `showPlus` has already hidden. **NB-6** — a `Glass` now mounts conditionally mid-keyboard-animation (Send disc, "+" circle) inside a subtree the KAV resizes every frame; not the documented hazard, but the same shape — worth one device pass.
>
> Nitpicks: stale state name `docked` in a comment; a cite to a non-existent §5.2; `Composer.tsx`'s paraphrase of the Glass rule over-reaches; `quickChipHeight` has no consumers left; duplicate `accessibilityLabel="Scan photo"` on screen simultaneously; the new files are untracked — dropping `Composer.tsx` from the commit would leave `main` uncompilable; and the composer now scrolls with the hero, so in overlay states a long answer can carry it off-screen (nothing clips).

Resolution (main agent): NB-1, NB-2, NB-3, NB-4 and the `plusOpen`-survives-Send half of NB-5 all applied, plus the stale-name and wrong-cite nitpicks. NB-2 was the most consequential — the typed gate is back to exactly what it was, so a mistyped "/x" still reaches "What can I ask?". Carried to spec §10 with reasons: the hero-scoped outside tap, the mid-animation Glass mount (a device check on the confirm list), `automaticOffset` as the principled replacement for the offset calibration, `quickChipHeight` parked for the §8 fallback, the duplicate VoiceOver label, and the scrolling-composer trade-off. Checks after the nits: 113 suites / 1930 tests.


## Verify
```
$ npm run typecheck && npm run lint && npm test && npm run eval   (worktree fm-spike, claude/liquid-glass-ui, 2026-09-07)
tsc --noEmit: clean
Test Suites: 113 passed, 113 total
Tests:       1930 passed, 1930 total
Overall: 21/32 (65.6%)   Fail-to-parse: 7/7 (100.0%)
PASS — at or above baseline (65.6%), no case regressed.
```
Eval provenance artifact(s): evals/results/heuristic.json. `package.json` unchanged; `ios/` untouched (pbxproj SHA `081df8c8…` = the build-102 value).

## Build
- Delivery UUID: n/a — Beta soak builds installed directly on Pigu via devicectl
- Build 103 (`5f51707` feature + bump), metrics on — installed on Pigu 2026-09-07, confirmed `Xavier Beta 1.1.3 build 103`. **Rejected on device.**
- Build 104 (`12d63a0` fixes + bump), metrics on — installed on Pigu 2026-09-07, confirmed `Xavier Beta 1.1.3 build 104`. Carries the three rejection fixes plus the theme-flip one found while verifying them.

## Device confirm — build 103: REJECTED
User report with screenshot: "text bar hidden by keyboard, doesn't focus on first tap." Both confirmed, both from this run. Diagnosis and fixes in spec §11. A third defect surfaced during verification: flipping the colour scheme while focused stranded the composer behind the tab bar until relaunch.

Headless sim verification of the fixes (three passes, `scratchpad/composer-fix/`, `composer-gap/`, `composer-theme/`):

> **Docking** — the composer is never behind the keyboard. First pass measured 30.0pt in every configuration (dark, light, after a "+" open/close), positive but ~2x the ≤12pt spec; traced to three stacked bottom paddings rather than the offset. After trimming: **8.0pt in both themes**, `describe-all` frames and pixel crops agreeing exactly, with the at-rest row still **216.3pt clear** of the tab bar.
> **First-tap focus** — 7 blur→one-tap rounds across both themes, **every tap focused first time**, zero two-tap cases. Backdrop still dismisses from the avatar and greeting and closes the "+" menu; "+" and the camera glyph both respond on the first tap.
> **Send disc mid-rise** — the case review flagged as unproven: typed while the keyboard was still rising, the disc renders with its blue glass material, both themes.
> **Theme flip while focused** — the layout recovers to the centred at-rest position (row bottom 575 vs tab bar top 791) in both directions, twice each; one tap refocuses afterwards on 6/6 attempts at the 8pt gap; draft text survives the Glass remount.

Caveat carried to device confirm: the 8pt gap is a simulator measurement, and the constant it replaced behaved differently on real hardware. `automaticOffset` reads the true screen position natively rather than inferring it, so it should not vary by device — but that is the thing to look at first on Pigu.

## Result
Shipped to soak on `claude/liquid-glass-ui`, installed on Pigu. Device confirmation pending. The spec's §8 fallback stands if reach or discoverability is rejected: mount the same `Composer` in the bottom band and restore `QuickActionChips` from git — a mount-point change, no new design.

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


### §12 (E1–E3) — QA round 1: PASS-WITH-CONCERNS

> `npm run typecheck` clean · `npm run lint` "ESLint: No issues found" · `npm test` 114 suites / 1935 tests · `npm run eval` 21/32 (65.6%) PASS.
>
> **Priority 1 — the `insets.bottom` deviation.** The reasoning holds: traced `automaticOffset` into the library — with `behavior="padding"` its own `paddingBottom` is derived from the KAV's true screen frame versus the keyboard's top edge, with no knowledge of a static gap a child reserves inside that frame, and it is additive to the child's own padding. An unconditional `insets.bottom + 8` would sit on top of the keyboard-height padding and reproduce the ~83pt dead gap. **Major:** but all four mechanisms that null `composerFocused` are keyed to the keyboard having shown/hidden or the field unmounting. **A hardware keyboard attached** suppresses the software keyboard entirely — `onFocus` still fires, no `keyboardDidShow`/`Hide` ever does — so `paddingBottom` collapses to 8 with nothing rendered to displace the tab bar, and the row lands under it. The same failure mode this run has hit three times (draft card, tab switch, theme flip), and specifically dangerous because the team's own headless-sim workflow toggles a hardware keyboard.
>
> **Priority 2 — the growing glass.** Verified structurally: the keyed `Glass` and the `onLayout` content View are JSX siblings under the same parent, so changing the Glass's key cannot remount the content or the `TextInput` — focus and text genuinely survive; and because the Glass is absolutely positioned it cannot re-trigger the content's `onLayout`, so no loop is possible. The opaque tier paints its own fill and hairline on the content view, correct. The 5-line cap applies to both layers. **Minor, pre-existing, not worsened:** `SlashMenu` has no `maxHeight`/scroll — the bottom mount actually gives it more headroom than the hero mount did.
>
> **Priority 3 — the reply timer. Major, confirmed, code-provable, untested by both the BDD suite and the screenshots.** The effect depends on `[lastOutcome]`, and `onConfirm` sets the outcome with no reset to null first. Two consecutive outcomes resolving to the same literal — the canonical case being a `DraftQueue` statement review, where the advance path never touches `lastOutcome` — are a value-unchanged update: no re-run, no cleanup, no new timer. The FIRST save's timer survives and fires on its original schedule against the next card's progress label or the closing summary, for a different card the user has not had their 5s to read. The reply flashes to the greeting mid-review beside an active draft card. Typed-chat flows are immune because typing nulls the outcome first; a queue of consecutive debits is the mainline use of the feature.
>
> **Priority 4 — regressions.** `submitBehavior="submit"` present and correct; the +8 gap traces correctly; the hero unwind is complete with no orphaned references; the deep links are byte-identical; `SlashMenu` moved with the composer and has more headroom; `composerState` untouched.

Resolution (main agent): both Majors fixed. The settle effect now depends on `reply` as well as the outcome, so the timer settles *this* reply and a new one restarts it. The bottom clearance now keys on a `keyboardUp` flag driven by `keyboardDidShow`/`Hide` rather than on focus. **That second fix collapsed the design**: with layout no longer asking about focus, nothing read `composerFocused` at all, so the state is gone along with all three mechanisms that existed only to keep it honest — the `composer.visible` reset, the `useFocusEffect` cleanup, and the focus half of the keyboard listener. Three patches for three symptoms of one wrong dependency. Checks after: 114 suites / 1935 tests, eval PASS.

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


### §12 — Review round 1: REQUEST-CHANGES (one blocker), and a sim pass that found it independently

> **Verdict: REQUEST-CHANGES.** One blocking issue; everything else optional. Typecheck clean, `ESLint: No issues found`, new BDD suite 5/5. No new deps, `package.json` and `ios/` untouched, diff confined to the ticket.
>
> The three QA resolutions all landed and are structurally right. The settle effect really does depend on `[lastOutcome, reply]` and I traced the ordering — the stale-timer class QA blocked on is genuinely closed. `keyboardUp` has a correct listener lifecycle and cannot be stranded by the three historical unmount paths. `composerFocused` is gone with zero live references anywhere; the focus ring is `Composer`'s own state, which dies with the component instead of outliving it — strictly better than what it replaced. `submitBehavior="submit"` typechecks against RN 0.81.5. The growing-glass split mirrors `ScreenHeader` exactly.
>
> **B1 — the 5s reply reset fires against the statement-queue progress label and the closing summary, not just against a receipt.** The effect settles *whatever `reply` currently is*. Mid-queue the line is `reviewProgress(q).label` ("2 of 6"), so five seconds later the hero text becomes the full first-run greeting beside an active confirm card, inviting a tap on a "+" that `composer.visible` has unmounted. Dwelling 5s on a card is the normal case, not an edge. `resetsReply` is a property of the *receipt*, but it is being applied to the *current reply*. Pre-change behaviour cleared only the face and left both texts standing, so this is a regression.
>
> Non-blocking: the timer can be starved by a run of fast skips (N1); `keyboardUp` is binary over a variable-height keyboard, and a hardware keyboard's shortcut bar reports ~50pt, putting the row back inside the bar's band (N2); the listener is app-global (N3); a stale comment block still describes the hero mount and a ScrollView padding that no longer exists (N4); a duplicated "+ menu" paragraph (N5); `floatingBottomGap` is defined, cited in a comment, and never consumed (N6); the extraction is thin because the rule that actually broke lives in the screen (N7); a stale `showCamera` doc (N8); the field's Glass remounts on every wrap, a new instance of the mid-animation mount hazard (N9).

> **Sim pass, same tree — V1 FAIL, reproducing B1 from the other direction.** The timer restart itself works: saved card 2 (reply "3 of 4"), saved card 3 2.29s later, and "4 of 4" survived past save#1+5.0s and reverted at 5.15s from its own appearance — under outcome-only deps it would have been cut at ~2.7s. But at 5.13s after saving card 1, "2 of 4" was replaced by the full greeting while card 2 sat open with Skip/Edit/Save; reproduced again on card 4. V2 PASS: hardware keyboard focused with no software keyboard leaves the row 8.0pt above the bar. V3 PASS on all five: 8.0pt gaps at rest and keyboard-up; a 3-line entry grows upward 49→95pt with the glass covering the whole field (a scan found edges only at the new top and the bottom, no step where a mis-sized Glass would leave the old one); focus and text survive; return sends; theme-flip while focused keeps focus, text and the gap.
> Two further findings: **account receipts never settle at all** — "Created X. Anything else?" sets a reply but no outcome, so the rule never fires and the typing pre-empt never clears it; observed persisting for minutes. And a **residual same-text hole**: two consecutive replies with identical text and identical kind still would not re-arm, reachable on the delete paths.

Resolution (main agent): B1 fixed by giving `replySettleRule` signals rather than a bare outcome — it now takes whether a card flow owns the screen, so the face settles and the text is left alone until the cards are done, with scenarios pinning it (N7 closes with it). The same-text hole fixed by stamping every reply and keying the timer on the stamp. Account receipts now tag `saved` so they settle like the rest. N2 fixed by storing the keyboard's real height and subtracting it rather than switching on a boolean. N4, N5, N6, N8 and the blank-line nits applied. Carried: N3 (app-global listener), N9 (device check), the `SlashMenu` height cap, hero-scoped outside tap, and the end-of-queue summary persisting if the last card was skipped rather than saved. Checks after: 114 suites / 1937 tests, eval PASS.

### §12 — re-verification on the simulator after the fixes: all PASS

> **W1 — the greeting must not replace a message owned by an open card: PASS**, three saves on different cards of a 4-card statement queue. "2 of 4" survived 10.60s with card 2 open; "3 of 4" survived 10.55s with card 3 open; "4 of 4" survived 9.54s with card 4 open. No revert over an open card in any run. The face still settled as designed, at 5.04–5.43s. When the queue finished, the end summary "Saved 4 of 4 from your statement, 0 skipped." correctly DID revert at 5.35–5.65s — the card no longer owned the screen.
> **W2 — identical consecutive messages settle independently: PASS.** Two deletes, byte-identical replies with the same outcome 3.0s apart; the second got ~5.05s of its own and was not cut short where the first one's timer would have fired. Honest caveat from the verifier: the delete flow inserts a confirmation between the two receipts, so that pair alone cannot distinguish text-keying from stamp-keying — but the W1 runs exercise the other half directly, three cards each setting the same literal outcome and each settling on a fresh full ~5s.
> **W3 — account receipts settle: PASS.** Create reverted at 5.01–5.15s, rename at 4.90–5.19s.
> **Sanity: PASS.** Single save reverts at 4.94–5.11s; typing pre-empts (receipt at 0.48s, one character at 2.11s, greeting by 2.32–2.49s); an error/clarify held the full 16s watched, with only the confused face settling on the 4s rule.

Also caught by that pass: a duplicated `setLastOutcome('saved')` my own receipt fix had left in `onTxOpUpdateSave` — behaviourally inert, removed.

### Build 105 device feedback (§15–§17) — F1, F2, and three bugs the Modal had been hiding

User, on device: "remove scan photo option in the + menu" and "the menu does not follow the keyboard down".

**F1** — the Scan row duplicated the composer's own camera glyph a few points away, and its menu opened over Xavier and the greeting. Removed, with the row-order scenario moved with it. Verified on the sim: the popover lists the commands, Add manually and What can I ask?, the glyph is the only Scan photo left on screen, and Add manually, /account, the examples sheet and the typed "/x" path all still work.

**F2** — the photo menu anchored to a press-time point, so opening it with the keyboard up left it stranded mid-screen once the composer resettled.

> **My first fix failed, and the sim proved it arithmetically.** A ref plus an effect re-measuring on keyboard-height change. Observed menu top 402.0 = the press-time placement exactly (touch 507 − menu 97 − gap 8); a re-measure would have given 636. `ContextMenu` is a `Modal` and presenting it is what suppresses the keyboard, so the transition the effect waited on never arrives. Reverted rather than left as code that looks like a fix.

Shipped instead: `ContextMenu` gained a `bottomRight` anchor that skips the Modal and renders in-flow inside the caller's own container, so the photo menu tracks the composer by ordinary layout — the pattern `SlashMenu` already used beside the same control. The deep link keeps the point/Modal/centre path, since it has no control to anchor to. `onCamera` lost its coordinates, retiring an 18pt disagreement between the touch point and a measured frame.

Then three bugs, all one root — the Modal had been silently providing guarantees nothing else did:

> **Review, REQUEST-CHANGES.** (1) Both popovers could be open at once; sharing a bottom edge and growing upward, the photo menu painted over the "+" menu's lower rows and, since an RN `View` hit-tests whatever is on top, made them untappable. (2) The photo menu outlived its anchor — one keystroke morphs the glyph into Send, a parse makes the composer busy, a draft card unmounts the composer — and the boolean survived the unmounted view, so the menu reappeared unrequested when the card cleared.
> **Sim pass.** V1 exclusion PASS both directions, the other menu's rows genuinely absent from the tree. V2 all three anchor-disappears cases PASS including Save and Discard. V3 tracking PASS — menu and composer both moved +252pt exactly, same 8–9pt gap. **V3(c) PARTIAL FAIL**: tapping the avatar or greeting dismissed nothing.
> **Third instance.** The hero backdrop sits *behind* the content (that is what fixed the two-tap focus bug in §11), and a `View` and a `Text` absorb their own touches — so only blank space ever dismissed. Quietly true for the "+" menu since §11; a regression for the photo menu, whose Modal used to render a full-screen backdrop. The comment on that backdrop claimed the opposite.
> **Re-verified, 5/5 PASS.** All four previously-dead taps now dismiss, blank space still does, the keyboard goes down, and nothing became untappable — the account-flow subtype chips were proven by finishing the flow and seeing the value on the confirm card, and Cancel still works. The avatar still animates. Incidental, pre-existing: the backdrop stops at the scroll content's padding, so the last ~24pt at either edge is outside it; the comment now says so.

Fixes: each handler closes the other menu; an effect keyed on `composer.showCamera` closes the photo menu when its anchor goes; the menu renders before `<Composer/>` for paint and VoiceOver order; the avatar and greeting are `pointerEvents="none"`. Plus comment corrections in `ContextMenu.tsx`, `contextMenuPlacement.ts` and its feature file that described a caller deleted long ago, and a §4.4 line that had become literally false.

### Build 106 device feedback (§18) — the colour blink

User: "the accent when i change Xavier color is blinking from the previous and current color whenever i change screen from navigation menu". Cause and fix in spec §18: every screen kept its own asynchronously-re-read copy of the avatar look, so each tab painted its stale value on arrival; now one shared context.

> **Review, REQUEST-CHANGES.** The single load had no `.catch()`, and `loaded` gates the ambient field on all four tabs plus the face on home, welcome and debug-avatar — a failed DB read would leave the app faceless with no background for the session, with no retry. "This is a regression in failure behaviour, not just a gap. The old per-component reads were equally uncaught, but their failure mode was 'keep rendering the default look' — the app looked completely normal." Also: a restore passes `avatar_look` through and the deleted focus re-reads used to cover that, so the context is now the one copy that can go stale; and the optimistic setters could show a colour that was never saved, permanently, where a focus re-read used to self-correct. Nit: the provider sat inside `PortalProvider`, so any future `useAvatar()` inside a portalled sheet would throw.
> Clean on inspection: no remaining direct repository reads, provider above all six consumer sites, hook order safe, placeholder matches the avatar's own root dimensions, and no Glass interaction — a look change cannot remount a glass surface.

> **Sim re-verification after the fixes.** The verifier compiled a 60fps frame sampler rather than accept the ~7.5fps screenshot burst limit. X1 PASS both looks: the flip lands in a single frame under 300ms, holds across all 496 frames of four tab switches, and survives a cold relaunch; on every tab arrival the face fades in already in the new colour, a monotonic alpha ramp with no hue change. X3 PASS: the `loaded` gate costs nothing measurable — face and ambient field appear in the SAME frame, 7–20ms before the composer's own placeholder text. X4 PASS: every portalled sheet opens, renders and dismisses, including a nested account picker stacked over the add-transaction sheet.
> **X2 SKIPPED, honestly.** A simulator has no iCloud account, the Backups screen reports iCloud unavailable, and there is no local-file restore route to substitute. `reloadAvatar()` was never executed — reachable (the screen mounts and its `useAvatar()` resolves) but untriggered. Carried to device confirm.

## Verify
```
$ npm run typecheck && npm run lint && npm test && npm run eval   (worktree fm-spike, claude/liquid-glass-ui, 2026-09-07, after §12 + its QA/review/sim fixes)
tsc --noEmit: clean
ESLint: No issues found
Test Suites: 114 passed, 114 total
Tests:       1937 passed, 1937 total
Overall: 21/32 (65.6%)   Fail-to-parse: 7/7 (100.0%)
PASS — at or above baseline (65.6%), no case regressed.
```
Eval provenance artifact(s): evals/results/heuristic.json. `package.json` unchanged; `ios/` untouched.

## Build
- Delivery UUID: n/a — Beta soak builds installed directly on Pigu via devicectl
- Build 103 (`5f51707` feature + bump), metrics on — installed on Pigu 2026-09-07, confirmed `Xavier Beta 1.1.3 build 103`. **Rejected on device.**
- Build 104 (`12d63a0` fixes + bump), metrics on — installed on Pigu 2026-09-07, confirmed `Xavier Beta 1.1.3 build 104`. Carries the three rejection fixes plus the theme-flip one found while verifying them. **Rejected on device**: the composer belonged above the tab bar, the field should wrap without overlapping it, and the saved receipt should settle by itself (§12).
- Build 105 (`a4d9c30` §12 E1–E3 + bump), metrics on — installed on Pigu 2026-09-07, confirmed `Xavier Beta 1.1.3 build 105`. The composer sits above the tab bar, the field grows to five lines, and replies settle at 5s or on the first keystroke. **Rejected on device**: the "+" menu's Scan row duplicated the camera glyph, and the photo menu did not follow the composer when the keyboard went (§15).
- Build 106 (`5ea3835` §15–§17 + bump), metrics on — installed on Pigu 2026-09-07, confirmed `Xavier Beta 1.1.3 build 106`. Scan row gone; the photo menu anchors to the composer by layout; plus the three bugs that surfaced once the Modal's implicit guarantees were gone.

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

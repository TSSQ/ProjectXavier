# Ship run: glass-standard-adoption

> Durable, committed record of one `/ship` run. Agent verdicts are pasted
> verbatim. Committed in stage 6 with the `Ship-Run: glass-standard-adoption`
> commit trailer.

- **Feature:** Put the component layer on top of the material layer — six new family components, five brought to the standard, the `card` role renamed to `panel`, three missing scale tokens, and source-scan guards that make the next literal a test failure. No visual redesign.
- **Branch:** claude/liquid-glass-ui
- **Spec:** docs/design/glass-standard-adoption-spec.md · standard: docs/design/glass-style-guide.md
- **Mockup:** https://claude.ai/code/artifact/1a7ac132-aa06-4646-848a-a8a44e2de8a9 (approved 2026-09-07)
- **Started / finished:** 2026-09-07 / —

## Spec
Objective: thirteen `<Glass>` call sites sit inline in screens, every core control component is flat, and the composition rules live as prose across seven files. S0 lands the tokens and the guards first so every later step has a red test to turn green; S1–S6 add the families; S7 sorts the 52 remaining `surfaceAlt` sites into the ladder and guards the count at zero.

Auto-passed: the mockup was approved on 2026-09-07 and the spec names its own fallbacks per step (§8) — drop the `glass` flag on a menu that misrenders, fall back to a bare glyph on the sheet's close. No open product question. Sequencing per the `/ship` arguments: S0 as its own commit, then S1–S6, S7 last, with a simulator pass in dark, light and Reduce Transparency.

## QA
Round 1 — **verdict:** FAIL

> **Verdict: FAIL.** Automated gates are green, but I found a critical, code-provable visual regression that likely breaks the close-button glass on nearly every `BottomSheet` in the app, plus a guard scenario that is already silently blind to real off-scale icon literals in the shipped tree, plus two contrast-loss regressions from the S7 sort, plus the spec's own numeric acceptance bar is not met.
>
> `npm run typecheck` clean · `npm run lint` "ESLint: No issues found" · `npm test` 115 suites / 1944 tests · `npm run eval` 21/32 (65.6%) PASS. `package.json` and `ios/` untouched.
>
> **Scenario-count acceptance bar is not met.** Spec §5 requires ≥ 1108 + 9. Baseline `e6097f2` counts 1108 exactly (confirming the counting method); the tree counts **1114**, not 1117. The `label` role was pinned as a row in an existing Scenario Outline (a real assertion that adds 0 to the count) and the panel rename is a rename, not an addition — so the arithmetic credited scenarios that could never exist. More spec imprecision than missing coverage, but the literal bar is not hit.
>
> **Critical — scenario 4 (Feather icon size) is blind to any multi-line JSX tag, and it is already happening in the shipped tree.** The scan is line-by-line, so `<Feather` on one line and `size={N}` on another never matches — the occurrence is not even counted against the file's budget. Proven synthetically and empirically: `app/manage-accounts.tsx:409-411` has an invisible multi-line `size={16}`, so the file's true count is 3 while the guard sees 2 and passes; `app/recurring.tsx:327-329` the same; `src/components/ui/IncludeArchivedToggle.tsx:47-51` is a multi-line `size={13}` that is not in the allowlist at all and has always been invisible. A new off-scale icon added in the most natural RN formatting passes forever, silently — which is exactly the premise S0 claims to deliver.
>
> **Major — scenario 3 (56pt box) uses a ±80-character window to pair width and height**, which a normal style object with a few intervening properties defeats (confirmed with a repro). Anything FAB-adjacent carrying a glow, shadow or border would slip past.
>
> **Positive, verified rather than assumed:** scenarios 1 and 6 are genuinely green — I re-ran both scans by hand against the real tree rather than trusting the guard's own code: zero stray `<Glass>` outside the eight family files, exactly one `c.surfaceAlt` (MenuPanel's documented exception). Every allowlist entry tagged S1/S2/S3/S5/S6 is gone and the source no longer contains the literal in each case.
>
> **Priority 2 — the claimed dark no-op.** The spec's blanket "Dark is a no-op visually" is false; only the narrower footnote is true. Dark `surfaceAlt` = `controlRaised` = `#1F2530` (a true no-op), but `wellRecessed` = `#0B0E13` and `badgeFlat` = `#12161D` are visibly darker, and `tokens.ts`'s own comment says so. The implementer's framing is correct and the spec's line is the part that is wrong.
> **But two specific sites now lose their fill entirely, in every theme.** `app/(tabs)/index.tsx:3768` and `:3790` — the "Did you mean" callouts moved to `bg-surface` inside a `Card` that is already `bg-surface`, leaving only a hairline. And `TransactionFormSheet.tsx:362` — the "Copying" banner moved to `bg-surface` inside a `BottomSheet` whose opaque-tier fallback IS surface, so on the opaque tier it is flush, which is one of the three passes §5 requires. I checked the other reassignments for the same failure mode; these two are the wrong ones.
>
> **Critical — a new Glass mounts inside a Reanimated `entering` animation, the exact hazard R9 exists to prevent, in the component nearly every sheet uses.** `BottomSheet` defers its own material carefully — `showGlass = tier === 'native' && entered && measured !== null`, with `entered` flipping only in `SlideInDown.withCallback` — and its own comment explains why. But the S2 close-button migration renders `<IconButton size="md" tone="clear">` unconditionally inside the content view, a descendant of the animated `Animated.View`, ungated. `IconButton` renders its own `Glass` with no defer logic. Since `openSeq` remounts the subtree on every open, the close button gets a fresh GlassView whose first layout lands mid-animation, every open of every sheet. By the mechanism this same file documents, the close button's glass fails to render on the native tier — tappable, but reading as a transparent hole. Airtight from the code; wasn't among the implementer's self-flagged items.
> **Major, related** — the `TxOpShowAllSheet` close (`index.tsx:4492`) puts a Glass-backed `IconButton` inside a raw `Modal animationType="slide"`, the same class of hazard `ContextMenu` explicitly avoids for its `point` mode, with no gating and no comment.
>
> **Priority 3 — otherwise compliant.** Chip keys its Glass on `selected` (R5 honoured); `MenuPanel`'s `glass` flag is passed only by the two animation-free callers and never by `point` mode; `Fab`'s glow is opaque-gated; all three `IconButton` sizes clear 44pt including hitSlop (48/48/52, 48/48/52, 52).
>
> **Priority 4.** `ScreenHeader` has a zero-line diff; `Composer`'s diff is exactly the three swaps; `BottomSheet`'s is exactly the close swap plus the import. `RepeatSheet`'s frequency maps are `Record`-typed over the exact four literals, so totality is enforced. `Input` still calls caller-supplied `onFocus`/`onBlur` and no caller fights the focus ring. Dead code with zero callers: `Chip surface="content"` and `Badge tone="negative"` — structurally sound but nothing exercises them. **Minor:** `transactions.tsx:627` keeps a hardcoded `paddingBottom: insets.bottom + 96` while the other four Fab screens express `SIZE.fab + 20 + insets.bottom`, so that one screen won't track the token.


Round 2 — **verdict:** PASS-WITH-CONCERNS

> All four round-1 defects are genuinely fixed, not just superficially patched — I re-derived each one from the code rather than trusting comments. But pushing past the specific round-1 repros turned up real, independently-confirmed gaps in the same guards, and the critical behavioral fix has zero automated regression coverage.
>
> `npm run typecheck` clean · `npm run lint` no issues · `npm test` 115 suites / **1945** tests · `npm run eval` 21/32 PASS. Scenario count recomputed rather than trusted: baseline 1108, tree **1115**, matching the spec's corrected §5 exactly, and the arithmetic is internally consistent with what is actually in the tree.
>
> **Fix 1 — genuinely fixed, and it is the only place it needed to be.** I independently re-swept: every `entering=` in the tree resolves to `BottomSheet` alone, and all seven raw `animationType=` Modals were checked for a Glass-family import — none exercise Glass/IconButton/Fab/Chip/MenuPanel at all. Round 1's "two" was exhaustive. Opaque-branch fidelity confirmed against what `Glass` itself draws: fill, edge, radius and a constant hairline border all match.
> **Minor gap:** `Glass` always draws a specular top lip; the lookalike `View` never does. Since the gate requires `tier === 'native'`, on the opaque tier the sheet's close button renders through the lookalike *permanently* — so that one control lacks a highlight every other `clear` IconButton shows.
> **Major gap: zero automated coverage of the actual fix.** Nothing renders `BottomSheet`/`IconButton` and asserts `glass` is false during entrance and true after settle. If someone reverts `glass={showGlass}` to a bare `glass` six months from now, every existing gate stays green.
> **Minor:** the new `glass?: boolean` is in neither the spec's `IconButtonProps` block nor the style guide's F2 row.
>
> **Fix 3 — the exact round-1 bug is fixed; the guard still has real, easy bypasses.** Confirmed empirically against the shipped regex: **any non-literal size is entirely invisible** — `size={someVar}`, `size={ICON.lg + 4}`, `size={20 as number}` all produce zero matches, and this is live, not hypothetical: `app/welcome.tsx:319` already has a computed `size={Math.round(...)}`, unguarded today. And **any literal `>` between `<Feather` and `size={` breaks the match for the whole tag** — confirmed for a comparison in an earlier prop, a label string containing `>`, and a block comment. All ordinary React code, not contrived. Same class of defect that got a Critical last round, different vector. **Major.**
>
> **Fix 4 — the round-1 repro is fixed; a narrower bypass remains.** Splitting `width: 56` and `height: 56` across two object literals combined in a style array defeats brace-range pairing (`offenders: []` in both repros). More deliberate than round 1's case, so Minor, but real.
>
> **Fix 5 — confirmed.** I grepped the whole tree for any remaining `borderWidth:` ternary keyed on tier/showGlass/showFieldGlass and found none; this class of RT defect looks fully closed.
>
> **Fix 6 — both verified against real parents and both tiers; no new collision.** `wellRecessed` is legitimately distinct from `surface` in both themes; `badgeFlat` likewise on the opaque tier, and on the native tier the background is real blurred glass so there is no flush risk. The sibling `AssignmentCard` is `bg-surface` — no badge-on-badge collision introduced. **Minor note:** the style guide describes `wellRecessed` as "a track things sit inside", and the callout is an action-holding card, not a track — the choice fixes the contrast bug correctly but stretches the ladder's stated semantics.
>
> **Fixes 2 and 7 — confirmed**, the latter now byte-identical in form to all four sibling Fab screens.
>
> **Style-guide claims check out.** F5 names both Chip surfaces; F6 lists exactly three Badge tones including `negative`, matching §5's requirement verbatim. Neither has a call site today — still structurally dead, but *sanctioned* dead code per the written standard. Recorded as a legitimate call, not overturned.
>
> **Process note:** all seven fixes and the entire S1–S7 migration are uncommitted, sitting on top of the single committed S0 (`0f3de6e`). The gate cannot really open until this lands somewhere durable.

## Reduce Transparency pass (spec §5.10)
Re-run after the first attempt's arm was found never to have taken effect. **9 of 11 probes PASS, one real defect.**

> **Proof the toggle actually applied** — the step missing last time. The switch's accessibility value went `0 → 1`, and every glass surface flipped to its exact token fallback: MenuPanel `(249,250,255) → (255,255,255)` = `lightColors.surface`; `clear` surfaces → `(234,238,244)` = `surfaceAlt`; `tinted` → `(47,107,221)` = `primaryFill`. Toggling back off reproduced the original pass with **zero frame diffs and identical fills**, so the toggle demonstrably drives the change in both directions. Two independent RT-on runs agreed to 0.01pt, so nothing below is jitter.
>
> Frames identical under RT for: Fab, IconButton lg, IconButton md clear, both Chip states, BottomSheet (all 41 elements), ScreenHeader, Badge. Frames shifted for: IconButton md tinted (−0.33pt), IconButton sm (−0.33pt), MenuPanel (−0.67pt).
>
> **The defect, one line — `Composer.tsx:142`:** `borderWidth: showFieldGlass ? 0 : StyleSheet.hairlineWidth`. The composer field is the only glass-adjacent surface that makes `borderWidth` conditional; every other family keeps the hairline unconditionally and swaps only `borderColor` to transparent, which is exactly why those three are pixel-identical. Confirmed optically as well as through accessibility: scanning a pixel column, the field's visible top edge sits at 734.00pt with RT off and 733.33pt with RT on. Its bottom is pinned, so the top rises, its flex-end children inset by a hairline, and the MenuPanel above is displaced the full 0.67pt with its own geometry untouched. One to two device pixels, invisible in practice, but a deterministic violation of §5.10 as written and the only one.
>
> **Legibility under RT: nothing became illegible, and two things improved.** The sheet's close disc — which on the native tier is nearly indistinguishable from the sheet behind it, both reading 239,241,242 — becomes a clearly bounded grey disc, and the composer "+" separates from the white field beside it.
>
> **Scope note:** `Badge` is not a glass family at all — it imports neither `Glass` nor `useGlass`, so its RT invariance is structural rather than something the toggle tested. The `Chip` probes were the glass `canvas` variant; the `content` surface is flat by construction and was not exercised. The tab bar was not used as a probe.

## Review
Round 1 — **verdict:** REQUEST-CHANGES

> Verified the gates myself before reviewing: typecheck clean, lint clean, 116 suites / 1954 tests, scenario count 1124 (meets the bar exactly). I did not re-litigate the QA findings; everything below is new. **Two blocking defects, both user-visible, both provable from the code, and both structurally outside what either QA round or the sim pass could have caught. The abstraction itself is sound — my design criticisms are non-blocking.**
>
> **B1 — The S7 sort puts three ladder tokens directly on the canvas, and they vanish in dark mode.** The ladder defines `wellRecessed` and `badgeFlat` as darker than `surface`. That works when they sit inside a card. Four sites now place them directly on `bg`: the onboarding page dots (`welcome.tsx:187`), `CardVisual`'s illustration disc (`:316`), `AccountFlowProgress`'s not-yet-reached dots (`index.tsx:4583`) and the statement-scan progress **track** (`:3216`). Against dark `bg` `#0E1116`: `surfaceAlt` was **1.230:1**, `wellRecessed` is **1.022:1**, `badgeFlat` **1.043:1**. 1.02:1 is not "subtle", it is gone. Two of them carry information — the page indicator stops indicating, and the progress bar loses its track so you can no longer see how much is left; only the filled segment survives. In light mode all four are unchanged, because light `wellRecessed` *is* the old light `surfaceAlt` — which is exactly why nothing caught it: §4 S7 says "Dark is a no-op visually… the sim pass is in light", and the sim pass was run in light. **The premise is inverted for these four sites: light is the no-op, dark is the regression.** QA round 1 found the adjacent failure mode (flush *inside* a Card); this is the mirror image and was never swept for.
>
> **B2 — `MenuPanel` clips its own drop shadow; `ContextMenu` loses the elevation it shipped with.** `MenuPanel.tsx:51` puts `overflow: 'hidden'` on the outer View and `:68` puts `c.elevation.overlay` on the inner one, which is the same size. On iOS `overflow: 'hidden'` sets `clipsToBounds`, which clips subviews' layer shadows — so it never renders, on either tier, in either theme. That is a regression, not a no-op: the pre-existing `panelStyle` at `0f3de6e` applied the elevation on the same view as its radius with no clipping. Compounding it, the border went from `1` to `hairlineWidth`. Net effect in light mode: a floating white menu on a near-white canvas, previously separated by a 1px border **and** a 16pt shadow, now separated by a 0.33px hairline and nothing else. Not fixable by moving the elevation outward — a layer with `clipsToBounds` doesn't draw its own shadow either.
>
> **Non-blocking, substantive.** `mayMountGlass` has one caller while `ScreenHeader`, `Composer` and `MenuPanel` each still inline the same decision — the file's stated purpose holds for one site in four. `Chip surface="content"` **is not dead API**: `index.tsx:3996-4014` and `:4112-4130` are that component in all but name, duplicated verbatim, hand-patched by S7 rather than migrated by S3 — so the answer is to use the variant, not delete it. `accessibilityRole="button"` is missing on `Fab`, `IconButton` and `Chip`, so VoiceOver announces the FAB, Send, every sheet close and every filter pill without the button trait — not a regression, but consolidating 13 sites into 5 components is the moment when fixing it costs five lines. `Chip` has no pressed feedback at all. **`maskComments` desyncs on an apostrophe** and it is happening today (`backups.tsx:278` "Apple's iCloud" desyncs to EOF; eight line comments in `index.tsx` survive masking) — it fails toward false positives so the teeth are intact, but the trigger is "someone typed *Don't* in a `<Text>`", which is precisely the confusing future false positive. Scenarios 1 and 2 scan raw source while everything else scans the masked copy. `SegmentedControl compact` ships a 32pt target under the guide's own 44 floor. **`Badge`'s `letterSpacing: 0.09` is almost certainly an em→pt mix-up** — RN reads it as 0.09 points, visually zero at 11pt, replacing `tracking-wide`'s ~0.225pt, so a change meant to standardise tracking reduced it ~60%. `Badge` scales with Dynamic Type while the row title it annotates does not, so at AX sizes the badge outgrows the payee name.
>
> **What holds up well.** The `Fab` consolidation is the cleanest part — five identical inline copies gone and the token can no longer drift. `Chip` keying its Glass on `selected` rather than swapping `material` is the right reading of R5. `IconButton`'s lookalike matching `Glass`'s opaque output down to the specular lip and an unconditional `borderWidth` — so flipping the prop can't reflow — is careful work, and the Composer fix shows the lesson was generalised rather than patched. On `glass?: boolean`: keep it as a prop. The two call sites are structurally different — one passes a live gate, the other a permanent `false` because a raw Modal has no settle signal — and the wiring guard already catches the realistic regression. The gap isn't the prop, it's that the predicate it should be gated on isn't the one three other components use.

_pending_

Round 2 — **verdict:** APPROVE-WITH-NITS

> Gates re-verified on my own run: typecheck clean, lint clean, 116 suites / 1955 tests, scenario count 1125. **Both blockers are genuinely closed, not moved.** I re-derived each from the code rather than from the comments. The fix round introduced one real (latent) defect and one type-safety regression — neither blocking.
>
> **B1 — closed correctly, and the sweep holds.** `controlRaised` dark `#1F2530` restores exactly the 1.230:1 these had before the sort — the same value, so this is a true revert rather than a new compromise. I did not take the sweep on trust: I re-enumerated every remaining `wellRecessed`/`badgeFlat` use (16 sites) and traced each to its nearest background ancestor; all sit on `surface`, a card or a sheet. I also checked the generalisation of the byok bug across all five `SegmentedControl` call sites — the other four were already wrapped. The byok find is the right catch and, more importantly, the right *shape* of fix: the component's `wellRecessed` track is correct per F7, and the bug was one call site skipping the card wrapper every sibling uses. Fixing the caller rather than the component is what keeps F7 true.
>
> **B2 — closed, diagnosis fully honoured.** Three layers, with the inner one now carrying the same radius, which closes the secondary artifact. The comment states the constraint correctly, including that moving the elevation outward fails if the outer is also the clipper — the part most likely to be got wrong on a re-read, and it wasn't. **On the tier split: I agree, and more strongly than you framed it. It isn't a judgment call, it's R4** — "no painted depth on glass" — so when the panel Glass mounts, the shadow *must* go. And the gating is precisely right in the case that matters: `point` mode never passes `glass`, so it keeps its shadow on **both** tiers, which is what makes this an actual fix for the control that regressed rather than a native-tier-only patch.
>
> **F1 (substantive) — `measured: unknown` reopens the hole the predicate exists to close.** `unknown` accepts `undefined`, and `undefined !== null` is `true`, so `mayMountGlass({ tier, measured: someRef.current })` type-checks and returns "mount now" while unmeasured — the exact R9 bug, with the type system no longer objecting. Confirmed at runtime. Not reachable today, since all four callers use `useState<T | null>(null)` — but generalising the type was the whole point of the change, so a fifth caller is now expected, and the scenarios only exercise `null`, never `undefined`. **This is the pattern you asked me to watch for: the fix round's own change reopened the property its file was extracted to protect.**
>
> **F2 (latent) — the masker now eats code after a single-quoted `//`.** Dropping `'` fully closes the apostrophe desync (verified tree-wide: zero surviving comments, zero unterminated states). The trade is that `const href='https://x.co'` now starts comment-masking and the rest of the line vanishes — a false *negative*. Zero exposure today. Worth flagging because the failure direction inverted: round 2's masker failed toward false positives — loud, annoying, safe. This one fails toward the silent class both prior rounds escalated to Critical/Major.
>
> **F3/F4 (nits).** Scenario 6 is now the only scan that doesn't mask, and it is arguably the likeliest to bite. And the ladder's root cause still isn't in the binding standard: the guide describes these rungs purely by role, with no statement that they are defined relative to `surface` and invert against the canvas. B1 was found by review, not by any gate, and nothing in the repo now stops a sixth site.
>
> **Judgment calls: all three accepted.** The `settings.tsx` reasoning is correct and I'd have made the same call — light `controlRaised` is `#FFFFFF`, identical to the row's own `bg-surface`, so a selected row would be invisible in light; that beats the S7 heuristic. But **accept the decision, reject the record**: there is no comment at either site and nothing in either doc, and the reasoning is exactly the non-obvious kind the next person will "fix" by applying S7's stated rule. Not folding the `TextInput`s into `Input` is **accepted with no caveat** — the right instinct and the correct read of the working agreement; properly deferred rather than silently skipped, and the model for how the other two should have been handled. The 14 icon discs as a follow-up is accepted: the spec names it, quantifies it, and admits the consequence out loud.

## Verify
Run by me in the worktree, not claimed by an agent:

```
npm run typecheck   clean
npm run lint        ESLint: No issues found
npm test            Test Suites: 116 passed, 116 total
                    Tests:       1958 passed, 1958 total
npm run eval        Overall: 21/32 (65.6%)   Fail-to-parse: 7/7 (100.0%)
                    PASS — at or above baseline (65.6%), no case regressed.
```

Scenario count 1128, against a baseline of 1108 at `e6097f2`.

Beyond the suite, I mutation-tested the three guards this run depends on, because a guard that cannot fail is worse than no guard:

| Guard | Mutation | Result |
| --- | --- | --- |
| Icon-size scan | revert to line-bounded matching | regression scenario fails |
| `mayMountGlass` | drop the `entered` signal | mid-animation scenario fails |
| Icon allowlist | compare all 30 budgets to true counts | exact, zero slack, no unallowlisted offenders |

**Commit shape.** The run was asked to land S0 first, then S1–S6, then S7. S0 went in on its own as `0f3de6e`, which is where the value of that ordering lay — the guards landed before the work they police. The S1–S6 / S7 boundary did not survive: four fix rounds later, 49 of 144 diff hunks change a component and its tokens together, so the two cannot be separated at hunk level. A split by file is worse, not better — the S0 guards scan the screens, so an S1–S6-only tree still contains live `surfaceAlt` sites and fails its own gate. Rather than hand-carve an intermediate no gate has run against, or knowingly commit a red tree, S1–S7 lands as one commit.

_pending_

## Build
**Beta build 108** — archived from `71ba8eb` on `claude/liquid-glass-ui`, installed on Pigu.

- Scheme `ProjectXavierBeta`, configuration `Beta`, `EXPO_PUBLIC_METRICS=1`
- `CFBundleVersion` 108 on both the app **and** `XavierWidget.appex` (verified before install — a mismatch there is the failure mode worth checking)
- `CFBundleIdentifier` `com.projectxavier.beta`, marketing version 1.1.3
- Installed via `devicectl` (direct install, not TestFlight)

The first install attempt failed with `CoreDeviceError 1011` — the device was
paired but `unavailable`. Nothing was rebuilt; the same archive installed
cleanly once Pigu was reachable again.

_pending_

### Soak builds after 108
- **109** — softened the modal sheet scrim after device feedback that the backdrop read as a black slab. The flat `rgba(0,0,0,0.55)` became a theme token (0.25 light / 0.45 dark); the test pins the relationship, not the values. The existing tokens-to-CSS-vars invariant caught the token being added without its `--color-*` var, which would have resolved to `undefined` at runtime.
- **110** — two device reports: the account screen's floating "as of <day>" balance bar was absolutely positioned at `top: insets.top`, covering the back button (it was `pointerEvents="none"`, so the button still worked and only the look was broken); and searching the ledger left the Upcoming strip unfiltered, so a payee search hid every unrelated transaction while still listing every imminent recurring charge. Both lists now match through one predicate, and the selection moved into `src/domain/searchMatch.ts` — the bug was a missing call rather than a wrong rule, so a predicate test could not catch it. Verified by deleting the filter and watching the suite stay green; with the selection in the domain, the same deletion fails a scenario.
- **111** — same code as 110, renumbered so it would not install over the device as a downgrade once the store train took 94.

## Store release
**1.2 (95)** uploaded to App Store Connect — `UPLOAD SUCCEEDED`, delivery UUID `8e92e033-4dd1-4b9f-9b46-9236938e977e`.

1.1.3 undersold the train, which carries the glass standard adoption, the composer rework, chrome adoption and four rounds of review fixes — so the release went out as 1.2. **1.1.3 (94)** had already been uploaded (delivery UUID `91d91f2e-be57-449e-a173-2312182c2d78`) and is now an orphan: a build's version string is fixed at archive time, so 1.2 needed its own build, and 94 sits unattached against a version record that will never exist. Harmless, and deletable from the builds list.

`main` was fast-forwarded to the branch first (`92f45d4`), so what is on main is exactly what shipped — closing the drift that let builds 52–59 go out without main's safety fixes. The build number follows the ASC train (highest was 93), not the local one: 99–111 were soak builds on `com.projectxavier.beta`, a bundle ASC never sees. 1.1.3 opens a new version train, which a released 1.1.2 requires.

Verified before upload, not after: app 1.1.3/94, widget appex present and also 94 (a mismatch there is what gets builds rejected), App Group on both binaries, Apple Distribution signing under team CFVNU6RD8C with `get-task-allow` false, iCloud container Production.

**Process note.** The version bump and signing check were first run without a `cd` while the shell had reset to the main repo, so they hit the wrong project. Nothing was damaged — that repo's build number is 47 and its plist 51, so every `sed` pattern matched nothing — but the edits had not happened and the signing reading was from the wrong `project.pbxproj`. Both were redone in the worktree and re-verified before the archive.

## Result
_pending_

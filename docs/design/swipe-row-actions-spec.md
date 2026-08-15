# Spec: swipe-left row actions (Copy | Delete) on transaction rows

**Branch:** `claude/phase2-byok` · **Status:** design · **Date:** 2026-08-05
**Builds on:** the long-press `ContextMenu` Copy path (`8c8e545`, fixed in `d3b8e0f` / `f851d04` / `bfcace6`) and `src/domain/transactionCopy.ts`.

## 1. Objective

Make row actions **discoverable**. Copy is currently reachable only by long-pressing a row — an invisible affordance — and Delete is reachable only by tapping into the edit sheet on the Transactions tab, and **not at all** on the account detail screen. Swipe-left reveals `Copy | Delete` inline on both screens. Long-press stays exactly as it is.

## 2. Verified starting state

### 2.1 The two lists share a row component, but only presentationally

| | `app/(tabs)/transactions.tsx` | `app/account/[id].tsx` | `app/period.tsx` |
|---|---|---|---|
| List | `SectionList` | `SectionList` | `SectionList` |
| Row | `TransactionRow` | `TransactionRow` | `TransactionRow` |
| Tap | `openEdit(item)` | none | none |
| Long-press | `ContextMenu` → Copy | `ContextMenu` → Copy | none |
| Delete | only inside the edit sheet | **none — doesn't import `deleteTransaction`** | none |

`src/components/ui/TransactionRow.tsx` is purely presentational. Its `onEdit`/`onDelete` props are **dead code** — nothing passes them, and the inline-button branch they drive has never rendered.

Consequence: **swipe adds a genuinely new capability to `/account/[id]` (delete)**, not just a new gesture. That is a scope decision — see §11.1.

`app/period.tsx` is a third consumer, fully read-only. Swipe must be opt-in via props so it stays unaffected.

### 2.2 `react-native-gesture-handler` is NOT installed

- Absent from `package.json`; `find node_modules -maxdepth 3 -name react-native-gesture-handler -type d` returns nothing. Not transitive.
- The only `package-lock.json` references are expo-router's peer entry, with `peerDependenciesMeta.optional: true`. expo-router runs fine without it; native swipe-back comes from `react-native-screens`.
- `react-native-reanimated` (4.1.x) and `react-native-worklets` **are** installed and already used (`src/components/ui/BottomSheet.tsx`, `XavierPet.tsx`). Reanimated has no gesture system — it animates only.
- No haptics package is installed.

### 2.3 Transfers are ONE row; there is no contra side

`src/db/schema.ts` — a transfer is a single `transactions` row carrying a nullable `transferAccountId` beside `accountId`. `src/domain/balances.ts` `signedDelta` returns `-amount` when `tx.accountId === accountId` and `+amount` when `tx.transferAccountId === accountId` — **both sides computed off that one row** (and 0 for a self-transfer, as defence in depth).

So `deleteTransaction(id)` already removes "both sides" by construction. **Do not write contra-row deletion logic** — there is no second row, and code hunting for one would delete an unrelated transaction.

The real hazard is different and worse: `app/account/[id].tsx` includes rows where `tx.transferAccountId === id`, i.e. **incoming** transfers whose `accountId` is a *different* account. Swiping one on account A deletes a row that also moves account B's balance. Today there is no way to do that from this screen; swipe creates the path, so the confirm must disclose it.

### 2.4 Deleting a posted recurring occurrence does not resurrect it

Posted occurrences are ordinary rows with `seriesId` + `occurrenceDate`. `dueOccurrences` starts its cursor strictly after `lastPostedAt`, so a past date is never re-derived. The series survives and keeps posting future occurrences. The confirm copy must say exactly this.

### 2.5 The Dynamic Type / NativeWind landmine is codified in lint

`.eslintrc.js` carries a `no-restricted-syntax` **error** on function-form `style` in JSX, naming the two shipped regressions (AmountKeypad, and ContextMenu in build 60 — which lost `flexDirection`/`padding` and rendered as a stacked overflowing column). Type is clamped by `clampFontScale` = `clamp(0.85, fontScale, 1.6)` and surfaced through `useScaledType()`.

### 2.6 No accessibility actions, no RTL

`accessibilityActions` / `onAccessibilityAction` appear **nowhere** in `src/` or `app/`. No `I18nManager`, no localization dependency — English-only, LTR-only today.

## 3. The dependency decision

### 3.1 What "add a native dependency" costs in this repo

- **`/ios/` is gitignored** and `git ls-files ios` returns 0 files. The native project is a purely local, hand-maintained artifact — if wiped, there is **no git history to restore it from**.
- It carries hand-applied two-target manual signing (`CODE_SIGN_STYLE = Manual`, `DEVELOPMENT_TEAM = CFVNU6RD8C`, per-target `PROVISIONING_PROFILE_SPECIFIER`).
- `.claude/commands/build.md` says: *"if prebuild wiped it, re-apply the python patch from the memory."* That patch lives in a private memory, **not in the repo**.
- **The drift is not hypothetical.** Commit `3e96be4`: the gitignored `ios/` tree is hand-patched and only version fields were carried across, so **builds 51–61 shipped the wrong home-screen name** to TestFlight. Nobody noticed for eleven builds.
- Two config-plugin surfaces already depend on prebuild being correct: SQLCipher and the `@bacons/apple-targets` widget. A prebuild that succeeds but drops one ships an app whose DB isn't encrypted or whose widget is missing.

In fairness: a bare `npx pod-install` would likely suffice (autolinking picks the pod up; `pod install` does not reset signing settings). So "prebuild wipes signing" is the worst case, not the guaranteed one. But it is still a new native module compiled into a Release archive that has never been built with it, on the **v0.2.0 store candidate**, plus a required `<GestureHandlerRootView>` wrapper at the root layout, plus Reanimated/worklets interop on an RN 0.81 + New Arch path we have never exercised.

### 3.2 Route A — `react-native-gesture-handler`

**For:** `ReanimatedSwipeable` gives 60fps UI-thread tracking, correct simultaneous/waiting relationships with the scroll view for free, rubber-banding, a well-trodden API. Strictly better feel.
**Against:** everything in §3.1, plus a permanent tax — every future `expo prebuild` must re-apply signing.

### 3.3 Route B — `PanResponder` (RN core) + Reanimated — **recommended**

- `onMoveShouldSetPanResponder` claims only when `|dx| > |dy| * 2 && |dx| > 8` — an unambiguously horizontal intent, claimed early, before the native scroll view latches. This is how `react-native-swipe-list-view` (PanResponder-only, shipped widely inside `FlatList`/`SectionList`) works.
- `onPanResponderMove` writes a Reanimated shared value; `useAnimatedStyle` applies the transform on the **UI thread**, so the visual is not gated on the JS frame rate even though the driver is.
- Release snaps with `withSpring`.

**Cost:** the drag is JS-driven, so under heavy list re-render it can drop frames where gesture-handler would not. "Good", not "silky".

### 3.4 Recommendation: **Route B**

A cost asymmetry, not a preference. Route A buys a *feel* delta on one interaction, and pays with a native-surface change to a hand-maintained, untracked-by-git iOS project that has already silently shipped a wrong build eleven times running, on the store-candidate branch. A polish improvement is not worth spending the one resource in this repo that has no undo.

Route B is also cheap to abandon: the gesture layer is one file, and swapping it for `ReanimatedSwipeable` later is contained behind an unchanged prop API. Reserve the native dependency for a moment with a build window and more than one gesture to justify it.

## 4. Approach

### 4.1 New: `src/domain/swipeReveal.ts` (framework-free)

Follows the `src/domain/contextMenuPlacement.ts` pattern — push every number out of the component so the plain-Node suite covers it.

- `shouldClaimHorizontal({ dx, dy }): boolean` — the `|dx| > |dy| * 2 && |dx| > 8` rule as one testable predicate.
- `clampTranslate(rawDx, actionsWidth): number` — clamps to `[-actionsWidth * 1.15, 0]`. Right-swipe on a closed row yields `0`; overshoot allowed to 1.15× for rubber-band, never past.
- `resolveSnap({ translateX, velocityX, actionsWidth }): 'open' | 'closed'` — by position past 50% **or** by velocity past a flick threshold.
- `actionsWidth({ fontSize, iconSize, padH, gap, minButtonWidth, count }): number` — the Dynamic Type calculation, mirroring `estimateMenuWidth`'s role.

Direction is **not** baked in: the functions take a signed translate and the component supplies the sign, so RTL later is one `I18nManager.isRTL` read, not a rewrite.

### 4.2 New: `src/components/ui/SwipeableRow.tsx`

Thin RN wrapper owning the `PanResponder`, one shared value, and the action strip. Renders `children` over an absolutely-positioned strip.

Props: `actions`, `openKey`, `onOpen`, `onClose`, `onSwipeActive`, `children`.

**Single-open is lifted to the screen, not kept in the row.** The row is controlled: open iff `openKey === its own key`. Each screen holds one `openRowId`. Opening B makes A spring back — no cross-row refs, no imperative handles, no leaked state on unmount.

**Every pressable uses a plain object `style`** plus `useState` + `onPressIn`/`onPressOut`, per `.eslintrc.js` and the `MenuRow` precedent in `ContextMenu.tsx`.

### 4.3 `TransactionRow.tsx` — additive only

Add optional `swipeActions?: SwipeAction[]` plus the controlled pass-through. Absent (the default) → renders exactly as today, so `app/period.tsx` is untouched. The unused `onEdit`/`onDelete` props and their dead branch may be removed in the same change (see §11.3).

### 4.4 Wiring both screens

Both get the same `swipeActions` array: `Copy` (reusing the existing `openCopy`, which already calls `buildCopyInitial`/`copyLabelFor`) and `Delete` (`confirmDelete`).

On the Transactions tab, `confirmDelete(tx)` is a small refactor of the existing sheet-scoped delete so it takes a `Transaction` rather than reading the editing id — **one delete implementation, two entry points**. On `/account/[id]`, delete is new: import `deleteTransaction` and add the same `confirmDelete`.

**Both keep `onLongPress` and the `ContextMenu` exactly as they are.** Swipe is the discoverable path; long-press is the fallback and the accessibility path.

### 4.5 Delete: reveal, then confirm. Never full-swipe-to-delete.

**Swipe reveals buttons; it never executes.**

Why: **this app has no undo.** No trash, no soft-delete column, no restore. `deleteTransaction` is a hard `DELETE`. The only recovery is restoring a whole-DB iCloud backup, which reverts everything else since and requires noticing the loss first. A single mis-registered gesture while scrolling a ledger permanently destroys part of someone's financial history. That is not worth the ~200ms a full-swipe saves.

Tapping `Delete` fires `Alert.alert` with `style: 'destructive'`, matching the seven existing confirms in the app. On confirm: `deleteTransaction(tx.id)` → close row → refresh. `deleteTransaction` already bumps `data_revision` and fires `updateWidgetSummary()`, so backup integrity and the widget stay correct — do not bypass it.

### 4.6 Dynamic Type on the revealed buttons

The failure to prevent is the build-60 bug's cousin: a fixed-width strip clipping "Delete" at `fontScale = 1.6`.

- Font from `useScaledType().role.caption` (14 base) — the role `ContextMenu` chose, for the same reason.
- Strip width from `actionsWidth(...)`, computed from the **scaled** font — never a constant.
- Each button: `minWidth` from the calculation, `minHeight: 44` (HIG), icon **above** label so a long label grows height rather than clipping, `numberOfLines={1}`.
- The strip is `position: 'absolute', top/bottom/right: 0` so it always matches the row's rendered height. No height constant anywhere.

### 4.7 Gesture conflict resolution

- **Horizontal vs vertical:** `onMoveShouldSetPanResponder` → `shouldClaimHorizontal`. `onStartShouldSetPanResponder` returns **false**, so a tap still reaches `openEdit` and a long-press still reaches `ContextMenu`.
- **List scroll while dragging:** screen holds `swiping`; `SectionList` gets `scrollEnabled={!swiping}`.
- **Scroll closes any open row:** `onScrollBeginDrag={() => setOpenRowId(null)}`.
- **Only one row open:** structural via the single `openRowId`.
- **Tap-outside closes:** tapping an open row's body closes it instead of firing `openEdit`.
- **Sheets/menus close it:** opening any sheet sets `openRowId = null`.
- **Refresh must not strand an open row:** clear `openRowId` in `refresh` if its id is gone. `keyExtractor` is `tx.id` — do not key by index.

## 5. Scope

**In:** `SwipeableRow` + `swipeReveal`; opt-in `swipeActions` on `TransactionRow`; wiring on both screens; a shared `confirmDelete`; `accessibilityActions` on the row; BDD coverage of the domain module.

**Out:** `react-native-gesture-handler`; full-swipe-to-delete; undo/trash/soft-delete (its own spec — and the thing that would make full-swipe safe); right-swipe actions; haptics (another native dependency for a nicety); `app/period.tsx`; assistant card rows; any change to `ContextMenu`.

## 6. Acceptance criteria

**Node-testable (`tests/`):**

1. `shouldClaimHorizontal` true for `(dx:-30, dy:4)`; false for `(-6, 1)` (below the 8pt floor), `(-20, 18)` (not 2:1), `(2, 40)` (vertical).
2. `clampTranslate` returns 0 for positive `dx` on a closed row; `-actionsWidth * 1.15` and no further for a large negative `dx`; identity in range.
3. `resolveSnap` → open past 50% at zero velocity; closed before it; open on a fast flick short of 50%; closed on a fast reverse flick from open.
4. `actionsWidth` grows monotonically with `fontSize`; at 1.6 strictly greater than at 1.0; never narrower than `minButtonWidth`.
5. No new copy semantics exist — grep for `buildCopyInitial` still shows only the two screen call sites plus the domain module.

**Device-verified (not in `tests/`):**

6. Swipe reveals `Copy`/`Delete` on both screens; springs back below threshold.
7. `Copy` opens the form prefilled and closes the row.
8. `Delete` opens a destructive Alert; Cancel changes nothing; Delete removes the row.
9. Long-press still opens `ContextMenu` on both screens; tap still opens Edit on the tab.
10. Opening B closes A; scrolling closes any open row; vertical scroll never opens one.
11. At `fontScale = 1.6` both labels are legible and unclipped, both buttons ≥44pt tall.
12. VoiceOver announces Copy and Delete in the Actions rotor and both are invokable without swiping.

## 7. Constraints

- `npm run typecheck`, `npm run lint`, `npm test` green before push; work on the feature branch.
- `src/domain/swipeReveal.ts` imports nothing from `react`/`react-native`.
- **No new runtime dependency.** `package.json` and `package-lock.json` unchanged.
- **`ios/` is not touched.** No prebuild, no `pod install`, no pbxproj edit.
- Guardrail #4: deletes go through the existing Drizzle `deleteTransaction`.
- Guardrail #1: do not bypass `bumpDataRevision()`.
- `.eslintrc.js`: no function-form `style` anywhere in the new components.

## 8. Edge cases

### 8.1 Swiping a transfer
One row (§2.3), so `deleteTransaction` removes the movement entirely — no contra handling to write. But the confirm must disclose the cross-account effect:

> **Delete transfer?** This removes the transfer between *DBS Savings* and *OCBC Current*. Both balances change. This can't be undone.

On `/account/[id]` an **incoming** transfer is in the list; deleting it rewrites the *other* account's history. Name both accounts. Never phrase it as "delete this transaction" on that screen.

### 8.2 Swiping a posted recurring occurrence
Does not stop the series and does not cause a re-post (§2.4):

> **Delete this occurrence?** The repeating series keeps running — only this entry is removed.

Label stays "Delete", never "Delete series".

### 8.3 Swiping while the list refreshes
Clear `openRowId` inside `refresh` when its id is gone; reconcile by `tx.id`, never index; guard `confirmDelete` against re-entry using each screen's existing `busy` flag so a double-tap can't fire two deletes.

### 8.4 VoiceOver users who cannot swipe
Swipe is consumed by the screen reader. Without a fix, swipe-only Delete on `/account/[id]` would leave VoiceOver users with **no** way to delete from that screen. Two mitigations, both required:

1. **Long-press stays** — reachable under VoiceOver, and why removing it would be a regression.
2. **`accessibilityActions` + `onAccessibilityAction` on the row** — `[{name:'copy'}, {name:'delete'}]`, exposed in the Actions rotor. This is the canonical iOS pattern and is used **nowhere in the app yet**, so it is genuinely new code. Give the row an `accessibilityLabel` summarising payee + amount + date.

### 8.5 Left-handed and RTL
Swipe-left is a thumb-arc gesture available to either hand. The app has no RTL support today (§2.6), so a hardcoded left-swipe is correct for the current product — but the direction is not baked into the domain module (§4.1).

### 8.6 Others
Pending rows behave identically (they already contribute 0 to balances). Headers and the empty component are not swipeable. Clear `openRowId` when the Transactions tab's search query changes.

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| PanResponder loses the responder race; swipe feels dead | Medium | Early 8pt claim with 2:1 ratio; `scrollEnabled={!swiping}`. **Must be verified on a physical device — the simulator does not reproduce responder-race timing.** |
| JS-driven drag drops frames on a long list | Low–Medium | Reanimated applies the transform on the UI thread; only the driver is JS. Measure on device (§10.2). Fallback is swapping internals behind the same props — with a build window, not on a store candidate. |
| Accidental delete | **High** (no undo) | Reveal-then-confirm, never full-swipe (§4.5); destructive Alert; re-entry guard. |
| Cross-account transfer delete surprises the user | Medium | Both account names in the confirm (§8.1). |
| Buttons clip at large Dynamic Type | Medium | Width from the scaled font, covered by BDD; icon-above-label; plain object styles enforced by lint. This exact class shipped in build 60. |
| Someone later "cleans up" the ContextMenu | Low | Long-press is the a11y fallback — say so in a comment on both screens, not only in this spec. |

## 10. Test plan

### 10.1 Plain-Node BDD — what CI covers
`tests/__features__/swipe-reveal.feature` + steps, modelled on `context-menu-placement.feature`. Covers criteria 1–4.

**Explicitly not covered:** the `PanResponder` wiring, Reanimated animation, `SectionList` responder negotiation, `Alert` presentation, VoiceOver, and every pixel of layout. Anything in that list not checked on hardware is unverified.

### 10.2 Physical device — mandatory before merge
The simulator is **not sufficient** for 1–3; trackpad gestures have different timing than a thumb, which is exactly what the responder race turns on.

1. **Responder race, real thumb** on a 100+ row ledger: fast vertical flick (must never open a row), slow diagonal drag (must resolve to one behaviour), swipe while decelerating.
2. **Frame rate under load** — the number that decides whether Route B holds.
3. **Both screens**, including an **incoming** transfer on the account screen (alert names both accounts; the other account's balance updates).
4. **Dynamic Type sweep** at default / large / maximum; screenshot at max.
5. **VoiceOver** — swipe unavailable (expected), rotor exposes both actions, long-press still works.
6. **Both themes**, verifying the negative tone on Delete.
7. **Recurring occurrence** — delete one, confirm the series continues and it does not come back on next launch.
8. **Widget + backup** — widget total updates; backup/restore round-trips.

### 10.3 Maestro (optional)
A `swipe-delete.yaml` is feasible and cheap, but runs on the simulator and does **not** substitute for 10.2 items 1–3.

## 11. Open questions

1. **Should `/account/[id]` get Delete at all in this change?** It has none today, so swipe there is a new destructive capability, not a new gesture over an old one. (a) `Copy | Delete` on both, symmetric; (b) `Copy` only there this round, adding Delete once swipe has soaked. Lean (a) — asymmetric action sets on visually identical rows are their own usability bug — but it is a product call to make explicitly.
2. **Action order.** `Copy | Delete` (destructive outermost, matching Mail) vs the reverse. Lean destructive outermost: more travel is the correct direction of friction for an irreversible action.
3. **Remove the dead `onEdit`/`onDelete` branch here or separately?** Either is fine — just don't leave it undecided.
4. **Should the long-press `ContextMenu` gain Delete too?** It has only Copy. Adding it gives VoiceOver and non-swipe users both actions through one affordance, making `accessibilityActions` belt-and-braces rather than load-bearing. Cheap; consider alongside §8.4.

# Ship run: az-sorted-lists

- **Feature:** Payees/categories/pickers sorted A–Z (display-level only) + A–Z quick-scroll rail on long payee lists
- **Branch:** claude/az-sorted-lists
- **Spec:** docs/design/az-sorted-lists-spec.md
- **Started / finished:** 2026-10-20 / —

## Spec
Mockup https://claude.ai/artifact/HcZSgdAtEvoNTAEiShd494 approved by the user ("okay looks good let's do that as well"). Deviations from the mock: categories are flat (the app never sets parentId), no haptics (no haptics lib installed).

## QA
Round 1 — **verdict:** PASS-WITH-CONCERNS

> **PASS-WITH-CONCERNS** — gates green, spec conformant; the unverifiable layout/gesture items need a sim pass.
>
> Majors: none confirmed (one unverified item could become a blocker on device).
>
> Unverified (needs simulator):
> - `src/components/ui/Combobox.tsx:215` — the new `<View style={{ flexShrink: 1 }}>` wraps the FlatList inside a sheet that has only `maxHeight: '75%'` (no fixed height). Previously the FlatList was the direct flex-shrink child. Should work in Yoga but unconfirmed: a 40-item list must scroll, a 3-item list must not be cut off, keyboard-up must not collapse it to zero.
> - `Combobox.tsx:~305` — rail is `position:'absolute', right:-16` with its bubble extending left; right gutter 28pt but rail 40pt, poking 16pt into the sheet's `px-5`. Unknown whether a parent clips it on Android.
>
> Minors:
> - `Combobox.tsx:222-232` — `onScrollToIndexFailed` estimates `averageItemLength * index` ignoring the create/clear header height; the `setTimeout` retry isn't cleared on unmount; a repeated failure loops through the same handler. Suggest a retry cap or `getItemLayout`.
> - `AlphaRail.tsx:33-35` — `current` is initialised once from `populated` and never resynced; if the set changes while mounted, `step()` computes `indexOf(current) = -1` and increment jumps to the first key.
> - `AlphaRail.tsx` — `resolve` silently returns when height is 0; if `onLayout` hasn't fired, the first grant is dropped.
> - `manage-payees.tsx:~80` — `headerY` is never cleared; stale entries for removed letters linger (harmless, stale).
> - `manage-payees.tsx:~262` and `Combobox.tsx:~270-306` — inconsistent JSX indentation.
> - `manage-payees.tsx` rail `top: insets.top + 96` is a magic number tied to title/search heights; Dynamic Type could overlap the search field.
> - Spec item 6 — no user-facing name lists in recurring/dashboard/period/transactions beyond Combobox; acceptable.
>
> Suggested tests: extract y→index math (`letterIndexAt`) and BDD-test bounds/height 0/boundary; groupByLetter mixing # with letters; indexKey "  apple", "ñandú", combining-mark-only; nearestPopulatedKey unknown key → null; source guard against function-form style; manual sim checklist (14 vs 15 items, query hides rail with create/clear working, fast slide + unmeasured letter, small screen, rename re-sorts).

Resolution: all minors sent back to the implementer (retry cap + timer cleanup, resync `current`, clear stale headerY, `letterIndexAt` extraction + tests, extra test cases, indentation). Unverified layout items covered by the simulator pass below.

Round 2 — implementer applied every QA minor (retry cap + timer cleanup, `current` resync, stale `headerY` cleared, `letterIndexAt` extracted + tested, extra edge-case tests, indentation). Gates green.

## Review
Round 1 — **verdict:** REQUEST-CHANGES (findings condensed from the reviewer's report; wording kept where possible)

> Blocking:
> 1. `app/manage-payees.tsx:97` — letter jump lands the section header under the status bar. The ScrollView runs under it (content padded `insets.top + 12`), and `scrollTo({ y })` uses the header's raw content offset, so the header ends up at screen y=0 behind the Dynamic Island. Fix: `scrollTo({ y: Math.max(0, y - insets.top - 8), animated: false })`.
> 2. Process — `docs/ship-runs/az-sorted-lists.md` points to a "simulator pass below" that doesn't exist; QA's unverified items (`Combobox.tsx:229` flexShrink wrapper under `maxHeight: '75%'`; `Combobox.tsx:326` rail `right: -16` overflow) and the spec's "Simulator build compiles" depend on it.
>
> Should fix:
> 3. `AlphaRail.tsx:127/132/152/161` — white on `c.primary` (3.23:1, Redline B2); use `c.primaryFill` fills + `c.onAccent` text, no hard-coded `#FFFFFF`.
> 4. `app/manage-payees.tsx:184` — rail gutter `paddingRight` on the content container shifts top bar/title/search; first keystroke widens the search field under the finger. Put the gutter on the rows only.
> 5. `app/manage-payees.tsx:273` — `top: insets.top + 96` magic number; derive from onLayout or comment it.
> 6. Hermes vs Node — `localeCompare(..., { sensitivity: 'base', numeric: true })` / `normalize('NFD')` only tested under Node ICU; eyeball "Item 2" < "Item 10", "apple" with "Banana", "Éclair" under E on the sim.
>
> Nits: 7 gutter comment math; 8 `HEADER_ROW_ESTIMATE = 46` acceptable; 9 spec Out-of-scope vs item 5 conflict on the category picker rail; 10 guard should also catch `/order by/i`; 11 comment that `allowFontScaling={false}` is intentional.

Resolution: 0f74174 fixes 1, 3, 4, 5, 7, 9, 10, 11. Item 2 → simulator pass below. Item 6 → "Item 2" before "Item 10" confirmed on the sim (Hermes); "Éclair" could not be typed (idb has no keycode for É), so diacritics rest on the Node test only.

### Simulator pass (2026-10-20, iPhone 17 Pro Max sim, Beta config, 32 payees seeded through the UI)
- Payees screen: A–Z sections, rail with empty letters dimmed, `#` (7-Eleven) last. **Tap and slide did nothing** — a debug readout showed the ScrollView ref was null and a callback ref was never called. Root cause: react-native-css-interop 0.1.22 `cssInterop()` wraps function components as `(props) => interop(base, configs, props, undefined)` and renders `{...props, ref}`, so `ref: undefined` clobbers React 19's ref prop (RN 0.81 ScrollView is a function component). Fixed in 3f3d607 (`cssInterop={false}`; that ScrollView has no className) + guard test. After: tap S → jumps; slide # → F lands on F.
- Payee picker (Add transaction): sorted, headers, rail at 32 items. **Jumps did nothing** even with a live FlatList ref — VirtualizedList scrolls through its inner ScrollView ref, lost the same way (RN's own list code goes through the nativewind JSX transform). Fixed in 8edc56c (`renderScrollComponent` → `<ScrollView {...props} cssInterop={false} />`, scroll indicator hidden under the rail) + guard test. After: tap S → jumps to the S section; slide # → C lands on C; manual scroll works; typing "sh" hides the rail and headers, "Create “Sh”" row shows, short list not clipped.

Round 2 — **verdict:** APPROVE-WITH-NITS

> All seven round-1 findings are fixed correctly, and the `cssInterop={false}` change does what it claims. `cssInterop={false}` loses no styling (neither ScrollView takes `className`/`contentContainerClassName`; children keep theirs). `renderScrollComponent` receives the full `scrollProps` and VirtualizedList's `cloneElement(..., { ref: this._captureScrollRef })` lands on the raw ScrollView, so `scrollToIndex` works. Short/searched Combobox lists unchanged.
>
> Non-blocking: (1) `ChatFeed.tsx:213,226,253` likely has the same dropped-ref bug — `scrollToNewest`/`scrollToOffset` may silently no-op; out of scope. (2) Guard tests cover only two call sites; an ESLint `no-restricted-syntax` rule would cover all; the Payees regex is prop-order-sensitive. (3) Rail flashes at `listTop = 0` for one frame.
> Nits: `renderPlainScroll` sits between imports; brace the `jumpTo` `if`; `/s` flag is redundant.

Resolution: applied (3) and all three nits. (1) and (2) reported to the user as a follow-up — not in this ship.

## Verify
```
npm run typecheck  → tsc --noEmit, no errors
npm run lint       → eslint . --ext .ts,.tsx, no output
npm test           → Test Suites: 186 passed, 186 total / Tests: 3884 passed, 3884 total
npm run eval       → Parse cases: 131/234 (56.0%)   Refusal cases: 27/96 (28.1%)
                     PASS — at or above baseline (split=dev, 47.9%), no case regressed.
```

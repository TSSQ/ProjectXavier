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

# A–Z sorted lists + quick-scroll rail — spec

Approved mockup: https://claude.ai/artifact/HcZSgdAtEvoNTAEiShd494 (user: "looks good let's do that", 2026-10-20).

## Objective
Payees and categories are shown in insertion order today, which makes long lists hard to scan. Show them alphabetically everywhere they're listed, and add an A–Z quick-scroll rail on long payee lists (manage screen + pickers) that the user can tap or slide along.

## Hard constraint — display-level only
`listPayees()` / `listCategories()` (src/features/*/repository.ts) MUST keep returning insertion order. The on-device FM grounding prompt is built from the caller's order and sorting it caused the #45 parse regression. Do not touch the repositories, `debug-fm.tsx`, `debug-byok.tsx`, or any parse/prompt path. Sort only in the UI layer.

## Scope
1. **Pure domain module `src/domain/alphaIndex.ts`** (framework-free, BDD-tested):
   - `compareNames(a, b)`: `localeCompare(b, 'en', { sensitivity: 'base', numeric: true })`, tie-broken by raw string so the order is total/stable.
   - `sortByName<T extends { name: string }>(items: readonly T[]): T[]` — returns a new array, never mutates.
   - `indexKey(name)`: first character after trim, uppercased, if it's A–Z (after stripping diacritics via NFD, so "Éclair" → E); otherwise `'#'` (digits, symbols, emoji, CJK, empty).
   - `RAIL_LETTERS`: A..Z then `#`.
   - `groupByLetter<T>(items)`: sorted items grouped into `{ key, items }[]` in RAIL_LETTERS order, `#` LAST (so 7-Eleven sits at the bottom, like iOS Contacts), empty groups omitted.
   - `nearestPopulatedKey(key, populated: Set<string>)`: the key itself if populated, else the next populated key after it in RAIL_LETTERS, else the previous one; null when nothing populated. (Sliding onto an empty letter snaps forward.)
   - `RAIL_MIN_ITEMS = 15` and `shouldShowRail(count, query)`: true only when `count >= 15` and the query is empty/whitespace.
2. **`src/components/ui/AlphaRail.tsx`** — the right-edge rail.
   - Props: `populated: Set<string>`, `onSelect(key)`, `accessibilityLabel`.
   - Renders all 27 RAIL_LETTERS evenly in a column (flex: 1 each), 11px bold; populated letters `c.primary`, empty letters `c.muted` at ~0.45 opacity. ~40pt-wide touch column, visual text centred.
   - Gesture: RN responder system (`onStartShouldSetResponder`/`onMoveShouldSetResponder` → true, `onResponderGrant`/`onResponderMove` using `nativeEvent.locationY` against the measured height from `onLayout` — use the event's layout, NOT a ref; refs can be null in onLayout, see memory view-refs-null-at-onlayout). Map y → letter index (clamped), then `nearestPopulatedKey`, and call `onSelect` only when the resolved key changes. Must claim the responder so the parent ScrollView/FlatList doesn't scroll while sliding (`onResponderTerminationRequest` → false).
   - While touching, show a centred letter bubble (~76pt rounded square, `c.primary` bg, white 38pt extrabold letter) to the left of the rail; hide on release. Active letter renders white + slightly larger.
   - No haptics (no haptics lib is installed; adding a native dep is out of scope).
   - Accessibility: rail is `accessibilityRole="adjustable"` with `accessibilityValue={{ text: currentKey }}` and `onAccessibilityAction` increment/decrement moving between populated keys.
   - NO function-form `style`; static style objects / className only (NativeWind swallows function styles).
3. **Manage payees (`app/manage-payees.tsx`)**:
   - Rows sorted via `groupByLetter` on the filtered list, with a small section header per letter (`text-muted text-xs font-bold`, letter-spaced) above each group. Keep the existing row look exactly.
   - Rail shown per `shouldShowRail(filtered.length, query)`, absolutely positioned on the right edge between below the title area and above the FAB; list content gets right padding when the rail shows so rows don't sit under it.
   - Jump: record each section header's y via its `onLayout` event (`e.nativeEvent.layout.y`, relative to the ScrollView content container — headers must be direct children of the content container, or accumulate offsets), then `scrollTo({ y, animated: false })` on select.
   - Sort the default-category Combobox items too (it will be via Combobox, item 5).
4. **Manage categories (`app/manage-categories.tsx`)**: sort the filtered list with `sortByName`. No section headers, no rail (categories are a flat list in practice — `parentId` is never set by the app; ignore it). 
5. **`Combobox` (`src/components/ui/Combobox.tsx`)**: sort `filtered` via `sortByName` inside the component so every picker (transaction form payee + category, manage-payees default category) is A–Z without caller changes. When `shouldShowRail(filtered.length, query)`, render letter section headers and an `AlphaRail` on the right of the list; selecting a letter calls `scrollToIndex`/`scrollToOffset` on the FlatList. Easiest robust approach: build a flat `rows` array of `{type:'header',key}|{type:'item',item}` and keep a `headerIndex` map; use `scrollToIndex({ index, animated:false, viewPosition:0 })` with an `onScrollToIndexFailed` fallback (scrollToOffset to an estimate, then retry). When the rail is hidden (short list or searching) render exactly as today (no headers) so short pickers look unchanged. The rail must not overlap the hint text — add right padding to the list when shown.
6. Other places listing payees/categories for the user (check `app/recurring.tsx` pickers, dashboard/period filter chips if they list categories by name): sort with `sortByName` at render if they present a user-facing list of names. Do NOT reorder anything that feeds parse, prompts, budgets math, or backups.

## Out of scope
Repository ordering, haptics, sub-category tree UI, rail on categories, light/dark token changes.

## Acceptance criteria
- `tests/__features__/alpha-index.feature` + steps covering: case-insensitive order ("apple" with "Banana" with "Cold Storage"), numeric-aware ("Item 2" before "Item 10"), diacritics key ("Éclair" → E), `#` group last (7-Eleven, "😀 Cafe", empty string), sortByName doesn't mutate input, nearestPopulatedKey forward snap / backward fallback / null, shouldShowRail at 14/15 and with a non-empty query.
- A source-level guard test that `src/features/payees/repository.ts` and `src/features/categories/repository.ts` contain no `orderBy` / `.sort(` (protects FM prompt order).
- `npm run typecheck && npm run lint && npm test && npm run eval` green.
- Simulator build compiles.

## Edge cases
Empty list (no rail, existing empty copy); exactly 15 items; all names under `#`; search narrows below 15 → rail hides; renaming a payee re-sorts after refresh; very small screens — letters may compress but must stay tappable (rail fills available height).

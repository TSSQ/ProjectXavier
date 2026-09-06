# Liquid Glass chrome adoption — completion of the approved steps 0–3

Mockup (approved, Option A · NativeTabs): https://claude.ai/code/artifact/f5f5de03-1db1-466e-a89f-cafbee8a7b3f
Handoff: `.claude/handoff.md` (2026-08-25). Phase specs already shipped on this
branch: `docs/design/glass-phase2-spec.md` (Phase 1 `d09ce4e`, Phase 2 `ab31e79`).

## 1. Objective

Finish the "Xavier on Glass" proposal's steps 0–3 on `claude/liquid-glass-ui`.
Two earlier runs on this branch already landed most of it; this run ships the
remaining delta and nothing else. Glass is chrome, never content: cards, rows,
draft card, keypad, chart palettes, the avatar body and all copy are untouched.

## 2. What is already landed (do not redo)

| Handoff step | Status | Where |
|---|---|---|
| 0a — Redline B2 `primary`/`primaryFill` split | done | `src/theme/tokens.ts` (`primaryFill` `#3E6FD4` dark / `#2F6BDD` light), `global.css`, `tailwind.config.js`; guarded by `tests/__steps__/theme-sync.steps.ts` |
| 1 — `expo-glass-effect` + `NativeTabs` + SF Symbols | done | `app/(tabs)/_layout.tsx`, Phase 1/2 |
| 2 — edge-to-edge under the tab bar | done | each tab pads `insets.bottom + clearance`, `contentInsetAdjustmentBehavior="never"` |
| 3 — composer capsule, tinted Send, tinted FABs | done | `app/(tabs)/index.tsx` tray, `transactions.tsx` + `account/[id].tsx` FABs |
| 4 — sheet material (gated) | done ahead of gate | `BottomSheet.tsx` on `chrome` glass; the build-100 Pigu pass IS the legibility test — if it fails, a separate `/triage` reverts the sheet to `chrome.fallback` |

## 3. Scope — the delta

- **D0b** Theme-tune the avatar halo (the only theme-sensitive part of Xavier).
- **D0c** Settings `AvatarSwatch` pupils match the live avatar (dark in both themes).
- **D2** One sticky glass `ScreenHeader` on Dashboard and Transactions carrying
  the title and the period pill; retire the two hand-rolled pill copies
  (Redline C4).
- **D3** Quick-action chips become clear glass; "Add manually" joins them as a
  peer chip and the pinned "Prefer to type it in?" link goes (Redline C5); the
  painted accent glow retires on every glass control.

Out of scope: the Redline's Xavier-in-header placement (no drawing exists for
it — the mockup's header shows title + pill only); Phase 3 cards/rows; the
depth-field `useIsFocused` gating; Reduce Transparency in-app switch; B1
chart palette; anything under `ios/`.

## 4. Approach

### D0b — avatar halo (`src/domain/avatar.ts`, `src/components/ui/XavierPet.tsx`)

`design_handoff_light_mode/README.md` specifies the halo as
`--xv-glow-avatar`: dark `0 8px 40px rgba(91,141,239,.55)`, light
`0 8px 36px rgba(47,107,221,.34)`, and darker light-mode glow hues per family
(blue `#2F6BDD`, violet `#6A45DE`, green `#149158`, pink `#D63A56`, gold
`#A6790E`). The body gradient stays brand-fixed (do NOT touch `from`/`to` or
the pupils — see the comment at the top of `XavierPet.tsx`).

1. `AvatarLook` gains `glowLight: string` (framework-free, so it is testable):
   xavier `#2F6BDD`, mint `#149158`, sunset `#D63A56`, gold `#A6790E`,
   grape `#6A45DE`, slate `#3A4F63` (its own `to`; no handoff entry).
2. `XavierPet` reads the colour scheme through the same source `useGlass`/
   `useThemeColors` use (scheme only — the body/eyes stay static) and picks:
   - dark (today's values, unchanged): colour `look.from`, `shadowOpacity
     0.4 + idle*0.35`, `shadowRadius 16 + idle*12`
   - light: colour `look.glowLight`, `shadowOpacity 0.25 + idle*0.22`,
     `shadowRadius 14 + idle*11` (the handoff's .34/.55 and 36/40 ratios
     applied to the native rest/pulse pair).
   The angry interpolation towards `ANGRY_GLOW` is unchanged in both themes.
3. Update the "not yet implemented natively" comment in `XavierPet.tsx`.

Test (plain Node): every look in `AVATAR_LOOKS` has a `glowLight` that is a
6-digit hex and has lower relative luminance than its `from` (it must read as
a glow on white, not a smudge). Put the luminance helper next to the test or
reuse one if the theme-sync steps already have it.

### D0c — swatch pupils (`app/(tabs)/settings.tsx` `AvatarSwatch`)

`fill={c.bg}` → the static dark palette's `bg` (`colors.bg` from
`src/theme/tokens.ts`, the same constant `XavierPet` calls `DARK`). One-line
comment: pupils are brand-fixed.

### D2 — `ScreenHeader` (`src/components/ui/ScreenHeader.tsx`, new)

Props: `title: string`, `period: { label: string; onPress: () => void }`,
`right?: ReactNode` (Transactions' search button), `below?: ReactNode`
(Transactions' open search field), `onHeight: (h: number) => void`.

Render: `<Glass material="chrome" edge specular>` positioned absolutely at the
top of the screen (`position:'absolute', top:0, left:0, right:0`, zIndex above
the scroll view), inner padding `insets.top` (from the screen's nested
`SafeAreaProvider` — every tab screen already has one) + 8 top, 24 horizontal,
10 bottom; a row with the title (`text-text text-[28px] font-extrabold`, as
"Overview" is today) on the left and the period pill + `right` on the right;
`below` renders under the row when present. No bottom radius (it is a bar).
Report its laid-out height through `onHeight` (`onLayout`), and the screen
sets its scroll `paddingTop = headerHeight + 12`, seeded with
`insets.top + SCREEN_HEADER_ESTIMATE` so frame 0 already clears the bar —
content scrolls under the glass and refracts through it, which is the whole
effect (mockup note 2/3). The material is a childless `Glass` sibling sized
off the measured content height and keyed on it (the BottomSheet pattern):
expo-glass-effect applies its effect only on first layout, so every height
change (search field, wrapped title, long label) gets a fresh instance at its
final size while the content — and the search `TextInput`'s focus — stays
mounted. Until measured (and always on the opaque tier) the wrapper carries
`chrome.fallback`, so no frame is backgroundless.

The period pill is one `PeriodPill` (same file, not exported beyond it unless
Phase 3 needs it): Feather `calendar` + label + `chevron-down`, `clear` glass
via `<Pressable><Glass material="clear" radius={radius.pill} isInteractive>`
(the same Pressable-wraps-Glass rule as Send, spec Phase 2 §4.3),
`accessibilityLabel="Change period"`. Delete both hand-rolled copies:
`app/(tabs)/dashboard.tsx` ~402–412 and `app/(tabs)/transactions.tsx`
~597–606.

Dashboard: title "Overview" moves out of the scroll content into the header
(remove the `<Text>Overview</Text>` at ~414). `AccountFilterPills`,
`IncludeArchivedToggle` and everything below stay in the scroll view.
Transactions: title "Transactions"; `right` = the existing search button
(hidden while `searchOpen`, as today); `below` = the existing search field
row when `searchOpen`. The `ListHeaderComponent` keeps whatever remains after
the pill row and search leave it (delete it if nothing remains).

Mount timing: the header mounts with the screen (UIKit tab switch, no
Reanimated layout animation above it), the same situation as the composer
tray, so no settle gate is needed. Do NOT wrap it in an `Animated.View` with
`entering`.

Opaque tier: `Glass` already renders `chrome.fallback` — the header reads as
today's solid bar. Nothing extra.

### D3 — chips + glow (`app/(tabs)/index.tsx`, `src/theme/assets.ts`, `src/theme/tokens.ts`)

1. `QuickActionChips` (~4501): each chip becomes
   `<Pressable …><Glass material="clear" radius={radius.pill} isInteractive
   style={{minHeight: s.quickChipHeight, paddingHorizontal: 18, flexDirection:
   'row', alignItems:'center', justifyContent:'center', gap: 6}}>…</Glass>
   </Pressable>` — drop `bg-surfaceAlt` (clear's fallback is `surfaceAlt`, so
   the opaque tier is pixel-identical to today).
2. Add a fourth chip **"Add manually"** (Feather `type`; add `keyboard:
   'type'` to `icons`) with `accessibilityLabel="Add manually"`, calling a new
   `onAddManually` prop → `router.push('/transactions?add=<Date.now()>')`
   (a fresh token per tap). `app/(tabs)/transactions.tsx` reads `add` with
   `useLocalSearchParams` inside a `useFocusEffect`, and — because expo-router
   keeps a tab's params across tab switches (the reason `index.tsx`'s widget
   deep links carry ref guards) — remembers the last handled token in a ref:
   a new token opens the form once via `openAdd()` and clears the param; a
   stale one is ignored, so tab-away-and-back never resets an in-progress
   entry. Chip heights move to the 44pt floor (`QUICK_CHIP_HEIGHT`).
3. Delete the pinned `<Link href="/transactions">Prefer to type it in? Add
   manually</Link>` (~2944) from the tray. The tray's bottom spacer stays.
4. Retire `c.elevation.accentGlow` + `shadowColor` on the three glass
   controls: Send (`index.tsx` ~2929), Transactions FAB (~775), account FAB
   (`account/[id].tsx` ~667). Keep it on the solid `bg-primaryFill` buttons
   (Create / Confirm / Open in Accounts) — they are not glass. Update the
   `accentGlow` doc comment in `tokens.ts` (it no longer sits under the FAB or
   Send; it is the glow under solid primary buttons).

## 5. Acceptance criteria

Checks: `npm run typecheck && npm run lint && npm test && npm run eval` green;
tests ≥ 1908 (the avatar `glowLight` scenarios are new). `project.pbxproj`
SHA stays `3b18a2bf5b333f728afa06a207f010d0dc689486` (= the Phase 2 baseline
`431aa662…` plus only the build-100 `CURRENT_PROJECT_VERSION` bump; `ios/` is
gitignored, so this is checked with `shasum`, not the diff); `package.json`
unchanged.

Headless simulator (iPhone 17 Pro, iOS 26.5, recipe in memory
`headless-simulator-driving`; screenshots to `scratchpad/glass-chrome/`; the
sim MUST be shut down and deleted at the end), dark AND light:

1. Dashboard at rest: glass header with "Overview" + period pill; scroll so a
   card passes under it — the card is visibly blurred through the header, the
   title stays crisp. Same on Transactions with rows.
2. Transactions: search button in the header's right slot; tapping it opens
   the field under the title row inside the header; the list's first row is
   never hidden under the header in either state.
3. Period pill on both tabs opens `PeriodSheet` (tap via idb) and shows the
   selected label after a change.
4. Assistant idle hero: four clear-glass chips (New account · Scan photo · All
   commands · Add manually), the depth field refracting through them; no
   "Prefer to type it in?" link under the composer. Tapping "Add manually"
   lands on Transactions with the Add transaction sheet open; a second visit
   to the tab does not reopen it.
5. Send and both FABs: no shadow glow around the glass disc.
6. Assistant in light mode: the halo is a soft, slightly darker-blue glow
   (compare to the dark screenshot — tighter, not a grey smudge); Settings →
   avatar swatches show dark pupils in light mode.
7. Reduce Transparency on (toggle in the sim's Settings app; `defaults` does
   not reach `AccessibilityInfo`): header solid `surface`, chips solid
   `surfaceAlt`, everything legible.

## 6. Constraints

- Working agreement + Phase 2 §7: parameterised SQL (n/a), zod (n/a), no new
  dependencies, never `expo prebuild` / `pod install` / `eas build --local`,
  `ios/` untouched, function-form `style` on Pressable is ESLint-banned.
- Bare `grep`/`find`/`npx jest` are hooked (fabricated output) — use
  `/usr/bin/grep`, `/usr/bin/find`, `node_modules/.bin/*`; verify only via
  `npm run …`.
- Glass first-layout hazard (Glass.tsx header comment): never mount a `Glass`
  under an ancestor that is mid Reanimated layout animation. None of the
  surfaces in this run has one; keep it that way.
- `XavierPet` body/eyes stay static; only the halo consumes the theme.

## 7. Edge cases

- **Large Dynamic Type**: the header row may wrap the title above the pill —
  allow `flexWrap` on the row; the measured height keeps the content clear.
- **Search open + keyboard**: the header grows (measured) and the list's
  `paddingTop` follows; no content jump beyond the header's own growth.
- **Period label width** ("Custom · 1 Jan – 31 Mar"): pill text `numberOfLines
  ={1}` with `flexShrink: 1`; the title has `flexShrink: 1` too.
- **Scroll to top**: the header sits on the depth field alone — fine, that is
  what it refracts.
- **`?add=<token>` while a form is already open**: `openAdd()` is NOT
  idempotent — it resets the form's initial values — so only a new token may
  call it (the ref guard); a stale token never reaches `openAdd()`.
- **Deep link `?focus=1`** into the Assistant is unaffected (tray unchanged
  apart from the removed link).
- **Android**: not a target but must compile; `Glass` already falls back.
- **Appearance change while a tab is in the background** (found by the
  round-2 sim pass; pre-existing since Phase 2): a scheme change gives the
  same `GlassView` a new tint, and a detached instance re-assigned that way
  renders nothing on the tab's next appearance. `Glass` keys its `GlassView`
  on the scheme so the material remounts and takes its first layout on
  attach. Cost: children inside a glass surface remount on a theme change
  (the composer's field loses focus if you were typing at sunset).
- **Search closed with a pending autocorrect**: iOS commits it through
  `onChangeText` after the field unmounts; the list filters on
  `searchOpen ? query : ''` and Open resets the query, so the stale value is
  inert.
- **AX text sizes**: the header's right cluster and the pill shrink (the
  label truncates) instead of overflowing the padded box.

## 8. Follow-ups (not this run)

Carried from Phase 2 §9 unchanged. New: Xavier-in-header placement needs a
drawing before it is built; `PeriodPill` becomes exported the moment a third
caller appears; `openAdd()` fired within the first second after a cold start
(the "Add manually" chip) shows "Choose account" because accounts haven't
loaded yet — pre-existing `openAdd` behaviour, needs the form to default the
account once the query resolves; changing Dynamic Type at runtime leaves
stale text boxes app-wide (RN artefact, relaunch clears it); at the default
text size the Transactions header wraps its pill + search onto a second row
(title 178pt + "September 2026" pill 177pt + search 32pt exceed the 354pt
padded width) — a shorter period label format would keep it on one row.

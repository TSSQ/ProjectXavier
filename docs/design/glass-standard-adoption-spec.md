# Glass standard adoption — materials + component families, S0–S7

Mockup (approved 2026-09-07): https://claude.ai/code/artifact/1a7ac132-aa06-4646-848a-a8a44e2de8a9
Standard (in repo, wins on conflict): `docs/design/glass-style-guide.md`
Handoff: `.claude/handoff.md` (2026-09-07). Prior specs on this branch:
`glass-phase2-spec.md`, `glass-chrome-adoption-spec.md`,
`composer-seated-with-xavier-spec.md` (build 107 = `e6097f2`).

## 1. Objective

Put the component layer on top of the material layer. Today thirteen `<Glass>`
call sites sit inline in screens, every core control component is flat, and
the composition rules live as prose in seven files. After this run: six new
family components (`Fab`, `IconButton`, `Chip`, `Badge`, `MenuPanel`,
`MenuRow`), five existing ones brought to the standard, the `card` role
renamed to what it actually is, three scale tokens that were missing, and
source-scan scenarios that make the next literal a test failure. No visual
redesign: every screen should look the same or marginally more consistent.
Glass stays chrome, never content (R1).

## 2. What is already landed (do not redo)

| Item | Status | Where |
|---|---|---|
| `Glass` primitive, roles, tier resolution, opaque fallback | done | `Glass.tsx`, `glassTokens.ts`, `useGlass.ts` |
| NativeTabs · `ScreenHeader` (chrome, keyed) · `BottomSheet` shell (chrome, gated) | done — F10 | `_layout.tsx`, `ScreenHeader.tsx`, `BottomSheet.tsx` |
| `Composer` (F3) — "+" · field · morphing slot, childless keyed Glass | done | `Composer.tsx` (build 105+) |
| `Button` primary/ghost/destructive, 44 floor, `role.control`, press state | done — F8 | `Button.tsx` |
| `SegmentedControl` on `wellRecessed` / `primaryFill` | done — F7 | `SegmentedControl.tsx` |
| `controlRaised` / `wellRecessed` / `badgeFlat` split (Redline B3) | tokens done; **17 / 4 / 4 call sites migrated, 52 still `surfaceAlt`** | `tokens.ts` |
| `radius-scale.feature` (class-based radii guard) | done; does not cover inline `borderRadius:` literals | `tests/__features__/radius-scale.feature` |
| Chart palette per theme (Redline B1) | done | `tokens.ts chartPalette` |

## 3. Scope — the delta

- **S0** Tokens and guards: `card` → `panel`; `radius.xs`; `SIZE`; `ICON`;
  `role.label`; `glass-standard.feature`; `radius-scale.feature` extension.
- **S1** `Fab` replaces the 5 inline copies.
- **S2** `IconButton` (lg / md / sm; clear / tinted) replaces the "+", Send,
  camera, both sheet close discs and the header search button.
- **S3** `Chip` + `Badge` replace `AccountFilterPills`' inline pills, the
  `/account` answer chips and the 11 badge sites.
- **S4** `Button` replaces the 7 hand-rolled copies; gains `glow`.
- **S5** `Input` takes the 3 stray fields and a focus rule; RepeatSheet's
  mini-segments take `SegmentedControl`; keypad radius and fills.
- **S6** `MenuPanel` / `MenuRow` unify `ContextMenu` and `SlashMenu`; `panel`
  glass on the animation-free anchor only.
- **S7** Sort the 52 `surfaceAlt` sites into the ladder; guard the count.

Out of scope: any new screen; cards/rows/draft card (R1); the tab bar;
`ScreenHeader`/`BottomSheet` internals beyond their close/search controls;
ESLint rules (guards are BDD source scans, the repo's existing pattern);
`ios/`.

## 4. Approach

### S0 — tokens and guards

`src/theme/glassTokens.ts`: rename the role `card` → `panel` at `:51`
(`GlassRole`), `:68` (interface), `:101` (dark), `:135` (light); update the
header comment `:17–:25`. `src/components/ui/Glass.tsx`: doc example `:14`;
**remove the default** at `:72` (`material = 'card'`) so `material` is
required — an omitted prop becomes a type error instead of a silent panel.
`tests/__features__/glass-tokens.feature:55` "Chrome and card carry a tint"
→ "Chrome and panel …" (steps follow).

`src/theme/tokens.ts`: `radius.xs: 4`. Add
`export const SIZE = { fab: 56, controlMd: 36, glyphBox: 36 } as const` next to
`radius` (the width-tiered sizes stay in `scaleMath.ts`:
`COMPOSER_HEIGHT` = `lg`, `CHIP_HEIGHT` = chip). `src/theme/assets.ts`:
`export const ICON = { sm: 14, md: 18, lg: 24 } as const`.
`src/domain/scaleMath.ts` `ROLE_BASE`: add `label: 11` (the badge role; retires
the 9/10 literals). Scenario in the existing scale feature pins the new role.

`tests/__features__/glass-standard.feature` (new; steps scan `app/` + `src/`
with `/usr/bin/grep`-equivalent Node code, same shape as `radius-scale`):

1. Every `<Glass` occurrence outside
   `src/components/ui/{Glass,Fab,IconButton,Chip,Composer,ScreenHeader,BottomSheet,MenuPanel}.tsx`
   is zero — glass is only ever used through a family component.
2. `material="card"` count is zero.
3. No `width: 56` / `height: 56` literal outside `Fab.tsx`.
4. No Feather `size={N}` outside `ICON` values, except an allowlist file
   (`tests/fixtures/icon-size-allowlist.json`) seeded with the one
   `size={172}` avatar preview.
5. `radius-scale.feature`: new scenario — no inline `borderRadius: N` literal
   in `app/`+`src/` outside `{0, 4, 8, 14, 22, 999}`; the `2`/`3`/`6`/`10`/
   `11` legend-swatch and dot literals move to `radius.xs` or `radius.sm`.

Scenario 1 will be red until S6; land it with S0 but tag the two menu files
in its allowlist until then, and remove the tag in S6.

### S1 — `Fab` (`src/components/ui/Fab.tsx`, new)

```ts
interface FabProps { onPress: () => void; accessibilityLabel: string; icon?: FeatherName /* default 'plus' */ }
```
`<Pressable style={{ position:'absolute', right: 20, bottom: insets.bottom + 20 }}>`
(insets from the caller's provider — every caller already has one) wrapping
`<Glass material="tinted" radius={radius.pill} isInteractive style={{ width:
SIZE.fab, height: SIZE.fab, alignItems:'center', justifyContent:'center' }}>`
with `<Feather name={icon} size={ICON.lg} color={c.onAccent} />`. Pressed:
Pressable `opacity .9` (never a Glass prop). On the **opaque tier only**
(`useGlass().tier === 'opaque'`) add `{ ...c.elevation.accentGlow,
shadowColor: c.primary }` to the Pressable — the fallback is a solid
`primaryFill` disc, which is exactly what `accentGlow` is for (R4).

Replace: `app/(tabs)/transactions.tsx` ~815–827, `app/account/[id].tsx`
~668–680, `app/manage-accounts.tsx` ~428–438, `app/manage-categories.tsx`
~232–242, `app/manage-payees.tsx` ~234–244. Keep each screen's list
`paddingBottom` rule (`56 + 20 + insets.bottom`) — express it as
`SIZE.fab + 20 + insets.bottom` so it can't drift from the component.

### S2 — `IconButton` (`src/components/ui/IconButton.tsx`, new)

```ts
interface IconButtonProps {
  size: 'lg' | 'md' | 'sm'; tone?: 'clear' | 'tinted';   // sm ignores tone
  icon: FeatherName; onPress: () => void; accessibilityLabel: string; disabled?: boolean;
}
```
- `lg`: `s.composerHeight` box, `Glass material={tone}`, glyph `ICON.lg`
  (`c.text` on clear, `c.onAccent` on tinted).
- `md`: `s.composerHeight − 12` box (36/36/40), Glass as above, glyph
  `ICON.md`, `hitSlop={6}`.
- `sm`: `SIZE.glyphBox` 36 plain View, no glass, glyph `ICON.md` `c.muted`,
  `hitSlop={8}`.
- Pressed: Pressable opacity .85. Disabled: opacity .35 + `accessibilityState`.

Migrate: `Composer.tsx` "+" (~120–140 → `lg clear`), Send (~213–229 → `md
tinted`), camera (~203–212 → `sm`); the glyph sizes 20 → 24 / 18 fall out.
`BottomSheet.tsx:344–349` close (32pt `controlRaised` disc → `md clear`; on the
chrome shell that is a control on a bar, R2's allowed case; opaque tier falls
back to `surfaceAlt`). `app/(tabs)/transactions.tsx` ~768–776 search button →
`md clear` (it sits in `ScreenHeader`'s `right` slot). `app/(tabs)/index.tsx`
4560–4572 — the examples sheet's hand-rolled close → `md clear`. Keep every
`accessibilityLabel` verbatim (the sim recipes tap by label).

### S3 — `Chip` and `Badge` (new files in `src/components/ui/`)

```ts
interface ChipProps { label: string; selected?: boolean; onPress: () => void; surface: 'canvas' | 'content';
  leading?: FeatherName; trailing?: FeatherName; overflow?: boolean; disabled?: boolean; accessibilityLabel?: string }
```
Canvas: `<Pressable><Glass material={selected ? 'tinted' : 'clear'} radius={radius.pill} isInteractive
style={{ minHeight: s.chipHeight, paddingHorizontal: 15, flexDirection:'row', alignItems:'center', gap: 6 }}>`.
Selected is a **different material on a different mount**, not a prop change on
one Glass — key the Glass on `selected` so R5 holds. `overflow` adds a sibling
overlay View with `borderWidth: 1, borderStyle:'dashed', borderColor:
c.borderAccent, borderRadius: radius.pill` (R5: overlay, not a Glass edge).
Content: plain Pressable, `controlRaised` + `c.elevation.raised`, or
`primaryFill` + `onAccent` when selected. Text `s.role.rowLabel` semibold.

Migrate `src/components/ui/AccountFilterPills.tsx` (all three pill kinds; the
"All accounts" pill is `selected={allActive}`, account pills
`selected={!allActive}` as today, "+N more" is `overflow` with `trailing="chevron-down"`)
— its 13px inline text becomes `rowLabel`, its 31pt height becomes `chipHeight`.
`app/(tabs)/index.tsx:4673–4700` `SubtypeChoiceChips` → `Chip surface="canvas"`
(the "Skip" chip keeps its `muted` label via a `tone` on the label, not a
different material).

```ts
interface BadgeProps { label: string; tone?: 'muted' | 'primary' | 'negative' }
```
Not pressable. `badgeFlat` background, `border` hairline (`borderAccent` for
primary), text `s.role.label` uppercase `letterSpacing .09`, `paddingHorizontal
7`, `paddingVertical 3`. Migrate: `TransactionRow.tsx:108, :117`;
`index.tsx:3642` (Pending → muted), `:3649–3669` (source pills: Offline →
muted, On-device / OpenAI / Anthropic / AI parsed → primary), `:3851` (New →
primary); `app/(tabs)/settings.tsx:368` (Soon → muted).

### S4 — `Button` migration

`Button.tsx` gains `glow?: boolean`: when true and `variant === 'primary'`,
apply `{ ...c.elevation.accentGlow, shadowColor: c.primary }` (the three hero
CTAs — Create / Confirm / Open in Accounts — pass it; nothing else does).
Replace the hand-rolled pairs at `index.tsx:4052/4062`, `:4186/4196`,
`:4239/4249` (Discard = `ghost`, Create/Confirm = `primary glow`, `className="flex-1"`,
labels and handlers verbatim; the inline `height: 50` goes — the 44 floor and
`role.control` come from the component) and `RepeatSheet.tsx:324` (Done →
`primary`). Delete the inline `accentGlow` objects those sites carried.

### S5 — fields, segments, keys

- `Input.tsx`: add a focus rule once — `onFocus`/`onBlur` state, `borderColor:
  focused ? c.primary : c.border`. Keep the public props.
- `app/(tabs)/settings.tsx` ~280–288 currency search → `<Input>` (drop
  `surfaceAlt`, `rounded-md`, `text-[13px]`).
- `src/components/ui/NoteSheet.tsx:28` → `<Input multiline>` with the existing
  `minHeight`; `wellRecessed` leaves this file (its remaining consumer is
  `SegmentedControl`).
- `app/(tabs)/transactions.tsx` ~780–790 header search `TextInput` → `<Input
  autoFocus>`; the wrapping row loses `border-primary` (the focus rule paints
  it).
- `src/components/ui/RepeatSheet.tsx` ~195–210 mini-segments → `SegmentedControl`;
  if the labels don't fit at default text size, add `compact?: boolean`
  (segment minHeight 32, `caption` label) to the component rather than a
  second control.
- `src/components/ui/AmountKeypad.tsx:112` `COLOR_KEY_BG` → `c.controlRaised`;
  `:113` pressed stays `c.border` (dark `controlRaised` = `surfaceAlt`, so a
  `surfaceAlt` pressed state would be invisible — the style guide records
  this); `:138` `borderRadius: 12` → `radius.md`.

### S6 — `MenuPanel` / `MenuRow` (`src/components/ui/MenuPanel.tsx`, new)

`MenuPanel`: `surface` + `border` 1px + `radius.md` + `c.elevation.overlay`,
`paddingVertical` as `ContextMenu`'s `PAD`; `glass?: boolean` renders the
material as a childless `Glass material="panel"` sibling keyed on the measured
height (R6) with the panel's own fill transparent — only when the caller
guarantees no entering animation (R9). `MenuRow`: `minHeight 44`, `radius.sm`,
`paddingHorizontal` as today, pressed `surfaceAlt`, `tone: 'negative'` for
destructive, leading Feather `ICON.md`.

Migrate `src/components/ui/ContextMenu.tsx:84–100` (`panelStyle`, `borderRadius:
12` → `radius.md`) and its `MenuRow` (~205–225); pass `glass` **only** in
`bottomRight` mode (no animation) — `point` mode keeps flat. `app/(tabs)/index.tsx:4727`
`SlashMenu` → `MenuPanel` + `MenuRow`s (it is a `bottomRight`-style sibling with
no animation → `glass`). Remove the two files from scenario 1's allowlist.
Measure on the sim that the grown panel's material covers the full height
(same column-scan method as the composer field, spec §14).

### S7 — `surfaceAlt` sort

For each of the 52 sites: pressable → `controlRaised` (+ `elevation.raised`
where it is a standalone control on a light surface); a track or a well →
`wellRecessed`; a read-only label → `badgeFlat` (or `Badge`); a section fill
that is none of those → `surface`. Then scenario 6 in `glass-standard.feature`:
`bg-surfaceAlt` / `c.surfaceAlt` / `colors.surfaceAlt` count in `app/`+`src/`
is zero outside `tokens.ts` and `glassTokens.ts`. Dark is a no-op visually;
light is where the sort shows (white raised vs grey well) — the sim pass is in
light.

## 5. Acceptance criteria

Checks: `npm run typecheck && npm run lint && npm test && npm run eval` green;
scenarios ≥ **1108 + 9** (the new feature's six, the radius extension, the
`label` role, the panel rename). `project.pbxproj` SHA unchanged from build 107
(`shasum`); `package.json` unchanged.

Headless simulator (iPhone 17 Pro, iOS 26.5; recipe in memory
`headless-simulator-driving`; screenshots to `scratchpad/glass-standard/`;
shut down AND delete the sim at the end), **dark, light, and Reduce
Transparency on**:

1. **Transactions / Dashboard / manage-accounts**: one `Fab` each, 56×56 at
   `right 20 · bottom insets.bottom + 20`, glyph 24; last row clears it. Opaque
   tier: solid `primaryFill` disc with the glow; native tier: no glow.
2. **Assistant idle**: "+" 48 clear with a 24 glyph; camera bare 18 glyph;
   type → Send `md` tinted 36 with an 18 glyph. Nothing below 44pt tappable
   (measure with hitSlop).
3. **Add transaction sheet**: close disc `md` clear on the chrome shell;
   segmented control unchanged; keys at `radius.md` with `controlRaised` fill,
   pressed = `border` tone; Add button unchanged.
4. **Dashboard**: filter chips are `chipHeight` tall, clear at rest, tinted
   selected, "+N more" dashed; text at `rowLabel`. **/account subtype step**:
   answer chips are canvas chips; "Skip" label muted.
5. **Badges**: Pending on a row, Offline / On-device on a draft card, New on a
   payee, Soon in Settings — all `badgeFlat`, one size (`label` 11), three
   tones.
6. **Buttons**: the account draft card's Discard / Create and RepeatSheet's
   Done are `Button`s at 44pt with press feedback; Create carries the glow.
7. **Fields**: currency search, note editor, header search all read as
   `Input`; focusing paints the `primary` border; `wellRecessed` appears only
   under the segmented control.
8. **Menus**: long-press menu (`point` mode) flat at `radius.md`; the "+" menu
   and the composer's photo menu (`bottomRight`) on `panel` glass, material
   covering the full grown height; rows 44pt, pressed `surfaceAlt`.
9. **Light mode after S7**: every pressable flat control is white with the
   raised shadow; wells and badges are grey; nothing is `#EAEEF4` that is
   pressable.
10. **Reduce Transparency**: every glass family renders its fallback with
    identical layout — measure one control per family before/after the toggle
    and diff the frames (position and size equal, fills differ).

## 6. Constraints

- Working agreement: no new dependencies; never `expo prebuild` /
  `pod install` / `eas build --local`; `ios/` untouched; function-form `style`
  on Pressable is ESLint-banned; domain logic (the source-scan steps) stays
  framework-free.
- Bare `grep`/`find`/`npx jest` are hooked — use `/usr/bin/grep`,
  `/usr/bin/find`, `node_modules/.bin/*`; verify only via `npm run …`.
- Glass hazards (`Glass.tsx` header): no Glass under a Reanimated layout
  animation (`point`-mode menus stay flat); never change a Glass prop for
  state (selected chips remount on a key); theme switch remounts children
  (known, accepted).
- Do not touch: cards, rows, the draft card, `Composer`'s layout, `ScreenHeader`
  and `BottomSheet` beyond their close/search controls, the tab bar, the
  depth field, the avatar, any copy.
- Keep every existing `accessibilityLabel` string — the sim recipes and the
  BDD steps tap by label.

## 7. Edge cases

- **AX text sizes**: chips grow with `rowLabel`; `chipHeight` is a `minHeight`;
  filter pills scroll horizontally so nothing truncates. Badges scale with
  `label` but keep `numberOfLines={1}`.
- **Send disc on Pro Max**: `md` = `composerHeight − 12` = 40 there; the
  Composer's row alignment (`alignItems:'flex-end'`, `marginBottom 6`) is
  unchanged.
- **Selected chip remount**: keying the Glass on `selected` remounts the
  material only; the label `Text` is a sibling in front (same idiom as the
  composer field), so VoiceOver focus is not lost on toggle.
- **`Fab` on a screen whose list is empty**: still mounted at the same
  position; the empty-state text keeps its existing bottom padding.
- **`panel` glass behind a menu that grows** (SlashMenu with "What can I
  ask?" + rows): keyed on measured height, same brief-unblurred-band cost as
  `ScreenHeader` — accepted.
- **Dark `controlRaised` = `surfaceAlt`**: the S7 sort is invisible in dark;
  the light sim pass is the proof, and scenario 6 is the guard.
- **Android**: not a target; must compile — all new components use `Glass`,
  which already falls back.

## 8. Order, fallback, follow-ups

Ship S0 first (it makes S1–S7 mechanical and gives every later commit a red
test to turn green), then S1 → S6 in any order, S7 last. Each step is one
commit and one sim check; none blocks the others once S0 is in.

Fallback: if `panel` glass misrenders behind a `bottomRight` menu on device,
drop the `glass` flag at that call site and keep the flat panel — the
component API doesn't change. If `md` clear discs on the sheet shell read as
glass-on-glass in the light theme on device, the shell's close falls back to
`sm` (bare glyph) — R2's allowed case is a taste call the device confirms.

Follow-ups (not this run): an ESLint rule mirroring the source-scan scenarios
(nicer feedback than a test failure); the examples sheet at `index.tsx:4560`
becoming a `BottomSheet`; the Redline's B4 type-ramp migration and C1 icon set
— both interact with `ICON`/`label` and should land after this.

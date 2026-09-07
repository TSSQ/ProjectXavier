# Xavier Glass Standard — materials, rules, control families

Status: **approved 2026-09-07**. Source of truth for how Liquid Glass and the
opaque surface ladder are used in this app. The rendered sheet (both palettes,
every specimen live) is the artifact
https://claude.ai/code/artifact/1a7ac132-aa06-4646-848a-a8a44e2de8a9; this file
is the copy that lives with the code. When they disagree, this file wins and
the artifact gets updated.

Values below are the ones in `src/theme/tokens.ts` and `src/theme/glassTokens.ts`
at build 107. Do not restate them elsewhere — link here.

## 1. Materials

| Role | System style | Tint dark / light | Fallback (opaque tier) | Job |
|---|---|---|---|---|
| `chrome` | regular | `rgba(20,25,33,.62)` / `rgba(255,255,255,.68)` | `surface` | Bars and shells: ScreenHeader, sheet shell, the composer field. Heaviest tint — it must survive a scrolling ledger under it. |
| `clear` | clear | none (edge only) | `surfaceAlt` | Controls that float on the canvas and must not compete with content: "+", period pill, chips on chrome, icon buttons at rest. |
| `tinted` | regular | `rgba(91,141,239,.68)` / `rgba(47,107,221,.82)` | `primaryFill` | The accent in glass: FAB, Send, a selected glass chip. White glyphs only. |
| `panel` (was `card`) | regular | `rgba(28,34,44,.55)` / `rgba(255,255,255,.58)` | `surface` | Floating panels over content: menus and popovers. **Not** ledger cards — see R1. |

Shared per theme: `edge` `rgba(255,255,255,.10)` / `rgba(20,28,45,.10)` (the
hairline on every glass shape; replaces `border` there), `specular`
`rgba(255,255,255,.16)` / `rgba(255,255,255,.90)` (1px top lip, drawn as an
overlay), `scrim` `rgba(14,17,22,.55)` / `rgba(255,255,255,.72)` (contrast
floor under figures on glass), the depth-field wells (from the avatar look),
`floatingSideInset` 16, `floatingBottomGap` 8.

Tier: `native` only when the flag is on, `isLiquidGlassAvailable()`,
`isGlassEffectAPIAvailable()` and Reduce Transparency is off; otherwise
`opaque`. Layout is identical across tiers; only fills change.

## 2. The surface ladder (opaque)

| Token | Dark | Light | Job |
|---|---|---|---|
| `bg` | `#0E1116` | `#F4F6FA` | The canvas, with the depth field on it |
| `surface` | `#171B22` | `#FFFFFF` | Cards, rows, sheet content, menu panels |
| `controlRaised` | `#1F2530` | `#FFFFFF` + `elevation.raised` | A flat control you press (ghost Button, chip on content, keypad key) |
| `wellRecessed` | `#0B0E13` | `#EAEEF4` | A track things sit inside (SegmentedControl) |
| `badgeFlat` | `#12161D` | `#EAEEF4` | A read-only label (Badge) |
| `primaryFill` | `#3E6FD4` | `#2F6BDD` | White text/glyphs on the accent (primary Button, selected content chip, active key) |
| `surfaceAlt` | `#1F2530` | `#EAEEF4` | **Legacy alias.** Every use belongs to one of the three roles above. Stays as `clear`'s fallback. |

Note the dark coincidence: `controlRaised` = `surfaceAlt` = `#1F2530`. A pressed
state on a `controlRaised` control therefore cannot be `surfaceAlt`; use
`border` (keypad) or opacity (Button).

Elevation: `raised` (under a flat control), `overlay` (under a menu panel),
`accentGlow` (under a **solid** `primaryFill` hero button only — never under
glass).

## 3. Composition rules

- **R1 — Glass is chrome. Content is never glass.** Bars, shells, floating
  controls and floating panels are glass. Cards, rows, the draft and confirm
  cards, the keypad, chart plot areas, figures, form fields, badges and solid
  buttons are opaque. The original proposal's Rule 01 put cards and rows on
  glass; every shipped spec kept them opaque and the role never got a caller.
  This is the decision, on record.
- **R2 — One glass per control. Never glass in glass.** A control is one
  piece of material. Controls that sit *on* a bar (period pill on the header,
  close disc on the sheet shell) are separate controls, not nesting.
- **R3 — Pressable wraps Glass.** `accessibilityLabel` on the Pressable;
  `hitSlop` lifts a small visual to 44pt without changing layout. Glass takes
  no touch props.
- **R4 — No painted depth on glass.** No shadow or glow under a glass control.
  `accentGlow` lives only under solid `primaryFill` buttons — which includes a
  glass control's *opaque-tier fallback*, because that fallback is a solid fill.
- **R5 — State never changes a Glass prop.** Focus, pressed, selected: a
  sibling overlay (hairline ring, tint layer, opacity on the Pressable), never
  a change to `material`/`edge`/`style` on the Glass.
- **R6 — Anything that resizes gets a childless Glass keyed on its height.**
  Content in flow; a sibling Glass sized off the measured height and keyed on
  it (ScreenHeader, BottomSheet, Composer pattern).
- **R7 — Money on glass sits on a scrim.** Any figure over glass gets `scrim`
  or a ≥ .55 tint. If a layer can't hold AA on the busiest background, it isn't
  glass there.
- **R8 — The opaque tier is today's flat design.** Every role has a fallback
  from the palette; layout never changes between tiers.
- **R9 — No Glass under a layout animation.** A Glass whose first layout lands
  during an ancestor's Reanimated animation never renders. Nothing wraps a
  Glass in `entering`; sheets gate on settle.
- **R10 — Floating chrome never shares the tab bar's silhouette.** Inset 16,
  gap 8, but a different width or height from the bar.

## 4. Control families

| # | Family | Material | Shape · size | States | Component |
|---|---|---|---|---|---|
| F1 | Floating action | `tinted` | pill · 56 · glyph `icon.lg` 24 `onAccent` · mount right 20 / bottom `insets.bottom + 20` | pressed .96 scale via Pressable; disabled .35; opaque = `primaryFill` + `accentGlow` | `Fab` |
| F2 | Icon button | `clear` (rest) · `tinted` (primary action) · none (`sm`) | pill · `lg` = `composerHeight` 48/48/52, glyph 24 · `md` = `composerHeight − 12` 36/36/40, glyph 18, hitSlop 6 · `sm` = 36 box, bare glyph 18 `muted`, hitSlop 8 | pressed = `g-sel`-style overlay / opacity; disabled .35; opaque = `surfaceAlt` / `primaryFill` | `IconButton` |
| F3 | Conversational field | `chrome` (childless, keyed on height) | pill · min `composerHeight` · grows to 5 lines | focus = `primary` hairline overlay; trailing slot camera → Send | `Composer` (shipped) |
| F4 | Form field | **not glass** · `surface` + `border` | `radius.sm` 8 · minHeight 48 · `body` | focus = `primary` border; disabled = `muted` text | `Input` |
| F5 | Chip (selectable) | canvas: `clear` / `tinted` · content: `controlRaised`+`raised` / `primaryFill` | pill · minHeight `chipHeight` 44/44/48 · pad 15 · `rowLabel` semibold | selected; disabled .35; overflow = clear + dashed `borderAccent` overlay | `Chip surface="canvas"|"content"` |
| F6 | Badge (read-only) | **never glass** · `badgeFlat` + `border` | pill · `label` 11 uppercase · tracking .09 · pad 7×3 | tones: muted · primary (`borderAccent`) · negative | `Badge tone` |
| F7 | Segmented control | **not glass** · track `wellRecessed` · selected `primaryFill` | pill · pad 4 · segment minHeight 36 | selected; labels `muted` / `onAccent` | `SegmentedControl` (exists) |
| F8 | Button (solid) | **never glass** · primary `primaryFill` · ghost `controlRaised`+`raised` · destructive `negative` | pill · minHeight 44 · `control` 16 | pressed .85; loading spinner; `glow` opt-in for hero CTAs (`accentGlow`) | `Button` (exists) |
| F9 | Menu / popover | now: `surface` + `border` + `overlay` · target: `panel` glass on animation-free anchors (R9) | `radius.md` 14 · rows minHeight 44 · row radius `sm` | row pressed `surfaceAlt`; destructive `negative` | `MenuPanel` + `MenuRow` |
| F10 | Bars and shells | tab bar = OS · header `chrome` r0 · sheet `chrome` `radius.lg` top | — | header keyed on height; sheet gated on settle | `NativeTabs` · `ScreenHeader` · `BottomSheet` (exist) |
| F11 | Keypad key | **never glass** · `controlRaised` + `border` | `radius.md` 14 · minHeight 52 · 22/600 | pressed `border` tone · active op `primaryFill` · disabled .35 | `AmountKeypad` (exists) |

## 5. Scales

| Scale | Values | Assigned |
|---|---|---|
| radius | `xs` 4 · `sm` 8 · `md` 14 · `lg` 22 · `pill` | xs swatches/dots · sm inputs/menu rows · md cards/keys/menus · lg sheet top · pill every control |
| control size | `fab` 56 · `lg` `composerHeight` · `chip` `chipHeight` · `md` `composerHeight − 12` · `sm` 36 box | hitSlop lifts md/sm to 44; nothing tappable below 44 |
| icon | `sm` 14 · `md` 18 · `lg` 24 | sm captions and pill glyphs · md rows, controls, in-field · lg FAB and `lg` icon buttons |
| type on controls | `control` 16 · `rowLabel` 15 · `label` 11 | Button/chip · pill/row · badge |
| float | inset 16 · gap 8 · FAB 20/20 | R10 |

## 6. Never glass

Cards, ledger rows, the draft and confirm cards, the keypad, chart plot areas,
any figure, form fields, badges, the segmented control, every solid button.

## 7. Adding a control

1. Find its family above. If none fits, add a family **here first**, then build.
2. Pick the material from the family, never from taste. Content-layer controls
   are flat.
3. `Pressable` wraps `Glass`; `hitSlop` to 44; label on the Pressable (R3).
4. States are overlays or Pressable opacity (R5). Never a Glass prop.
5. If it can change size, use the childless-keyed-Glass pattern (R6).
6. Sizes, radii and icons come from §5's tokens — no literals. The source-scan
   scenarios in `tests/__features__/glass-standard.feature` and
   `radius-scale.feature` will fail on a literal.
7. Verify both tiers on the simulator: native, and Reduce Transparency on.

## 8. Known constraints

See the header of `src/components/ui/Glass.tsx` for the two first-layout
hazards (animation ancestor; detached-tab prop change) and the theme-switch
remount cost. `expo-glass-effect` exposes no blur radius — the OS decides.

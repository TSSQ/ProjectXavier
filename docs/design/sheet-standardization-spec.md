# Build spec: standardize all form sheets on the design system

## Objective
Make the four form bottom-sheets — **Add/Edit transaction, payee, category,
account** — structurally and visually consistent with the design handoff
(`design_handoff_keyboard_avoidance/Layout Pass.dc.html` + its README). One
three-region sheet shape, one set of tokens, shared field/row/keypad primitives.
**Keep the app's current fonts** (no mono-font dependency — the design's mono
amount is rendered in the existing sans font).

The app's NativeWind tokens ALREADY equal the design tokens
(`tailwind.config.js`: `bg #0E1116`, `surface #171B22`, `surfaceAlt #1F2530`,
`border #2A313C`, `text #F2F5F9`, `muted #9AA4B2`, `primary #5B8DEF`). So this is
about *using* them — replace every off-palette hardcoded hex in these sheets with
the tokens.

## Design principles (apply to ALL four sheets)
From the prototype:
- **Three regions** in a flex column:
  1. **Header** (`flex:0 0 auto`): phone grab handle (38×5, radius 3, `#3a414d`),
     centered title (18px / 700), close `x` IconButton pinned top-left.
  2. **Body** (`flex:1; min-height:0`, scrollable, `keyboardShouldPersistTaps="handled"`):
     the form content. Field gap ~18; horizontal padding 22.
  3. **Footer** (`flex:0 0 auto`, padding `14 22 22`): full-width **primary
     Button** (`padding 15`, `font 16`). For the manage-* sheets the footer has a
     **top hairline** (`1px border`); the transaction footer has the keypad above
     the button instead of a hairline.
- **Sheet surface** = `surface` (`#171B22`), top corners radius 24, max-height
  90% (95% for transaction). (Replaces the current hardcoded `#23262C`.)
- **Fields** (`TextField`): box, full width, ~48–50px tall, `surface` bg, `1px
  border`, radius-sm (8), placeholder `muted`.
- **Selector / assignment rows**: icon (18, muted) + label (flex:1, 16) + value
  (16, muted, or `text`/600 when set) + `chevron-right` (18, faint); padding
  `15 16`, gap 12. Grouped in a card (`surface` bg, `1px border`, radius-md 14)
  with **inset hairline dividers** (`1px border`, `margin 0 16`).
- **Helper caption**: 13px, line-height ~1.45, `muted`/faint.
- The sheet must stay clear of the keyboard (the existing `BottomSheet` lift is
  kept) AND the footer button is pinned, so the primary action is never occluded.

## 1. `BottomSheet` — add the pinned-footer region (keystone)
`src/components/ui/BottomSheet.tsx`:
- Add an optional `footer?: React.ReactNode` prop (keep all existing props;
  back-compatible — no footer ⇒ today's behavior).
- Structure the sheet as: header (grab handle + ✕/title/headerRight, as today) →
  **scrollable body** (`ScrollView`, `flex:1`, `keyboardShouldPersistTaps`) holding
  `children` → **pinned footer** (`flex:0 0 auto`) holding `footer`, rendered only
  when provided. The footer sits below the scroll body, inside the sheet, so the
  existing keyboard-lift carries it above the keyboard.
- Replace the hardcoded sheet bg `#23262C` with the `surface` token; replace the
  grab-handle/header hex with tokens where one exists (keep `#3a414d` handle if no
  token — it matches the design's handle color).
- Keep the portal + lift + slide animation + Android back exactly as-is.

## 2. Shared primitives (standardize, reuse everywhere)
- `src/components/ui/Input.tsx` → align to the design **TextField**: `surface` bg,
  `1px border-border`, radius-sm, `minHeight ~48`, placeholder `muted`, current
  font. (Today it's `surfaceAlt`, no border.) This propagates to every manage-*
  field + NoteSheet.
- Reuse the existing `AssignmentRow`/`AssignmentCard` for grouped rows. Make sure
  their styling matches the spec (padding 15 16, gap 12, inset dividers, `surface`
  card bg + border + radius-md). Fix any off-palette hex.
- Optional `src/components/ui/HelperText.tsx` (13px muted caption) if it reduces
  duplication — small, your call.

## 3. Transaction sheet — restyle + fix the layout gap
`src/components/transactions/TransactionFormSheet.tsx`,
`src/components/ui/AmountKeypad.tsx`, `src/components/ui/AmountDisplay.tsx`:
- **Layout**: adopt the prototype's column. The **amount area becomes the
  flex-grow element** (centered, absorbs slack) inside the scroll body, followed
  by the SegmentedControl and the assignment card. Put the **keypad + "Add"
  button in the BottomSheet `footer`** (keypad above the full-width primary
  button). **Delete the `bodyHeight = screen*0.92 - 92` magic number** — the flex
  column sizes itself. (Fixes the dead empty band above the keypad.)
- **Keypad**: restyle to the prototype (line 220) — each key `surface` bg, `1px
  border`, radius 12, `minHeight 52`, font 22/600 (current sans), **operator
  glyphs `primary` (blue)**, digits/`.`/`⌫` in `text`; 4-col grid, gap 8. Key
  order incl. bottom row `. 0 ⌫ +`. (Replaces the solid filled keys.)
- **AmountDisplay**: centered — an outline **currency badge** (`surfaceAlt`/`border`
  pill, e.g. "SGD") **above** the amount figure (keep current font; large via
  `adjustsFontSizeToFit`). Drop the blinking caret and the asymmetric pill+scan
  row (keep the scan affordance if desired, but secondary/subtle). Use tokens.
- Note row icon → `edit-2` (was `edit-3`) to match.

## 4. Payee / Category / Account sheets → three-region structure
For each, move the inline `<BottomSheet>` body to: scrollable body (`children`) +
the primary Button passed via the new `footer` prop. Restyle fields/rows to the
shared primitives + tokens.
- **`app/manage-payees.tsx`**: body = name `Input` ("Payee name") + default-category
  selector (`AssignmentRow`/Combobox-trigger, "Default category (optional)") +
  helper caption. Footer = "Add payee" / "Save".
- **`app/manage-categories.tsx`**: body = name `Input` ("Category name") + kind
  `SegmentedControl` + existing icon/emoji picker (keep its behavior, restyle to
  tokens) + helper. Footer = "Add category" / "Save".
- **`app/manage-accounts.tsx`**: body = the existing fields (name, opening balance,
  subtype, tag) as standardized `Input`s with field gap; footer = "Add"/"Save".
- Keep each screen's existing logic (validation, save, delete via `headerRight`,
  Combobox/default-category behavior) — this is presentation only.

## Out of scope
- Tablet centered-modal variant (sheet stays bottom-anchored).
- Adding a mono font (use current fonts).
- Non-sheet screens (lists, dashboard, assistant) — a later systemic pass.
- Changing any save/validation/domain logic.

## Verify
- `npm run typecheck` / `lint` / `test` green (141). No new domain logic expected;
  if a pure helper is added, unit-test it.
- `BottomSheet` back-compat: existing callers without `footer` behave as before.
- Metro is hot — visually confirm each sheet on the iPhone 17 simulator (the
  keyboard-avoidance lift + pinned footer; the keypad/amount restyle).

## Handoff
Build in this order so each step stays green: (1) BottomSheet `footer` + token
cleanup; (2) Input/AssignmentRow primitives; (3) transaction sheet restyle +
layout; (4) payee/category/account sheets onto the footer structure. Keep the
BottomSheet public API additive. Then qa-tester (focus: API back-compat, all four
sheets compile + keep their save/validation logic, no off-palette hex left in the
sheets, suite green), then reviewer.

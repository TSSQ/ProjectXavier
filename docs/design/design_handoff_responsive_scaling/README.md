# Handoff: Responsive Scaling (Assistant home + /account flow)

## Overview
The ProjectXavier app hard-codes point sizes tuned for a ~390 pt canvas and does
not honor iOS Dynamic Type. On large devices (iPhone 15 Pro Max, 430 pt wide)
the same fixed text fills a smaller fraction of the screen and the vertically
centered hero (a 340 pt `minHeight`) leaves big empty bands — so the app reads as
"zoomed out." The `/account` Q&A step is especially cramped: its question reuses
the 16 pt body role and its subtype chips are 13 pt / ~30 pt tall (below the
44 pt touch minimum).

This handoff specifies a **responsive type & spacing scale** and applies it to
the two affected screens: the **Assistant home** (idle hero + composer) and the
**/account Q&A flow** (the "what type is it?" step + confirm card).

## About the Design Files
The file in this bundle (`Scaling re-look.dc.html`) is a **design reference
created in HTML** — a prototype showing intended sizing and layout across three
device widths, not production code to copy directly. The device frames are drawn
at true logical-point dimensions (1 px = 1 pt) inside a 0.66× display transform,
so the *relative* sizes between devices are exact.

The task is to **implement this scale model in the existing app**
(React Native + Expo + TypeScript, NativeWind/Tailwind) using its established
patterns — `src/theme/tokens.ts`, `tailwind.config.js`, and the
`useThemeColors()` hook idiom. Do not ship the HTML.

## Fidelity
**High-fidelity (hifi).** All font sizes, spacing, touch targets, colors, and the
scaling multipliers are final values. Recreate them exactly. The numbers below
are the source of truth; the HTML is the visual reference.

---

## The Scale Model

Every size derives from a **role** (a base value at the 390 pt reference width),
then is multiplied by two factors:

```
size = base × widthFactor × dynamicTypeFactor
```

### widthFactor
```
widthFactor = clamp(0.94, screenWidth / 390, 1.12)
```
Reference values used in the mocks:

| Device | Width | widthFactor |
|---|---|---|
| iPhone SE / mini (smaller) | 375 pt | ×0.96 |
| iPhone 15 (standard, reference) | 393 pt | ×1.00 |
| iPhone 15 Pro Max (large) | 430 pt | ×1.10 |

Get width from `useWindowDimensions()` (reacts to rotation / split view).

### dynamicTypeFactor
Map the iOS content-size category to a multiplier, **capped for layout** so
Accessibility sizes don't overflow. In React Native, read
`PixelRatio.getFontScale()` (Android/iOS) and clamp it, or read the category via
a Dynamic Type lib. The mock uses these steps:

| Category | Factor |
|---|---|
| xSmall | 0.85 |
| Small | 0.92 |
| Medium | 0.96 |
| **Large (system default)** | **1.00** |
| xLarge | 1.10 |
| xxLarge | 1.22 |
| xxxLarge | 1.35 |
| Accessibility 1+ | 1.45 (cap ~1.60) |

Recommended implementation: `dynamicTypeFactor = clamp(0.85, PixelRatio.getFontScale(), 1.60)`.

### Role ramp (base px, at 390 pt / default Dynamic Type)
Computed columns show `base × widthFactor` rounded to whole px.

| Role | Was (current) | Base | SE ×0.96 | 15 ×1.00 | Pro Max ×1.10 |
|---|---|---|---|---|---|
| Screen title | 28 | 30 | 29 | 30 | 33 |
| Hero figure | 26 | 34 | 33 | 34 | 37 |
| **Prompt** (NEW role — assistant question) | 16* | 22 | 21 | 22 | 24 |
| Section heading | 20 | 22 | 21 | 22 | 24 |
| Body / input | 16 | 17 | 16 | 17 | 19 |
| Control (chip / button) | 13 | 16 | 15 | 16 | 18 |
| Row label | 14 | 15 | 14 | 15 | 17 |
| Caption / field key | 13 | 14 | 13 | 14 | 15 |

\* The `/account` question currently reuses `text-base` (16). Promote it to the
new **Prompt** role.

### Spacing & touch targets (width-aware)

| Token | Was | SE | 15 | Pro Max |
|---|---|---|---|---|
| Screen padding | 24 | 24 | 24 | 28 |
| Idle hero avatar | 160 | 148 | 160 | 180 |
| Flow (mid-Q&A) avatar | 96 | 104 | 112 | 124 |
| Chip tap height | ~30 ⚠ | 44 | 44 | 48 |
| Composer button / input height | ~46 | 48 | 48 | 52 |
| Step-progress dot | 8 | 8 | 8 | 10 |

⚠ Current chip height is below the 44 pt iOS minimum — this is the primary fix
for "the /account step is too small."

---

## Screens / Views

### 1 · Assistant home (idle hero + composer)
**File reference:** `app/(tabs)/index.tsx` → `AssistantScreen`.

**Purpose:** The landing surface — Xavier avatar, greeting, quick-action chips,
pinned composer, bottom tab bar.

**Layout (top → bottom):**
- Status bar (safe-area top inset).
- **Hero:** a flex column, `flex: 1`, centered content — avatar, greeting,
  quick-action chips.
- **Composer:** pinned above the keyboard — `[camera button] [text input] [send button]`,
  then the "Prefer to type it in? Add manually" link.
- Bottom tab bar.

**Components:**
- **XavierAvatar** — size scales with width: 148 / 160 / 180. State `idle`.
- **Greeting** — role Body, weight 700, `line-height 1.3`, centered,
  `max-width ~300`. Copy: `Hi, I'm Xavier. Tell me about an expense, or snap a receipt.`
  Computed size: SE 16 / 15 17 / PM 19.
- **Quick-action chips** — pill (`radius 999`), `bg surfaceAlt`, control-role
  label (SE 15 / 16 / 18), **height 40 / 42 / 46**, horizontal padding 18, `gap 8`,
  wrap + center. Labels: "New account", "Scan receipt", "All commands".
- **Composer input** — pill, `bg surface`, Body-role placeholder color `faint`,
  height = 48 / 48 / 52, horizontal padding 18.
- **Camera / Send buttons** — square pills, side = composer height (48/48/52).
  Send: `bg primary` + `--xv-glow-blue` box-shadow; camera: `bg surfaceAlt`.
- **"Add manually" link** — Caption role (13/14/15), color `muted`, centered,
  `margin-top 10–12`.

**Key change:** remove the fixed `minHeight: 340` on the hero; distribute space
with flex and scale the avatar so tall screens fill instead of centering a small
cluster.

### 2 · /account Q&A — subtype step
**File references:** `app/(tabs)/index.tsx` (`AccountFlowProgress`,
`SubtypeChoiceChips`), `src/domain/accountAssistant.ts` (flow logic +
`ACCOUNT_SUBTYPE_CHOICES`).

**Purpose:** Step 2 of 3 — the assistant asks what type of account it is; the
user taps a chip or types an answer.

**Layout:** same hero column as Assistant home, but the content is:
step-progress row → avatar (smaller, flow size) → question → subtype chips.
Composer placeholder becomes `…or type your own`.

**Components:**
- **Step-progress row** — `[dots] "Step 2 of 3" [Cancel]`, `gap 12`, centered.
  - Dots: 3 × pill, size 8/8/10; done = `positive`, active = `primary`,
    pending = `surfaceAlt`; `gap 6`.
  - "Step N of 3": role uses the step size 13 / 14 / 15, weight 600, color `muted`.
  - "Cancel": same size, weight 700, color `negative`.
- **XavierAvatar** — flow size 104 / 112 / 124 (was hard-coded 96). State `idle`.
- **Question** — **Prompt role**: weight 700, `line-height 1.3`, centered,
  `max-width ~320`. Computed size **21 / 22 / 24**. Copy example:
  `"Savings" — got it. What type is it?`
- **Subtype chips** — pill, `bg surfaceAlt`, control label 15 / 16 / 18,
  **height 44 / 44 / 48**, horizontal padding 20, `gap 10`, wrap + center.
  Labels from `ACCOUNT_SUBTYPE_CHOICES`: "Bank", "Cash", "Credit card",
  "Savings", plus "Skip" (label color `muted`).

### 3 · /account confirm card (step 3)
**File reference:** `app/(tabs)/index.tsx` → `AccountDraftCard`.

**Purpose:** Review the collected account before creating it.

**Layout:** a highlighted card (`border-accent`) inside the scroll content.
Shown at Pro Max scale in the mock (1:1).

**Components (Pro Max values):**
- Card: `bg surface`, `1px border --xv-border-accent`, `radius 14`, `padding 20`.
- Header: title "New account" at **Prompt role 24**, weight 700; right-aligned
  "Assistant" pill — Caption 12, weight 700, color `primary`,
  `1px border-accent`, `radius 999`, padding `4px 10px`.
- Field rows: `[key] … [value]`, `space-between`, `padding 9px 0`,
  `border-top 1px --xv-border`. Key = role Caption **15**, color `muted`;
  value = Body **19**, weight 600. The "Starting balance" value is
  **Geist Mono, weight 700, tabular**, colored `positive` when ≥ 0 /
  `negative` when < 0 (true minus glyph "−"). Example: `+$3,200.00`.
- Buttons: two full-width pills, height 50, control size **18**, weight 700.
  "Discard" = `bg surfaceAlt`; "Create" = `bg primary` + `--xv-glow-blue`.

---

## Interactions & Behavior
- **Chips → answer:** tapping a subtype chip funnels through the same
  `advanceAccountFlow()` a typed answer uses (see `accountAssistant.ts`), so chip
  and typed answer land on identical state. Preserve this.
- **Press feedback:** buttons scale to 0.97, icon buttons to 0.92 on press
  (existing app behavior); ~150 ms.
- **Avatar animation:** the existing XavierAvatar breathe/blink/reaction loop is
  unchanged — only its `size` prop becomes width-derived.
- **Dynamic Type reflow:** when the multiplier increases, text grows and the
  layout reflows (chips wrap, hero redistributes). Nothing should clip; the hero
  scrolls if content exceeds the viewport. `numberOfLines` should NOT be set on
  the question or chip labels.
- **`prefers-reduced-motion`:** avatar already respects it; keep that.

## State Management
No new app state. The scale is derived, not stored:
- `useWindowDimensions()` → `width` → `widthFactor`.
- `PixelRatio.getFontScale()` (or a Dynamic Type category hook) → `dynamicTypeFactor`.
- Existing `accountFlow` / `pendingAccount` state drives which step renders
  (unchanged).

## Design Tokens
Colors (from `src/theme/tokens.ts`, dark theme; light theme also exists):
- `bg #0E1116` · `surface #171B22` · `surfaceAlt #1F2530` · `surfaceBlue #1B2540`
- `border #2A313C` · `borderAccent #33406E`
- `text #F2F5F9` · `muted #9AA4B2` · `faint #6B7686`
- `primary #5B8DEF` · `positive #33C27F` · `negative #F2637E` · `amber #E0884B` · `gold #E0B84B`

Radius: `sm 8 · md 14 · lg 22 · pill 999`.
Neon glow (send/FAB/create): `box-shadow 0 6px 24px rgba(91,141,239,0.50)`.
Fonts: platform system font (SF Pro / Roboto) in-app; the web mock substitutes
Geist / Geist Mono. Money is always mono + `tabular-nums`.

## Recommended implementation
1. Add a `useScaledType()` hook that returns role → px:
   `base × widthFactor × clamp(0.85, PixelRatio.getFontScale(), 1.60)`, with
   `widthFactor` from `useWindowDimensions()`. Replace fixed reads of
   `typography.*` / hard-coded Tailwind text sizes on these screens with it.
2. Add a **`prompt: 22`** role to the type scale and use it for the assistant
   question (`reply` text) in `index.tsx` instead of `text-base`.
3. Set chip / quick-action `minHeight` to 44 (48 on Pro Max) — replace `py-2`.
   Do the same for the composer buttons.
4. Remove the hero's fixed `minHeight: 340`; distribute with flex and scale the
   avatar `size` with width (idle 148/160/180, flow 104/112/124).

## Assets
None. All iconography is Feather (already in the app via `@expo/vector-icons`);
the mascot is `XavierAvatar` / `XavierPet.tsx`. Account/type glyphs use the
existing emoji chips. No new images.

## Files
- `Scaling re-look.dc.html` — the HTML design reference (this bundle).
- Target files to edit in the app:
  - `src/theme/tokens.ts` — add the `prompt` role + scale helpers.
  - `tailwind.config.js` — if exposing the role as a utility.
  - `app/(tabs)/index.tsx` — Assistant home + `/account` flow rendering.
  - New: `src/theme/useScaledType.ts` (the hook described above).

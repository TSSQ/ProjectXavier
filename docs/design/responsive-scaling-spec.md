# Spec: responsive type & spacing scale (Assistant home + /account flow)

Source: `docs/design/design_handoff_responsive_scaling/` (hifi handoff, user-
provided; `Scaling re-look.dc.html` is the visual reference — do NOT port the
HTML). All numbers below are the source of truth and final. Product-shaped work,
but the design is user-provided + hifi, so the spec is a faithful recreation
(no product fork) → auto-pass.

## Objective

The app hard-codes point sizes tuned for ~390pt and ignores Dynamic Type, so on
large iPhones (430pt) it reads "zoomed out" (the hero's fixed `minHeight:340`
leaves empty bands) and the `/account` Q&A step is cramped (question reuses 16pt
body; subtype chips ~30pt tall — below the 44pt touch minimum). Add a responsive
type/spacing scale and apply it to the **Assistant home** and the **/account
Q&A flow** (subtype step + confirm card), all in `app/(tabs)/index.tsx`.

## The scale model

`size = base × widthFactor × dynamicTypeFactor`

- **widthFactor** = `clamp(0.94, screenWidth / 390, 1.12)`, `screenWidth` from
  `useWindowDimensions()` (reacts to rotation/split-view). Ref: 375→×0.96,
  393→×1.00, 430→×1.10.
- **dynamicTypeFactor** = `clamp(0.85, PixelRatio.getFontScale(), 1.60)`.

### Role ramp (base px @ 390pt / default Dynamic Type)
| Role | Base |
|---|---|
| screenTitle | 30 |
| heroFigure | 34 |
| **prompt** (NEW — assistant question) | 22 |
| sectionHeading | 22 |
| body | 17 |
| control (chip/button) | 16 |
| rowLabel | 15 |
| caption | 14 |

(Computed examples the implementer can sanity-check: prompt → SE 21 / 15 22 /
PM 24; body → 16/17/19; control → 15/16/18; caption → 13/14/15. These are
`round(base × widthFactor)` at default Dynamic Type.)

### Spacing / touch targets (width-aware: SE / 15 / ProMax)
- Screen padding 24 / 24 / 28
- Idle hero avatar 148 / 160 / 180
- Flow (mid-Q&A) avatar 104 / 112 / 124  (was hard-coded 96)
- Chip tap height 44 / 44 / 48  (was ~30 — the primary fix)
- Composer button / input height 48 / 48 / 52
- Step-progress dot 8 / 8 / 10

## Approach

### 1. `src/theme/useScaledType.ts` (new)
- Export a pure helper (framework-free, unit-testable) that does the math, e.g.
  `scaledSize(base, widthFactor, fontScale)` and the two clamps
  (`computeWidthFactor(screenWidth)`, `clampFontScale(raw)`), so the arithmetic
  is tested in the plain-Node suite. Put the pure functions in `src/domain/` (or
  a framework-free module) if `src/theme` would drag RN into tests — check the
  import chain; `tokens.ts` today is plain data, keep the pure math importable
  without RN.
- Export a `useScaledType()` hook that reads `useWindowDimensions().width` +
  `PixelRatio.getFontScale()` and returns a `role → px` map for the roles above
  (plus width-aware helpers for the avatar sizes / chip heights / screen
  padding). Returns numbers; consumers apply them via inline `style` (NativeWind
  can't do dynamic runtime sizes).

### 2. Type scale (`src/theme/tokens.ts`)
- Add a `prompt: 22` role to `typography` (with the other role bases), so the
  ramp has a single source. Keep existing roles; add the new bases the hook needs.

### 3. Assistant home (`app/(tabs)/index.tsx`, `AssistantScreen` + hero)
- **Remove the hero's fixed `minHeight: 340`** (line ~739); keep `flex:1` +
  centered so tall screens distribute space.
- **XavierAvatar** idle `size` → width-derived 148/160/180 (was fixed).
- **Greeting**: body role, weight 700, lineHeight 1.3, centered, maxWidth ~300.
- **Quick-action chips**: pill, `surfaceAlt`, control-role label, **minHeight 40
  /42/46** (replace `py-2`), hPad 18, gap 8, wrap+center.
- **Composer input**: the `text-base` input (line ~696) height → 48/48/52, hPad
  18; **camera/send buttons** square, side = composer height; send keeps the
  `primary` bg + blue glow.
- **"Add manually" link**: caption role, `muted`, centered.

### 4. /account subtype step (`AccountFlowProgress`, `SubtypeChoiceChips`)
- **Question** (`reply` Text, line ~752): promote from `text-base` to the
  **prompt role** (21/22/24), weight 700, lineHeight 1.3, centered, maxWidth
  ~320, NO `numberOfLines`.
- **Flow avatar** → 104/112/124 (was 96).
- **Subtype chips**: pill, `surfaceAlt`, control label 15/16/18, **minHeight 44
  /44/48**, hPad 20, gap 10, wrap+center; "Skip" label color `muted`.
- **Step-progress dots**: size 8/8/10; done=`positive`, active=`primary`,
  pending=`surfaceAlt`. "Step N of 3" caption weight 600 `muted`; "Cancel"
  caption weight 700 `negative`.

### 5. /account confirm card (`AccountDraftCard`)
- Title "New account" → prompt role, weight 700; "Assistant" pill caption 12
  weight 700 `primary`, border-accent. Field rows: key caption `muted`, value
  body weight 600; **Starting balance value stays Geist Mono / tabular**,
  `positive` ≥0 / `negative` <0 (true "−"). Buttons full-width height 50,
  control size 18 weight 700; Create keeps `primary` + glow.

## Preserve (do not regress)
- Chip tap and typed answer BOTH funnel through `advanceAccountFlow()`
  (`src/domain/accountAssistant.ts`) → identical state. Unchanged.
- Press feedback (buttons ×0.97, icon buttons ×0.92, ~150ms), avatar
  breathe/blink loop, `prefers-reduced-motion` — all unchanged; only the avatar
  `size` prop becomes width-derived.
- Dynamic Type reflow: text grows, chips wrap, hero scrolls if it overflows —
  no clipping, no `numberOfLines` on question/chip labels.
- No new app state — the scale is derived, not stored.

## Acceptance criteria
1. **Node suite green** (`npm run typecheck && npm run lint && npm test`, 455+).
   Unit-test the PURE math: `computeWidthFactor` clamps to [0.94,1.12] (375→0.96,
   393→1.00, 430→1.10, 320→0.94 floor, 500→1.12 ceil); `clampFontScale` clamps
   [0.85,1.60]; `scaledSize(base,wf,fs)` rounds correctly for a few roles.
2. **No behavioral regression** — the account flow still advances identically
   via chip or typed answer (existing recurrence/flow tests stay green).
3. **Sim/visual confirm** (like prior UI ships): build for the simulator, screenshot
   the Assistant home and the /account subtype step at a small (SE/375) and a
   large (Pro Max/430) width, confirm: no `minHeight:340` empty band; chips ≥44pt;
   the question renders at the prompt size; nothing clips. (Screens are visual —
   Node can't prove them.)
4. **Device confirm (build 34):** the two screens look right on the real device,
   chips are comfortably tappable, and large Dynamic Type grows text without
   clipping.

## Constraints
- ONLY the Assistant home + /account flow (`app/(tabs)/index.tsx`) + the new
  hook/token. Do NOT restyle other screens.
- Keep `src/domain/**` framework-free; the pure scale math must be Node-testable.
- Dynamic runtime sizes go through inline `style={{...}}` (NativeWind utilities
  can't express `base×factor`); keep color/token usage via `useThemeColors()`.
- Money stays mono + tabular.

## Edge cases
- **Rotation / split view:** `useWindowDimensions` re-renders → factors recompute.
- **Accessibility Dynamic Type:** factor caps at 1.60 so layout doesn't explode;
  content scrolls rather than clips.
- **Very small width (≤366):** widthFactor floors at 0.94 (never smaller).
- **Existing 96pt flow avatar / 340 hero:** both replaced; verify no other code
  depends on those constants.

# Build spec: Xavier avatar — animated state transitions (new app motion standard)

Reference bundle: `design_handoff_xavier_avatar/` (README.md, XavierAvatar.jsx.txt,
screenshots). Reference only — do not ship the HTML; do not port web CSS verbatim.

## Objective
Upgrade `XavierPet` so every `state` change **morphs/tweens** (eyes, colors,
accessories) instead of hard-cutting, and fires a one-shot squash-and-stretch
reaction pop — matching the hi-fi handoff. These motion values become the app's
standard going forward.

## Scope (in)
- Rewrite the motion in `src/components/ui/XavierPet.tsx` to tween between states
  (eyes morph, color crossfade, accessory fades, reaction pop), public API
  identical.
- Adopt the handoff's exact end-state geometry, colors, durations, easings.
- Add `useReducedMotion()` support.
- Add a small motion-token module (named easings + durations) used by XavierPet.
- Extract per-state eye geometry into a pure, unit-tested helper.

## Scope (out — do NOT touch)
- `src/domain/avatar.ts` (`AvatarState`, `avatarStateFor`, `AVATAR_LOOKS`, kinds).
- Public props/signature: `XavierPet({ size?, state?, look? })` — same types and
  defaults (keep `size` default **96**; the handoff's 120 is just its reference
  default — all values are ratios of `size`).
- `registry.tsx` / `AssistantAvatar.tsx` / screens / `debug-avatar.tsx`.
- Retrofitting other components to the new tokens — future sweep.

## Approach

**New — motion tokens** (`src/theme/motion.ts`)
- Easings (Reanimated `Easing.bezier`): `standard (0.45,0,0.55,1)`,
  `out (0.22,1,0.36,1)`, `bounce (0.34,1.56,0.64,1)`.
- Durations: `fast 150`, `normal 240`, `eye 340`, `color 360`, `react 480`.

**New — pure eye geometry** (`src/domain/avatarEyes.ts`, framework-free)
`eyeGeometry(state, side): { heightRatio, flatBottom, tiltDeg, offsetYRatio }`:

| state | heightRatio | flatBottom | tiltDeg (L/R) | offsetYRatio (R) |
|---|---|---|---|---|
| idle / listening | 0.17 | false | 0 | 0 |
| thinking | 0.075 | false | 0 | 0 |
| happy | 0.105 | true | 0 | 0 |
| confused | L 0.17 / R 0.10 | false | 0 | R 0.055 |
| angry | 0.085 | false | L +16 / R −16 | 0 |

Eye width is constant `0.13·size`; top radii always = eye width; `flatBottom` →
bottom radii 0; `offsetYRatio` = `marginBottom`.

**Rewrite `src/components/ui/XavierPet.tsx`** (Reanimated; no new deps)
- **Eyes morph:** one `Animated.View` per eye (drop the discrete shape branches).
  Animate height, bottom-radius, tilt, marginBottom as shared values to
  `eyeGeometry()` targets with `withTiming(340, { easing: bezier(out) })`. Keep
  the blink `scaleY` on the eyes container.
- **Color crossfade (360ms):** body gradient stops, glow, and halo crossfade
  between look colors and angry red (`#F4707E`→`#C4302E`, glow `#C4302E`) via an
  `angryProg` shared value + `interpolateColor`. Prefer animating SVG `<Stop>`s
  via `Animated.createAnimatedComponent(Stop)` + `useAnimatedProps`; **fallback:**
  two stacked gradient ellipses crossfading opacity. Glow stays the iOS shadow —
  animate `shadowColor` via `interpolateColor`; idle still pulses
  `shadowOpacity`/`shadowRadius`.
- **Accessories fade, don't pop:** render thinking dots + cheeks always; animate
  opacity 0↔1 over 360ms. Cheeks also scale 0.4→1 over 360ms (bounce easing).
- **Reaction pop (one-shot, 480ms):** on every state change (NOT first mount —
  ref guard), `withSequence` on `reactX`/`reactY`:
  `(1,1)→@28%(1.14,0.88)→@60%(0.94,1.07)→@82%(1.02,0.99)→(1,1)` (bounce), multiply
  per-axis into the body transform (combine with breathing scale in the worklet:
  `scaleX = breathe*reactX`, `scaleY = breathe*reactY`).
- **Ambient loops (keep, tuned to handoff):** breathe 1.9s (idle/thinking/angry/
  confused base), breathe-fast 1.5s (listening), hop 0.9s (happy), shake 0.55s
  (confused), blink ~4.2s (idle/listening), glow-pulse (idle), dots (thinking),
  ring (listening).
- **Remove** the `redFlash` pulsing overlay — angry is now steady red body + glow.
- **Reduced motion:** `useReducedMotion()` → no reaction pop, no infinite ambient
  loops (hold resting); state geometry/colors still update (tween may be instant).

## Requirements / acceptance criteria
- [ ] Public API unchanged (`size` default 96); all callers compile untouched.
- [ ] In `/debug-avatar`, switching any two states **morphs**: eyes tween
  (~340ms), body/glow color crossfades (~360ms, through red into/out of angry),
  dots + cheeks **fade** (~360ms; cheeks overshoot-scale) — nothing snaps.
- [ ] Every state change fires exactly one reaction pop (~480ms) over breathing;
  none on initial mount.
- [ ] End-states match the table + tokens (eye width `0.13·size`, gap
  `0.12·size`, top `0.38·size`; cheeks `rgba(255,170,185,0.4)`; angry
  `#F4707E`→`#C4302E`, glow `#C4302E`; dark `#0E1116`).
- [ ] OS reduce-motion ON → no reaction pop, no ambient loops; states still
  visually distinct.
- [ ] `redFlash` overlay + shared value removed; angry glow steady.
- [ ] `eyeGeometry()` is a pure module with a unit test asserting the table.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green; suite unaffected; no
  unused imports.

## Constraints & conventions
- Reanimated + react-native-svg only — **no new dependencies** (no blur lib; glow
  stays the iOS shadow). Match existing shared-value patterns.
- Translate the web reference to shared values + `withTiming`/`withSpring`/
  `interpolate`/`interpolateColor` — do not port CSS.
- `XavierPet` stays self-contained; no registry/screen changes.

## Edge cases & risks
- **Angry = steady red now (behavior change):** supersedes the recently-added
  slow angry-glow flash. Per the decision (handoff = app's style moving forward)
  this is intended — flag for the user in case they want the flash kept.
- **Animated SVG `<Stop>`** is the riskiest RN piece; use the two-layer
  opacity-crossfade fallback if `useAnimatedProps` misbehaves.
- **Two scales:** combine breathing + reaction per-axis in the worklet; don't
  drop the breathe.
- **First-mount guard** on the reaction pop.
- **Reduced motion is reactive** — honor runtime changes via the hook.
- **Android glow:** shadow-based glow doesn't render on Android (pre-existing,
  iOS-first).
- **Performance:** several shared values + animated gradient — keep worklets
  minimal; verify on a real iPhone if available (CI can't).

## Suggested handoff
> Use the implementer agent to build the spec above. Then run qa-tester on the
> diff (focus: transitions tween not cut for all 6 states, reaction pop fires
> once per change and not on mount, reduced-motion disables motion, `eyeGeometry`
> test + suite green, API unchanged). Then reviewer. Visual verification is via
> the dev `/debug-avatar` state preview.

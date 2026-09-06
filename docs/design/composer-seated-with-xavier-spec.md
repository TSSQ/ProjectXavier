# Composer seated with Xavier — Option D (Messages grammar, in the hero, no chips)

Mockup (approved, Option D): https://claude.ai/code/artifact/20d2f3b4-ca02-4d90-8f3d-98016029b274
Handoff: `.claude/handoff.md` (2026-09-06). Prior spec on this branch:
`docs/design/glass-chrome-adoption-spec.md` (build 102, §10 F1 is the tray
fix this spec supersedes).

## 1. Objective

Re-seat the Assistant composer so it stops reading as a second tab bar. The
approved direction is **D = A + B**: the composer takes Messages' grammar
(a detached "+" circle, a field, a trailing slot that swaps the camera for
Send once there's text), it mounts **inside the hero group under Xavier's
greeting** instead of the bottom band, and the four quick-action chips
**retire** — everything they did lives in "+". The bottom band holds the OS
tab bar and nothing else. Glass stays chrome, never content: the draft card,
answer chips, keypad, avatar body and palettes are untouched.

Diagnosis being fixed (mockup §01): the build-102 tray is a chrome-glass
capsule at the tab bar's own inset and silhouette, 12.6pt above it; inside
it four materials nest (clear disc → opaque `wellRecessed` well → tinted
disc); the well is darker than `bg`; Send is tinted while empty.

## 2. What is already landed (do not redo)

| Item | Status | Where |
|---|---|---|
| `Glass` primitive, roles `chrome / clear / tinted`, opaque fallback | done | `src/components/ui/Glass.tsx`, `src/theme/glassTokens.ts` |
| NativeTabs bar, edge-to-edge under it, nested `SafeAreaProvider` (`insets.bottom` ≈ 83) | done | `app/(tabs)/_layout.tsx`, `index.tsx` ~420 |
| Tray fix F1 (spacer outside the Glass) | done, **superseded here** | `index.tsx` `composerWithInset`, `composerBottomInsetStyle` |
| Quick-action chips as clear glass incl. "Add manually" → `/transactions?add=<token>` | done, **retired here** (the `?add` handling in `transactions.tsx` stays) | `index.tsx` `QuickActionChips` ~4514 |
| `SlashMenu` popover with pinned "What can I ask?" row → `AssistantExamplesSheet` | done, **reused as the "+" menu** | `index.tsx` ~4580–4630 |
| Scan via app `ContextMenu` anchored at a tapped point (`onScan(at)`) | done | `index.tsx` ~2834 |
| Widget deep links `?focus=1` / `?scan=1` with once-per-navigation ref guards | done | `index.tsx` ~2845 |
| Depth field follows the avatar look | done | `DepthField.tsx`, `domain/depthField.ts` |

## 3. Scope — the delta

- **C1** New `Composer` component: "+" · field · morphing trailing slot, one
  `chrome` capsule, no tray.
- **C2** Mount it in the hero group under the reply text; delete the bottom
  band's tray, spacer and keyboard-progress plumbing.
- **C3** Pure state rules (`src/domain/composerState.ts`, BDD-covered):
  idle = "+" · field · camera; typing = "+" · field · Send; /account Q&A =
  field only; draft or account card pending = no composer.
- **C4** "+" opens the existing `SlashMenu` as a menu: every command plus
  **Scan photo** and **Add manually** rows; retire `QuickActionChips`,
  `showQuickActions` and `openAllCommands`.
- **C5** Greeting carries the "+" hint (copy proposal in §4.5 — the user
  edits the words, not the structure).

Out of scope: the search-role tab (mockup Option C); any change to
`SlashMenu`'s rows for typed "/" (the `assistant-commands.feature` contract
is unchanged); the draft card; the `?add` handling in `transactions.tsx`;
anything under `ios/`; Phase 3 cards/rows.

## 4. Approach

### 4.1 `Composer` (`src/components/ui/Composer.tsx`, new)

```ts
interface ComposerProps {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  onSubmit: () => void;          // Send tap and returnKeyType="send"
  editable: boolean;             // !busy, as today
  inputRef: React.RefObject<TextInput>;
  showPlus: boolean;             // §4.3
  onPlus: (at: { x: number; y: number }) => void;
  showCamera: boolean;           // §4.3 — only honoured while value is empty
  onCamera: (at: { x: number; y: number }) => void;
}
```

Render, left to right, in a plain `View` row (`flexDirection:'row',
alignItems:'center', gap: 8`) — **no container glass**:

1. **"+"** (when `showPlus`): `<Pressable accessibilityLabel="More actions"
   onPress={e => onPlus({x: e.nativeEvent.pageX, y: e.nativeEvent.pageY})}>
   <Glass material="clear" radius={radius.pill} isInteractive
   style={{ width: s.composerHeight, height: s.composerHeight,
   alignItems:'center', justifyContent:'center' }}>
   <Feather name={icons.add} color={c.text} size={20} /></Glass></Pressable>`.
   `s.composerHeight` is 48/48/52 (width-tiered), so the target is ≥ 44pt.
   Same Pressable-wraps-Glass rule as Send today.
2. **Field**: `<Glass material="chrome" radius={radius.pill} style={{ flex:1,
   height: s.composerHeight, flexDirection:'row', alignItems:'center',
   paddingLeft: 18, paddingRight: 6, gap: 8 }}>` containing:
   - the `TextInput` (`flex:1`, `fontSize: s.role.body`, `lineHeight:
     round(body × 1.25)`, `letterSpacing: 0`, `color: c.text`,
     `placeholderTextColor: c.muted`, `returnKeyType="send"`,
     `onSubmitEditing={onSubmit}`, `editable`) — **no background class**;
     the placeholder sits on the glass itself (mockup A note 3). Drop
     `bg-wellRecessed` here; the token stays for `NoteSheet`.
   - the **trailing slot**, exactly one of:
     - camera (when `value.trim() === '' && showCamera`): `<Pressable
       accessibilityLabel="Scan photo" hitSlop={8} onPress={e => onCamera({…pageX/pageY})}
       style={{ width: 36, height: 36, alignItems:'center', justifyContent:'center' }}>
       <Feather name={icons.camera} color={c.muted} size={20} /></Pressable>` —
       a bare glyph, no disc (the seat Messages gives the mic; mockup M2).
     - Send (when `value.trim() !== ''`): `<Pressable accessibilityLabel="Send"
       hitSlop={6} onPress={onSubmit}><Glass material="tinted"
       radius={radius.pill} isInteractive style={{ width: s.composerHeight - 12,
       height: s.composerHeight - 12, alignItems:'center', justifyContent:'center' }}>
       <Feather name={icons.send} color="#fff" size={18} /></Glass></Pressable>` —
       36/36/40 disc, hitSlop brings the target to ≥ 44. Keep Feather
       `send`; do not introduce SF `arrow.up` (one icon set per control).
   - **focus ring**: while the input is focused render a sibling overlay
     `View` inside the field — `position:'absolute', top/left/right/bottom: 0,
     borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
     borderColor: c.primary, pointerEvents:'none'`. This is an overlay, NOT a
     change to the `Glass` `edge` prop: a prop change reaches the native
     `GlassView` and, on a detached tab, re-assigns an effect that then
     renders nothing (Glass.tsx header, case 2). Never mutate Glass props on
     focus/blur.
   - `onFocus`/`onBlur` are forwarded up (`onFocusChange?: (f: boolean) =>
     void`) so the screen can dock the hero (§4.2).

No shadow, no `accentGlow`, no `Animated.View` with `entering` anywhere in
this component (Glass first-layout hazard).

### 4.2 Mount in the hero (`app/(tabs)/index.tsx`)

Today the hero column (~3005) is `flex:1, justifyContent:'center',
alignItems:'center'` and renders: `AccountFlowProgress?` → `AssistantAvatar`
→ reply `<Text>` → `SubtypeChoiceChips?` → `QuickActionChips?` → busy
spinner. New order:

`AccountFlowProgress?` → `AssistantAvatar` → reply → `SubtypeChoiceChips?` →
**`<Composer>` (when `composerState.visible`, §4.3)** → busy spinner.

- The row is `alignSelf:'stretch'` with `marginTop: 14` (the mockup's gap
  under the greeting) — the screen already pads `s.screenPadding`
  horizontally, so the row spans `width − 48`, visibly narrower than the
  bar's 16pt inset (mockup M3).
- The `SlashMenu` popover moves with the row: wrap the row in a
  `position:'relative'` `View` and keep the popover's `bottom:'100%',
  marginBottom: 8` placement (it now overlays the greeting, which is fine —
  it's transient). Delete the bottom-band wrapper at ~3225–3236.
- **Docking on focus** (mockup D "Focused"): keep a `composerFocused` state
  from `onFocusChange`. While focused, the hero column switches
  `justifyContent` to `'flex-end'` with `paddingBottom: 8`, and the avatar
  size prop becomes `s.avatarFlow` (the same swap the /account Q&A already
  does). The surrounding `KeyboardAvoidingView` (keyboard-controller,
  frame-synced) already shrinks the container, so the row lands on the
  keyboard. Plain re-layout — no `LayoutAnimation`, no Reanimated layout
  animation (a Glass is inside the group).
- ScrollView `contentContainerStyle` gains `paddingBottom: insets.bottom + 8`
  (the nested provider's ≈83) so the centred group never sits under the
  floating bar at rest; with the keyboard up UIKit hides the bar and
  `insets.bottom` follows, so no separate handling.
- **Delete**: the tray `inputBar` (~2876–2950), `composerWithInset` (~2959),
  `composerBottomInsetStyle` and the `keyboardProgress` shared value +
  `useKeyboardHandler` subscription (~440–480) — the spacer was their only
  consumer (verify with `/usr/bin/grep` before removing the import).
  `wellRecessed` stays in `tokens.ts` (NoteSheet).
- `inputRef` is unchanged in identity (forwarded into `Composer`), so the
  `?focus=1` deep-link effect (~2849) and `runSlashCommand`'s refocus keep
  working untouched.

### 4.3 State rules (`src/domain/composerState.ts`, new, framework-free)

```ts
export interface ComposerSignals {
  pending: boolean;          // draft card up
  pendingAccount: boolean;   // /account confirm card up
  accountFlow: boolean;      // /account Q&A active (any step)
  noOverlay: boolean;        // the existing composite gate (~683)
  busy: boolean;
  draft: string;
}
export interface ComposerState {
  visible: boolean;    // !pending && !pendingAccount
  showPlus: boolean;   // visible && noOverlay && !busy && !accountFlow
  showCamera: boolean; // visible && !accountFlow && draft.trim() === ''
  showSend: boolean;   // visible && draft.trim() !== ''
}
export function composerState(s: ComposerSignals): ComposerState
```

Rationale per state (mockup D frames): draft/account card pending — the
card's Discard / Edit / Save own the moment, a correction goes through Edit;
/account Q&A — the field rides with the question, a commands menu mid-flow
invites abandoning it and Cancel lives in the progress line, camera has no
meaning there; overlays such as `queryAnswer`/`txOp` — field stays (you ask
again), "+" hides exactly as the chips did. `busy` disables the field as today
and hides "+"; Send stays visible but `onSubmit` keeps its `busy` guard.

Placeholder logic (`inputPlaceholder`, ~706) is unchanged.

### 4.4 "+" menu = `SlashMenu` (`index.tsx` ~4580, `src/domain/assistantCommands.ts`)

- New `plusOpen` boolean. `showSlashPopover` becomes
  `noOverlay && (matchCommands(draft).length > 0 && isSlashQuery(draft) || plusOpen)`
  — the typed-"/" behaviour and its BDD contract are untouched; "+" is a
  second way to open the same popover.
- When opened by "+", `items = matchCommands('')` (every command) — the
  existing pure catalogue — and the popover gains two action rows, rendered
  between the commands and "What can I ask?":
  - **Scan photo** (Feather `camera`) → `onScan(plusPoint)` where
    `plusPoint` is the point captured in `onPlus` — the scan `ContextMenu`
    anchors near the "+" (same placement code, no new geometry).
  - **Add manually** (Feather `type`, `icons.keyboard`) →
    `router.push(`/transactions?add=${Date.now()}`)` (the exact call the chip
    makes today; `transactions.tsx`'s token guard stays).
  Row composition is a pure function `plusMenuRows(commands)` in
  `assistantCommands.ts` returning `[...commands, 'scan', 'addManually']`
  so the BDD suite pins the order; the `SlashMenu` gets an `actions` prop it
  renders with the same row styling and `accessibilityLabel`s "Scan photo" /
  "Add manually".
- Close: any row tap, the field gaining text, a tap outside (a full-screen
  transparent `Pressable` behind the popover, only while `plusOpen`), or
  `plusOpen` reset by any overlay. "New account" is the `/account` row
  (`runSlashCommand` → `startAccountCreation`, as the chip did) and "All
  commands" is the menu itself — both chips are subsumed, none is lost.
- **Retire** `QuickActionChips` (~4514–4580), `showQuickActions` (~690),
  `openAllCommands` (~1824) and the `onAddManually` prop; keep `icons.keyboard`
  (used by the row).

### 4.5 Greeting (`index.tsx` ~202)

`GREETING` today: "Hi, I'm Xavier. Tell me about an expense, or snap a
receipt or a statement." Proposed: **"Hi, I'm Xavier. Tell me about an
expense, snap a receipt or a statement, or tap + for more."** This is the
only place the four actions are named on the idle screen now, so the clause
is load-bearing (mockup taste note); wording is the user's call, the
structure (greeting names "+") is not. Keep the reply text's `maxWidth: 300`
— the longer line wraps to two, which the mockup shows.

## 5. Acceptance criteria

Checks: `npm run typecheck && npm run lint && npm test && npm run eval`
green; test count ≥ today's + the new `composer-state.feature` (≥ 7
scenarios: idle, typing, /account name step, /account subtype step, draft
pending, account card pending, overlay-with-field, busy) and the
`plusMenuRows` scenario in `assistant-commands.feature`.
`project.pbxproj` SHA unchanged from build 102 (`shasum`, `ios/` is
gitignored); `package.json` unchanged.

Headless simulator (iPhone 17 Pro, iOS 26.5, recipe in memory
`headless-simulator-driving`; screenshots to `scratchpad/composer-d/`; shut
down AND delete the sim at the end), dark AND light:

1. **Idle**: Xavier at `avatarIdle`, the greeting with the "+" clause, then
   the row — clear-glass "+" circle, chrome field with "Ask Xavier" and a
   muted camera glyph at its trailing edge — and **no chips**. Row width =
   screen width − 48; nothing between the row and the tab bar but depth
   field (horizontal luminance scan across the gap: max step ≈ 1, as the
   build-102 F1 check). Field fill is lighter than `bg` (no well).
2. **Typing** "12 bucks lunch at Joe's": camera gone, tinted Send disc
   present, primary hairline on the field, avatar at `avatarFlow`, row
   docked on the keyboard (gap ≤ 12pt, positive in every frame of the rise —
   no overlap, no glass behind the keyboard). "+" still present.
3. **"+"**: popover above the row listing `/account`, `/transactions`, Scan
   photo, Add manually, What can I ask?; tap outside closes it; Scan photo
   opens the scan `ContextMenu` anchored near the "+"; Add manually lands on
   Transactions with the Add sheet open once (second visit does not reopen).
4. **/account Q&A**: progress line, question at the prompt role, answer
   chips, then the field alone — no "+", no camera; placeholder "…or type
   your own" on the subtype step.
5. **Draft pending**: after a parse the card shows and **no composer** is on
   screen; Save (and Discard) bring the row back under the reply.
6. **Reduce Transparency** (toggle in the sim's Settings app): "+" solid
   `surfaceAlt`, field solid `surface` + `border` hairline (the app's
   `Input` look), Send solid `primaryFill`; everything legible.
7. **Deep links**: `projectxavier://?focus=1` focuses the field (row docks);
   `?scan=1` opens the scan menu at screen centre; neither repeats on a tab
   round-trip.
8. `/account` and a parse round-trip both complete end-to-end (typed answer
   + chip answer; Send from the button and from the return key).

## 6. Constraints

- Working agreement: no new dependencies; never `expo prebuild` /
  `pod install` / `eas build --local`; `ios/` untouched; function-form
  `style` on Pressable is ESLint-banned; keep domain logic framework-free
  (`composerState`, `plusMenuRows`).
- Bare `grep`/`find`/`npx jest` are hooked (fabricated output) — use
  `/usr/bin/grep`, `/usr/bin/find`, `node_modules/.bin/*`; verify only via
  `npm run …`.
- Glass hazards (Glass.tsx header): no `Glass` under an ancestor mid
  Reanimated layout animation; no Glass prop changes on focus/blur (overlay
  ring instead); the theme-switch remount cost (field loses focus at
  sunset) is accepted and pre-existing.
- Do not change the tab bar, `DepthField`, the avatar, the draft card, the
  answer chips, or `SlashMenu`'s typed-"/" rows.

## 7. Edge cases

- **Blur while the keyboard is still animating**: keep `flex-end` until
  `onBlur`, then re-centre; a one-frame re-layout is acceptable, an animated
  one is not (hazard above).
- **Interactive keyboard dismiss**: the KAV tracks the finger; the group
  stays `flex-end` until blur — no snap.
- **Long greeting / large Dynamic Type**: the group grows upward from its
  centre; at AX sizes `s.role.body` scales but `s.composerHeight` does not —
  `lineHeight` at fontScale 1.6 is ≈ 34 < 48, so the single-line field still
  fits; the "+" clause may wrap to a third line — fine.
- **"+" tapped with "/ac" in the field**: the menu shows the full list (the
  button means "everything"), the typed filter applies only to the typed
  path; clearing the field closes neither until a tap outside.
- **Scan from "+" then cancel**: `plusOpen` is already false (row tap
  closed it); the scan `ContextMenu` dismisses on its own as today.
- **Statement queue** (`queue` set): `pending` is set → composer hidden; the
  progress bar + card own the screen; Skip/Save advance as today.
- **`busy` mid-type**: field `editable={false}`, "+" hidden, Send visible but
  inert (guard), spinner under the row as today.
- **Android**: not a target; must compile — `Glass` falls back, the
  overlay ring is plain RN.

## 8. Fallback and follow-ups

- **Fallback (decided up front, mockup D note)**: if the device confirm
  says the first tap sits too high on a 6.9" or first-run users can't find
  Scan / New account, mount the same `Composer` in the bottom band (mockup
  Option A) and restore `QuickActionChips` from git — one commit, no new
  design. Keep `Composer` placement-agnostic (no absolute positioning
  inside it) so this stays a mount-point change.
- Follow-ups: a first-run coach mark on "+" if the greeting clause proves
  insufficient; `PeriodPill`/`Composer` export tidy-up when a third caller
  appears; the pre-existing `openAdd()`-before-accounts-load "Choose account"
  case (glass spec §8) is unaffected but still open.

## 9. QA round 1 — findings and resolutions

- **Critical, fixed.** `?focus=1` set `focusDeepLinkHandledRef` *before* the
  null-safe `inputRef.current?.focus()`. Those lines are unchanged from build
  102, but C2 removed the invariant they relied on: the field used to be in
  an always-rendered bottom bar, and is now unmounted whenever a draft or
  account card is up. Tapping the widget in that state burned the guard on a
  focus that never happened, killing the entry point for the session. The
  guard is now consumed only when the ref is live, with `composer.visible` as
  a dependency so it retries when the card clears.
- **Major, fixed.** Switching tabs while the field was focused left
  `composerFocused` stuck true — React fires no `onBlur` for that — so the
  hero stayed docked with the small avatar on the next visit. A
  `useFocusEffect` cleanup resets it on blur, which cannot race the
  arrival-time deep link.
- **Major, fixed.** `onScan(undefined)` passed `{x:0, y:0}`, and
  `computeMenuPlacement` anchors on the point it is given rather than
  treating 0 as unset — so the widget's `?scan=1` opened the menu in the
  top-left corner under the status bar, against §5 acceptance 7. It now
  passes the real screen centre.
- **Minor, fixed.** `showCamera` did not gate on `busy`, so the stable
  post-Send render put a camera glyph beside the parse spinner (it no-ops
  when tapped). Now gated, with a scenario.
- **Major, accepted with a caveat.** `keyboardVerticalOffset={-insets.top}`
  is calibrated on one Dynamic-Island device and still leaves a 4pt
  residual there. It is a formula rather than a constant, and its failure
  mode on a device with a smaller top inset is a *larger gap* between the
  row and the keyboard, never an overlap — so it degrades safely. The app is
  portrait-locked and ships to a Dynamic-Island device. Re-measure before
  targeting a non-notch device; recorded as a follow-up rather than a
  blocker.

## 10. Review round 1 — findings and resolutions

Applied: `?focus=1` no longer burns its guard while the field is
`editable={false}` (`busy`), the same failure class QA blocked on, one gate
over. The typed-"/" gate is restored to exactly what it was before "+"
existed — a typed "/x" that matches nothing must still open the popover,
because the pinned "What can I ask?" row is the only way out of a mistyped
command; §4.4's formula was wrong to filter on `matchCommands(...).length`.
`onSend` now closes the "+" menu, which otherwise floated over the greeting
attached to a button `showPlus` had already hidden. `showSend` is passed to
`Composer` instead of being re-derived there, so `composerState` is the one
source of truth its scenarios claim to pin. The keyboard-offset comment had
its causality inverted (a negative offset *reduces* padding; the view
over-pads, it does not fall short) and now states the mechanism and the
safe failure direction correctly.

Carried, not fixed:
- **Outside-tap dismissal is hero-scoped**, not the full-screen `Pressable`
  §4.4 called for: taps in the horizontal gutters and the top strip do not
  close the "+" menu. Every tap inside the hero does, which is where the
  menu is. Revisit if it reads as stuck on device.
- **A `Glass` now mounts mid-keyboard-animation.** The Send disc and the "+"
  circle mount and unmount on typing, inside a subtree the
  KeyboardAvoidingView resizes every frame. This is not `Glass.tsx` hazard 1
  (that is scoped to Reanimated layout animations) but it is the same shape,
  and typing the first character while the keyboard is still rising is a
  routine gesture. Device check: focus, type immediately, confirm the Send
  disc has its material rather than rendering blank.
- **`automaticOffset`** in keyboard-controller 1.21 is documented as making
  `keyboardVerticalOffset` purely additive rather than a correction for
  unknown positioning. It would retire the §9 calibration entirely — look at
  it before any non-notch device work.
- `useScaledType`'s `quickChipHeight` has no consumers now the chips are
  retired. Kept deliberately: the §8 fallback restores them from git.
- With "+" open on an empty field, "Scan photo" is the accessibility label of
  both the camera glyph and the menu row. Minor VoiceOver ambiguity.
- In the overlay states §4.3 keeps the field for, a long answer can carry the
  composer off-screen now that it scrolls with the hero rather than being
  pinned. Nothing clips; worth a screenshot in a later pass.

## 11. Device confirm on build 103 — rejected, and what it cost

Two defects on Pigu, both from this run, plus a third found while verifying
the fixes.

- **The composer sat behind the keyboard.** §9 accepted
  `keyboardVerticalOffset={-insets.top}` with the argument that its failure
  mode on another device was a wider gap, never an overlap. That argument
  was wrong on the actual hardware. Replaced with the library's
  `automaticOffset`, which reads the view's true screen-absolute position
  natively (`viewPositionInWindow`) instead of inferring it from a
  parent-relative layout rect. No per-device calibration remains. The
  general lesson: a constant fitted on one device is a measurement that has
  not been taken.
- **The field needed two taps.** The backdrop `Pressable` added for
  tap-to-dismiss wrapped the hero, making it an ancestor of the field, so
  iOS gave it the first touch and the keyboard dismissed instead of the
  field focusing. It is now a sibling declared first and positioned
  `absoluteFill`, so it sits behind the content: taps on the field focus,
  taps on blank space dismiss.
- **The row settled 30pt above the keyboard**, against §5's ≤12pt. Not the
  offset — three stacked bottom paddings (the screen's 16, the scroll
  container's 8, the hero's 8). The first two are dead space once the
  keyboard is up and are now zero while focused, leaving the hero's 8.
  Measured 8.0pt in both themes, with the at-rest row still 216pt clear of
  the tab bar.
- **Flipping the colour scheme while focused stranded the layout.** A scheme
  change remounts every `Glass` by design, taking the field inside the
  composer's with it; React fires no `onBlur` on unmount, so
  `composerFocused` outlived the keyboard, and because the docked layout
  drops its bottom padding the row settled behind the tab bar, unreachable
  until relaunch. This was the third case of the same shape (draft card,
  tab switch, theme switch), each patched separately. Replaced with the
  invariant itself: a `keyboardDidHide` subscription clears the flag, so it
  can never outlive the keyboard however the field goes away.

# Build spec: keyboard-aware bottom sheets + input polish

## Objective
Fix the keyboard overlapping form fields in every bottom-sheet dialog by moving
the shared `BottomSheet` off RN `<Modal>` (which `react-native-keyboard-controller`
can't observe) onto a root portal under `KeyboardProvider`, using a
`KeyboardAwareScrollView`. Also: keep the keyboard up when moving between text
fields but dismiss it when opening the date picker, and fix the cropped text
caret (inputs are too short).

## Why the structural change (read first)
`react-native-keyboard-controller` does **not** work inside RN `<Modal>` — a
Modal is a separate native window the root `KeyboardProvider` can't see (the lib
ships `OverKeyboardView` explicitly as "an alternative to Modal"). The current
`src/components/ui/BottomSheet.tsx` is Modal-based, so simply dropping in a
keyboard-aware scroll view does nothing. The sheet must render **in-tree** under
`KeyboardProvider`. To also cover the full screen (incl. the tab bar on the
Transactions tab) **and** preserve form focus/state, render it through a portal
(`@gorhom/portal`, JS-only) hosted at the app root — not an in-place overlay
(which would leave the tab bar uncovered) and not a naive context-copy (which
remounts the form and loses focus on each keystroke).

## Scope (in)
- Add deps: `react-native-keyboard-controller` (native), `@gorhom/portal` (JS).
- Wrap the app root in `KeyboardProvider` + `PortalProvider` (`app/_layout.tsx`).
- Rewrite `src/components/ui/BottomSheet.tsx` — **same public API** — to render via
  `<Portal>` (root) with a Reanimated slide-up sheet + `KeyboardAwareScrollView`,
  `keyboardShouldPersistTaps="handled"`, and Android back-button to close.
- `src/components/ui/DateField.tsx`: `Keyboard.dismiss()` when the field is tapped.
- New shared `src/components/ui/Input.tsx` (taller, caret not clipped); use it for
  the single-line text fields in the add/edit forms.

## Scope (out — do NOT touch)
- The `BottomSheet` public props/shape (`visible`, `onClose`, `title`,
  `headerRight`, `children`) — must stay identical so the 5 call sites
  (`transactions`, `manage-categories`, `manage-payees`, `manage-accounts`,
  `account/[id]`) need **zero changes**.
- `@gorhom/bottom-sheet` (not adopting it).
- DateField's own iOS date-picker Modal (leave it; it has no text input).
- The assistant screen's existing `KeyboardAvoidingView` and `SignIn.tsx`.
- Backup/recurring/avatar code.

## Approach

**Deps + root (`app/_layout.tsx`)**
- `npm install react-native-keyboard-controller @gorhom/portal`.
- Wrap the **authenticated** render (and ideally all returns) so the tree is
  `<KeyboardProvider><PortalProvider> … <Stack/> … </PortalProvider></KeyboardProvider>`.
  The `PortalProvider` host sits above the navigator so portaled sheets cover the
  tab bar. Keep `StatusBar`. Don't disturb the splash/SignIn gating logic.

**`src/components/ui/BottomSheet.tsx` (rewrite, API unchanged)**
- When `visible`, render a `<Portal>` containing: a full-screen absolute overlay
  → backdrop `Pressable` (dim `bg-black/55`, `onPress={onClose}`) + a bottom sheet
  container (`bg-[#23262C] rounded-t-2xl`, `maxHeight: '92%'`) with the grab
  handle + header (✕ / title / `headerRight`) exactly as today, and the body in
  `KeyboardAwareScrollView` (from `react-native-keyboard-controller`) with
  `keyboardShouldPersistTaps="handled"`, `bottomOffset={24}`, and bottom padding
  for the safe area. When not `visible`, render nothing.
- Animate with Reanimated (already a dep): sheet `entering={SlideInDown}`
  `exiting={SlideOutDown}`, backdrop `FadeIn`/`FadeOut` (or a manual translateY).
- Android: while visible, register a `BackHandler` `hardwareBackPress` listener
  that calls `onClose` (Modal gave this for free); remove on hide/unmount.
- Because `<Portal>` preserves the children's React position, the form keeps focus
  and state across the keyboard opening — do not copy children into host state.

**`src/components/ui/DateField.tsx`**
- In the field's `onPress`, call `Keyboard.dismiss()` before `setShow(true)` so
  tapping the date field dismisses the text keyboard and the picker takes over.
  (Import `Keyboard` from `react-native`.) Nothing else changes.

**`src/components/ui/Input.tsx` (new) + caret fix**
- A thin wrapper over RN `TextInput` with the app's field styling but a
  comfortable height so the iOS caret isn't clipped: `minHeight: 44`, `py-3`
  vertical centering, explicit `lineHeight` (~20 for the 16px font),
  `style={{ letterSpacing: 0 }}` (matches the existing iOS-26 fix), dark
  placeholder color `#9AA4B2`, `bg-surfaceAlt text-text rounded-sm px-3`. Forward
  all `TextInputProps` + `ref`.
- Replace the single-line form `TextInput`s currently styled
  `className="bg-surfaceAlt text-text rounded-sm px-3 py-2.5 text-base"` with
  `<Input>` in: `app/(tabs)/transactions.tsx` (amount), `app/manage-categories.tsx`
  (name), `app/manage-payees.tsx` (name), `app/manage-accounts.tsx` (name,
  opening, subtype, tag), `app/account/[id].tsx` (amount). The multiline **note**
  field: bump its `minHeight` and `lineHeight` too (can stay a raw multiline
  TextInput). Leave the search bars and comboboxes as-is.
- Match `DateField`'s pressable height to the new input height (`py-3` /
  `minHeight: 44`) so the date field and text fields line up.

## Requirements / acceptance criteria
- [ ] `BottomSheet`'s exported props are unchanged; the 5 call sites compile with
  no edits.
- [ ] `BottomSheet` no longer imports/uses RN `Modal`; it renders through
  `<Portal>` under the root `KeyboardProvider`; the overlay covers the full
  screen including the tab bar (verified on a device build — see note).
- [ ] Opening a sheet animates up and the backdrop dims; tapping the backdrop or
  ✕ closes it; Android hardware back closes it.
- [ ] With the keyboard up, the focused field auto-scrolls above the keyboard
  (KeyboardAwareScrollView + `bottomOffset`); tapping from one text field to
  another keeps the keyboard up (no dismiss flash); tapping the **date** field
  dismisses the keyboard and opens the picker.
- [ ] Form focus/state is preserved while the keyboard opens (no remount).
- [ ] The text caret is no longer clipped in the form inputs (taller `Input`).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green. (Runtime keyboard
  behavior + native module are verified on the next EAS device build, NOT in CI —
  both new deps include native/host wiring CI can't exercise.)

## Constraints & conventions
- Keep `BottomSheet` the single swap point; do not change call sites.
- Reanimated is already a dependency — use it for the slide; no other animation lib.
- `react-native-keyboard-controller` calls confined to `BottomSheet` (+ the root
  provider); `@gorhom/portal` to `BottomSheet` + root.
- Match existing NativeWind styling/tokens; dark theme; placeholder `#9AA4B2`.

## Edge cases & risks
- **Native + portal can't be CI/device-verified here** (Actions over budget, no
  device). The bar is typecheck/lint/test green + correct wiring; the real
  keyboard/coverage behavior is checked on the user's next EAS build. Flag this.
- **Focus preservation** is the subtle risk — must use a true portal (`@gorhom/portal`
  keeps React tree position), not a context-copy that remounts children.
- **Tab-bar coverage** — the portal host must sit above the navigator so the
  Transactions-tab sheet's backdrop covers the tab bar (the reason for the portal
  over an in-place overlay).
- **Exit animation** — the sheet must stay mounted during its `exiting` animation;
  Reanimated handles this on unmount when toggling `visible`.
- **Two RN Modals nested** is now avoided, but DateField still uses its own Modal
  for the iOS spinner — that's fine (no text input, appears above the sheet).
- **New Arch** — both libs support RN 0.76 New Architecture (the app has
  `newArchEnabled: true`); `react-native-keyboard-controller` autolinks in a dev
  build (no Expo Go).

## Suggested handoff
> Use the implementer agent to build the spec above (deps + root providers →
> BottomSheet portal rewrite → DateField dismiss → shared Input + caret fix).
> Keep the BottomSheet API identical. Then run qa-tester on the diff (focus: API
> unchanged + 5 call sites compile, no RN Modal in BottomSheet, persistTaps +
> DateField dismiss wiring, Input height/caret, suite green). Then reviewer. Do
> not push (Actions over budget) — local green is the bar; runtime verified on the
> next device build.

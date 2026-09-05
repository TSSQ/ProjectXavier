# Liquid Glass — Phase 2: chrome

Resumes the Apple Glass UI proposal (artifact `257d1545`, "Apple Glass UI
Integration") on `claude/liquid-glass-ui`, which now carries everything up to
build 99. Phase 1 (`d09ce4e`) landed the `--xg-*` tokens, the `<Glass>`
primitive, `useGlass()`/`resolveGlassTier`, and `DepthField`, all behind
`EXPO_PUBLIC_GLASS`. Nothing visible has shipped yet.

Phase 2 is the proposal's "chrome" phase: tab bar, composer, FAB, sheet
shells, plus the depth field — "highest visible payoff, smallest diff". The
goal of this run is one Beta build on Pigu where the app *looks* like glass.

## 1. Objective

- The tab bar is the real iOS 26 Liquid Glass bar, with content travelling
  underneath it, and it never covers anything the user needs to touch.
- The composer, FAB and every bottom sheet are glass. Fields stay solid.
- The depth field sits behind every tab screen so the material has something
  to refract.
- Glass is ON by default on iOS; Reduce Transparency still gets the opaque
  tier (Phase 1's `resolveGlassTier` is unchanged).

## 2. Decisions carried over — and the one new one

**D1 — the tab bar is `NativeTabs`, not our `GlassTabBar`.** Phase 1 noted
that proposal §06 (a bar we draw, inset 12px) and §10 ("swapping Tabs for
NativeTabs hands rendering to the OS") disagree. Resolved for §10:

- The POC's floating bar is `position: absolute` in *both* tiers, so it hides
  the Assistant composer even with the flag off (measured 17 Aug: "the
  composer is entirely behind the pill"). Merging it as-is would ship that
  regression. `NativeTabs` is a `UITabBarController`; the OS owns the bar's
  geometry and safe area.
- The App Store look the POC imitated *is* the system bar. `NativeTabs` gives
  the same material, the selection capsule, and `minimizeBehavior` (the bar
  shrinks on scroll-down) for free, and honours Reduce Transparency itself.
- `expo-router ~6.0.24` ships it: `expo-router/unstable-native-tabs` →
  `NativeTabs`, `NativeTabs.Trigger`, `Icon`, `Label`, `VectorIcon`. New
  Architecture is on (`app.config.ts:27`), which it requires.

Cost accepted: the bar's exact look is Apple's, not ours, and per-tab
customisation is limited to tint/label style. That is what "aligning to
Apple glass UI" means.

**D2 — `GLASS_UI_ENABLED` defaults ON on iOS.** Phase 1 said "Phase 2 is
what makes it worth switching on by default"; this is Phase 2.
`EXPO_PUBLIC_GLASS=0` becomes the escape hatch (was `=1` to enable).

**D3 — the depth field is per-screen, not per-app.** Under `NativeTabs` each
tab is its own view controller; nothing at the `(tabs)/_layout` level can sit
behind all four. Each tab screen mounts `<DepthField />` itself.

## 3. Scope

In: `app/(tabs)/_layout.tsx`, the four tab screens' bottom insets and
backgrounds, the Assistant composer, the FAB on `transactions.tsx` and
`account/[id].tsx`, `BottomSheet.tsx`'s shell, `flags.ts`, deletion of
`GlassTabBar.tsx`.

Out (Phase 3/4): cards, ledger rows, StatTile, filter chips, money scrims,
the widget, App Store screenshots. Xavier's avatar, all charts, the keypad,
Combobox lists and every text field's *focused* state stay exactly as they
are (proposal §09).

## 4. Approach

### 4.1 Tab bar — `app/(tabs)/_layout.tsx`

Replace `Tabs` with `NativeTabs`. Keep `PeriodProvider` wrapping it.

```tsx
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

<NativeTabs
  minimizeBehavior="onScrollDown"
  tintColor={c.primary}          // selected icon+label; verify the prop name in NativeTabsProps
>
  <NativeTabs.Trigger name="index">
    <Icon sf={{ default: 'sparkles', selected: 'sparkles' }} />
    <Label>Assistant</Label>
  </NativeTabs.Trigger>
  <NativeTabs.Trigger name="dashboard">
    <Icon sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }} />
    <Label>Dashboard</Label>
  </NativeTabs.Trigger>
  <NativeTabs.Trigger name="transactions">
    <Icon sf={{ default: 'list.bullet', selected: 'list.bullet' }} />
    <Label>Transactions</Label>
  </NativeTabs.Trigger>
  <NativeTabs.Trigger name="settings">
    <Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
    <Label>Settings</Label>
  </NativeTabs.Trigger>
</NativeTabs>
```

SF Symbols replace the Feather glyphs *in the bar only*; `icons.home` etc. in
`src/theme/assets.ts` stay for every other use. If a chosen symbol name does
not exist on iOS 26 the tab renders blank — verify each one on the simulator
(§6.1). Do not use `VectorIcon` with Feather: it rasterises at one size and
loses the selected/unselected pairing.

Delete `src/components/ui/GlassTabBar.tsx` (POC superseded; nothing else
imports it). Remove its `tabBar={...}` wiring.

Read `node_modules/expo-router/build/native-tabs/NativeBottomTabs/types.d.ts`
for the real prop names before writing this — `NativeTabsProps` is the
contract, not this sketch.

### 4.2 Safe area under the native bar — all four tab screens

With JS `Tabs` the bar took layout height, so no screen padded its bottom.
Under `NativeTabs` the content area extends *under* the floating bar (that is
the effect), so every screen must clear it explicitly.

**First, measure.** On the simulator, log `useSafeAreaInsets().bottom` from
inside `transactions.tsx`. Two outcomes:

- It includes the bar (≈ 83–100pt on iPhone 17 Pro): the root
  `SafeAreaProvider` sees the tab VC's `additionalSafeAreaInsets`. Use it.
- It is the home indicator only (34pt): the root provider is above the tab
  VCs and can't see the bar. Then wrap each tab screen's root in its own
  `<SafeAreaProvider>` (nested providers measure their own native view —
  react-native-safe-area-context's documented pattern), and re-measure.

Record which outcome it was, with the number, in the PR/commit message.

Then per screen:

| Screen | Scrolling container | Change |
|---|---|---|
| `transactions.tsx` (FlatList, ~562) | `contentContainerStyle.paddingBottom: 96` | → `insets.bottom + 96` (keeps the FAB clearance) |
| `dashboard.tsx` (ScrollView, ~374) | none | add `paddingBottom: insets.bottom + 24` |
| `settings.tsx` (ScrollView, ~198) | none | add `paddingBottom: insets.bottom + 24` |
| `index.tsx` (Assistant) | composer is fixed chrome | see §4.3 |

Add `contentInsetAdjustmentBehavior="never"` explicitly on those three
scroll containers so UIKit does not *also* inset them once the VC's safe area
grows — double padding is the classic NativeTabs symptom. If measurement shows
UIKit is already insetting correctly with `"automatic"` and `insets.bottom`
is home-indicator-only, the reverse configuration is acceptable — but pick
one and say which in the commit.

Every tab screen's outermost view keeps `backgroundColor: c.bg` (the
depth field sits on top of it, §4.6) so nothing ever shows the window
through.

### 4.3 Composer — `app/(tabs)/index.tsx` (`inputBar`, ~2811)

Proposal §05: "Clear at rest, solid on focus"; §07: "Composer is chrome glass,
pinned above a floating tab bar."

- Wrap the composer row (camera · input · send) plus the "Add manually" link
  in `<Glass material="chrome" radius={radius.lg}>` with horizontal padding
  `s.screenPadding` and `paddingBottom: insets.bottom + 8` so the tray sits
  above the native bar. The tray is the *last child* of the
  `KeyboardAvoidingView`, exactly where the row is today — it is not
  absolutely positioned. Keyboard avoidance keeps working because the tray is
  in flow.
- Camera button: `<Glass material="clear" radius={radius.pill} isInteractive>`
  replacing `bg-surfaceAlt`.
- Send button: `<Glass material="tinted" radius={radius.pill} isInteractive>`
  keeping `shadowColor: c.primaryFill` + `c.elevation.accentGlow` on the
  wrapper (tinted glass "plus the existing neon glow").
- The `TextInput` keeps `bg-surface` — it is a field, and fields stay solid
  (§09). Do not put glass behind the caret.
- `Pressable` must wrap `Glass`, not the reverse, so the 44pt target and
  `accessibilityLabel` stay on the pressable.

### 4.4 FAB — `transactions.tsx` (~739) and `account/[id].tsx` (~640)

`<Pressable ... className="absolute right-5 bottom-5 ...">` → the Pressable
keeps position/size/label; its fill becomes
`<Glass material="tinted" radius={radius.pill} isInteractive style={{ width: 56, height: 56 }}>`
with the glow on the Pressable. `bottom` becomes `insets.bottom + 20` so the
FAB clears the native bar (today `bottom-5` = 20pt assumes an opaque bar in
layout). One `GlassContainer` around the FAB is *not* needed — the cluster
merge is for multiple FABs, and there is one.

### 4.5 Sheet shell — `src/components/ui/BottomSheet.tsx`

The sheet's rounded container (the `Animated.View` with `bg-surface` /
`backgroundColor: c.surface` and the top radius) becomes
`<Glass material="chrome" radius={<the existing sheet radius>} edge specular>`.
Keep the backdrop dim as it is (the proposal's "45% dim"; do not retune it
this phase). Everything *inside* the sheet — header row, body, footer, every
Input/Combobox/keypad — is untouched and stays on its solid fills.

Because `Glass` sets `overflow: 'hidden'`, confirm the grab handle and the
`SlideInDown` entering animation still render (the handle is inside the
shape; the animation is on the outer Animated.View — keep Glass *inside* the
animated wrapper, not around it).

`BottomSheet` renders through the root Portal "so it covers the full screen
(including the tab bar)". Under `NativeTabs` the bar is a native `UITabBar`;
verify on the simulator that an open sheet still covers it (§6.3). If it does
not, the fix is `presentationStyle` on the Portal host, not a z-index — stop
and report.

### 4.6 Depth field — the four tab screens

Each tab screen's root `View` gets `<DepthField />` as its **first** child,
absolutely filling (`StyleSheet.absoluteFill`, `pointerEvents="none"` — the
component already does both; confirm). Content renders above it. Not on
`account/[id]`, not on any sheet, not on modals — tab screens only.

`DepthField` already returns `null` on the opaque tier? Check. If it does
not, it must: the field exists to light glass; with no glass it is a moving
gradient behind text for no reason.

### 4.7 Flag — `src/lib/flags.ts`

```ts
export const GLASS_UI_ENABLED: boolean =
  Platform.OS === 'ios' && process.env.EXPO_PUBLIC_GLASS !== '0';
```

`flags.ts` currently imports nothing from RN. If keeping it RN-free matters
(it is imported by `parseMetrics`, which the plain-node BDD suite loads —
check), gate on `Platform` inside `useGlass()` instead and keep `flags.ts` as
`process.env.EXPO_PUBLIC_GLASS !== '0'`. Either way, update the doc comment:
it currently says OFF by default.

Update `tests/__steps__/glass-tokens.steps.ts` if any scenario asserts the
default is off.

## 5. Acceptance criteria

1. `app/(tabs)/_layout.tsx` imports from `expo-router/unstable-native-tabs`
   and no longer imports `Tabs` or `GlassTabBar`;
   `src/components/ui/GlassTabBar.tsx` is gone.
   `grep -rn GlassTabBar src app tests` → nothing.
2. On an iOS 26 simulator, all four tabs show a symbol and label; the
   selected tab is tinted `c.primary`; switching tabs works; the bar is
   translucent with list rows visible through it on Transactions.
3. **Assistant composer is reachable**: tap the input, type, the keyboard
   rises, the tray rises with it, the send button is tappable. Screenshot
   with keyboard up and keyboard down.
4. Transactions: scroll to the last row — it clears the bar (visible above
   it, not under it) at rest; the FAB clears the bar.
5. Dashboard and Settings: last item clears the bar.
6. Open any bottom sheet (e.g. the FAB's Add transaction) — it covers the tab
   bar; its shell is glass (something behind it visibly refracts) and the
   Amount/Payee/Account fields are solid.
7. Reduce Transparency ON (Settings → Accessibility → Display → Reduce
   Transparency, on the simulator): composer, FAB and sheet render their
   opaque fallbacks; the depth field is absent; the native bar does whatever
   iOS does (not ours to assert). Screenshot.
8. Light mode: repeat 2, 3 and 6. The tinted send/FAB must not read as
   disabled on a pale background (proposal §08). If it does, note it — do not
   retune tokens this phase.
9. `npm run typecheck`, `npm run lint`, `npm test` green. Test count must not
   drop below 1902.
10. `ios/ProjectXavier.xcodeproj/project.pbxproj` SHA unchanged before/after
    (`shasum` — it is `431aa662ae6b…` now). **No `expo prebuild`, ever.**

## 6. Verification on the simulator

Build with `xcodebuild -workspace ios/ProjectXavier.xcworkspace -scheme
ProjectXavier -configuration Release -sdk iphonesimulator -derivedDataPath
ios/build -destination 'generic/platform=iOS Simulator' build` (Release
embeds the JS bundle; no Metro needed). Create an **iPhone 17 Pro / iOS 26.5**
device with `simctl create`, boot, install, launch `com.projectxavier.app`.
Use `simctl io <udid> screenshot`. Save screenshots to the scratchpad under
`glass-phase2/`. **Shut down and delete the simulator afterwards.**

6.1 Symbols: a blank tab icon = bad symbol name; pick another.
6.2 Insets: the §4.2 measurement, recorded.
6.3 Sheet over bar: §5.6.
6.4 The `expo-glass-effect` pod is already installed (`ios/Podfile.lock` has
    `ExpoGlassEffect`); if Xcode complains about it, run `pod install` in
    `ios/` — never prebuild.

## 7. Constraints

- All the working-agreement rules: parameterised SQL (n/a), zod at
  boundaries (n/a), `Pressable` never takes function-form `style` (ESLint
  enforces), plain-object styles.
- No new dependencies. `expo-glass-effect` and `react-native-svg` are the
  whole material stack.
- `XavierPet` must not gain a glass or `overflow: hidden` ancestor (§09).
  The composer tray is *below* the avatar in the tree, not around it.
- Charts' plot areas untouched (Phase 3 concern, but don't wrap them by
  accident when adding `DepthField` to the dashboard root).

## 8. Edge cases

- **Keyboard + native bar**: when the keyboard is up, the tab bar is hidden
  by UIKit; `insets.bottom` may change. The tray's `paddingBottom` should not
  double-count — `KeyboardAvoidingView` `behavior="padding"` already adds the
  keyboard height. If the tray floats 34pt above the keyboard, drop the inset
  when the keyboard is visible (`useKeyboardHandler` is already imported in
  this file's neighbourhood).
- **Deep link `?focus=1`** into the Assistant still focuses the input.
- **Large Dynamic Type**: the native bar handles its own labels; the composer
  tray height still derives from `s.composerHeight`.
- **Android**: not a target (fallback tier), but it must still compile —
  `NativeTabs` renders a Material bar there; fine.

## 9. Follow-ups (not this run)

Phase 3: `Card`, `TransactionRow`, `ListRow` groups on `card` glass with the
money scrim; ledger scroll perf on the oldest device. Phase 4: contrast
audit, Reduce Transparency pass on every screen, new store screenshots. Also:
the "Settings → Reduce transparency" in-app switch from proposal §07 (it
should mirror, not duplicate, the iOS setting — needs a product answer).

Round 5 QA: `DepthField`'s wells keep looping (`withRepeat(..., -1, true)`,
confirmed in the component) on tabs that are mounted but not focused — each
tab screen mounts its own `<DepthField />`
(D3), and none of them currently gate the animation on focus, so a
backgrounded tab's field is still burning frames the user can't see. Phase 3
should gate it behind `useIsFocused()` (or pause/resume the loop in a
`useFocusEffect`) rather than running unconditionally for the screen's whole
mounted lifetime.

Round 5 QA re-gate, carried (not blocking):
- **Glass first-layout hazard on the composer tray and FABs.** The sheet
  gates its `Glass` behind SlideInDown settling because expo-glass-effect
  applies its effect only on the first `layoutSubviews`. The tray and the two
  FABs mount unconditionally; their ancestors animate via UIKit (NativeTabs
  switch, Stack push), not Reanimated layout animations, and sim screenshots
  in rounds 2–5 showed them glassy after both — but confirm on device
  (build 100: switch tabs, push into an account, cold-launch) before Phase 3
  adds more unconditional instances.
- **Rapid close→reopen of a sheet** while SlideOutDown is still playing can
  stack a fresh instance over the exiting one (pre-existing: the subtree is
  gated by `visible`, not keyed). Needs an unusually fast double-tap; fix by
  keying the animated subtree per open if it's ever observed.

Review, carried:
- `BottomSheet`'s solid phase re-draws Glass's edge + specular lip inline so
  the settle swap is seamless; a `forceOpaque` prop on `Glass` would let the
  wrapper be a Glass in both phases and remove the duplication (Phase 3).
- Depth field is 12 oversized animated SVG layers across the four mounted
  tabs (3 wells × ~0.9×max(w,h) each) — check battery on the build-100 soak
  before Phase 3 adds more; pairs with the `useIsFocused` gating above.

# Spec: transparent, hiding ScreenHeader

Approved from a device screenshot: `ScreenHeader` (Dashboard, Transactions)
rendered as a flat opaque band with a hard edge against the `DepthField`
gradient scrolling under it — `chrome`'s 62%/68% tint was crushing the
gradient. Settings has no header chrome at all, which is why its gradient
runs cleanly to the top; these two screens can't drop chrome entirely
(they need the title/period/search row), so the fix is a lighter material
plus the standard hide-on-scroll behaviour.

## Decision 1 — the header carries no material at all

**Superseded once, on device.** The first attempt kept the blur and added a
fifth glass role, `sheer`, at roughly a third of `chrome`'s tint, so the
full-bleed `DepthField` could read through the header. On device that still
read as a band: lighter, but visibly a different surface from the gradient
either side of it. The user's call was unambiguous — "totally invisible, so I
don't see a background color for the header".

So `ScreenHeader` now draws **no material on either tier**: no `<Glass>`, no
`backgroundColor`, no bottom edge. Only the title and the period pill are
painted, over whatever the screen's own background is. The pill keeps its
`clear` glass — it is a control, not chrome, and R1 already draws that line.

`sheer` was deleted with it. It had exactly one call site, and once that call
site wanted nothing, a role with no callers is precisely the unexercised API
that this standard's own review rounds kept rejecting. Its two scenarios and
its style-guide row went too; the role list is back to the proposal's four.

**What now carries legibility.** Nothing sits behind the title, so the answer
is the hide-on-scroll in Decision 2 rather than a material: at rest the scroll
padding starts content below the header, and by the time content would pass
behind it, the header is already sliding away. The opaque tier (Reduce
Transparency) is no longer a special case — there is no material to fall back
from, and the title keeps full text contrast against the canvas.

**What this removed as a side effect.** With no `<Glass>` in the header there
is no keyed-remount machinery, no `mayMountGlass` gate, and no measured-height
state inside the component. The R9 hazard does not vanish entirely — the
period pill's `clear` glass still lives inside the animated wrapper — so the
reasoning in `ScreenHeader.tsx`'s header comment still stands and still needs
to hold.

## Decision 2 — hide on scroll, both screens

`src/domain/headerScrollOffset.ts` — `nextHeaderOffset({ offset, previousY,
y, headerHeight, locked })` — is the whole rule, framework-free (the
`'worklet'` directive on it is a no-op string statement in Node, real on
device). `offset` is the header's own slide distance: `0` fully shown,
`headerHeight` fully hidden. Scrolling down grows it (hides, clamped at
`headerHeight`); scrolling up shrinks it (reveals, clamped at `0`); within
`NEAR_TOP_THRESHOLD` (24pt) of the top, or at any negative `y` (the
rubber-band bounce past the top), it's forced to `0` regardless of the
computed delta. Eight scenarios in `header-scroll-offset.feature` cover all
of this, including the search-field exception below.

`src/components/ui/ScreenHeader.tsx` exports `useScreenHeaderScroll({
headerHeight, locked })`, called once per screen. It owns the Reanimated
shared values and returns `{ onScroll, style, hidden }`: `onScroll` goes on
the screen's own scrollable, `style`/`hidden` go to `<ScreenHeader
scroll={{ style, hidden }} />`. Putting the hook here (not duplicated inline
in both screens) keeps the actual decision — `nextHeaderOffset` — the only
place either screen's hide-on-scroll behaviour is expressed.

**`onScroll` is a plain JS-thread callback, not a `useAnimatedScrollHandler`
result — see "Why `onScroll` is a plain callback" below; this is a
device-tested finding, not the original design.** Both screens use the
PLAIN RN `ScrollView`/`SectionList` as a result (a worklet handler needs an
`Animated.*`-wrapped component; a plain callback doesn't). Both set
`scrollEventThrottle={16}` so the slide tracks the finger smoothly rather
than in 100ms-apart steps.

No React re-render happens per scroll frame: `onScroll` only ever writes a
shared value (`offset.value = …`), and the header's transform is derived
from it by `useAnimatedStyle`. The one piece of ordinary React state,
`hidden`, only updates on the rare frame the offset actually crosses
`headerHeight` (via `useAnimatedReaction` + `runOnJS`, still a UI-thread
shared-value reaction), not once per frame — driving `pointerEvents`
(`box-none` ↔ `none`) and `accessibilityElementsHidden`/
`importantForAccessibility` on ScreenHeader's outer view, so a fully-hidden
header can't eat a touch or be reached by VoiceOver.

Content never shifts when the header hides: both screens' scroll
`paddingTop` is still seeded from `headerHeight` (the *measured* height,
from `onHeight` — unrelated to the animated slide offset), and the header
is absolutely positioned. Sliding it away just uncovers already-padded
space; the padding itself never changes.

### The search-field exception

Transactions renders its open search field through ScreenHeader's `below`
prop. Sliding a focused text field off screen mid-typing is a genuine bug,
not a nicety, so `useScreenHeaderScroll({ headerHeight, locked: searchOpen
})` is called with `locked: searchOpen` — `nextHeaderOffset` returns `0`
unconditionally whenever `locked` is true, regardless of scroll position or
direction. This also means opening search while the header is already
hidden (mid-scroll) snaps it back into view rather than leaving it stuck
off-screen — covered by its own scenario
("An open search field reveals an already-hidden header"). Dashboard has no
such field, so it calls the hook with `locked` omitted (defaults `false`).

## Why `onScroll` is a plain callback (device-tested root cause)

First-pass implementation used `useAnimatedScrollHandler` on
`Animated.ScrollView`/a `createAnimatedComponent`-wrapped `SectionList`, per
the brief's own suggested shape. A first round of simulator verification
(build+install+drive via `idb`, both screens, both real scroll gestures and
pixel/AX-tree measurement) found the header's frame **never changed at
all** across three states (top of list, slow drag, hard fling) even though
the list content demonstrably scrolled underneath it.

**Diagnosis, not guesswork.** `console.log`/`console.warn` do not reach
`idb`'s unified-log capture in this Release/Hermes build at all (confirmed:
zero output despite real UIKit scroll activity in the log stream), so
on-screen text was used instead. Steps, each rebuilt and re-driven on
device:

1. A *minimal* handler — `useAnimatedScrollHandler({ onScroll: () =>
   runOnJS(setDebug)('FIRED') })`, nothing else, no call to
   `nextHeaderOffset` — never updated the on-screen text, on either
   `Animated.ScrollView` (Dashboard) or the wrapped `SectionList`
   (Transactions), under a confirmed real scroll (list content visibly
   moved to the bottom of a 7-account, 15-transaction seeded dataset).
   This ruled out the brief's own leading hypothesis (that
   `nextHeaderOffset` itself wasn't correctly workletized) — the bug is
   below that, in the handler-registration/dispatch mechanism itself, not
   in anything this feature's code calls.
2. A plain (non-Reanimated) `onScroll={(e) => setDebug(...)}` on the exact
   same `Animated.ScrollView`, same gesture, fired correctly and
   immediately. This isolated the break to specifically
   `useAnimatedScrollHandler`'s native event registration — not the
   gesture, not the component, not this feature's own logic.

**Root cause:** in this build, `useAnimatedScrollHandler`'s native
direct-event registration does not fire — on either `Animated.ScrollView`
or a `createAnimatedComponent`-wrapped `SectionList`. `useAnimatedStyle` and
`useAnimatedReaction` (shared-value *reactions*, a different Reanimated
code path from native event-handler *registration*) are unaffected — both
are exercised elsewhere already (BottomSheet's keyboard lift) and continued
working throughout. Nothing points at New Architecture being off (it's on:
`newArchEnabled: true`, confirmed in the built binary via `ExpoFabricView`/
`ReanimatedModuleProxy::initializeFabric` symbols) or a version mismatch
(`Podfile.lock` and `node_modules` agree: `RNReanimated 4.1.7` /
`RNWorklets 0.5.1`). The exact reason the event-registration path
specifically doesn't fire is not identified further — that would mean
instrumenting Reanimated's own native/C++ layer, out of scope here — but
the fix below doesn't need to know why, only that this specific path is
unusable in this build today.

**Fix:** `onScroll` is an ordinary JS-thread callback (confirmed working,
above), not a `useAnimatedScrollHandler` result. It still writes into the
same `offset` shared value `useAnimatedStyle` reads, so the slide itself is
unaffected — this is the "throttled JS-thread handler" fallback the brief
authorized in advance, keeping `nextHeaderOffset` the one place the rule is
expressed, rather than duplicating it into a worklet AND a JS copy. Because
a plain callback is all `onScroll` needs now, Dashboard and Transactions use
the **plain** RN `ScrollView`/`SectionList` — the `Animated.*`-wrapped
versions, and the hand-written type cast `AnimatedSectionList` needed to
recover `SectionList`'s generics through `createAnimatedComponent`, were
only ever needed for a worklet handler, so both were removed rather than
left as dead weight.

**Re-verified after the fix**, on device, both screens: a slow controlled
drag on Dashboard slides the header fully off-screen (its title/pill
disappear from the screenshot AND from the accessibility tree) and a
reverse drag reveals it fully (`AXFrame`/pixel measurement, not just visual
inspection); Transactions' `SectionList` does the same; opening search and
scrolling substantially (contentOffset genuinely moved, confirmed via the
same on-screen instrumentation) kept the header fully shown throughout, per
the search-field exception. A fast fling that overshoots and rubber-bands
at the bottom edge can transiently reveal the header during the bounce-back
(the rule reads that settle-back as "scrolling up") — noted as a real,
minor consequence of the delta-based rule, not the frozen-header bug, and
left as-is (not in the brief's scenarios; a future refinement could ignore
deltas during a momentum bounce if this proves visible in practice).

### The unrelated cosmetic line

Separately reported: a faint ~1-2px bright line at the header's lower edge
(confirmed present, `rgba(244,251,255)` in light mode, a smaller but
present brightness step in dark mode — exact pixel values recorded via
on-device sampling). Tested with `specular={false}` on the header's
`Glass`, rebuilt, re-measured the same pixel column: **identical values,
line unchanged.** This rules out this app's own specular-lip overlay
(`Glass.tsx`'s `lip`, drawn at the material's TOP edge, not the bottom
where the line actually sits) as the cause. Left as a cosmetic, unfixed
follow-up — likely the native Liquid Glass material's own edge treatment,
which isn't controlled by anything this component sets.

## Why the `Animated.View` wrapper doesn't violate R9

`ScreenHeader.tsx`'s file comment used to warn against wrapping the header
in `Animated.View` with `entering` — R9 (style guide, `Glass.tsx`,
`glassMountGate.ts`): a Glass whose first layout lands during an ancestor's
Reanimated *layout animation* never renders, because `expo-glass-effect`
assigns its native effect exactly once, on that first `layoutSubviews`.

This change does add an `Animated.View`, but not the case R9 warns about:

- **No `entering`/`exiting` anywhere on it.** R9 is specifically about a
  layout-animation ancestor (`entering`, `SlideInDown`, etc.) intercepting
  the FIRST layout pass. A continuous `translateY` driven by
  `useAnimatedStyle` is a paint-time transform, applied as an ordinary prop
  mutation on the UI thread — it never touches Yoga's box model (the nested
  Glass's own width/height/position in the layout tree are unaffected; only
  the render transform of the ancestor moves), so it can't defer or reorder
  the Glass's `layoutSubviews` call the way an entering animation does.
- **The header's first layout happens at rest.** The shared value backing
  the slide starts at `0` (fully shown) and nothing animates until a real
  scroll event arrives, well after mount. So the exact moment
  `mayMountGlass`/`Glass.tsx` care about — the header's first layout — is
  identical to before this change: no motion in flight, same as the
  composer tray and `MenuPanel` (the other "mounts with the screen, no
  `entering` ancestor" cases `glassMountGate.ts` already documents).
- **The material moves with its view, not independently of it.** Once
  mounted, the whole header subtree — Glass included — is one composited
  layer; translating that layer doesn't detach or reset the blur, the same
  way a `UIVisualEffectView` keeps blurring while its own layer scrolls or
  animates.

Still true, unchanged: nothing may add `entering`/`exiting` to this wrapper.
That's the actual hazard, and nothing above licenses it.

**Confirmed on device, not just reasoned about.** In light mode the header
samples 240-245 where the opaque fallback would be exactly 255, and that
value varies across the header's width tracking the `DepthField` gradient
underneath — i.e. the material is live and genuinely refracting, not
rendering blank. Scrolling a red expense amount under the header shifted
the sampled band's red channel measurably. This held across the
`Animated.View` wrapper change (including remounts on search-open/close),
so the reasoning above matches what actually ships, not just what should
happen in theory.

## Verified on device

Build: `xcodebuild -workspace ios/ProjectXavier.xcworkspace -scheme
ProjectXavier -configuration Release -sdk iphonesimulator -derivedDataPath
ios/build -destination 'generic/platform=iOS Simulator' build`, installed
and driven via `idb` (`ui tap`/`ui swipe`/`ui describe-all`/`screenshot`) —
`Xavier's simulator`, iOS 26.5. Seeded data: 1→7 accounts and 15
transactions via the in-app assistant (a fresh install has none, and empty
screens don't scroll far enough to exercise this at all).

1. Header reads as a light, blurred bar with the `DepthField` gradient
   showing through in both dark and light mode — confirmed via pixel
   sampling, not just visual read (see the R9 confirmation above).
2. Scrolling each screen down slides the header fully off-screen (title and
   period pill absent from both the screenshot AND the accessibility tree
   — see item 4); scrolling up reveals it progressively; near the top it's
   always fully shown. See "Why `onScroll` is a plain callback" above for
   the one caveat found: a hard fling that overshoots and rubber-bands at
   the bottom can transiently reveal the header during the bounce-back.
3. Transactions: opened search, scrolled the list substantially (confirmed
   via measurement, not just a gesture that might not have registered) —
   the header (and the focused field) stayed fully shown throughout, on
   every attempt.
4. With the header fully hidden, its title and period pill are absent from
   `idb ui describe-all`'s accessibility tree entirely (not just visually
   off-screen) — VoiceOver cannot reach them.
5. Content did not shift when the header hid/revealed across every test
   above — the list's own scroll padding never moved.
6. Reduce Transparency (opaque tier) was not re-verified in this pass —
   carried over from the original glass-standard work this reuses
   (`mayMountGlass`/the opaque-tier fallback branch are unchanged code
   paths); flagged here as a follow-up rather than assumed.
7. The header's glass material renders and refracts live — see the R9
   confirmation above.

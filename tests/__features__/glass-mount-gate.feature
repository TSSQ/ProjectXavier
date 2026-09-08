Feature: Glass mount gate — may a Glass mount yet?

  style guide R9: "No Glass under a layout animation." A GlassView applies
  its native effect exactly once, on its own first layout, and loses it for
  good if that layout lands mid Reanimated `entering` animation — so a
  Glass gated on an ancestor's settle must not mount until the ancestor has
  actually settled. Extracted from BottomSheet's inline `showGlass` boolean
  (glass-standard-adoption-spec.md QA round 1/2) so the decision itself has
  direct scenario coverage, not just its call sites.

  Scenario: The opaque tier never mounts Glass, even once settled
    Given tier is "opaque", entered is true, and measured is set
    Then it should not be allowed to mount

  # The exact QA round-1 hazard, and the realistic ordering: BottomSheet's
  # content measures itself (onLayout) well before SlideInDown reports
  # finished, so `measured` is typically SET while `entered` is still
  # false — this is the actual mid-animation window a real GlassView must
  # not mount into. Isolating `entered` this way (rather than pairing it
  # with `measured: null` too) is what catches a regression that drops the
  # `entered` check but keeps the `measured` one.
  Scenario: The native tier defers while the entering animation is still playing, even once measured
    Given tier is "native", entered is false, and measured is set
    Then it should not be allowed to mount

  Scenario: The native tier defers until the content has been measured, even once settled
    Given tier is "native", entered is true, and measured is null
    Then it should not be allowed to mount

  Scenario: The native tier defers when nothing has happened yet
    Given tier is "native", entered is false, and measured is null
    Then it should not be allowed to mount

  Scenario: The native tier mounts once settled and measured
    Given tier is "native", entered is true, and measured is set
    Then it should be allowed to mount

  # QA round 3: `entered` is optional, defaulting to true, for the three
  # callers that mount with the screen and have no `entering` ancestor to
  # wait for at all (ScreenHeader, Composer's field, MenuPanel) — they pass
  # only `tier` and `measured`. This pins the default itself, since omitting
  # a field is invisible to the "entered is false/true" scenarios above.
  Scenario: Entered defaults to true for a caller with no entering animation to wait for
    Given tier is "native" and measured is set, with entered omitted
    Then it should be allowed to mount

  # QA round 4: widening `measured` to `unknown` (so a caller can pass a bare
  # settled-height number, not just a `{width,height}` object) let `undefined`
  # in too, and `!== null` treats `undefined` as "measured" — reading as
  # mountable while still unmeasured, the exact bug this predicate exists to
  # prevent. Not reachable by today's four callers (all `useState<T | null>`,
  # never `undefined`), but a fifth caller holding measurement in a ref
  # (`.current` starts `undefined`) would hit this silently.
  Scenario: Measured being undefined defers the same as null
    Given tier is "native", entered is true, and measured is undefined
    Then it should not be allowed to mount

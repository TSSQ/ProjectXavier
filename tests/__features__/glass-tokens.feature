Feature: Liquid Glass tokens and tier resolution
  Phase 1 of the Apple Glass UI proposal: the `--xg-*` token family and the
  single decision behind the `<Glass>` primitive — does this surface render
  the OS material, or its opaque fallback. The decision is pure so it can be
  tested here rather than only on a device.

  Scenario: Everything available and the flag on renders the native material
    When I resolve the glass tier with flag on, glass available, api available, reduce transparency off
    Then the glass tier should be "native"

  # The flag is what lets Phase 1 land without changing a shipping pixel.
  Scenario: The flag being off forces the opaque tier
    When I resolve the glass tier with flag off, glass available, api available, reduce transparency off
    Then the glass tier should be "opaque"

  Scenario: No Liquid Glass on the device forces the opaque tier
    When I resolve the glass tier with flag on, glass unavailable, api available, reduce transparency off
    Then the glass tier should be "opaque"

  # Some iOS 26 betas ship without the API and CRASH when GlassView mounts,
  # which is why this is a gate of its own and not folded into the one above.
  Scenario: A missing glass API forces the opaque tier
    When I resolve the glass tier with flag on, glass available, api unavailable, reduce transparency off
    Then the glass tier should be "opaque"

  # The one that is an accessibility failure rather than a cosmetic one.
  # `isLiquidGlassAvailable()` does NOT report Reduce Transparency — its own
  # docs point at AccessibilityInfo.isReduceTransparencyEnabled() instead —
  # so a build that trusts it alone renders glass at a user who asked for
  # none. The POC in this repo claimed otherwise in a comment.
  Scenario: Reduce Transparency forces the opaque tier even when glass is available
    When I resolve the glass tier with flag on, glass available, api available, reduce transparency on
    Then the glass tier should be "opaque"

  Scenario: Every role resolves in both themes
    When I read the glass tokens for "dark"
    Then every glass role should carry a system style and an opaque fallback
    When I read the glass tokens for "light"
    Then every glass role should carry a system style and an opaque fallback

  # The proposal maps "controls resting on colour" to Apple's clear material
  # and everything else to regular; `clear` alone carries no tint, at full
  # system transparency.
  Scenario: Roles map to the system materials the proposal specifies
    When I read the glass tokens for "dark"
    Then the "chrome" role should use the "regular" system style
    And the "card" role should use the "regular" system style
    And the "clear" role should use the "clear" system style
    And the "tinted" role should carry a tint

  # Phase 2 bugfix (glass-phase2 round 2): the `regular` system style alone
  # was nearly clear, so a screen title read straight through the composer
  # tray / sheet header. tintColor IS settable, so chrome and card each
  # approximate the proposal's rgba fill via a tint, in both themes.
  Scenario: Chrome and card carry a tint in both themes
    When I read the glass tokens for "dark"
    Then the "chrome" role should carry a tint
    And the "card" role should carry a tint
    When I read the glass tokens for "light"
    Then the "chrome" role should carry a tint
    And the "card" role should carry a tint

  # Phase 2 review: the tinted role's opaque fallback (Reduce Transparency)
  # sits under white glyphs (Send, FABs), so it must be the 4.5:1 `primaryFill`
  # — `primary` (#5B8DEF) is only 3.23:1 with white (tokens.ts Redline B2).
  Scenario: The tinted opaque fallback is the accessible fill in both themes
    When I read the glass tokens for "dark"
    Then the "tinted" fallback should equal the "dark" primaryFill
    When I read the glass tokens for "light"
    Then the "tinted" fallback should equal the "light" primaryFill

  # On white, translucency is a legibility problem before it is a style: the
  # proposal flips the specular lip to near-white rather than reusing dark's.
  Scenario: Light and dark carry different edge and specular values
    Then the dark and light specular values should differ
    And the dark and light edge values should differ

  Scenario: The depth field defines three wells in both themes
    When I read the glass tokens for "dark"
    Then the depth field should define 3 wells
    When I read the glass tokens for "light"
    Then the depth field should define 3 wells

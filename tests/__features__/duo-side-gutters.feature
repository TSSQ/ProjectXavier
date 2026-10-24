Feature: Side gutters honour the horizontal safe area (iPhone Duo)
  iOS puts the tab bar, clock and Dynamic Island along a side edge on iPhone
  Duo's cover screen in landscape, on the open display in landscape, and in
  Split View. react-native-safe-area-context reports that as insets.left /
  insets.right, and the two sides are usually unequal. Every screen gutter and
  edge-pinned control goes through src/domain/screenGutters.ts so the side
  reserved by the system is added on that side only.

  # ── sideGutters ──────────────────────────────────────────────────────────
  Scenario: A phone in portrait keeps the design's own gutter on both sides
    Given horizontal insets left 0 and right 0
    When I compute side gutters with a base of 24
    Then the left padding should be 24
    And the right padding should be 24

  Scenario: A rail on the right adds to the right gutter only
    Given horizontal insets left 0 and right 83
    When I compute side gutters with a base of 24
    Then the left padding should be 24
    And the right padding should be 107

  Scenario: Split View on the left half puts the rail on the left
    Given horizontal insets left 83 and right 0
    When I compute side gutters with a base of 24
    Then the left padding should be 107
    And the right padding should be 24

  Scenario: Asymmetric insets are never mirrored
    Given horizontal insets left 59 and right 20
    When I compute side gutters with a base of 16
    Then the left padding should be 75
    And the right padding should be 36

  Scenario: A negative or NaN inset contributes nothing
    Given horizontal insets left -5 and right NaN
    When I compute side gutters with a base of 24
    Then the left padding should be 24
    And the right padding should be 24

  Scenario: A zero base leaves only the system's reservation
    Given horizontal insets left 0 and right 83
    When I compute side gutters with a base of 0
    Then the left padding should be 0
    And the right padding should be 83

  # ── edgeOffset ───────────────────────────────────────────────────────────
  Scenario: An edge-pinned control keeps its designed distance with no inset
    When I compute the edge offset for inset 0 with a base of 20
    Then the edge offset should be 20

  Scenario: An edge-pinned control moves inward by the inset on that edge
    When I compute the edge offset for inset 83 with a base of 20
    Then the edge offset should be 103

  Scenario: An undefined inset is treated as zero
    When I compute the edge offset for an undefined inset with a base of 4
    Then the edge offset should be 4

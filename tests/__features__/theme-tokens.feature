Feature: Theme tokens
  Light mode adds a parallel palette to the existing dark tokens. A token
  missing its light value (or the two palettes drifting out of sync) would
  silently fall back to `undefined` at runtime, so the two token sets must
  always declare exactly the same keys — and every dark value that existed
  before light mode was added must still hold that exact value. Adding a new
  token to both palettes is allowed; changing a shipped one is not.

  Scenario: Dark and light palettes define the same set of tokens
    Given the dark theme palette
    And the light theme palette
    Then both palettes should declare the same token keys

  Scenario: Dark values are unchanged from before light mode was added
    Given the dark theme palette
    Then the dark palette should match the pre-light-mode values

  # The sheet scrim replaced a flat `rgba(0,0,0,0.55)` literal that read as a
  # black slab over the light canvas (device feedback, build 108). Light needs
  # LESS of it than dark: dimming a near-black canvas barely moves it, while
  # the same opacity over a near-white one is what produced the slab. Pinning
  # the relationship, not the exact values, so it can be tuned without a test
  # edit — but not accidentally inverted or walked back toward 0.55.
  Scenario: The sheet scrim is softer in light than in dark
    Given the dark theme palette
    And the light theme palette
    Then both scrims should be below the 0.55 that read as a slab
    And the light scrim should be lighter than the dark one

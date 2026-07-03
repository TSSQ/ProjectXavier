Feature: Theme tokens
  Light mode adds a parallel palette to the existing dark tokens. A token
  missing its light value (or the two palettes drifting out of sync) would
  silently fall back to `undefined` at runtime, so the two token sets must
  always declare exactly the same keys — and dark must stay pixel-identical
  to what it was before light mode was added.

  Scenario: Dark and light palettes define the same set of tokens
    Given the dark theme palette
    And the light theme palette
    Then both palettes should declare the same token keys

  Scenario: Dark values are unchanged from before light mode was added
    Given the dark theme palette
    Then the dark palette should match the pre-light-mode values

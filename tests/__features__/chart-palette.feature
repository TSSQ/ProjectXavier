Feature: Chart series colours are readable on their own card

  Chart marks are non-text graphics, so WCAG asks for 3:1 against the surface
  they sit on. The palette used to be imported statically from `colors`, which
  is an alias for the DARK tokens, so light mode painted dark-tuned hexes onto
  a white card — the amber measured 2.53:1, the orange 2.66 and the sky 2.86.

  Scenario: Every dark series colour clears 3:1 on a dark card
    Given the dark chart palette
    Then every colour should clear 3:1 against "#171B22"

  Scenario: Every light series colour clears 3:1 on a light card
    Given the light chart palette
    Then every colour should clear 3:1 against "#FFFFFF"

  Scenario: The two palettes stay the same length
    Given both chart palettes
    Then they should have the same number of colours

  Scenario: The palettes are actually different
    Given both chart palettes
    Then at least three colours should differ between them

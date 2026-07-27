Feature: Welcome carousel chrome reserves
  At large Dynamic Type, the welcome carousel's title used to collide with the
  absolutely-positioned Skip button and the body used to render under the
  absolutely-positioned dots/Get-Started row, because each card's padding was
  a hard-coded guess (insets.top + 24 / insets.bottom + 120) that didn't grow
  with the font scale. src/domain/onboardingChrome.ts derives the ACTUAL
  space that chrome needs — from the safe-area insets plus the same scaled
  sizes it renders at — so a card's content can never sit under it.

  Scenario Outline: The top reserve clears the Skip button and grows with its scaled font size
    Then the top reserve for insets top <insetsTop>, skip font size <skipFontSize> should be <reserve>

    Examples:
      | insetsTop | skipFontSize | reserve |
      | 0         | 16           | 64      |
      | 0         | 24           | 74      |

  Scenario: The top reserve grows with the safe-area inset
    Then the top reserve for insets top 50, skip font size 16 should be 114

  Scenario Outline: The bottom reserve clears the dots row + Get Started button and grows with font scale
    Then the bottom reserve for insets bottom <insetsBottom>, dot size <dotSize>, font scale <fontScale> should be <reserve>

    Examples:
      | insetsBottom | dotSize | fontScale | reserve |
      | 0            | 8       | 1         | 112     |
      | 0            | 8       | 1.6       | 125     |

  Scenario: The bottom reserve grows with the safe-area inset
    Then the bottom reserve for insets bottom 34, dot size 8, font scale 1 should be 146

  Scenario: The bottom reserve is strictly larger than the dots row alone, because it also accounts for the Get Started button
    Then the bottom reserve for insets bottom 0, dot size 8, font scale 1 should exceed the dots-row-only height of 28 by at least the Get Started button's own height

  Scenario: A large-scale, small-screen case still leaves a positive content area
    Then the content height for screen height 667, insets top 20, insets bottom 0, skip font size 24, dot size 10, font scale 1.6 should be positive

  Scenario Outline: The onboarding visual shrinks as font scale climbs, but never past its base or floor
    Then the onboarding visual size for font scale <fontScale> should be <size>

    Examples:
      | fontScale | size |
      | 0.85      | 140  |
      | 1         | 140  |
      | 1.6       | 106  |
      | 3         | 84   |

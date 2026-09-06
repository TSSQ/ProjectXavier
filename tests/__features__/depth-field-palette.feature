Feature: The depth field follows the avatar's look
  The background wells take their hues from the chosen avatar look, so the
  ambient gradient is the colour of Xavier rather than a fixed palette.
  Light mode needs darker, weaker hues than dark mode (the light-mode
  handoff tightens every glow on white).

  Scenario: Dark wells are the look's own gradient stops
    When I read the depth-field colours for "xavier" in "dark"
    Then well 1 should be "rgba(91,141,239,0.2)"
    And well 2 should be "rgba(124,91,239,0.18)"

  Scenario: The third well is the midpoint of the two stops
    When I read the depth-field colours for "xavier" in "dark"
    Then well 3 should be the midpoint hue of the look

  Scenario: Light wells use the handoff hue for the primary stop
    When I read the depth-field colours for "xavier" in "light"
    Then well 1 should be "rgba(47,107,221,0.14)"

  Scenario: Every look is darker and weaker in light mode
    Then for every look each light well should be darker than its dark well
    And for every look each light well should be less opaque than its dark well

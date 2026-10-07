Feature: Xavier's motion scales with his size
  A small avatar must not bob like the big one, but at the size the motion
  was tuned for nothing may change
  (docs/design/xavier-daily-chat-spec.md section 4).

  Scenario: At 180 the dark halo and breathing are exactly today's
    When the motion is computed for size 180 in the dark theme
    Then the opacity should run 0.40 to 0.75 and the radius 16 to 28
    And the breathing should be a scale of 1.045, a lift of -8 and 1.9 seconds, with a halo of 2.2 seconds

  Scenario: At 180 the light halo is exactly today's
    When the motion is computed for size 180 in the light theme
    Then the opacity should run 0.25 to 0.47 and the radius 14 to 25

  Scenario: At 180 the listening lift is exactly today's
    Then the listening lift at size 180 should be -6 and the resting lift -8

  Scenario: At the header size the lift is small and the halo uses its floor
    When the motion is computed for size 52 in the dark theme
    Then the lift should be about -2.3
    And the halo rest radius should be the 6 point floor and the peak should be its scaled value
    And the opacities should be unchanged

  Scenario: The halo never goes below the floor, and grows with size
    Then the halo radius at size 20 should be 6 at rest and at peak, and at size 360 should be double

  Scenario Outline: The Assistant's hero looks exactly as today at every hero size
    When the hero is drawn at <size> with its own size as the reference
    Then the halo and lift should equal today's constants

    Examples:
      | size |
      | 180  |
      | 160  |
      | 148  |

  Scenario Outline: The header avatar's halo is floored at 6 on screen
    When the avatar is drawn at 180 and shown at <header> with a reference of 180
    Then the rest radius on screen should be 6 in the dark and light themes
    And the lift on screen should be about <lift>

    Examples:
      | header | lift  |
      | 52     | -2.31 |
      | 46     | -2.04 |
      | 42     | -1.87 |

  Scenario: The header at 160 is scaled from the hero's own reference
    Then the 46 header drawn from a 160 hero has a rest radius of 6 on screen and a lift of -8 times 46 over 160

  Scenario: The lift does not depend on the visual scale
    Then the lift in avatar space is the same at visual scales 1 and 0.29

  Scenario: The header at 46 on a 160 hero, end to end, on screen
    Then the rest halo is 6 and the peak is 28 times 46 over 160 on screen, and the opacities are unchanged

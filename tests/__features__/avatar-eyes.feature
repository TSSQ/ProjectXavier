Feature: Avatar eye geometry
  The eyeGeometry helper returns the correct shape parameters for each avatar
  state, driving the Reanimated tweens in XavierPet.

  Scenario: Idle eyes are tall pills
    When I compute eye geometry for state "idle" and side "l"
    Then the heightRatio should be 0.17
    And flatBottom should be false

  Scenario: Listening eyes are the same as idle
    When I compute eye geometry for state "listening" and side "l"
    Then the heightRatio should be 0.17
    And flatBottom should be false

  Scenario: Thinking eyes are narrow slits
    When I compute eye geometry for state "thinking" and side "l"
    Then the heightRatio should be 0.075
    And flatBottom should be false

  Scenario: Happy eyes are flat-bottomed domes
    When I compute eye geometry for state "happy" and side "l"
    Then the heightRatio should be 0.105
    And flatBottom should be true

  Scenario: Confused left eye is full height with no offset
    When I compute eye geometry for state "confused" and side "l"
    Then the heightRatio should be 0.17
    And the offsetYRatio should be 0

  Scenario: Confused right eye is smaller and raised
    When I compute eye geometry for state "confused" and side "r"
    Then the heightRatio should be 0.10
    And the offsetYRatio should be 0.055

  Scenario: Angry left eye tilts inward at +16 degrees
    When I compute eye geometry for state "angry" and side "l"
    Then the tiltDeg should be 16

  Scenario: Angry right eye tilts inward at -16 degrees
    When I compute eye geometry for state "angry" and side "r"
    Then the tiltDeg should be -16

  Scenario: Right idle eye matches left (symmetry)
    When I compute eye geometry for state "idle" and side "r"
    Then the heightRatio should be 0.17
    And flatBottom should be false
    And the tiltDeg should be 0

  Scenario: Right listening eye matches left (symmetry)
    When I compute eye geometry for state "listening" and side "r"
    Then the heightRatio should be 0.17
    And flatBottom should be false
    And the tiltDeg should be 0

  Scenario: Right thinking eye matches left (symmetry)
    When I compute eye geometry for state "thinking" and side "r"
    Then the heightRatio should be 0.075
    And flatBottom should be false
    And the tiltDeg should be 0

  Scenario: Right happy eye matches left (symmetry)
    When I compute eye geometry for state "happy" and side "r"
    Then the heightRatio should be 0.105
    And flatBottom should be true
    And the tiltDeg should be 0

  Scenario: Angry left eye has correct heightRatio and flatBottom
    When I compute eye geometry for state "angry" and side "l"
    Then the heightRatio should be 0.085
    And flatBottom should be false

  Scenario: Angry right eye has correct heightRatio and flatBottom
    When I compute eye geometry for state "angry" and side "r"
    Then the heightRatio should be 0.085
    And flatBottom should be false

  Scenario: Confused left eye has zero tilt and zero offsetY
    When I compute eye geometry for state "confused" and side "l"
    Then the tiltDeg should be 0
    And the offsetYRatio should be 0

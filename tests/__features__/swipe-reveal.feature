Feature: Swipe row actions
  The pure gesture arithmetic behind SwipeableRow (swipe-left Copy | Delete on
  a transaction row, transactions tab + account detail): whether a drag
  claims itself as a horizontal swipe, how far the row is allowed to
  translate, whether a release snaps the row open or closed, and how wide the
  revealed action strip is at a given (Dynamic-Type-scaled) font size.
  Framework-free — no PanResponder, no Reanimated, no Alert.

  Scenario: An unambiguous horizontal drag claims the gesture
    Given a drag of dx -30 and dy 4
    When horizontal claim is evaluated
    Then the gesture should be claimed

  Scenario: A drag below the 8pt floor does not claim the gesture
    Given a drag of dx -6 and dy 1
    When horizontal claim is evaluated
    Then the gesture should not be claimed

  Scenario: A drag that isn't at least 2:1 horizontal does not claim the gesture
    Given a drag of dx -20 and dy 18
    When horizontal claim is evaluated
    Then the gesture should not be claimed

  Scenario: A vertical drag does not claim the gesture
    Given a drag of dx 2 and dy 40
    When horizontal claim is evaluated
    Then the gesture should not be claimed

  Scenario: A right-swipe on a closed row is rejected
    Given a raw translate of 40
    And an actions width of 120
    When the translate is clamped
    Then the clamped translate should be 0

  Scenario: A drag within range passes through unchanged
    Given a raw translate of -70
    And an actions width of 120
    When the translate is clamped
    Then the clamped translate should be -70

  Scenario: Overshoot rubber-bands to 1.15x the actions width and no further
    Given a raw translate of -500
    And an actions width of 120
    When the translate is clamped
    Then the clamped translate should be -138

  Scenario: Snaps open when released past the halfway point at rest
    Given a translate of -80, a velocity of 0, and an actions width of 120
    When the snap is resolved
    Then the row should end up open

  Scenario: Snaps closed when released short of the halfway point at rest
    Given a translate of -40, a velocity of 0, and an actions width of 120
    When the snap is resolved
    Then the row should end up closed

  Scenario: A fast flick opens the row even short of the halfway point
    Given a translate of -20, a velocity of -2, and an actions width of 120
    When the snap is resolved
    Then the row should end up open

  Scenario: A fast reverse flick closes an already-open row
    Given a translate of -100, a velocity of 2, and an actions width of 120
    When the snap is resolved
    Then the row should end up closed

  Scenario: The actions strip widens monotonically as Dynamic Type scales up
    Given an actions strip of 2 buttons, icon size 16, padding 12, gap 8, and a minimum button width of 60
    When the strip width is computed at font size 10
    And the strip width is computed at font size 14
    And the strip width is computed at font size 22.4
    Then each recorded strip width should be strictly wider than the last

  Scenario: The strip width never falls below the minimum button width
    Given an actions strip of 1 button, icon size 16, padding 4, gap 8, and a minimum button width of 90
    When the strip width is computed at font size 8
    Then the strip width should be at least 90

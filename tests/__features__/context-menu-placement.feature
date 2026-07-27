Feature: Context menu placement
  The long-press ContextMenu (transactions list / account detail) positions
  itself above the touch point when there's room, flips below when the touch
  is near the top of the screen, and clamps to the screen edges — using the
  ACTUAL (Dynamic-Type-scaled) menu size, not a hard-coded row height, so a
  taller menu at large font scales still lands fully on-screen instead of
  overflowing the bottom.

  Scenario: Prefers placing the menu above the touch point when there's room
    Given a touch at x 100, y 300
    And a menu 196 wide and 140 tall
    And a screen 390 wide and 800 tall
    When the menu placement is computed
    Then the menu top should be 152
    And the menu left should be 76

  Scenario: Flips the menu below the touch point when it's near the top
    Given a touch at x 100, y 40
    And a menu 196 wide and 140 tall
    And a screen 390 wide and 800 tall
    When the menu placement is computed
    Then the menu top should be 56

  Scenario: Clamps the menu to the left screen edge
    Given a touch at x 5, y 300
    And a menu 196 wide and 140 tall
    And a screen 390 wide and 800 tall
    When the menu placement is computed
    Then the menu left should be 12

  Scenario: Clamps the menu to the right screen edge
    Given a touch at x 380, y 300
    And a menu 196 wide and 140 tall
    And a screen 390 wide and 800 tall
    When the menu placement is computed
    Then the menu left should be 182

  Scenario: Clamps so the bottom of the menu never runs off-screen
    Given a touch at x 100, y 780
    And a menu 196 wide and 140 tall
    And a screen 390 wide and 800 tall
    When the menu placement is computed
    Then the menu top should be 620

  Scenario: A taller menu (simulating large Dynamic Type) still lands fully on-screen
    Given a touch at x 100, y 400
    And a menu 220 wide and 780 tall
    And a screen 390 wide and 800 tall
    When the menu placement is computed
    Then the menu top should be 12
    And the menu bottom should not exceed the screen height

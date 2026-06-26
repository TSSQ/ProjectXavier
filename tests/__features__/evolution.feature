Feature: Avatar evolution progression
  The companion's stage is derived from net-worth GROWTH over the user's own
  baseline, never devolves, and reports progress toward the next stage.
  Thresholds (minor units): 0 / 50000 / 200000 / 1000000 / 5000000.

  Scenario: No growth sits at the first stage
    Given a high-water growth of 0
    Then the evolution stage should be 0
    And the stage label should be "Spark"

  Scenario: Crossing a threshold advances the stage
    Given a high-water growth of 60000
    Then the evolution stage should be 1
    And the stage label should be "Sprout"

  Scenario: Growth between thresholds stays at the lower stage
    Given a high-water growth of 199999
    Then the evolution stage should be 1

  Scenario: Large growth reaches the top stage
    Given a high-water growth of 9000000
    Then the evolution stage should be 4
    And the stage label should be "Luminary"

  Scenario: Negative growth stays at the first stage
    Given a high-water growth of -100000
    Then the evolution stage should be 0

  Scenario: Progress halfway to the next stage
    Given a high-water growth of 125000
    Then the progress fraction should be "0.50"
    And the remaining growth should be 75000

  Scenario: The top stage reports full progress
    Given a high-water growth of 6000000
    Then the progress fraction should be "1.00"
    And there should be no next stage

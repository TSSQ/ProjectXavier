Feature: Parse diagnostics helpers
  Content-free bucketing and material-edit detection used to decide whether the
  local parsing layers need the cloud LLM (see docs/design/parse-metrics-spec.md).

  Scenario: Confidence maps to a 0-4 bucket
    Given an AI confidence of 0.0
    Then the confidence bucket should be 0

  Scenario: Top confidence clamps to the highest bucket
    Given an AI confidence of 1.0
    Then the confidence bucket should be 4

  Scenario: Mid confidence buckets correctly
    Given an AI confidence of 0.55
    Then the confidence bucket should be 2

  Scenario: A tiny amount change is not material
    Given a proposed amount of 4500 and a saved amount of 4500
    Then the amount edit should not be material
    And the amount delta bucket should be 0

  Scenario: A real amount correction is material
    Given a proposed amount of 4500 and a saved amount of 5400
    Then the amount edit should be material
    And the amount delta bucket should be 2

  Scenario: A near-typo payee fix is not material
    Given a proposed name "Starbux" and a saved name "Starbucks"
    Then the name edit should not be material

  Scenario: A different payee is material
    Given a proposed name "Starbucks" and a saved name "McDonalds"
    Then the name edit should be material

  Scenario: Adding a payee that was missing is material
    Given a proposed name "" and a saved name "Starbucks"
    Then the name edit should be material

  Scenario: Same calendar day is not a material date change
    Given a proposed date 2026-06-24 at 09:00 and a saved date 2026-06-24 at 21:00
    Then the date edit should not be material

  Scenario: A different day is a material date change
    Given a proposed date 2026-06-24 at 09:00 and a saved date 2026-06-25 at 09:00
    Then the date edit should be material

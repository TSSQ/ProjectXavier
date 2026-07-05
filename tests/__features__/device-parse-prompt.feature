Feature: On-device Foundation Models parse — prompt and output normalization
  Pure, framework-free bits of the on-device (Apple Foundation Models) parse
  tier: deciding whether the device can run it, building the grounded prompt,
  and normalizing the model's sentinel-laden raw output back into the same
  nullable shape the cloud parse produces.

  Scenario: The "available" state means the device can run Foundation Models
    When I check device parse availability for "available"
    Then the device should be usable for parsing

  Scenario: "appleIntelligenceNotEnabled" means the device cannot run it
    When I check device parse availability for "appleIntelligenceNotEnabled"
    Then the device should not be usable for parsing

  Scenario: "modelNotReady" means the device cannot run it
    When I check device parse availability for "modelNotReady"
    Then the device should not be usable for parsing

  Scenario: "unavailable" means the device cannot run it
    When I check device parse availability for "unavailable"
    Then the device should not be usable for parsing

  Scenario: The prompt includes known categories and payees as grounding hints
    Given existing categories:
      | name    | kind    |
      | Dining  | expense |
    Given existing payees:
      | name      |
      | Starbucks |
    When I build the device parse prompt for "spent 12 at Starbucks" at time 1735689600000
    Then the prompt should mention "Known categories: Dining"
    And the prompt should mention "Known payees: Starbucks"
    And the prompt should mention "Expense: spent 12 at Starbucks"

  Scenario: The prompt omits hints when there are no known categories or payees
    When I build the device parse prompt for "coffee" at time 1735689600000
    Then the prompt should not mention "Known categories"
    And the prompt should not mention "Known payees"

  Scenario: A sentinel amount normalizes to null
    When I normalize the device parse output:
      | field | value |
      | amount | -1 |
    Then the normalized amount should be null

  Scenario: A real amount normalizes unchanged
    When I normalize the device parse output:
      | field | value |
      | amount | 1250 |
    Then the normalized amount should be 1250

  Scenario: Empty-string text fields normalize to null
    When I normalize the device parse output:
      | field   | value |
      | currency | "" |
      | payee    | "" |
      | category | "" |
      | account  | "" |
      | note     | "" |
    Then the normalized currency should be null
    And the normalized payee should be null
    And the normalized category should be null
    And the normalized account should be null
    And the normalized note should be null

  Scenario: A non-empty text field normalizes unchanged
    When I normalize the device parse output:
      | field | value |
      | payee | "Starbucks" |
    Then the normalized payee should be "Starbucks"

  Scenario: A recognised type passes through
    When I normalize the device parse output:
      | field | value |
      | type | "income" |
    Then the normalized type should be "income"

  Scenario: The "unknown" type sentinel normalizes to null
    When I normalize the device parse output:
      | field | value |
      | type | "unknown" |
    Then the normalized type should be null

  Scenario: A garbage type value normalizes to null
    When I normalize the device parse output:
      | field | value |
      | type | "sandwich" |
    Then the normalized type should be null

  Scenario: A sentinel occurredAt normalizes to null
    When I normalize the device parse output:
      | field | value |
      | occurredAt | -1 |
    Then the normalized occurredAt should be null

  Scenario: Confidence is clamped to the 0..1 range
    When I normalize the device parse output:
      | field | value |
      | confidence | 4.2 |
    Then the normalized confidence should be 1

  Scenario: A missing or malformed confidence defaults to zero
    When I normalize the device parse output:
      | field | value |
      | confidence | "not a number" |
    Then the normalized confidence should be 0

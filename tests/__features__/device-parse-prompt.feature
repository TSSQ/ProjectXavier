Feature: On-device Foundation Models parse — prompt and output normalization
  Pure, framework-free bits of the on-device (Apple Foundation Models) parse
  tier: the zod guided-generation schema handed to the binding, building the
  grounded prompt, and normalizing the model's output into the same nullable
  shape the cloud parse produces.

  Scenario: The guided-generation schema accepts an all-unknown (omitted) parse
    When the model returns a parse with every unknown field omitted and confidence 0
    Then the guided-generation schema should accept it

  Scenario: The guided-generation schema accepts a fully populated parse
    When the model returns a fully populated parse
    Then the guided-generation schema should accept it

  Scenario: The guided-generation schema rejects a wrongly typed field
    When the model returns a parse whose amount is the string "12.50"
    Then the guided-generation schema should reject it

  Scenario: The guided-generation schema stays expressible by the FM binding
    When the AI SDK converts the schema to JSON schema
    Then every property type should be a single supported type
    And the unknown-able fields should not be required

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

  Scenario: The instructions ask to omit (not guess) unknown fields
    When I build the device parse instructions
    Then the instructions should mention "omit the field"

  Scenario: A negative amount normalizes to null
    When I normalize the device parse output:
      | field | value |
      | amount | -1 |
    Then the normalized amount should be null

  Scenario: A zero amount normalizes to null
    When I normalize the device parse output:
      | field | value |
      | amount | 0 |
    Then the normalized amount should be null

  Scenario: A whole-dollar amount converts to minor units
    When I normalize the device parse output:
      | field | value |
      | amount | 20 |
    Then the normalized amount should be 2000

  Scenario: A decimal amount converts to minor units
    When I normalize the device parse output:
      | field | value |
      | amount | 12.5 |
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

  Scenario: A lowercase currency code normalizes to uppercase
    When I normalize the device parse output:
      | field | value |
      | currency | "usd" |
    Then the normalized currency should be "USD"

  Scenario: A chatty non-code currency normalizes to null
    When I normalize the device parse output:
      | field | value |
      | currency | "US dollars" |
    Then the normalized currency should be null

  Scenario: A recognised type passes through
    When I normalize the device parse output:
      | field | value |
      | type | "income" |
    Then the normalized type should be "income"

  Scenario: A garbage type value normalizes to null
    When I normalize the device parse output:
      | field | value |
      | type | "sandwich" |
    Then the normalized type should be null

  Scenario: A numeric occurredAt passes through
    When I normalize the device parse output:
      | field | value |
      | occurredAt | 1735689600000 |
    Then the normalized occurredAt should be 1735689600000

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

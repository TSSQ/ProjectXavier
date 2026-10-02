Feature: The on-device parse retry policy is shared between the app and the eval harness
  `runDeviceParseAttempts` (src/domain/deviceParseAttempts.ts) is the single
  retry loop both `deviceParse.ts` (the app) and the FM eval probe runner
  call, so they can never hand-drift apart (review B1/S1).

  Scenario: A useful result on the first try needs no retry
    Given text with amount evidence
    And attempts that return: useful
    When the attempts run
    Then the result is the useful parse
    And 1 attempt was made
    And 0 attempts threw

  Scenario: A weak result followed by a useful one retries once
    Given text with amount evidence
    And attempts that return: weak, useful
    When the attempts run
    Then the result is the useful parse
    And 2 attempts were made
    And 0 attempts threw

  Scenario: A weak result followed by a throw returns the weak result
    Given text with amount evidence
    And attempts that return: weak, throw
    When the attempts run
    Then the result is the weak parse
    And 2 attempts were made
    And 1 attempt threw

  Scenario: A throw followed by a weak result returns the weak result
    Given text with amount evidence
    And attempts that return: throw, weak
    When the attempts run
    Then the result is the weak parse
    And 2 attempts were made
    And 1 attempt threw

  Scenario: Both attempts throwing returns null
    Given text with amount evidence
    And attempts that return: throw, throw
    When the attempts run
    Then the result is null
    And 2 attempts were made
    And 2 attempts threw

  Scenario: Text with no amount evidence never retries, even on a weak result
    Given text with no amount evidence
    And attempts that return: weak
    When the attempts run
    Then the result is the weak parse
    And 1 attempt was made
    And 0 attempts threw

  Scenario: A weak result followed by an explicit null return keeps the weak result
    Given text with amount evidence
    And attempts that return: weak, null
    When the attempts run
    Then the result is the weak parse
    And 2 attempts were made
    And 0 attempts threw

  Scenario: A result the caller marks final is not retried
    Given text with amount evidence
    And attempts that return: refusal, useful
    When the attempts run with refusals marked final
    Then the result is the refusal
    And 1 attempt was made
    And 0 attempts threw

  Scenario: Without a final marker the same result is retried
    Given text with amount evidence
    And attempts that return: refusal, useful
    When the attempts run
    Then the result is the useful parse
    And 2 attempts were made
    And 0 attempts threw

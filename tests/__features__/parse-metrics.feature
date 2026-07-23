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

  Scenario: aggregate counts an edited row toward saved
    Given aggregate rows with resolved values "edited"
    Then the aggregate saved count should be 1
    And the aggregate discarded count should be 0
    And the aggregate editedAtDraft count should be 1

  Scenario: aggregate handles a mix of saved, discarded, and edited rows
    Given aggregate rows with resolved values "saved,discarded,edited,edited"
    Then the aggregate saved count should be 3
    And the aggregate discarded count should be 1
    And the aggregate editedAtDraft count should be 2

  Scenario: aggregate materialEditRate uses saved denominator that includes edited rows
    Given aggregate rows with resolved values "edited,edited" and no post-save field edits
    Then the aggregate saved count should be 2
    And the aggregate editedAtDraft count should be 2
    And the aggregate materialEditRate should be 0

  Scenario: aggregate keeps "floor" (account gate, no engine extracted) distinct from "heuristic" (expense deterministic parse)
    # Reviewer follow-up (docs/design/account-chat-creation-spec.md §5.5): the
    # account gate's "no engine ran" case must show up as its own bucket, not
    # be folded into the expense heuristic tier's bucket.
    Given aggregate rows with engines "heuristic,floor,floor,on_device"
    Then the aggregate byEngine "heuristic" count should be 1
    And the aggregate byEngine "floor" count should be 2
    And the aggregate byEngine "on_device" count should be 1

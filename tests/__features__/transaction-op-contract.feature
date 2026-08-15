Feature: Chat transaction delete/update contract — one enum, nothing else
  docs/design/chat-transaction-delete-update-spec.md §5.2/§7 acceptance #5/#6
  — exactly one key, a z.enum, no .optional()/.nullable()/z.string() anywhere;
  the model's raw output is untrusted (guardrail #6) and a hallucinated value
  is rejected, never coerced into a guess.

  Scenario: The schema has exactly one field, a closed three-value enum
    Then the transaction-op schema should have exactly one field named "op"
    And the "op" field should be a closed enum of "delete", "update", "none"
    And the schema should have no optional, nullable, or free string field

  Scenario Outline: A well-formed model answer normalizes to the right result
    When I normalize a raw transaction-op selection with op "<raw>"
    Then the normalized op should be <expected>

    Examples:
      | raw        | expected |
      | delete     | delete   |
      | update     | update   |
      | none       | NONE     |
      | DROP TABLE | NONE     |
      | Delete     | delete   |

  Scenario: A non-string op (a number) is rejected, never coerced
    When I normalize a raw transaction-op selection with a numeric op of 42
    Then the normalized op should be NONE

  Scenario: An empty object is rejected, never throws
    When I normalize an empty raw transaction-op selection
    Then the normalized op should be NONE

  Scenario: A null raw payload never throws
    Then normalizing a null transaction-op selection should not throw and should be NONE

  Scenario: System instructions carry the load-bearing "user picks the row" line
    Then the transaction-op instructions should mention that the user chooses the transaction themselves

  Scenario: The user-turn prompt is the raw message and nothing else — no grounding lists
    Then the transaction-op prompt for "delete my last transaction" should be exactly "Message: delete my last transaction"

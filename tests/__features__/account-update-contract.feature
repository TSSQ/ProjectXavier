Feature: Account UPDATE-extraction contract — token-support guard, subtype fallback, normalization
  The update sibling of the account create contract (docs/design/account-
  chat-crud-spec.md §5.2): the model's raw {targetName, operation, newName,
  newSubtype} is untrusted (guardrail #6) — hallucinated names with no
  support in the user's own text are discarded, an "unknown" operation stays
  unknown (the chat flow's deterministic verb-pattern is the real classifier),
  and an "unknown" newSubtype falls back to the deterministic gate's hint.

  Scenario: A hallucinated target with no token support in the text is discarded
    Given a model update output targetName "DBS Savings" operation "rename" newName "" newSubtype "" for source text "rename my account"
    When I normalize the account update extraction with subtype hint ""
    Then the normalized targetName should be null

  Scenario: A genuine target and new name with token support survive
    Given a model update output targetName "DBS Savings" operation "rename" newName "Rainy Day" newSubtype "" for source text "rename my DBS Savings to Rainy Day"
    When I normalize the account update extraction with subtype hint ""
    Then the normalized targetName should be "DBS Savings"
    And the normalized newName should be "Rainy Day"
    And the normalized operation should be "rename"

  Scenario Outline: An "unknown" newSubtype falls back to the gate's hint; a known subtype is kept as-is
    Given a model update output targetName "" operation "retype" newName "" newSubtype "<modelSubtype>" for source text "change my wallet to a credit card"
    When I normalize the account update extraction with subtype hint "<hint>"
    Then the normalized newSubtype should be "<expected>"

    Examples:
      | modelSubtype | hint         | expected     |
      | unknown      | credit_card  | credit_card  |
      | unknown      |              | unknown      |
      | bank         | credit_card  | bank         |

  Scenario: An operation outside the known set is treated as unknown
    Given a model update output targetName "" operation "delete" newName "" newSubtype "" for source text "change my wallet"
    When I normalize the account update extraction with subtype hint ""
    Then the normalized operation should be "unknown"

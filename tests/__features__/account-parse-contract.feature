Feature: Account-extraction contract — token-support guard, subtype fallback, normalization
  The account counterpart of the expense parse contract
  (docs/design/account-chat-creation-spec.md §5.3): the model's raw
  {name, subtype} is untrusted (guardrail #6) — a hallucinated name with no
  support in the user's own text is discarded, and an "unknown" subtype falls
  back to the deterministic gate's subtype hint.

  Scenario: A hallucinated name with no token support in the text is discarded
    Given a model output name "DBS Savings" and subtype "bank" for source text "add account"
    When I normalize the account extraction with subtype hint "bank"
    Then the normalized name should be null

  Scenario: A genuine name with token support survives
    Given a model output name "DBS Savings" and subtype "bank" for source text "add a DBS savings account with 500"
    When I normalize the account extraction with subtype hint "bank"
    Then the normalized name should be "DBS Savings"

  Scenario Outline: An "unknown" subtype falls back to the gate's hint; a known subtype is kept as-is
    Given a model output name "" and subtype "<modelSubtype>" for source text "make a thing"
    When I normalize the account extraction with subtype hint "<hint>"
    Then the normalized subtype should be "<expected>"

    Examples:
      | modelSubtype | hint  | expected |
      | unknown      | cash  | cash     |
      | unknown      |       | unknown  |
      | bank         | cash  | bank     |
      | investment   |       | investment |

  Scenario: A subtype outside the known set is treated as unknown
    Given a model output name "" and subtype "crypto" for source text "make a thing"
    When I normalize the account extraction with subtype hint "cash"
    Then the normalized subtype should be "cash"

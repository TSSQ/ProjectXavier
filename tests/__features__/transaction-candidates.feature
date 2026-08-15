Feature: Transaction candidate filter, cascade, ranking and picker sizing
  docs/design/chat-transaction-delete-update-spec.md §5.3/§5.4 (acceptance
  criteria 7, 8, 9, 10 and 13) — a deterministic, model-free narrowing of the
  ledger from the user's own words: the pre-filter never empties the list (a
  cascade drops the most specific constraint and retries), ranking is
  total/stable, and picker sizing follows 0/1/2-5/>5. The model never picks a
  row; only this pure logic and the user's own tap do.

  Scenario: The filter extracts a currency-anchored amount, an exact payee, and a single-day date
    Given the known payees "Starbucks" and "NTUC"
    When I build a candidate filter from "delete the $50 Starbucks charge from yesterday"
    Then the filter amount should be 5000 minor units
    And the filter payee should resolve to "Starbucks"
    And the filter should have a single-day date

  Scenario: A fuzzy/typo payee name is NOT treated as an exact filter match
    Given the known payees "Starbucks"
    When I build a candidate filter from "delete the Starbux charge"
    Then the filter payee should be unresolved

  Scenario: A bare (non-anchored) number is NOT treated as a stated amount
    When I build a candidate filter from "delete the transaction from 3 days ago"
    Then the filter amount should be unresolved

  Scenario: "latest" is recognised as a recency signal, distinct from a date
    When I build a candidate filter from "delete my latest transaction"
    Then the filter should be marked latest

  Scenario: The pre-filter is deterministic — identical input, identical output across 100 iterations
    Given the known payees "Starbucks"
    When I build the same candidate filter 100 times from "delete the $50 Starbucks charge from yesterday"
    Then every one of the 100 filters should be identical

  Scenario: The cascade never empties the list — it drops the most specific constraint first and retries
    Given a 3-row ledger with distinct accounts, dates and amounts
    When I select candidates with an amount that matches none of them and no other constraint
    Then the candidate count should be 3
    And the dropped constraints should be "amount"

  Scenario: The cascade drops multiple constraints in order (amount, then payee) when needed
    Given a 3-row ledger with distinct accounts, dates and amounts
    When I select candidates with an amount and a payee that together match none of them
    Then the candidate count should be 3
    And the dropped constraints should be "amount, payee"

  Scenario: "latest" truncates an otherwise-larger ranked list to exactly one row
    Given a 3-row ledger with distinct accounts, dates and amounts
    When I select candidates with no constraint at all and latest set
    Then the candidate count should be 1

  Scenario: Ranking is total and stable — byte-identical order on repeat calls over a 50-row fixture
    Given a 50-row ledger
    When I rank the candidates twice with the same filter
    Then both rankings should be byte-identical in order

  Scenario Outline: Picker sizing follows the 0/1/2-5/>5 rule
    Then the picker size for <count> candidates should be "<size>"

    Examples:
      | count | size    |
      | 0     | none    |
      | 1     | confirm |
      | 2     | inline  |
      | 5     | inline  |
      | 6     | sheet   |
      | 12    | sheet   |

  Scenario: An unchanged row passes the stale-row fingerprint guard
    Given a transaction fingerprinted at picker-render time
    When the same transaction is re-read unchanged
    Then the fingerprints should match

  Scenario: A row whose amount changed before the tap fails the fingerprint guard
    Given a transaction fingerprinted at picker-render time
    When the transaction is re-read with a different amount
    Then the fingerprints should not match

Feature: On-device heuristic offline parse
  When the cloud AI proxy is unreachable, the app parses the utterance
  on-device with a deterministic heuristic: amount + type are extracted
  reliably, while category/payee are matched conservatively (existing
  entities only — never invented, never guessed semantically).

  Scenario: A currency-symbol amount is parsed to minor units
    When I locally parse "$100"
    Then the parsed amount should be 10000

  Scenario: An amount adjacent to a spend verb is parsed to minor units
    When I locally parse "spent 45"
    Then the parsed amount should be 4500

  Scenario: A decimal amount is parsed to minor units
    When I locally parse "12.50"
    Then the parsed amount should be 1250

  Scenario: A thousands-separated decimal amount is parsed to minor units
    When I locally parse "1,234.56"
    Then the parsed amount should be 123456

  Scenario: A "k" suffix amount is parsed to minor units
    When I locally parse "1.5k"
    Then the parsed amount should be 150000

  Scenario: No number in the text means no amount
    When I locally parse "coffee"
    Then the parsed amount should be null

  Scenario: An amount of zero is treated as no amount
    When I locally parse "spent 0"
    Then the parsed amount should be null
    And the parsed confidence should be 0

  Scenario: A spend verb with no other indicator defaults to expense
    When I locally parse "spent 10 lunch"
    Then the parsed type should be "expense"

  Scenario: An income verb is recognised
    When I locally parse "received 500 salary"
    Then the parsed type should be "income"

  Scenario: A transfer verb is recognised
    When I locally parse "transfer 100 to savings"
    Then the parsed type should be "transfer"

  Scenario: With no type keyword at all, the type defaults to expense
    When I locally parse "20 tacos"
    Then the parsed type should be "expense"

  Scenario: An exact existing category name is matched
    Given existing categories:
      | name       | kind    |
      | Groceries  | expense |
    When I locally parse "spent 30 groceries"
    Then the parsed category should be "Groceries"

  Scenario: An unmatched category word is never invented
    Given existing categories:
      | name       | kind    |
      | Groceries  | expense |
    When I locally parse "spent 30 pizza"
    Then the parsed category should be null

  Scenario: A category that only exists under a different kind never matches
    Given existing categories:
      | name       | kind    |
      | Groceries  | income  |
    When I locally parse "spent 30 groceries"
    Then the parsed category should be null

  Scenario: An "at" anchor matches an existing payee
    Given existing payees:
      | name       |
      | Starbucks  |
    When I locally parse "5 at Starbucks"
    Then the parsed payee should be "Starbucks"

  Scenario: An "at" anchor with no existing match returns the extracted name
    Given existing payees:
      | name       |
      | Starbucks  |
    When I locally parse "5 at Bruno's"
    Then the parsed payee should be "Bruno's"

  Scenario: No anchor phrase means no payee
    When I locally parse "5 lunch"
    Then the parsed payee should be null

  Scenario: "to" is not a payee anchor (avoids infinitive/direction false positives)
    When I locally parse "spent 20 to work"
    Then the parsed payee should be null

  Scenario: A fuzzy (near-typo) payee match returns the raw text, not the existing name
    Given existing payees:
      | name       |
      | Wendy      |
    When I locally parse "5 at Wendys"
    Then the parsed payee should be "Wendys"

  Scenario: A lowercase anchor still matches an existing payee exactly
    Given existing payees:
      | name       |
      | Starbucks  |
    When I locally parse "5 at starbucks"
    Then the parsed payee should be "Starbucks"

  Scenario: A long anchor phrase does not capture the rest of the sentence
    When I locally parse "20 at Very Long Restaurant Name That Keeps Going"
    Then the parsed payee should be "Very Long Restaurant"

  Scenario: Defaults — currency, account are null, occurredAt is the injected clock
    When I locally parse "spent 20 lunch" at time 1750000000000
    Then the parsed currency should be null
    And the parsed account should be null
    And the parsed occurredAt should be 1750000000000

  Scenario: Confidence is high when an amount is found
    When I locally parse "spent 20 lunch"
    Then the parsed confidence should be at least 0.5

  Scenario: Confidence is zero when no amount is found
    When I locally parse "coffee"
    Then the parsed confidence should be 0

  # ─── Currency-aware scale (review F1 / M7) ───────────────────────────────
  # The heuristic scales the extracted amount by the ACTIVE currency's
  # exponent, not a hard-coded ×100 — a 0-decimal currency like JPY stores the
  # number as-is (500 minor units), not 100x too large.

  Scenario: A bare amount at the default (2-decimal) currency scales ×100
    When I locally parse "coffee 500" at currency "USD"
    Then the parsed amount should be 50000

  Scenario: A bare amount at a 0-decimal currency is not scaled at all
    When I locally parse "coffee 500" at currency "JPY"
    Then the parsed amount should be 500

  Scenario: A decimal amount at a 0-decimal currency still rounds to whole units
    When I locally parse "coffee 12.50" at currency "JPY"
    Then the parsed amount should be 13

  Scenario: A bare amount at a 3-decimal currency scales ×1000
    When I locally parse "coffee 12.5" at currency "KWD"
    Then the parsed amount should be 12500

Feature: BYOK worked examples from the user's own corrections (cloud prompt only, off by default)
  With the byok_worked_examples setting on, the BYOK expense prompt carries up
  to 5 of the user's most recently used phrase-memory rows as
  "Example: <phrase> → type/category/payee/account" lines
  (src/domain/workedExamples.ts). The on-device prompt never does, and with no
  examples the cloud prompt is byte-identical to before.

  Scenario: The most recently used transaction phrases become examples, at most five
    Given phrase memory with these rows:
      | key             | verdict | type    | category | payee   | account | lastUsedAt |
      | kopi at ya kun  |         | expense | Food     | Ya Kun  | Cash    | 90         |
      | grab home       | log     | expense | Transport| Grab    |         | 80         |
      | q:expense:kopi  |         | expense | Food     |         |         | 100        |
      | lottery         | not_log | expense | Gifts    |         |         | 95         |
      | mystery         |         |         |          |         |         | 99         |
      | bare type       |         | income  |          |         |         | 98         |
      | salary          |         | income  | Salary   |         | DBS     | 70         |
      | ntuc            |         | expense | Groceries| FairPrice|        | 60         |
      | netflix         |         | expense | Bills    | Netflix | Citi    | 50         |
      | old one         |         | expense | Food     |         |         | 10         |
    When I take the worked examples
    Then the examples should be:
      | example                                                   |
      | Example: kopi at ya kun → expense/Food/Ya Kun/Cash        |
      | Example: grab home → expense/Transport/Grab/-             |
      | Example: salary → income/Salary/-/DBS                     |
      | Example: ntuc → expense/Groceries/FairPrice/-             |
      | Example: netflix → expense/Bills/Netflix/Citi             |

  Scenario: The phrase being parsed is never its own example, and a deleted entity is left out
    Given phrase memory with these rows:
      | key             | verdict | type    | category | payee   | account | lastUsedAt |
      | kopi at ya kun  |         | expense | Food     | Ya Kun  | Cash    | 90         |
      | gone            |         | expense | Deleted  |         |         | 80         |
      | half gone       |         | expense | Food     | Deleted |         | 70         |
    When I take the worked examples excluding "kopi at ya kun"
    Then the examples should be:
      | example                                       |
      | Example: half gone → expense/Food/-/-         |

  Scenario: No examples leave the cloud prompt byte-identical
    When I build the cloud prompt for "coffee 5" without examples and with an empty list
    Then the two cloud prompts should be identical
    And the cloud prompt should not contain "Example:"

  Scenario: Examples go into the cloud prompt and never the on-device prompt
    Given phrase memory with these rows:
      | key             | verdict | type    | category | payee   | account | lastUsedAt |
      | kopi at ya kun  |         | expense | Food     | Ya Kun  | Cash    | 90         |
    When I build the cloud and on-device prompts for "teh 2" with the worked examples
    Then the cloud prompt should contain "Example: kopi at ya kun → expense/Food/Ya Kun/Cash"
    And the cloud prompt should end with the on-device prompt for "teh 2"
    And the on-device prompt should not contain "Example:"
    And the expense contract's prompt should equal the cloud prompt

Feature: On-device Foundation Models parse — prompt and output normalization
  Pure, framework-free bits of the on-device (Apple Foundation Models) parse
  tier: the zod guided-generation schema handed to the binding, building the
  grounded prompt, and normalizing the model's output into the same nullable
  shape the cloud parse produces.

  Scenario: The schema accepts required fields with sentinels and optionals omitted
    When the model returns the required fields with sentinels and optionals omitted
    Then the guided-generation schema should accept it

  Scenario: The schema rejects a parse missing a required field
    When the model returns a parse with no amount field
    Then the guided-generation schema should reject it

  Scenario: The guided-generation schema accepts a fully populated parse
    When the model returns a fully populated parse
    Then the guided-generation schema should accept it

  Scenario: The guided-generation schema rejects a wrongly typed field
    When the model returns a parse whose amount is the string "12.50"
    Then the guided-generation schema should reject it

  Scenario: The guided-generation schema stays expressible by the FM binding
    When the AI SDK converts the schema to JSON schema
    Then every property type should be a single supported type
    And the required fields should be amount, type, category, payee, account, confidence, pending

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

  Scenario: The prompt includes known accounts as a grounding hint
    Given existing accounts:
      | name |
      | Amex |
    When I build the device parse prompt for "spent 30 at Starbucks on my Amex" at time 1735689600000
    Then the prompt should mention "Known accounts: Amex"

  Scenario: The prompt omits hints when there are no known categories or payees
    When I build the device parse prompt for "coffee" at time 1735689600000
    Then the prompt should not mention "Known categories"
    And the prompt should not mention "Known payees"
    And the prompt should not mention "Known accounts"

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

  # ─── Currency-aware scale (review F1 / M7) ───────────────────────────────
  # Shared by BOTH the on-device FM path (deviceParse.ts) and the cloud path —
  # both funnel through normalizeDeviceParseOutput, so this pure test covers
  # the scale fix for either engine.

  Scenario: A bare amount at a 0-decimal active currency is not scaled at all
    When I normalize the device parse output at active currency "JPY":
      | field | value |
      | amount | 500 |
    Then the normalized amount should be 500

  Scenario: The same bare amount at the default (2-decimal) active currency scales ×100
    When I normalize the device parse output at active currency "USD":
      | field | value |
      | amount | 500 |
    Then the normalized amount should be 50000

  Scenario: A decimal amount at a 3-decimal active currency scales ×1000
    When I normalize the device parse output at active currency "KWD":
      | field | value |
      | amount | 12.5 |
    Then the normalized amount should be 12500

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

  Scenario: A placeholder-word payee normalizes to null
    When I normalize the device parse output:
      | field | value |
      | payee | "unknown" |
    Then the normalized payee should be null

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

  Scenario: "yesterday" in the text resolves deterministically to the prior day
    When I resolve the relative date in "spent 10 at mcdonalds yesterday" at time 1751800000000
    Then the resolved date should be local noon 1 days before 1751800000000

  Scenario: "3 days ago" resolves three days back
    When I resolve the relative date in "bought coffee 3 days ago" at time 1751800000000
    Then the resolved date should be local noon 3 days before 1751800000000

  Scenario: "today" resolves to the current day
    When I resolve the relative date in "lunch today at subway" at local time 2026-07-08 15:00
    Then the resolved date should be local noon on 2026-07-08

  Scenario: text with no relative date resolves to null
    When I resolve the relative date in "coffee at starbucks" at time 1751800000000
    Then the resolved date should be null

  Scenario: "24th June" (day first) resolves to that date, this year if past
    When I resolve the absolute date in "10 on food on 24th June" at time 1783296000000
    Then the resolved date should be local noon on 2026-06-24

  Scenario: "June 24" (month first) resolves the same
    When I resolve the absolute date in "spent 10 June 24 at the market" at time 1783296000000
    Then the resolved date should be local noon on 2026-06-24

  Scenario: an absolute date with an explicit year is honoured
    When I resolve the absolute date in "groceries on 3 May 2025" at time 1783296000000
    Then the resolved date should be local noon on 2025-05-03

  Scenario: a bare month with no day is not an absolute date
    When I resolve the absolute date in "may buy coffee" at time 1783296000000
    Then the resolved date should be null

  Scenario: a numeric DD/MM/YYYY date resolves (day-first)
    When I resolve the absolute date in "30 on mcdonald on the 24/06/2026" at time 1783296000000
    Then the resolved date should be local noon on 2026-06-24

  Scenario: an unambiguous MM/DD/YYYY numeric date is read correctly
    When I resolve the absolute date in "lunch 06/24/2026" at time 1783296000000
    Then the resolved date should be local noon on 2026-06-24

  Scenario: a bare amount is not mistaken for a numeric date
    When I resolve the absolute date in "spent 30 dollars at the shop" at time 1783296000000
    Then the resolved date should be null

  Scenario: an account named in the text is a real mention
    When I check whether account "Amex" is mentioned in "spent 10 at Starbucks on my Amex"
    Then the account should be considered mentioned

  Scenario: an account absent from the text is a hallucination
    When I check whether account "Budget" is mentioned in "30 on mcdonald on the 24/06/2026"
    Then the account should not be considered mentioned

  Scenario: a payee name ending in punctuation is still a real mention
    When I check whether payee "Acme Inc." is mentioned in "paid Acme Inc. for supplies"
    Then the account should be considered mentioned

  Scenario: an account name with trailing parentheses is still a real mention
    When I check whether account "Savings (USD)" is mentioned in "moved cash into Savings (USD) today"
    Then the account should be considered mentioned

  Scenario: A YYYY-MM-DD date converts to a local-noon epoch
    When I normalize the device parse output:
      | field | value |
      | occurredOn | "2026-07-05" |
    Then the normalized date should be local noon on 2026-07-05

  Scenario: A non-date occurredOn normalizes to null
    When I normalize the device parse output:
      | field | value |
      | occurredOn | "yesterday" |
    Then the normalized occurredAt should be null

  Scenario: An impossible date normalizes to null
    When I normalize the device parse output:
      | field | value |
      | occurredOn | "2026-02-31" |
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

  Scenario: A parse with a positive amount is useful
    When I check usefulness of a parse with amount 2000
    Then the parse should be useful

  Scenario: A parse with no amount is not useful
    When I check usefulness of a parse with amount null
    Then the parse should not be useful

  Scenario: A parse with a zero amount is not useful
    When I check usefulness of a parse with amount 0
    Then the parse should not be useful

  Scenario: A null parse is not useful
    When I check usefulness of a null parse
    Then the parse should not be useful

  Scenario: Grounding guards keep an account mentioned in the text
    When I apply grounding guards to account "Amex" and payee null for text "spent 10 at Starbucks on my Amex"
    Then the guarded account should be "Amex"

  Scenario: Grounding guards drop an account not mentioned in the text
    When I apply grounding guards to account "Budget" and payee null for text "spent 10 on lunch"
    Then the guarded account should be null

  Scenario: Grounding guards keep a payee mentioned in the text exactly
    When I apply grounding guards to account null and payee "Starbucks" for text "spent 10 at Starbucks"
    Then the guarded payee should be "Starbucks"

  Scenario: Grounding guards keep a payee mentioned in the text case-insensitively
    When I apply grounding guards to account null and payee "starbucks" for text "spent 10 at STARBUCKS"
    Then the guarded payee should be "starbucks"

  Scenario: Grounding guards drop a hallucinated payee absent from the text
    When I apply grounding guards to account null and payee "Malaysia Trip" for text "received $1000 salary today"
    Then the guarded payee should be null

  Scenario: Grounding guards keep a genuinely new payee typed by the user
    When I apply grounding guards to account null and payee "John" for text "paid John 20"
    Then the guarded payee should be "John"

  Scenario: Grounding guards strip a glued trailing amount from the payee
    When I apply grounding guards to payee "NTUC 80" with amount 8000 for text "groceries at NTUC 80"
    Then the guarded payee should be "NTUC"

  Scenario: Grounding guards keep trailing digits that are not the amount
    When I apply grounding guards to payee "Studio 54" with amount 1200 for text "spent 12 at Studio 54"
    Then the guarded payee should be "Studio 54"

  Scenario: Grounding guards strip a glued decimal amount from the payee
    When I apply grounding guards to payee "the coffee shop 4.5" with amount 450 for text "cai fan from the coffee shop 4.5"
    Then the guarded payee should be "the coffee shop"

  Scenario: The word today said before noon resolves to now, not a future noon
    When I resolve the relative date in "30$ on stuffd today" at local time 2026-07-08 06:54
    Then the resolved date should equal that local time

  Scenario: The word today said after noon resolves to local noon
    When I resolve the relative date in "coffee today" at local time 2026-07-08 15:00
    Then the resolved date should be local noon on 2026-07-08

  Scenario: Today's own bare date said in the morning stays this year
    When I resolve the absolute date in "lunch on 8 July" at local time 2026-07-08 06:54
    Then the resolved date should equal that local time

  Scenario: Today's own date with an explicit year said in the morning is not future
    When I resolve the absolute date in "lunch on 8 July 2026" at local time 2026-07-08 06:54
    Then the resolved date should equal that local time

  # ─── textHasPendingMarker: a hallucination backstop, not a context judge ───
  # (docs/design/pending-guard-marker-backstop-spec.md, Option 3). The FM is
  # reliable on these phrasings (Mac probe: 25/25 on trailing-marker cases,
  # stayed false on plain "40 dinner") — so the guard's only job is to confirm
  # an explicit marker word genuinely appears in the user's own text,
  # regardless of where relative to the amount. It is NOT a judge of what the
  # marker refers to.
  Scenario Outline: An explicit marker word anywhere in the text asserts pending
    When I check whether the text has a pending marker: "<utterance>"
    Then the text should have a pending marker <expected>

    Examples:
      | utterance                                | expected |
      | pending $40 dinner at Nando's             | true     |
      | provisional 15 coffee                     | true     |
      | tentative 50 hotel deposit                | true     |
      | unconfirmed 12.50 taxi                     | true     |
      | not yet paid 20 for the invoice           | true     |
      | not yet confirmed, 30 for the trip        | true     |
      | not yet finalised, 30 for the venue       | true     |
      | not yet finalized 30 venue                | true     |
      # The reported bug this fixes: a trailing marker after the amount, with
      # a glued "$" or no punctuation at all, was rejected by the old
      # amount-adjacency regex.
      | 27.72$ on dinner pending                  | true     |
      | dinner 27.72 pending                      | true     |
      | I might have spent 20 on lunch            | false    |
      | not sure yet, 30 groceries at NTUC        | false    |
      | paid 30 for gas                           | false    |
      | coffee 5                                  | false    |
      | 40 dinner at Nando's                       | false    |
      | bought groceries 80 at NTUC               | false    |
      | salary 3000                               | false    |
      | waiting for the bus, 2.50 fare            | false    |
      | might go back later, paid 25 lunch        | false    |
      # Word boundary: the marker must be a whole word — "spending"/"depending"
      # must NOT false-match on "pending".
      | spending 40 on groceries                  | false    |
      | depending on the weather, lunch was 20    | false    |
      | PENDING 40                                | true     |
      # Documented recall boundary (Option 3, deliberate): adverb forms of the
      # markers are NOT matched — the set is the base adjective/verb words only.
      # Fails safe (drops to not-pending; the manual toggle covers it). Flip
      # these to true only if real usage shows adverb phrasing is common.
      | tentatively 30 for lunch                  | false    |
      | provisionally 45 hotel                    | false    |

  # Accepted regressions (Option 3's deliberate tradeoff): a marker word is
  # present but its context has nothing to do with the transaction status —
  # amount-adjacency used to reject these; now the marker's mere presence is
  # enough, since a wrong flag is a visible Pending pill the user clears at
  # confirm time, not a silent totals change.
  Scenario Outline: Accepted: marker present, context wrong — shows a visible pill the user clears
    When I check whether the text has a pending marker: "<utterance>"
    Then the text should have a pending marker true

    Examples:
      | utterance                                                |
      | pending tray return, 4 cai fan                           |
      | pending 2 days shipping, lunch was 40                    |
      | unpaid 2 invoices from last month, dinner tonight was 40 |

  Scenario: Grounding guards keep the FM's pending proposal for an explicit marker in the text
    When the FM proposes pending true for "pending $40 dinner at Nando's" with amount 40
    Then the guarded pending should be true

  Scenario: Grounding guards keep the FM's pending proposal for the trailing-marker bug fix
    When the FM proposes pending true for "27.72$ on dinner pending" with amount 27.72
    Then the guarded pending should be true

  # Backstop: this is the reason the guard still exists — the FM's proposal
  # alone is not trusted; it must be corroborated by an actual marker word in
  # the user's own text.
  Scenario: Grounding guards drop a pending proposal with no marker in the text at all
    When the FM proposes pending true for "paid 30 for gas" with amount 30
    Then the guarded pending should be false

  Scenario: Grounding guards never invent pending when the FM itself proposed false
    When the FM proposes pending false for "pending $40 dinner at Nando's" with amount 40
    Then the guarded pending should be false

Feature: What the user changed — per-field before/after on every captured correction
  The on-device correction loop records, for each of amount, type, category,
  payee, account, date and note, what the engine proposed ("from") and what
  the user saved ("to") — names, never ids — plus which fields the user's
  history pre-filled (the payee's learned defaults and phrase memory),
  whether a refusal was overridden, and whether a draft code affirmed was
  discarded (src/domain/correctionEdits.ts). A case is captured
  automatically when a field changed or the draft was discarded, or when the
  user reports the parse as wrong. The developer screen groups the changes
  per engine and per field.

  Background:
    Given accounts "Wallet" and "Visa"
    And an engine draft of 4.80 expense on "Wallet" on 2026-10-09, category "Food", payee "starbucks" and no note

  Scenario: The engine's own proposal is recorded, not the learned default that replaced it
    Given the payee's learned category "Coffee" and learned account "Visa" were applied to the draft
    When the user saves the draft as shown
    Then the edit for "category" should be from "Food" to "Coffee"
    And the edit for "account" should be from "Wallet" to "Visa"
    And the applied defaults should be "payee:category, payee:account"
    And the case should be captured

  Scenario: Phrase memory's fields are reverted too, and named by their source
    Given phrase memory set the type to "income" and the payee to "Starbucks Reserve" on the draft
    When the user saves the draft as shown
    Then the edit for "type" should be from "expense" to "income"
    And the edit for "payee" should be from "starbucks" to "Starbucks Reserve"
    And the applied defaults should be "phrase:type, phrase:payee"

  Scenario: Saving exactly what the engine proposed captures nothing
    When the user saves the draft as shown
    Then no field should count as changed
    And the case should not be captured

  Scenario: A difference only in letter case is not an edit
    When the user saves it with payee "Starbucks"
    Then no field should count as changed

  Scenario: Reporting the parse as wrong captures it even when nothing changed
    When the user saves the draft as shown, reporting it as wrong
    Then the case should be captured

  Scenario: Every changed field is recorded with names and day-precision dates
    When the user saves it as 48.00 income on "Visa" on 2026-10-08 with category "Refund", payee "Starbucks" and note "returned mug"
    Then the edit for "amount" should be from 480 to 4800
    And the edit for "type" should be from "expense" to "income"
    And the edit for "date" should be from "2026-10-09" to "2026-10-08"
    And the edit for "note" should be from nothing to "returned mug"
    And the changed fields should be "amount, type, category, account, date, note"

  Scenario: A discarded draft is captured with no "to" values
    When the user discards the draft
    Then the case should be marked discarded with every "to" empty
    And the case should be captured

  Scenario Outline: An amount change is classified by what kind of mistake it was
    Then an amount change from <from> to <to> should read "<kind>"

    Examples:
      | from | to    | kind           |
      | 480  | 4800  | scale changed  |
      | 4800 | 48    | scale changed  |
      | 480  | 490   | digits changed |
      | 480  | 52    | other          |

  Scenario Outline: A date change is bucketed by its day offset
    Then a date change from "<from>" to "<to>" should read "<bucket>"

    Examples:
      | from       | to         | bucket           |
      | 2026-10-09 | 2026-10-08 | -1 day           |
      | 2026-10-09 | 2026-10-10 | +1 day           |
      | 2026-10-09 | 2026-10-04 | -2–7 days        |
      | 2026-10-09 | 2026-10-14 | +2–7 days        |
      | 2026-10-09 | 2026-09-01 | > 7 days earlier |
      | 2026-10-31 | 2026-11-30 | > 7 days later   |

  Scenario: The developer screen's per-engine view counts edits and ranks the top pairs
    Given captured cases:
      | engine    | category from | category to | amount from | amount to | discarded | refused |
      | on_device | Food          | Coffee      | 480         | 480       | no        | no      |
      | on_device | Food          | Coffee      | 480         | 4800      | no        | no      |
      | on_device | Shopping      | Groceries   | 1200        | 1300      | no        | yes     |
      | on_device | Food          | Food        | 500         | 500       | yes       | no      |
      | heuristic | Other         | Transport   | 900         | 900       | no        | no      |
    When the edits are aggregated per engine
    Then engine "on_device" should show 3 cases, 1 discarded and 1 after a refusal
    And engine "on_device" field "category" should show 3 edits with top pairs "Food → Coffee ×2, Shopping → Groceries ×1"
    And engine "on_device" field "amount" should show 2 edits with top pairs "digits changed ×1, scale changed ×1"
    And engine "heuristic" field "category" should show 1 edits with top pairs "Other → Transport ×1"

  Scenario: At most five pairs are listed per field
    Given seven captured on-device cases each changing the category to a different name
    When the edits are aggregated per engine
    Then engine "on_device" field "category" should show 7 edits and list 5 pairs

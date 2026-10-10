Feature: "This parse was wrong" — a correction becomes a real eval case
  The on-device correction loop (docs/design/parse-correction-loop-spec.md):
  when the user reports a parse as wrong and fixes it, the fix is written to
  a local file as ONE case in the exact shape of evals/dataset.jsonl, so it
  can be folded into the dev split and the on-device probe re-run against it.
  These are the pure rules (src/domain/parseCorrection.ts): the shape, the
  id, the dates, what a transfer carries, what is refused before any write —
  and the proof that the shape is the harness's own, by running a built case
  through the real `evals/corrections/fold.mjs --validate`.

  Background:
    Given the parse saw categories "Dining:expense, Groceries:expense, Salary:income", payees "Starbucks, FairPrice" and accounts "Wallet, Visa"
    And the parse ran at local time 2026-10-10 12:00

  Scenario: A corrected expense becomes a dataset case with the user's fields as expected
    When the user reports "coffee 4.80 at starbux" as wrong and saves it as an expense of 480 on 2026-10-09 with category "Dining" and payee "Starbucks" from engine "on_device"
    Then the case should carry the text "coffee 4.80 at starbux"
    And the case's expected should be amount 480, sign "expense", date "2026-10-09", category "Dining" and payee "Starbucks"
    And the case's context should list categories "Dining:expense, Groceries:expense, Salary:income", payees "Starbucks, FairPrice" and accounts "Wallet, Visa"
    And the case's context nowISO should start with "2026-10-10T12:00:00"
    And the case's axis should be "user-correction" and its engine "on_device"
    And the case should carry no split

  Scenario: An archived account is not part of the grounding
    Given the account "Visa" is archived
    When the user reports "coffee 4.80 at starbux" as wrong and saves it as an expense of 480 on 2026-10-09 with category "Dining" and payee "Starbucks" from engine "on_device"
    Then the case's context should list accounts "Wallet"

  Scenario: The id is a dev-split addition so split.mjs can never hold it out
    When the user reports "coffee 4.80 at starbux" as wrong and saves it as an expense of 480 on 2026-10-09 with category "Dining" and payee "Starbucks" from engine "on_device"
    Then the case id should start with "dv-uc-20261010-"
    And the dev-addition prefix should be the one evals/split.mjs uses

  Scenario: A corrected transfer carries no category or payee
    When the user reports "move 100 to visa" as wrong and saves it as a transfer of 10000 on 2026-10-10 with category "Dining" and payee "Starbucks" from engine "heuristic"
    Then the case's expected should be amount 10000, sign "transfer", date "2026-10-10", category null and payee null

  Scenario: An empty category or payee is recorded as null, not an empty string
    When the user reports "spent 12" as wrong and saves it as an expense of 1200 on 2026-10-10 with category "" and payee "" from engine "on_device"
    Then the case's expected should be amount 1200, sign "expense", date "2026-10-10", category null and payee null

  Scenario: A correction with no amount is refused before anything is written
    When the user reports "spent 12" as wrong and saves it as an expense of 0 on 2026-10-10 with category "" and payee "" from engine "on_device"
    Then building the case should throw

  Scenario: A correction with no text is refused before anything is written
    When the user reports "" as wrong and saves it as an expense of 1200 on 2026-10-10 with category "" and payee "" from engine "on_device"
    Then building the case should throw

  Scenario: A built case is valid against the harness's own dataset schema
    When the user reports "coffee 4.80 at starbux" as wrong and saves it as an expense of 480 on 2026-10-09 with category "Dining" and payee "Starbucks" from engine "on_device"
    And the case is written to a corrections file and run through evals/corrections/fold.mjs --validate
    Then the fold script should accept it as 1 valid, new correction

  Scenario: The fold script refuses a case that would not land in the dev split
    Given a corrections file holding a case whose id is "uc-20261010-abc123"
    When it is run through evals/corrections/fold.mjs --validate
    Then the fold script should refuse it, naming the dev prefix

  Scenario: Reading the file back tolerates a cut-short last line
    Given a corrections file holding two valid cases and a half-written third line
    When the file is parsed
    Then 2 cases should be read and 1 line counted as invalid

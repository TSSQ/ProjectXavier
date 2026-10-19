Feature: The parse prompt grounds the model in the entities that matter, not every one the user has
  The prompt builders used to list every payee, category and account. After
  months a user has far longer lists than the eval's 8 payees / 13 categories,
  and the grounding guards drop any payee or account the text does not name
  anyway. A pure selector (src/domain/groundingSelection.ts) caps the lists the
  same way for the app and the eval. Each list keeps the caller's order: the
  first FM dev run sorted them by name, which changed no entity in any small
  context yet lost six dev cases, so a short list is sent exactly as given.

  Background:
    Given 60 payees named "Payee 01" to "Payee 60" plus "FairPrice", "The Old Kopitiam" and "Grab"
    And 45 categories named "Category 01" to "Category 45" plus "Groceries", "Dining", "Transport", "Donations" and "Dental Care"
    And accounts "UOB One, Cash, DBS Savings"

  Scenario: Every payee the text names is offered, plus at most ten recent ones
    Given payee usage: FairPrice used 3 times last on 2026-09-01, Grab used 40 times last on 2026-10-09, Payee 05 used once last on 2026-10-08, Payee 60 used 9 times last on 2026-10-07
    When the grounding is selected for "lunch at the kopitiam 6.50"
    Then the selected payees are "Payee 01, Payee 02, Payee 03, Payee 04, Payee 05, Payee 06, Payee 07, Payee 60, FairPrice, The Old Kopitiam, Grab"
    And the selected payees include "The Old Kopitiam"
    And at most 11 selected payees are not named in the text

  Scenario: A payee named in the text is offered even when it was never used
    When the grounding is selected for "groceries 64.20 at FairPrice"
    Then the selected payees include "FairPrice"
    And the selected payees number 11

  Scenario: Without usage the recent payees are picked by name, then listed in the caller's order
    When the grounding is selected for "coffee 4"
    Then the selected payees are "Payee 01, Payee 02, Payee 03, Payee 04, Payee 05, Payee 06, Payee 07, Payee 08, FairPrice, Grab"

  Scenario: Twenty or fewer payees are all offered, in the caller's order
    Given 18 payees named "Payee 01" to "Payee 18" plus "Grab" and "FairPrice"
    When the grounding is selected for "coffee 4"
    Then the selected payees number 20
    And the selected payees are the payees as given

  Scenario: Past twenty payees the list is capped
    Given 19 payees named "Payee 01" to "Payee 19" plus "Grab" and "FairPrice"
    When the grounding is selected for "coffee 4"
    Then the selected payees number 10

  Scenario Outline: A payee sharing a word of three or more letters with the text survives the cap
    Given 30 payees named "Payee 01" to "Payee 30" plus "NTUC FairPrice", "Starbucks Reserve" and "The Coffee Bean"
    When the grounding is selected for "<text>"
    Then the selected payees include "<payee>"

    Examples:
      | text                         | payee             |
      | I save 5 at ntuc paid 40     | NTUC FairPrice    |
      | flat white 5.80 at starbucks | Starbucks Reserve |
      | coffee bean 6.20             | The Coffee Bean   |

  Scenario: A connector word or a short word names no payee
    Given 30 payees named "Payee 01" to "Payee 30" plus "Thought For Food" and "The Coffee Bean"
    When the grounding is selected for "lunch for the 2 of us 30"
    Then the selected payees do not include "Thought For Food, The Coffee Bean"

  Scenario: Thirty or fewer categories are all offered, in the caller's order
    Given only the categories "Transport, Dining, Groceries"
    When the grounding is selected for "coffee 4"
    Then the selected categories are "Transport, Dining, Groceries"

  Scenario: Past thirty categories the most used are offered, plus any the text names
    Given category usage: Transport used 50 times, Dining used 40 times, Groceries used 30 times, Category 45 used 2 times
    When the grounding is selected for "groceries 64.20 at FairPrice"
    Then the selected categories number 30
    And the selected categories include "Transport, Dining, Groceries, Category 45"
    And the selected categories do not include "Category 44"

  Scenario: A category the text names survives the cap even when never used
    Given category usage: Transport used 50 times, Dining used 40 times
    When the grounding is selected for "category 44 stuff 12"
    Then the selected categories include "Category 44"

  Scenario: A category sharing a word with the text survives the cap
    Given category usage: Transport used 50 times, Dining used 40 times
    When the grounding is selected for "dental 120"
    Then the selected categories include "Dental Care"
    And the selected categories number 31

  Scenario: A category named in the singular survives the cap
    Given category usage: Transport used 50 times, Dining used 40 times
    When the grounding is selected for "donation 50 to Red Cross"
    Then the selected categories include "Donations"
    And the selected categories number 31

  Scenario: Every account is offered, in the caller's order
    When the grounding is selected for "coffee 4"
    Then the selected accounts are "UOB One, Cash, DBS Savings"

  Scenario: Which entities are kept does not depend on the caller's order
    Given payee usage: Grab used 40 times last on 2026-10-09
    When the grounding is selected for "grab to work 11.20" twice with the payees shuffled
    Then both selections keep the same entities
    And each selection lists them in its caller's order

  Scenario: The on-device prompt lists only the selected entities
    Given payee usage: Grab used 40 times last on 2026-10-09
    When I build the FM parse prompt for "lunch at the kopitiam 6.50"
    Then the prompt mentions "Known payees: Payee 01, Payee 02, Payee 03, Payee 04, Payee 05, Payee 06, Payee 07, Payee 08, FairPrice, The Old Kopitiam, Grab."
    And the prompt does not mention "Payee 60"
    And the prompt lists 30 known categories
    And the prompt mentions "Known accounts: UOB One, Cash, DBS Savings."

  Scenario: The BYOK prompt lists the same selected entities
    Given payee usage: Grab used 40 times last on 2026-10-09
    When I build the BYOK cloud expense prompt for "lunch at the kopitiam 6.50"
    Then the prompt mentions "Known payees: Payee 01, Payee 02, Payee 03, Payee 04, Payee 05, Payee 06, Payee 07, Payee 08, FairPrice, The Old Kopitiam, Grab."
    And the prompt does not mention "Payee 60"
    And the prompt lists 30 known categories

  Scenario: Past thirty categories the BYOK prompt keeps the most used, even those that sort late
    Given category usage: Transport used 50 times, Dining used 40 times, Groceries used 30 times, Category 45 used 2 times
    When I build the BYOK cloud expense prompt for "coffee 4"
    Then the prompt lists 30 known categories
    And the prompt mentions "Transport"
    And the prompt mentions "Category 45"
    And the prompt does not mention "Category 44"

  Scenario: Small lists are sent exactly as given
    Given only the categories "Salary, Dining"
    And only the payees "Subway, FairPrice"
    When I build the FM parse prompt for "paid 20"
    Then the prompt mentions "Known categories: Salary, Dining."
    And the prompt mentions "Known payees: Subway, FairPrice."

  Scenario: Every pre-existing dev case gets the same FM prompt as main before the caps
    Given the FM prompt hashes recorded from main in "tests/fixtures/fm-prompt-sha.main.json"
    When the FM prompt is built for every dev case without usage data, as the eval builds it
    Then every prompt hashes the same as main's
    And no dev case without usage data is missing from the recording

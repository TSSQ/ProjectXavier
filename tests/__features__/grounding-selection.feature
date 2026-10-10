Feature: The parse prompt grounds the model in the entities that matter, not every one the user has
  The prompt builders used to list every payee, category and account. After
  months a user has far longer lists than the eval's 8 payees / 13 categories,
  and the grounding guards drop any payee or account the text does not name
  anyway. A pure selector (src/domain/groundingSelection.ts) caps the lists the
  same way for the app and the eval, sorted by name so the prompt is reproducible.

  Background:
    Given 60 payees named "Payee 01" to "Payee 60" plus "FairPrice", "The Old Kopitiam" and "Grab"
    And 45 categories named "Category 01" to "Category 45" plus "Groceries", "Dining", "Transport" and "Donations"
    And accounts "UOB One, Cash, DBS Savings"

  Scenario: Every payee the text names is offered, plus at most ten recent ones
    Given payee usage: FairPrice used 3 times last on 2026-09-01, Grab used 40 times last on 2026-10-09, Payee 05 used once last on 2026-10-08, Payee 60 used 9 times last on 2026-10-07
    When the grounding is selected for "lunch at the kopitiam 6.50"
    Then the selected payees are "FairPrice, Grab, Payee 01, Payee 02, Payee 03, Payee 04, Payee 05, Payee 06, Payee 07, Payee 60, The Old Kopitiam"
    And the selected payees include "The Old Kopitiam"
    And at most 11 selected payees are not named in the text

  Scenario: A payee named in the text is offered even when it was never used
    When the grounding is selected for "groceries 64.20 at FairPrice"
    Then the selected payees include "FairPrice"
    And the selected payees number 11

  Scenario: Without usage the recent payees fall back to name order
    When the grounding is selected for "coffee 4"
    Then the selected payees are "FairPrice, Grab, Payee 01, Payee 02, Payee 03, Payee 04, Payee 05, Payee 06, Payee 07, Payee 08"

  Scenario: Thirty or fewer categories are all offered, sorted
    Given only the categories "Transport, Dining, Groceries"
    When the grounding is selected for "coffee 4"
    Then the selected categories are "Dining, Groceries, Transport"

  Scenario: Past thirty categories the most used are offered, plus any the text names
    Given category usage: Transport used 50 times, Dining used 40 times, Groceries used 30 times, Category 45 used 2 times
    When the grounding is selected for "groceries 64.20 at FairPrice"
    Then the selected categories number 30
    And the selected categories include "Transport, Dining, Groceries, Category 45"
    And the selected categories do not include "Category 44"

  Scenario: A category the text names survives the cap even when never used, by its whole name only
    Given category usage: Transport used 50 times, Dining used 40 times
    When the grounding is selected for "category 44 stuff 12"
    Then the selected categories include "Category 44"
    And the selected categories number 31

  Scenario: A category named in the singular survives the cap
    Given category usage: Transport used 50 times, Dining used 40 times
    When the grounding is selected for "donation 50 to Red Cross"
    Then the selected categories include "Donations"
    And the selected categories number 31

  Scenario: Every account is offered, sorted
    When the grounding is selected for "coffee 4"
    Then the selected accounts are "Cash, DBS Savings, UOB One"

  Scenario: The selection is a pure function of its inputs
    Given payee usage: Grab used 40 times last on 2026-10-09
    When the grounding is selected for "grab to work 11.20" twice with the payees shuffled
    Then both selections are identical

  Scenario: The on-device prompt lists only the selected entities
    Given payee usage: Grab used 40 times last on 2026-10-09
    When I build the FM parse prompt for "lunch at the kopitiam 6.50"
    Then the prompt mentions "Known payees: FairPrice, Grab, Payee 01, Payee 02, Payee 03, Payee 04, Payee 05, Payee 06, Payee 07, Payee 08, The Old Kopitiam."
    And the prompt does not mention "Payee 60"
    And the prompt lists 30 known categories
    And the prompt mentions "Known accounts: Cash, DBS Savings, UOB One."

  Scenario: The BYOK prompt lists the same selected entities
    Given payee usage: Grab used 40 times last on 2026-10-09
    When I build the device parse prompt for "lunch at the kopitiam 6.50"
    Then the prompt mentions "Known payees: FairPrice, Grab, Payee 01, Payee 02, Payee 03, Payee 04, Payee 05, Payee 06, Payee 07, Payee 08, The Old Kopitiam."
    And the prompt does not mention "Payee 60"
    And the prompt lists 30 known categories

  Scenario: Small lists are unchanged apart from the sort
    Given only the categories "Dining, Salary"
    And only the payees "Subway, FairPrice"
    When I build the FM parse prompt for "paid 20"
    Then the prompt mentions "Known categories: Dining, Salary."
    And the prompt mentions "Known payees: FairPrice, Subway."

Feature: The save sequence runs the write-boundary guard first, against a live read
  docs/design/stale-draft-spec.md §3.1's fix is one line inside
  `saveAssistantDraft`: `assertDraftIsSaveable(draft, await listAccounts())`,
  positioned before any payee/category/transaction write. QA proved that
  line was unprotected — deleting it by hand left the full suite green,
  because the only existing test (draft-integrity.feature) exercises
  `assertDraftIsSaveable` in isolation, never as part of the sequence that
  is supposed to call it.

  `saveAssistantDraftWith` (src/features/ai/saveDraftSequence.ts) is that
  sequence with every native/DB operation injected as `deps`, so a fake
  repository here can record the ORDER calls happen in — not just whether
  the guard's own logic is correct, but whether it actually runs, and
  whether it runs before anything else touches the fake DB.

  Background:
    Given now is fixed for the sequence

  Scenario: A draft whose account is gone is refused before any other repository call
    Given a fake repository with accounts "Wallet"
    And a draft against account "Ghost" with amount 10.00
    When I save the draft through the sequence
    Then the save should throw a DraftAccountGoneError
    And the repository call log should be "listAccounts"

  Scenario: A draft whose account's currency changed is refused before any other repository call
    Given a fake repository with accounts "Wallet" in "USD"
    And a draft against account "Wallet" with amount 10.00 and currency "SGD"
    When I save the draft through the sequence
    Then the save should throw a DraftCurrencyStaleError
    And the repository call log should be "listAccounts"

  Scenario: A transfer draft whose destination is gone is refused before any other repository call
    Given a fake repository with accounts "Wallet"
    And a transfer draft from "Wallet" to "Ghost" with amount 10.00
    When I save the draft through the sequence
    Then the save should throw a DraftTransferAccountGoneError
    And the repository call log should be "listAccounts"

  Scenario: A valid expense draft's calls land in order — guard, then category, then payee, then the row
    Given a fake repository with accounts "Wallet"
    And a draft against account "Wallet" with amount 10.00, category "Food" and payee "Kopitiam"
    When I save the draft through the sequence
    Then the save should not throw
    And the repository call log should be "listAccounts > findOrCreateCategory > getPayeeByName > findOrCreatePayee > createTransaction"

  Scenario: A valid transfer draft skips category/payee resolution entirely
    Given a fake repository with accounts "Wallet" and "Savings"
    And a transfer draft from "Wallet" to "Savings" with amount 10.00
    When I save the draft through the sequence
    Then the save should not throw
    And the repository call log should be "listAccounts > createTransaction"

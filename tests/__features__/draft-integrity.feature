Feature: A pending draft must not outlive the data it points at
  docs/design/stale-draft-spec.md — a confirm-card TransactionDraft freezes
  `accountId` and `currency` at the moment it was built, but tab switches
  don't unmount the card (app/(tabs)/_layout.tsx), so the account behind it
  can be deleted, or its currency relabelled in place (Settings'
  relabelCurrency), while the card is still on screen. `checkDraftIntegrity`/
  `assertDraftIsSaveable` (src/domain/draftIntegrity.ts) are the write-
  boundary guard (§3.1) — checked against the live account list at save
  time, not whatever the draft itself remembers.

  Note on "no row is written" (criteria 1/2): saveAssistantDraft itself goes
  through the Drizzle/expo-sqlite repository, which this plain-Node suite
  can't import (same limitation noted in statement-drafts.feature) — there
  is no BDD DB harness for it. This feature instead proves the guard it
  calls FIRST, before any write: `assertDraftIsSaveable` throws synchronously
  for both cases below, so saveAssistantDraft's own call to it (see
  src/features/ai/saveDraft.ts) can never reach `createTransaction`.

  A transfer draft carries a SECOND account reference (`transferAccountId`,
  the destination) with the identical exposure — deleting it behind an open
  transfer card leaves the same orphan through the same unchecked write, so
  it gets the same guard, with copy that says which side disappeared.

  Background:
    Given an asset account "Wallet" with opening balance 100.00 and currency "SGD"
    And an asset account "Savings" with opening balance 0.00 and currency "SGD"

  Scenario: A draft whose account still exists is saveable
    Given a draft against "Wallet" with amount 12.00 and currency "SGD"
    Then the draft integrity check should be "ok"
    And asserting the draft is saveable should not throw

  Scenario: A draft whose account was deleted is refused
    Given a draft against "Wallet" with amount 12.00 and currency "SGD"
    And the account "Wallet" is deleted
    Then the draft integrity check should be "account-gone"
    And asserting the draft is saveable should throw a DraftAccountGoneError

  Scenario: A draft whose account's currency was relabelled since is refused
    Given a draft against "Wallet" with amount 12.00 and currency "SGD"
    And the account "Wallet" is relabelled to currency "USD"
    Then the draft integrity check should be "currency-changed"
    And asserting the draft is saveable should throw a DraftCurrencyStaleError

  Scenario: A draft whose account is untouched still saves byte-identical
    Given a draft against "Wallet" with amount 12.00 and currency "SGD"
    When I build the transaction from that draft
    Then the built transaction's accountId should be "Wallet"
    And the built transaction's currency should be "SGD"
    And the built transaction's amount should be 1200

  Scenario: A transfer draft whose destination account still exists is saveable
    Given a transfer draft from "Wallet" to "Savings" with amount 50.00
    Then the draft integrity check should be "ok"
    And asserting the draft is saveable should not throw

  Scenario: A transfer draft whose destination account was deleted is refused
    Given a transfer draft from "Wallet" to "Savings" with amount 50.00
    And the account "Savings" is deleted
    Then the draft integrity check should be "transfer-account-gone"
    And asserting the draft is saveable should throw a DraftTransferAccountGoneError

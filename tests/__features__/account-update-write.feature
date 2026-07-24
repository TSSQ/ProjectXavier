Feature: Account update write-time balance guardrail (resolveUpdatedAccount)
  QA BLOCKER (financial-data-corruption): `onConfirmAccountUpdate` in
  app/(tabs)/index.tsx must never write a balance change for a rename or
  retype, even if the draft that reached it somehow carried a wrong
  `newBalance`. `resolveUpdatedAccount` (src/domain/accountUpdateAssistant.ts)
  is the pure "what actually gets written" decision, tested here at the write
  boundary — since app/(tabs)/index.tsx itself is excluded from the BDD suite
  (native imports), this is the closest thing to a true write-level guarantee:
  `openingBalance` only ever changes when `draft.balanceEdited` is true.

  Background:
    Given an existing account "DBS Savings" with balance 10000

  Scenario: A rename preserves the existing balance even if the draft's newBalance is wrong
    Given an update draft with op "rename" newName "Rainy Day" newBalance 0 balanceEdited false
    When I resolve the write for that draft
    Then the written openingBalance should be 10000
    And the written name should be "Rainy Day"

  Scenario: A retype preserves the existing balance even if the draft's newBalance is wrong
    Given an update draft with op "retype" newName "DBS Savings" newSubtype "credit_card" newBalance 1234 balanceEdited false
    When I resolve the write for that draft
    Then the written openingBalance should be 10000

  Scenario: A rebalance DOES change the balance
    Given an update draft with op "rebalance" newName "DBS Savings" newBalance 500000 balanceEdited true
    When I resolve the write for that draft
    Then the written openingBalance should be 500000

  Scenario: A manual balance edit on a rename is honored
    Given an update draft with op "rename" newName "Rainy Day" newBalance 750000 balanceEdited true
    When I resolve the write for that draft
    Then the written openingBalance should be 750000

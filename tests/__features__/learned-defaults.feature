Feature: Learned payee defaults — the user's past choice wins over the engine's guess
  Every parse engine always fills a category, so "use the payee's learned
  default when the draft has none" never fired for a known payee: the engine's
  guess always won, and only a brand-new payee ever learned. These are the
  pure rules (src/domain/learnedDefaults.ts) that make a correction stick:
  a known payee's remembered category replaces the engine's proposal unless
  the user typed that proposal themselves; its remembered account is used
  when the engine named none; each is flagged on the card with an exact
  revert; and what the user confirms becomes the payee's new default.

  Background:
    Given categories:
      | name   | kind    |
      | Food   | expense |
      | Coffee | expense |
      | Salary | income  |
    And accounts:
      | name     | currency |
      | Wallet   | SGD      |
      | Visa     | SGD      |
      | USD Card | USD      |
    And a payee "Starbucks" remembering category "Coffee" and account "Visa"

  # ── category ───────────────────────────────────────────────────────────────

  Scenario: The learned category wins over the engine's proposal
    Given an expense draft for payee "Starbucks" with category "Food" from the text "spent 6 at starbucks"
    When learned defaults are applied
    Then the draft's category should be "Coffee"
    And the category should be flagged as learned, remembering the engine's "Food"

  Scenario: A category the user typed wins over the learned one
    Given an expense draft for payee "Starbucks" with category "Food" from the text "spent 6 at starbucks on food"
    When learned defaults are applied
    Then the draft's category should be "Food"
    And the category should not be flagged as learned

  Scenario: The learned category still wins when the user's words are unknown
    Given an expense draft for payee "Starbucks" with category "Food" from no text
    When learned defaults are applied
    Then the draft's category should be "Coffee"

  Scenario: The learned category fills a draft the engine left without one
    Given an expense draft for payee "Starbucks" with no category from the text "spent 6 at starbucks"
    When learned defaults are applied
    Then the draft's category should be "Coffee"
    And the category should be flagged as learned, remembering the engine's nothing

  Scenario: An unknown payee has nothing to teach
    Given an expense draft for payee "Nonna's" with category "Food" from the text "spent 6 at nonna's"
    When learned defaults are applied
    Then the draft should be unchanged

  Scenario: A close-but-not-exact payee is not trusted
    Given an expense draft for payee "Starbux" with category "Food" from the text "spent 6 at starbux"
    When learned defaults are applied
    Then the draft should be unchanged

  Scenario: A learned category of another kind never lands on the draft
    Given an income draft for payee "Starbucks" with category "Salary" from the text "got 6 from starbucks"
    When learned defaults are applied
    Then the draft should be unchanged

  Scenario: Proposing the learned category itself is not a replacement
    Given an expense draft for payee "Starbucks" with category "coffee" from the text "spent 6 at starbucks"
    When learned defaults are applied
    Then the draft's category should be "coffee"
    And the category should not be flagged as learned

  Scenario: A learned category that no longer exists is ignored
    Given the payee "Starbucks" remembers a category that was deleted
    And an expense draft for payee "Starbucks" with category "Food" from the text "spent 6 at starbucks"
    When learned defaults are applied
    Then the draft should be unchanged

  Scenario: Reverting the learned category restores the engine's proposal
    Given an expense draft for payee "Starbucks" with category "Food" from the text "spent 6 at starbucks"
    And learned defaults were applied
    When the learned category is reverted
    Then the draft's category should be "Food"
    And the category should not be flagged as learned

  Scenario: Reverting a learned category the engine never proposed clears it again
    Given an expense draft for payee "Starbucks" with no category from the text "spent 6 at starbucks"
    And learned defaults were applied
    When the learned category is reverted
    Then the draft should have no category
    And the category should be marked as defaulted

  # ── account ────────────────────────────────────────────────────────────────

  Scenario: The learned account is used when the engine named none
    Given an expense draft for payee "Starbucks" on the defaulted account "Wallet"
    When learned defaults are applied
    Then the draft's account should be "Visa"
    And the account should be flagged as learned, remembering the engine's "Wallet"
    And the account should not be marked as defaulted

  Scenario: An account the engine named is kept
    Given an expense draft for payee "Starbucks" on the named account "Wallet"
    When learned defaults are applied
    Then the draft's account should be "Wallet"
    And the account should not be flagged as learned

  Scenario: An account name the user gave but that did not resolve blocks the learned account
    Given an expense draft for payee "Starbucks" on the defaulted account "Wallet" after "my dbs" was not found
    When learned defaults are applied
    Then the draft's account should be "Wallet"
    And the account should not be flagged as learned

  Scenario: A learned account in another currency is never used silently
    Given the payee "Starbucks" remembers the account "USD Card"
    And an expense draft for payee "Starbucks" on the defaulted account "Wallet"
    When learned defaults are applied
    Then the draft's account should be "Wallet"
    And the account should not be flagged as learned

  Scenario: A learned account in the currency the user named resolves the conflict
    Given the payee "Starbucks" remembers the account "USD Card"
    And an expense draft for payee "Starbucks" on the defaulted account "Wallet" having heard "USD"
    When learned defaults are applied
    Then the draft's account should be "USD Card"
    And the draft's currency should be "USD"
    And the draft should have no currency conflict

  Scenario: A learned account that is archived is ignored
    Given the account "Visa" is archived
    And an expense draft for payee "Starbucks" on the defaulted account "Wallet"
    When learned defaults are applied
    Then the draft's account should be "Wallet"

  Scenario: A transfer never takes a learned account
    Given a transfer draft from the defaulted account "Wallet" to "Visa"
    When learned defaults are applied
    Then the draft should be unchanged

  Scenario: Reverting the learned account restores the engine's account and its currency conflict
    Given the payee "Starbucks" remembers the account "USD Card"
    And an expense draft for payee "Starbucks" on the defaulted account "Wallet" having heard "USD"
    And learned defaults were applied
    When the learned account is reverted
    Then the draft's account should be "Wallet"
    And the draft's currency should be "SGD"
    And the draft should have a currency conflict with "USD"
    And the account should be marked as defaulted

  # ── learning ───────────────────────────────────────────────────────────────

  Scenario: A changed category becomes the payee's new default
    When the user confirms category "Food" on account "Visa" for "Starbucks"
    Then the payee should learn category "Food" only

  Scenario: A changed account becomes the payee's new default
    When the user confirms category "Coffee" on account "Wallet" for "Starbucks"
    Then the payee should learn account "Wallet" only

  Scenario: Confirming what the payee already remembers writes nothing
    When the user confirms category "Coffee" on account "Visa" for "Starbucks"
    Then the payee should learn nothing

  Scenario: Saving without a category never forgets the remembered one
    When the user confirms no category on account "Visa" for "Starbucks"
    Then the payee should learn nothing

  Scenario: A payee that remembers nothing learns both
    Given a payee "Nonna's" remembering nothing
    When the user confirms category "Food" on account "Wallet" for "Nonna's"
    Then the payee should learn category "Food" and account "Wallet"

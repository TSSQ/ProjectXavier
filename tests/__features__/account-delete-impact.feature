Feature: Account-delete impact calculation
  computeAccountDeleteImpact (docs/design/account-chat-crud-spec.md §5.3/§5.4)
  is the pure "what would this destroy" calculation shared by the chat delete
  handoff and the manage-accounts delete sheet — counts every transaction
  touching the account (as accountId OR transferAccountId), the subset that
  are transfers, every OTHER account whose balance would change, and every
  recurring series that references it.

  Background:
    Given accounts "DBS Savings" (acc-dbs) and "OCBC Current" (acc-ocbc) and "Cash Wallet" (acc-cash)

  Scenario: A mix of expenses and transfers on the target account
    Given a $10 expense on acc-dbs
    And a $500 transfer from acc-dbs to acc-ocbc
    And a $200 transfer from acc-ocbc to acc-dbs
    And a $5 expense on acc-cash
    When I compute the delete impact for acc-dbs
    Then the transaction count should be 3
    And the transfer count should be 2
    And the counterparty accounts should be acc-ocbc

  Scenario: No transactions touch the account at all
    Given a $5 expense on acc-cash
    When I compute the delete impact for acc-dbs
    Then the transaction count should be 0
    And the transfer count should be 0
    And the counterparty accounts should be none

  Scenario: A recurring series referencing the account as its own account or transfer destination
    Given a recurring series "rent" with account acc-dbs
    And a recurring series "savings-transfer" transferring into acc-dbs from acc-cash
    And a recurring series "unrelated" with account acc-cash
    When I compute the delete impact for acc-dbs
    Then the recurring series ids should include "rent" and "savings-transfer"
    And the recurring series ids should not include "unrelated"

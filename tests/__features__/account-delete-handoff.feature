Feature: Chat delete handoff message — recognize + never execute
  buildAccountDeleteHandoff (docs/design/account-chat-crud-spec.md §5.3) names
  the impact of deleting an account, including the cross-account effect of a
  transfer (never hidden), and always points to manage-accounts as the deep
  link — it never calls anything destructive itself.

  Scenario: A delete with cross-account transfers names the counterparty and offers the deep link
    Given the account "DBS Savings" (acc-dbs) with 47 transactions, 3 of them transfers with "OCBC Current" (acc-ocbc)
    When I build the delete handoff for "DBS Savings"
    Then the handoff message should mention "47"
    And the handoff message should mention "OCBC Current"
    And the handoff deep link should be "/manage-accounts?deleteAccountId=acc-dbs"

  Scenario: A delete with recurring rules names them in the warning
    Given the account "DBS Savings" (acc-dbs) with 2 recurring rules referencing it
    When I build the delete handoff for "DBS Savings"
    Then the handoff message should mention "recurring rule"

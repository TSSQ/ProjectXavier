Feature: Account archive / restore helpers
  Pure functions behind the manage-accounts screen's restore path
  (docs/design/account-archive-restore-spec.md §5.1/§5.2): the shared search
  predicate, splitting accounts into active/archived for display, the
  archived-section render gate, which action the edit sheet should offer,
  whether archiving beats permanent delete, and the restore-time
  name-collision check (§8.4).

  # ── matchesAccountQuery ────────────────────────────────────────────────────
  Scenario: An empty query matches every account
    Given an account "DBS Savings"
    Then it should match the query ""

  Scenario: A query matches by name, case-insensitively
    Given an account "DBS Savings"
    Then it should match the query "dbs"

  Scenario: A query matches by tag, case-insensitively
    Given an account "Wallet" tagged "Cash"
    Then it should match the query "cash"

  Scenario: A query matches by subtype, case-insensitively
    Given an account "Wallet" with subtype "credit_card"
    Then it should match the query "CREDIT"

  Scenario: A query that matches nothing does not match
    Given an account "DBS Savings"
    Then it should not match the query "ocbc"

  # ── splitAccountsForManage ─────────────────────────────────────────────────
  Scenario: Partitions active and archived accounts, preserving input order
    Given an account "Alpha"
    And an archived account "Beta"
    And an account "Gamma"
    And an archived account "Delta"
    When I split the accounts for manage with query ""
    Then the active names should be "Alpha, Gamma"
    And the archived names should be "Beta, Delta"

  Scenario: The same query filters both the active and archived lists
    Given an account "DBS Savings"
    And an archived account "DBS Fixed Deposit"
    And an account "Cash Wallet"
    When I split the accounts for manage with query "dbs"
    Then the active names should be "DBS Savings"
    And the archived names should be "DBS Fixed Deposit"

  # ── hasArchivedAccounts ────────────────────────────────────────────────────
  Scenario: False when there are no accounts at all
    Given no accounts
    Then hasArchivedAccounts should be false

  Scenario: False when every account is active
    Given an account "Alpha"
    And an account "Beta"
    Then hasArchivedAccounts should be false

  Scenario: True when at least one account is archived
    Given an account "Alpha"
    And an archived account "Beta"
    Then hasArchivedAccounts should be true

  # ── archiveActionFor ───────────────────────────────────────────────────────
  Scenario: Offers unarchive for an archived account
    Given an archived account "Old Wallet"
    Then archiveActionFor should be "unarchive"

  Scenario: Offers archive for an active account
    Given an account "Checking"
    Then archiveActionFor should be "archive"

  Scenario: Offers archive when archived was never set
    Given an account "Checking" with archived left undefined
    Then archiveActionFor should be "archive"

  # ── recommendArchiveOverDelete ─────────────────────────────────────────────
  Scenario: Recommends archive when the account has transactions
    Given a $10 expense on account "acc-dbs"
    When I compute the delete impact for account "acc-dbs"
    Then recommendArchiveOverDelete should be true

  Scenario: Does not recommend archive when the account has no transactions
    Given no transactions
    When I compute the delete impact for account "acc-dbs"
    Then recommendArchiveOverDelete should be false

  # ── collidesWithActiveName (§8.4) ──────────────────────────────────────────
  Scenario: Restoring collides with an active account of the same name
    Given an archived account "DBS"
    And an account "DBS"
    When I check whether restoring it collides with an active name
    Then collidesWithActiveName should be true

  Scenario: A collision is detected across case and whitespace differences
    Given an archived account "DBS Savings"
    And an account "dbs   savings"
    When I check whether restoring it collides with an active name
    Then collidesWithActiveName should be true

  Scenario: No collision when no other account shares the name
    Given an archived account "DBS"
    And an account "OCBC"
    When I check whether restoring it collides with an active name
    Then collidesWithActiveName should be false

  Scenario: No collision against itself when it is the only account
    Given an archived account "DBS"
    When I check whether restoring it collides with an active name
    Then collidesWithActiveName should be false

  Scenario: No collision when the same-named account is also archived
    Given an archived account "DBS"
    And an archived account "DBS"
    When I check whether restoring it collides with an active name
    Then collidesWithActiveName should be false

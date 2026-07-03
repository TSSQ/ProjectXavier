Feature: Account filter helpers
  Pure domain functions that manage a session-local account selection for
  dashboard filtering. Selection = null means all accounts.

  # ── isAllSelected ──────────────────────────────────────────────────────────
  Scenario: Default selection is all accounts
    Given a null selection
    Then isAllSelected should be true

  Scenario: An explicit list is not all-selected
    Given a selection of ids "a,b"
    Then isAllSelected should be false

  # ── toggleAccount ──────────────────────────────────────────────────────────
  Scenario: Toggle one account from all-selected focuses on that account
    Given a null selection
    When I toggle account "a" with ids "a,b,c"
    Then the selection should be "a"

  Scenario: Toggle adds an account to the set
    Given a selection of ids "a"
    When I toggle account "b" with ids "a,b,c"
    Then the selection should be "a,b"

  Scenario: Toggle removes an account from the set
    Given a selection of ids "a,b"
    When I toggle account "a" with ids "a,b,c"
    Then the selection should be "b"

  Scenario: Toggle to empty set becomes null (all)
    Given a selection of ids "a"
    When I toggle account "a" with ids "a,b,c"
    Then the selection should be null

  Scenario: Toggle to full set becomes null (all)
    Given a selection of ids "a,b"
    When I toggle account "c" with ids "a,b,c"
    Then the selection should be null

  # ── scopeLabel ─────────────────────────────────────────────────────────────
  Scenario: scopeLabel for all-selected is "All accounts"
    Given a null selection
    Then scopeLabel should be "All accounts"

  Scenario: scopeLabel for one account shows its name
    Given a selection of ids "b"
    Then scopeLabel with names "a=Alpha,b=Beta,c=Gamma" should be "Beta"

  Scenario: scopeLabel for multiple accounts shows count
    Given a selection of ids "a,c"
    Then scopeLabel with names "a=Alpha,b=Beta,c=Gamma" should be "2 accounts"

  # ── pillsSplit ─────────────────────────────────────────────────────────────
  Scenario: All selected shows first 3 accounts inline
    Given a null selection
    Then pillsSplit with cap 3 and 4 accounts gives 3 inline and 1 more

  Scenario: Subset selection shows only selected accounts
    Given a selection of ids "a,c"
    Then pillsSplit with cap 3 and 3 accounts gives 2 inline and 1 more

  # ── applyLabel ─────────────────────────────────────────────────────────────
  Scenario: Apply with all accounts selected shows all-accounts label
    Then applyLabel for 3 of 3 should be "Show all accounts"

  Scenario: Apply with zero accounts selected shows all-accounts label
    Then applyLabel for 0 of 3 should be "Show all accounts"

  Scenario: Apply with one account shows singular label
    Then applyLabel for 1 of 3 should be "Show 1 account"

  Scenario: Apply with multiple accounts shows plural label
    Then applyLabel for 2 of 3 should be "Show 2 accounts"

  # ── effectiveIds ───────────────────────────────────────────────────────────
  Scenario: effectiveIds drops a deleted id
    Given a selection of ids "a,z"
    Then effectiveIds with accountIds "a,b,c" should be "a"

  Scenario: effectiveIds falls back to all when every selected id is gone
    Given a selection of ids "z"
    Then effectiveIds with accountIds "a,b,c" should be "a,b,c"

  Scenario: effectiveIds with null selection returns all ids
    Given a null selection
    Then effectiveIds with accountIds "a,b,c" should be "a,b,c"

  Scenario: effectiveIds retains partial-valid ids without falling back
    Given a selection of ids "a,b"
    Then effectiveIds with accountIds "a,b,c" should be "a,b"

  # ── toggleAccount (unknown id) ────────────────────────────────────────────
  Scenario: Toggle an unknown id passes through without collapsing to all
    Given a selection of ids "a"
    When I toggle account "z" with ids "a,b,c"
    Then the selection should be "a,z"

  # ── scopeLabel (Fix 2 coverage) ───────────────────────────────────────────
  Scenario: scopeLabel with all-stale ids falls back to All accounts
    Given a selection of ids "z"
    Then scopeLabel with names "a=Alpha" should be "All accounts"

  Scenario: scopeLabel for one valid of two accounts shows account name
    Given a selection of ids "a"
    Then scopeLabel with names "a=Alpha,b=Beta" should be "Alpha"

  # ── pillsSplit (edge cases) ───────────────────────────────────────────────
  Scenario: pillsSplit with cap larger than accounts shows all inline with no more
    Given a null selection
    Then pillsSplit with cap 999 and 3 accounts gives 3 inline and 0 more

  Scenario: pillsSplit with empty account list gives empty inline and no more
    Given a null selection
    Then pillsSplit with cap 3 and 0 accounts gives 0 inline and 0 more

  # ── commitDraft ───────────────────────────────────────────────────────────
  Scenario: commitDraft with single account equal to total collapses to null
    Then commitDraft with ids "a" and total 1 should be null

  # ── applyLabel (additional cases) ────────────────────────────────────────
  Scenario: Apply with two of three accounts shows plural label
    Then applyLabel for 2 of 3 should be "Show 2 accounts"

  Scenario: Apply with zero of zero accounts shows all-accounts label
    Then applyLabel for 0 of 0 should be "Show all accounts"

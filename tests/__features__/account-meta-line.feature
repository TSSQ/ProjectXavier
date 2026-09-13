Feature: The account row's meta line

  The first fix for raw subtypes patched three screens and missed two sheets
  (AccountPickerSheet, AccountFilterSheet) that had copied the same
  "[subtype, tag].join(' · ')" expression — the picker's own comment even said
  it was copied. These pin the joined line itself, so the next screen that
  needs one has a tested function to call rather than an expression to copy.

  Scenario: The account meta line reads the kind as words
    Given an account of kind "credit_card" tagged "Personal"
    When I build its meta line
    Then the meta line should be "Credit card · Personal"

  Scenario: An archived account says so, when the caller asks
    Given an archived account of kind "bank" with no tag
    When I build its meta line including the archived marker
    Then the meta line should be "Bank · Archived"

  Scenario: An account with nothing to say falls back
    Given an account with no kind and no tag
    When I build its meta line with the fallback "Account"
    Then the meta line should be "Account"

  Scenario: No stored subtype survives into a meta line as a raw value
    Given every subtype the app offers as a choice
    When I build a meta line for each one
    Then no meta line should contain an underscore

Feature: Onboarding-complete flag default is opt-out-by-completion
  `onboarding_complete` gates the welcome carousel (app/welcome.tsx, build
  39): a fresh install (no stored value) must show the carousel until the
  user finishes or skips it. resolveOnboardingComplete is the pure
  stored-value → boolean resolution src/features/settings/repository.ts's
  getOnboardingComplete defers to.

  Scenario: An unset preference resolves to not complete
    Given no stored onboarding-complete value
    When the onboarding-complete value is resolved
    Then onboarding should not be complete

  Scenario: A stored "1" value resolves to complete
    Given a stored onboarding-complete value of "1"
    When the onboarding-complete value is resolved
    Then onboarding should be complete

  Scenario Outline: A "0" or corrupt stored value resolves to not complete
    Given a stored onboarding-complete value of "<stored>"
    When the onboarding-complete value is resolved
    Then onboarding should not be complete

    Examples:
      | stored |
      | 0      |
      | 2      |
      | true   |
      |        |

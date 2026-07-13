Feature: Biometric lock default is opt-in
  The biometric app-lock is opt-in: a fresh install (no stored preference)
  must not gate the app on Face ID until the user explicitly turns it on in
  Settings, and enabling it is itself gated on a successful biometric check
  (see app/(tabs)/settings.tsx). resolveBiometricLock is the pure
  stored-value → boolean resolution the repository defers to.

  Scenario: An unset preference resolves to off
    Given no stored biometric-lock preference
    When the biometric-lock preference is resolved
    Then the biometric lock should be off

  Scenario: A stored "on" preference resolves to on
    Given a stored biometric-lock preference of "1"
    When the biometric-lock preference is resolved
    Then the biometric lock should be on

  Scenario: A stored "off" preference resolves to off
    Given a stored biometric-lock preference of "0"
    When the biometric-lock preference is resolved
    Then the biometric lock should be off

  Scenario Outline: An arbitrary or corrupt stored value resolves to off
    Given a stored biometric-lock preference of "<stored>"
    When the biometric-lock preference is resolved
    Then the biometric lock should be off

    Examples:
      | stored |
      | 2      |
      | true   |
      |        |

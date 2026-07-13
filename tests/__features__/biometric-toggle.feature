Feature: Settings biometric-lock toggle decision
  decideLockToggle is the pure decision behind the Settings "Require Face ID
  on launch" switch (app/(tabs)/settings.tsx). Turning the lock OFF never
  needs an auth outcome and always persists. Turning it ON only persists —
  and only shows the switch as ON — when a real biometric check just
  succeeded; a failed check and a device with no biometrics enrolled both
  leave it OFF and unpersisted, but with distinct notes so the user knows
  which happened. The 'unavailable' outcome in particular must never be
  treated like success (that's the anti-lockout valve on the unlock path
  bleeding into the enable path, which this decision must refuse).

  Scenario: Turning the lock off never requires auth
    Given the lock is being turned off
    When the toggle decision is made
    Then it should persist off, show the switch off, and clear any note

  Scenario: Turning the lock on with a successful auth persists on
    Given the lock is being turned on
    And the auth outcome is "success"
    When the toggle decision is made
    Then it should persist on, show the switch on, and clear any note

  Scenario: Turning the lock on with a failed auth leaves it off
    Given the lock is being turned on
    And the auth outcome is "failed"
    When the toggle decision is made
    Then it should not persist, show the switch off, and note that verification failed

  Scenario: Turning the lock on with no biometrics enrolled leaves it off
    Given the lock is being turned on
    And the auth outcome is "unavailable"
    When the toggle decision is made
    Then it should not persist, show the switch off, and note that Face ID isn't set up

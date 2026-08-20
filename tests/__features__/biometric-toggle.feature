Feature: Settings biometric-lock toggle decision
  decideLockToggle is the pure decision behind the Settings "Require Face ID
  on launch" switch (app/(tabs)/settings.tsx). Turning the lock OFF never
  needs an auth outcome and always persists. Turning it ON only persists —
  and only shows the switch as ON — when a real biometric check just
  succeeded; every other outcome leaves it OFF and unpersisted, with a note
  naming the one thing that would fix it. None of them may be treated like
  success — that would be the anti-lockout valve from the unlock path
  bleeding into the enable path, which this decision must refuse.

  This file also covers the unlock gate itself (`unlockGrants`), because the
  two halves have to stay consistent: the enable path refusing to turn a
  useless lock ON is worthless if the unlock path silently opens an already-
  ON lock the moment biometrics become unusable.

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
    And the auth outcome is "not_enrolled"
    When the toggle decision is made
    Then it should not persist, show the switch off, and note that Face ID isn't set up

  # Reported, then reproduced on device: declining the one-time iOS Face ID
  # permission prompt left the user staring at "Face ID isn't set up on this
  # device". Face ID *was* set up — the app just wasn't allowed to use it, and
  # the fix is in Settings > ProjectXavier, nowhere near where that message
  # sends them. Measured on iOS 26.5: not-enrolled reports hasHardware TRUE
  # (error biometryNotEnrolled), permission-denied reports FALSE
  # (biometryNotAvailable), so these were always distinguishable.
  Scenario: Turning the lock on without Face ID permission says so, and offers Settings
    Given the lock is being turned on
    And the auth outcome is "no_permission"
    When the toggle decision is made
    Then it should not persist, show the switch off, and note that permission is missing
    And the decision should offer to open Settings

  Scenario: Turning the lock on where the device has no biometrics at all
    Given the lock is being turned on
    And the auth outcome is "no_hardware"
    When the toggle decision is made
    Then it should not persist, show the switch off, and note that the device has no biometrics
    And the decision should not offer to open Settings

  Scenario: A failed check does not offer Settings
    Given the lock is being turned on
    And the auth outcome is "failed"
    When the toggle decision is made
    Then the decision should not offer to open Settings

  # ── the unlock gate (the silent-bypass half) ──────────────────────────────
  # `requireBiometricUnlock` used to return TRUE — i.e. open the app with no
  # authentication — whenever biometrics were unusable for ANY reason, while
  # Settings still showed the lock as ON. Reproduced on iOS 26.5 simply by
  # un-enrolling Face ID. The anti-lockout valve is still needed, but it only
  # applies when there is genuinely no way to authenticate at all.

  Scenario: A successful check unlocks
    When the unlock check returns success
    Then the app should unlock

  Scenario: A failed check keeps the app locked
    When the unlock check fails with "authentication_failed"
    Then the app should stay locked

  Scenario: Cancelling keeps the app locked
    When the unlock check fails with "user_cancel"
    Then the app should stay locked

  Scenario: Biometrics being unavailable no longer opens the app
    When the unlock check fails with "not_available"
    Then the app should stay locked

  Scenario: Biometrics not enrolled no longer opens the app
    When the unlock check fails with "not_enrolled"
    Then the app should stay locked

  # The one real lockout risk: no biometrics AND no device passcode means
  # there is nothing left to prove identity with, so the valve stays open.
  Scenario: A device with no passcode at all still opens
    When the unlock check fails with "passcode_not_set"
    Then the app should unlock

Feature: Auth gate offline grace
  On an offline cold start with an expired access token, Supabase's network
  refresh fails and returns a null session WITHOUT emitting SIGNED_OUT
  (network errors are retryable). The gate must not treat that null session
  as a sign-out — it should only clear the "has authenticated before" marker
  on a real SIGNED_OUT, and it should still render the app (instead of
  SignIn) when biometric passed and the marker is present.

  Scenario: A real sign-out clears the marker
    When the auth event "SIGNED_OUT" fires with no session
    Then the marker action should be "clear"

  Scenario: An offline null session from the initial load keeps the marker
    When the auth event "INITIAL_SESSION" fires with no session
    Then the marker action should be "none"

  Scenario: An offline null session from a failed token refresh keeps the marker
    When the auth event "TOKEN_REFRESHED" fires with no session
    Then the marker action should be "none"

  Scenario: Signing in sets the marker
    When the auth event "SIGNED_IN" fires with a session
    Then the marker action should be "set"

  Scenario: A successful token refresh sets the marker
    When the auth event "TOKEN_REFRESHED" fires with a session
    Then the marker action should be "set"

  Scenario: Offline grace renders the app when the marker is present
    Given no live session
    And the device has authenticated before
    Then app access should be granted

  Scenario: No session and no marker falls back to SignIn
    Given no live session
    And the device has never authenticated before
    Then app access should be denied

  Scenario: A live session always grants app access
    Given a live session
    And the device has never authenticated before
    Then app access should be granted

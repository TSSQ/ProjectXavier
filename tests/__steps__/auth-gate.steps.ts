import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { markerActionForEvent, grantsAppAccess, AuthEvent } from '../../src/domain/authGate';

const feature = loadFeature(path.resolve(__dirname, '../__features__/auth-gate.feature'));

defineFeature(feature, (test) => {
  let action: 'set' | 'clear' | 'none';
  let hasSession: boolean;
  let hasMarker: boolean;
  let access: boolean;

  test('A real sign-out clears the marker', ({ when, then }) => {
    when(/^the auth event "(.*)" fires with no session$/, (event: string) => {
      action = markerActionForEvent(event as AuthEvent, false);
    });
    then(/^the marker action should be "(.*)"$/, (expected: string) => {
      expect(action).toBe(expected);
    });
  });

  test('An offline null session from the initial load keeps the marker', ({ when, then }) => {
    when(/^the auth event "(.*)" fires with no session$/, (event: string) => {
      action = markerActionForEvent(event as AuthEvent, false);
    });
    then(/^the marker action should be "(.*)"$/, (expected: string) => {
      expect(action).toBe(expected);
    });
  });

  test('An offline null session from a failed token refresh keeps the marker', ({
    when,
    then,
  }) => {
    when(/^the auth event "(.*)" fires with no session$/, (event: string) => {
      action = markerActionForEvent(event as AuthEvent, false);
    });
    then(/^the marker action should be "(.*)"$/, (expected: string) => {
      expect(action).toBe(expected);
    });
  });

  test('Signing in sets the marker', ({ when, then }) => {
    when(/^the auth event "(.*)" fires with a session$/, (event: string) => {
      action = markerActionForEvent(event as AuthEvent, true);
    });
    then(/^the marker action should be "(.*)"$/, (expected: string) => {
      expect(action).toBe(expected);
    });
  });

  test('A successful token refresh sets the marker', ({ when, then }) => {
    when(/^the auth event "(.*)" fires with a session$/, (event: string) => {
      action = markerActionForEvent(event as AuthEvent, true);
    });
    then(/^the marker action should be "(.*)"$/, (expected: string) => {
      expect(action).toBe(expected);
    });
  });

  test('Offline grace renders the app when the marker is present', ({ given, then }) => {
    given(/^no live session$/, () => {
      hasSession = false;
    });
    given(/^the device has authenticated before$/, () => {
      hasMarker = true;
    });
    then(/^app access should be granted$/, () => {
      access = grantsAppAccess(hasSession, hasMarker);
      expect(access).toBe(true);
    });
  });

  test('No session and no marker falls back to SignIn', ({ given, then }) => {
    given(/^no live session$/, () => {
      hasSession = false;
    });
    given(/^the device has never authenticated before$/, () => {
      hasMarker = false;
    });
    then(/^app access should be denied$/, () => {
      access = grantsAppAccess(hasSession, hasMarker);
      expect(access).toBe(false);
    });
  });

  test('A live session always grants app access', ({ given, then }) => {
    given(/^a live session$/, () => {
      hasSession = true;
    });
    given(/^the device has never authenticated before$/, () => {
      hasMarker = false;
    });
    then(/^app access should be granted$/, () => {
      access = grantsAppAccess(hasSession, hasMarker);
      expect(access).toBe(true);
    });
  });
});

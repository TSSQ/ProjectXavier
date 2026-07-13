import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  decideLockToggle,
  LockAuthOutcome,
  LockToggleDecision,
} from '../../src/domain/biometricLock';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/biometric-toggle.feature')
);

defineFeature(feature, (test) => {
  test('Turning the lock off never requires auth', ({ given, when, then }) => {
    let requestedOn: boolean;
    let decision: LockToggleDecision;

    given('the lock is being turned off', () => {
      requestedOn = false;
    });

    when('the toggle decision is made', () => {
      // No auth outcome is supplied for the off path — it must not matter.
      decision = decideLockToggle(requestedOn, null);
    });

    then('it should persist off, show the switch off, and clear any note', () => {
      expect(decision).toEqual({ persist: false, uiOn: false, note: null });
    });
  });

  test('Turning the lock on with a successful auth persists on', ({
    given,
    and,
    when,
    then,
  }) => {
    let requestedOn: boolean;
    let auth: LockAuthOutcome;
    let decision: LockToggleDecision;

    given('the lock is being turned on', () => {
      requestedOn = true;
    });

    and(/^the auth outcome is "success"$/, () => {
      auth = 'success';
    });

    when('the toggle decision is made', () => {
      decision = decideLockToggle(requestedOn, auth);
    });

    then('it should persist on, show the switch on, and clear any note', () => {
      expect(decision).toEqual({ persist: true, uiOn: true, note: null });
    });
  });

  test('Turning the lock on with a failed auth leaves it off', ({
    given,
    and,
    when,
    then,
  }) => {
    let requestedOn: boolean;
    let auth: LockAuthOutcome;
    let decision: LockToggleDecision;

    given('the lock is being turned on', () => {
      requestedOn = true;
    });

    and(/^the auth outcome is "failed"$/, () => {
      auth = 'failed';
    });

    when('the toggle decision is made', () => {
      decision = decideLockToggle(requestedOn, auth);
    });

    then(
      'it should not persist, show the switch off, and note that verification failed',
      () => {
        expect(decision.persist).toBeNull();
        expect(decision.uiOn).toBe(false);
        expect(decision.note).toBe("Couldn't verify — Face ID not enabled");
      }
    );
  });

  test('Turning the lock on with no biometrics enrolled leaves it off', ({
    given,
    and,
    when,
    then,
  }) => {
    let requestedOn: boolean;
    let auth: LockAuthOutcome;
    let decision: LockToggleDecision;

    given('the lock is being turned on', () => {
      requestedOn = true;
    });

    and(/^the auth outcome is "unavailable"$/, () => {
      auth = 'unavailable';
    });

    when('the toggle decision is made', () => {
      decision = decideLockToggle(requestedOn, auth);
    });

    then(
      "it should not persist, show the switch off, and note that Face ID isn't set up",
      () => {
        expect(decision.persist).toBeNull();
        expect(decision.uiOn).toBe(false);
        expect(decision.note).toBe(
          "Face ID isn't set up on this device — turn it on in iOS Settings first"
        );
      }
    );
  });
});

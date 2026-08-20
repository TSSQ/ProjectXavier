import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  decideLockToggle,
  LockAuthOutcome,
  LockToggleDecision,
  unlockGrants,
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
      expect(decision).toEqual({ persist: false, uiOn: false, note: null, canOpenSettings: false });
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
      expect(decision).toEqual({ persist: true, uiOn: true, note: null, canOpenSettings: false });
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

    and(/^the auth outcome is "not_enrolled"$/, () => {
      auth = 'not_enrolled';
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
// ── the three states the old 'unavailable' was hiding ─────────────────────

  const enableWith = (outcome: LockAuthOutcome) => {
    let decision: LockToggleDecision;
    return {
      run: (given: any, and: any, when: any) => {
        given('the lock is being turned on', () => {});
        and(/^the auth outcome is "[^"]+"$/, () => {});
        when('the toggle decision is made', () => {
          decision = decideLockToggle(true, outcome);
        });
      },
      get: () => decision,
    };
  };

  test('Turning the lock on without Face ID permission says so, and offers Settings', ({
    given,
    and,
    when,
    then,
  }) => {
    const ctx = enableWith('no_permission');
    ctx.run(given, and, when);
    then(
      'it should not persist, show the switch off, and note that permission is missing',
      () => {
        expect(ctx.get().persist).toBeNull();
        expect(ctx.get().uiOn).toBe(false);
        expect(ctx.get().note).toBe(
          'ProjectXavier isn’t allowed to use Face ID — turn it on in iOS Settings › ProjectXavier'
        );
      }
    );
    and('the decision should offer to open Settings', () => {
      expect(ctx.get().canOpenSettings).toBe(true);
    });
  });

  test('Turning the lock on where the device has no biometrics at all', ({
    given,
    and,
    when,
    then,
  }) => {
    const ctx = enableWith('no_hardware');
    ctx.run(given, and, when);
    then(
      'it should not persist, show the switch off, and note that the device has no biometrics',
      () => {
        expect(ctx.get().persist).toBeNull();
        expect(ctx.get().uiOn).toBe(false);
        expect(ctx.get().note).toBe("This device doesn't support Face ID or Touch ID");
      }
    );
    and('the decision should not offer to open Settings', () => {
      expect(ctx.get().canOpenSettings).toBe(false);
    });
  });

  test('A failed check does not offer Settings', ({ given, and, when, then }) => {
    const ctx = enableWith('failed');
    ctx.run(given, and, when);
    then('the decision should not offer to open Settings', () => {
      expect(ctx.get().canOpenSettings).toBe(false);
    });
  });

  // ── the unlock gate ───────────────────────────────────────────────────────

  test('A successful check unlocks', ({ when, then }) => {
    let granted: boolean;
    when('the unlock check returns success', () => {
      granted = unlockGrants({ success: true });
    });
    then('the app should unlock', () => {
      expect(granted).toBe(true);
    });
  });

  for (const name of [
    'A failed check keeps the app locked',
    'Cancelling keeps the app locked',
    'Biometrics being unavailable no longer opens the app',
    'Biometrics not enrolled no longer opens the app',
  ]) {
    test(name, ({ when, then }) => {
      let granted: boolean;
      when(/^the unlock check fails with "([^"]+)"$/, (error: string) => {
        granted = unlockGrants({ success: false, error });
      });
      then('the app should stay locked', () => {
        expect(granted).toBe(false);
      });
    });
  }

  test('A device with no passcode at all still opens', ({ when, then }) => {
    let granted: boolean;
    when(/^the unlock check fails with "([^"]+)"$/, (error: string) => {
      granted = unlockGrants({ success: false, error });
    });
    then('the app should unlock', () => {
      expect(granted).toBe(true);
    });
  });
});

import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runRestoreSequence, RestoreSequenceEffects } from '../../src/domain/restoreSequence';
import { exclusive } from '../../src/domain/backupGate';

const feature = loadFeature(path.resolve(__dirname, '../__features__/restore-sequence.feature'));

defineFeature(feature, (test) => {
  test('runRestoreSequence downloads before reading, and reads before applying', ({
    given,
    when,
    then,
  }) => {
    let order: string[];
    let effects: RestoreSequenceEffects<undefined>;

    given(/^effects that record their own call order$/, () => {
      order = [];
      effects = {
        ensureDownloaded: async () => {
          order.push('ensureDownloaded');
        },
        readBackup: async () => {
          order.push('readBackup');
          return undefined;
        },
        apply: exclusive(async () => {
          order.push('apply');
        }),
      };
    });

    when(/^I run the restore sequence$/, async () => {
      await runRestoreSequence(effects);
    });

    then(/^the recorded order should be "(.*)"$/, (expected: string) => {
      expect(order.join(', ')).toBe(expected);
    });
  });

  test("runRestoreSequence passes readBackup's result to apply", ({ given, when, then }) => {
    let effects: RestoreSequenceEffects<string>;
    let received: string | undefined;

    given(
      /^effects where readBackup resolves with "(.*)"$/,
      (data: string) => {
        received = undefined;
        effects = {
          ensureDownloaded: async () => undefined,
          readBackup: async () => data,
          apply: exclusive(async (d) => {
            received = d;
          }),
        };
      },
    );

    when(/^I run the restore sequence$/, async () => {
      await runRestoreSequence(effects);
    });

    then(/^apply should have received "(.*)"$/, (expected: string) => {
      expect(received).toBe(expected);
    });
  });

  test('runRestoreSequence never reads or applies if ensureDownloaded rejects', ({
    given,
    when,
    then,
  }) => {
    let effects: RestoreSequenceEffects<undefined>;
    let readBackupCalled: boolean;
    let applyCalled: boolean;
    let rejected: unknown;

    given(/^effects where ensureDownloaded rejects$/, () => {
      readBackupCalled = false;
      applyCalled = false;
      effects = {
        ensureDownloaded: async () => {
          throw new Error('download failed');
        },
        readBackup: async () => {
          readBackupCalled = true;
          return undefined;
        },
        apply: exclusive(async () => {
          applyCalled = true;
        }),
      };
    });

    when(/^I run the restore sequence and it rejects$/, async () => {
      rejected = undefined;
      try {
        await runRestoreSequence(effects);
      } catch (e) {
        rejected = e;
      }
    });

    then(/^readBackup and apply should never have been called$/, () => {
      expect(rejected).toBeInstanceOf(Error);
      expect(readBackupCalled).toBe(false);
      expect(applyCalled).toBe(false);
    });
  });

  test('runRestoreSequence never applies if readBackup rejects', ({ given, when, then }) => {
    let effects: RestoreSequenceEffects<undefined>;
    let applyCalled: boolean;
    let rejected: unknown;

    given(/^effects where readBackup rejects$/, () => {
      applyCalled = false;
      effects = {
        ensureDownloaded: async () => undefined,
        readBackup: async () => {
          throw new Error('read failed');
        },
        apply: exclusive(async () => {
          applyCalled = true;
        }),
      };
    });

    when(/^I run the restore sequence and it rejects$/, async () => {
      rejected = undefined;
      try {
        await runRestoreSequence(effects);
      } catch (e) {
        rejected = e;
      }
    });

    then(/^apply should never have been called$/, () => {
      expect(rejected).toBeInstanceOf(Error);
      expect(applyCalled).toBe(false);
    });
  });
});

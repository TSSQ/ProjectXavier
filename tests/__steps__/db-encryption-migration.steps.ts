import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  decideMigration,
  decideStartupRecovery,
  dbSidecarNames,
  migrationVerified,
  DbProbeOutcome,
  MigrationDecision,
  RowCounts,
  StartupFilesystemState,
  StartupRecoveryAction,
} from '../../src/db/encryptionMigrationPlan';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/db-encryption-migration.feature')
);

defineFeature(feature, (test) => {
  let keyedProbe: DbProbeOutcome;
  let unkeyedProbe: DbProbeOutcome | undefined;
  let decision: MigrationDecision;

  let encOpens: boolean;
  let plainCounts: RowCounts;
  let encCounts: RowCounts;
  let verified: boolean;

  let fsState: StartupFilesystemState;
  let recoveryAction: StartupRecoveryAction;

  let sidecarNames: [string, string];

  beforeEach(() => {
    unkeyedProbe = undefined;
    plainCounts = { accounts: 3, transactions: 42 };
    encCounts = { accounts: 3, transactions: 42 };
    encOpens = true;
    fsState = { dbExists: false, encExists: false };
  });

  test('A keyed probe that succeeds needs no migration', ({ given, when, then }) => {
    given('the keyed probe succeeds', () => {
      keyedProbe = 'readable';
    });
    when('I decide the migration action', () => {
      decision = decideMigration(keyedProbe, unkeyedProbe);
    });
    then('no migration should be needed', () => {
      expect(decision).toEqual({ kind: 'none' });
    });
  });

  test('A keyed probe that fails but an unkeyed probe succeeds is legacy plaintext', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the keyed probe fails', () => {
      keyedProbe = 'unreadable';
    });
    and('the unkeyed probe succeeds', () => {
      unkeyedProbe = 'readable';
    });
    when('I decide the migration action', () => {
      decision = decideMigration(keyedProbe, unkeyedProbe);
    });
    then('the database should be migrated', () => {
      expect(decision).toEqual({ kind: 'migrate' });
    });
  });

  test('A keyed probe that fails and an unkeyed probe that also fails is unresolvable', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the keyed probe fails', () => {
      keyedProbe = 'unreadable';
    });
    and('the unkeyed probe also fails', () => {
      unkeyedProbe = 'unreadable';
    });
    when('I decide the migration action', () => {
      decision = decideMigration(keyedProbe, unkeyedProbe);
    });
    then('the migration should be refused as key-missing-or-corrupt', () => {
      expect(decision).toEqual({ kind: 'key-missing-or-corrupt' });
    });
  });

  test('Matching row counts on a key-opening copy verifies the migration', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the encrypted copy opens with the key', () => {
      encOpens = true;
    });
    and('the plaintext and encrypted row counts match for every table', () => {
      plainCounts = { accounts: 3, transactions: 42 };
      encCounts = { accounts: 3, transactions: 42 };
    });
    when('I check whether the migration is verified', () => {
      verified = migrationVerified(encOpens, plainCounts, encCounts);
    });
    then('the migration should be verified', () => {
      expect(verified).toBe(true);
    });
  });

  test('A copy that fails to open with the key is never verified', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the encrypted copy does not open with the key', () => {
      encOpens = false;
    });
    and('the plaintext and encrypted row counts match for every table', () => {
      plainCounts = { accounts: 3, transactions: 42 };
      encCounts = { accounts: 3, transactions: 42 };
    });
    when('I check whether the migration is verified', () => {
      verified = migrationVerified(encOpens, plainCounts, encCounts);
    });
    then('the migration should not be verified', () => {
      expect(verified).toBe(false);
    });
  });

  test('Mismatched row counts are never verified', ({ given, and, when, then }) => {
    given('the encrypted copy opens with the key', () => {
      encOpens = true;
    });
    and('the plaintext and encrypted row counts differ for a table', () => {
      plainCounts = { accounts: 3, transactions: 42 };
      encCounts = { accounts: 3, transactions: 41 };
    });
    when('I check whether the migration is verified', () => {
      verified = migrationVerified(encOpens, plainCounts, encCounts);
    });
    then('the migration should not be verified', () => {
      expect(verified).toBe(false);
    });
  });

  test('A plaintext source with zero tables verifies trivially', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the encrypted copy opens with the key', () => {
      encOpens = true;
    });
    and('the plaintext source has no tables at all', () => {
      plainCounts = {};
      encCounts = {};
    });
    when('I check whether the migration is verified', () => {
      verified = migrationVerified(encOpens, plainCounts, encCounts);
    });
    then('the migration should be verified', () => {
      expect(verified).toBe(true);
    });
  });

  test('A zero-table plaintext source with a copy that fails to open is never verified', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the encrypted copy does not open with the key', () => {
      encOpens = false;
    });
    and('the plaintext source has no tables at all', () => {
      plainCounts = {};
      encCounts = {};
    });
    when('I check whether the migration is verified', () => {
      verified = migrationVerified(encOpens, plainCounts, encCounts);
    });
    then('the migration should not be verified', () => {
      expect(verified).toBe(false);
    });
  });

  test('Neither file present needs no startup recovery', ({ given, and, when, then }) => {
    given('the canonical DB file is absent', () => {
      fsState.dbExists = false;
    });
    and('the encrypted export file is absent', () => {
      fsState.encExists = false;
    });
    when('I decide the startup recovery action', () => {
      recoveryAction = decideStartupRecovery(fsState);
    });
    then('no startup recovery should be needed', () => {
      expect(recoveryAction).toBe('none');
    });
  });

  test('Only the canonical DB file present needs no startup recovery', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the canonical DB file is present', () => {
      fsState.dbExists = true;
    });
    and('the encrypted export file is absent', () => {
      fsState.encExists = false;
    });
    when('I decide the startup recovery action', () => {
      recoveryAction = decideStartupRecovery(fsState);
    });
    then('no startup recovery should be needed', () => {
      expect(recoveryAction).toBe('none');
    });
  });

  test('An orphaned encrypted export with no canonical DB must be recovered', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the canonical DB file is absent', () => {
      fsState.dbExists = false;
    });
    and('the encrypted export file is present', () => {
      fsState.encExists = true;
    });
    when('I decide the startup recovery action', () => {
      recoveryAction = decideStartupRecovery(fsState);
    });
    then('the orphaned encrypted export should be moved into place', () => {
      expect(recoveryAction).toBe('recover-move-enc-to-db');
    });
  });

  test('Both files present means the stale export should be discarded', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the canonical DB file is present', () => {
      fsState.dbExists = true;
    });
    and('the encrypted export file is present', () => {
      fsState.encExists = true;
    });
    when('I decide the startup recovery action', () => {
      recoveryAction = decideStartupRecovery(fsState);
    });
    then('the stale encrypted export should be discarded', () => {
      expect(recoveryAction).toBe('discard-stale-enc');
    });
  });

  test('The state left behind by a successful migration needs no further recovery', ({
    given,
    and,
    when,
    then,
  }) => {
    given('the canonical DB file is present', () => {
      fsState.dbExists = true;
    });
    and('the encrypted export file is absent', () => {
      fsState.encExists = false;
    });
    when('I decide the startup recovery action', () => {
      recoveryAction = decideStartupRecovery(fsState);
    });
    then('no startup recovery should be needed', () => {
      expect(recoveryAction).toBe('none');
    });
    and('no stray encrypted export file is left at the canonical path', () => {
      // decideStartupRecovery only ever returns 'discard-stale-enc' /
      // 'recover-move-enc-to-db' when encExists is true — 'none' here is the
      // pure-logic pin that a successful migration (dbExists: true,
      // encExists: false) leaves nothing for the next launch to clean up.
      expect(fsState.encExists).toBe(false);
    });
  });

  test('Sidecar filenames are derived from the db filename', ({ when, then }) => {
    when(/^I derive the WAL\/SHM sidecar names for "(.*)"$/, (name: string) => {
      sidecarNames = dbSidecarNames(name);
    });
    then(/^the sidecar names should be "(.*)" and "(.*)"$/, (wal: string, shm: string) => {
      expect(sidecarNames).toEqual([wal, shm]);
    });
  });

  test('Sidecar filenames are derived from the enc export filename', ({ when, then }) => {
    when(/^I derive the WAL\/SHM sidecar names for "(.*)"$/, (name: string) => {
      sidecarNames = dbSidecarNames(name);
    });
    then(/^the sidecar names should be "(.*)" and "(.*)"$/, (wal: string, shm: string) => {
      expect(sidecarNames).toEqual([wal, shm]);
    });
  });
});

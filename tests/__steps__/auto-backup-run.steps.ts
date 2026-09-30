import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runAutoBackupCheck, AutoBackupIO, AutoBackupOutcome } from '../../src/domain/autoBackupRun';

const feature = loadFeature(path.resolve(__dirname, '../__features__/auto-backup-run.feature'));

const NOW = 1_790_000_000_000;
const HOUR = 3_600_000;
const CURRENT_SIG = 'v2:42:currency=SGD';

defineFeature(feature, (test) => {
  let enabled: boolean;
  let last: { sig: string | null; at: number };
  let cloud: boolean;
  let calls: string[];
  let outcome: AutoBackupOutcome;

  beforeEach(() => {
    enabled = true;
    last = { sig: null, at: 0 };
    cloud = true;
    calls = [];
  });

  const io = (): AutoBackupIO => ({
    autoEnabled: async () => (calls.push('autoEnabled'), enabled),
    lastBackup: async () => (calls.push('lastBackup'), last),
    signature: async () => (calls.push('signature'), CURRENT_SIG),
    cloudAvailable: async () => (calls.push('cloudAvailable'), cloud),
    backup: async () => void calls.push('backup'),
    record: async () => void calls.push('record'),
    now: () => NOW,
  });

  const whenRun = (when: any) =>
    when('the auto-backup check runs', async () => {
      outcome = await runAutoBackupCheck(io(), HOUR);
    });
  const thenOutcome = (then: any) =>
    then(/^the outcome should be "(.*)"$/, (o: string) => expect(outcome).toBe(o));
  const andCalls = (and: any) =>
    and(/^it should only have called "(.*)"$/, (list: string) => expect(calls).toEqual(list.split(', ')));

  test('Turned off — nothing else is read', ({ given, when, then, and }) => {
    given('auto-backup is off', () => { enabled = false; });
    whenRun(when); thenOutcome(then); andCalls(and);
  });

  test('Too soon since the last backup — the signature is never computed', ({ given, when, then, and }) => {
    given('the last backup was 10 minutes ago', () => { last = { sig: 'old', at: NOW - 10 * 60_000 }; });
    whenRun(when); thenOutcome(then); andCalls(and);
  });

  test('Nothing changed — iCloud is not even asked', ({ given, when, then, and }) => {
    given('the last backup was 2 hours ago with the current signature', () => {
      last = { sig: CURRENT_SIG, at: NOW - 2 * HOUR };
    });
    whenRun(when); thenOutcome(then); andCalls(and);
  });

  test('Changed but no iCloud — no backup', ({ given, and, when, then }) => {
    given('the last backup was 2 hours ago with an older signature', () => {
      last = { sig: 'v2:41:currency=SGD', at: NOW - 2 * HOUR };
    });
    and('iCloud is unavailable', () => { cloud = false; });
    whenRun(when); thenOutcome(then); andCalls(and);
  });

  test('Changed and due — backs up and records it', ({ given, when, then, and }) => {
    given('the last backup was 2 hours ago with an older signature', () => {
      last = { sig: 'v2:41:currency=SGD', at: NOW - 2 * HOUR };
    });
    whenRun(when); thenOutcome(then); andCalls(and);
  });
});

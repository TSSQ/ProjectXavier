import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  selectBackupsToPrune,
  shouldAutoBackup,
  backupSignature,
} from '../../src/domain/backupPolicy';
import { BackupData } from '../../src/lib/backup';

const emptyData = (): BackupData => ({
  accounts: [],
  categories: [],
  payees: [],
  transactions: [],
  recurringSeries: [],
  settings: {},
});

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/backup-policy.feature')
);

const HOUR_MS = 3_600_000;
const MIN_INTERVAL_MS = HOUR_MS; // 1 hour

defineFeature(feature, (test) => {
  test('Prune keeps the 3 newest backups', ({ given, when, then }) => {
    let metas: { name: string; exportedAt: number }[];
    let pruned: string[];

    given(/^5 backups ordered by age$/, () => {
      const now = 1_700_000_000_000;
      metas = [
        { name: 'backup-5.json', exportedAt: now - 4 * HOUR_MS },
        { name: 'backup-4.json', exportedAt: now - 3 * HOUR_MS },
        { name: 'backup-3.json', exportedAt: now - 2 * HOUR_MS },
        { name: 'backup-2.json', exportedAt: now - 1 * HOUR_MS },
        { name: 'backup-1.json', exportedAt: now },
      ];
    });

    when(/^I select backups to prune keeping 3$/, () => {
      pruned = selectBackupsToPrune(metas, 3);
    });

    then(/^the 2 oldest backups should be returned for deletion$/, () => {
      expect(pruned).toHaveLength(2);
      // The oldest two are backup-5 and backup-4
      expect(pruned).toContain('backup-5.json');
      expect(pruned).toContain('backup-4.json');
      // The 3 newest must NOT be in the pruned list
      expect(pruned).not.toContain('backup-1.json');
      expect(pruned).not.toContain('backup-2.json');
      expect(pruned).not.toContain('backup-3.json');
    });
  });

  test('shouldAutoBackup is false when signature is unchanged', ({ given, then }) => {
    let result: boolean;

    given(
      /^a current signature "(.*)" matching the last backup signature$/,
      (sig: string) => {
        const now = 1_700_000_000_000;
        result = shouldAutoBackup(sig, sig, now, now - 2 * HOUR_MS, MIN_INTERVAL_MS);
      },
    );

    then(/^shouldAutoBackup should return false regardless of time elapsed$/, () => {
      expect(result).toBe(false);
    });
  });

  test('shouldAutoBackup is false when within the minimum interval', ({
    given,
    and,
    then,
  }) => {
    let currentSig: string;
    let lastSig: string;
    let now: number;
    let lastAt: number;
    let result: boolean;

    given(
      /^a current signature "(.*)" different from last signature "(.*)"$/,
      (cur: string, last: string) => {
        currentSig = cur;
        lastSig = last;
        now = 1_700_000_000_000;
      },
    );

    and(/^the last backup was 30 minutes ago$/, () => {
      lastAt = now - 30 * 60 * 1000; // 30 minutes ago
    });

    then(/^shouldAutoBackup should return false$/, () => {
      result = shouldAutoBackup(currentSig, lastSig, now, lastAt, MIN_INTERVAL_MS);
      expect(result).toBe(false);
    });
  });

  test('shouldAutoBackup is true when data changed and interval elapsed', ({
    given,
    and,
    then,
  }) => {
    let currentSig: string;
    let lastSig: string;
    let now: number;
    let lastAt: number;
    let result: boolean;

    given(
      /^a current signature "(.*)" different from last signature "(.*)"$/,
      (cur: string, last: string) => {
        currentSig = cur;
        lastSig = last;
        now = 1_700_000_000_000;
      },
    );

    and(/^the last backup was 2 hours ago$/, () => {
      lastAt = now - 2 * HOUR_MS;
    });

    then(/^shouldAutoBackup should return true$/, () => {
      result = shouldAutoBackup(currentSig, lastSig, now, lastAt, MIN_INTERVAL_MS);
      expect(result).toBe(true);
    });
  });

  test('An empty dataset has a stable signature', ({ given, then }) => {
    let data: BackupData;
    given(/^an empty dataset$/, () => {
      data = emptyData();
    });
    then(/^its backup signature should be "(.*)"$/, (sig: string) => {
      expect(backupSignature(data)).toBe(sig);
    });
  });

  test('Adding a transaction changes the signature', ({ given, when, then }) => {
    let base: string;
    let next: string;
    given(/^an empty dataset$/, () => {
      base = backupSignature(emptyData());
    });
    when(/^I add one transaction$/, () => {
      const d = emptyData();
      d.transactions.push({
        id: 't1',
        accountId: 'a1',
        type: 'expense',
        amount: 100,
        currency: 'SGD',
        occurredAt: 1,
        createdAt: 1,
        source: 'manual',
      });
      next = backupSignature(d);
    });
    then(/^the signature should change$/, () => {
      expect(next).not.toBe(base);
    });
  });

  test('Changing a setting changes the signature', ({ given, when, then }) => {
    let base: string;
    let next: string;
    given(/^an empty dataset$/, () => {
      base = backupSignature(emptyData());
    });
    when(/^I change the currency setting$/, () => {
      const d = emptyData();
      d.settings = { currency: 'EUR' };
      next = backupSignature(d);
    });
    then(/^the signature should change$/, () => {
      expect(next).not.toBe(base);
    });
  });
});

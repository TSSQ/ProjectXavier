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

  test('Prune keeps the 3 newest across a mixed .json/.sqlite list', ({ given, when, then }) => {
    let metas: { name: string; exportedAt: number }[];
    let pruned: string[];

    given(/^5 backups ordered by age with mixed \.json and \.sqlite suffixes$/, () => {
      const now = 1_700_000_000_000;
      // Suffix is unrelated to age here on purpose — pruning must go by
      // exportedAt alone, regardless of which format wrote the file.
      metas = [
        { name: 'projectxavier-backup-1.json', exportedAt: now - 4 * HOUR_MS },
        { name: 'projectxavier-backup-2.sqlite', exportedAt: now - 3 * HOUR_MS },
        { name: 'projectxavier-backup-3.json', exportedAt: now - 2 * HOUR_MS },
        { name: 'projectxavier-backup-4.sqlite', exportedAt: now - 1 * HOUR_MS },
        { name: 'projectxavier-backup-5.sqlite', exportedAt: now },
      ];
    });

    when(/^I select backups to prune keeping 3$/, () => {
      pruned = selectBackupsToPrune(metas, 3);
    });

    then(/^the 2 oldest backups should be returned for deletion regardless of suffix$/, () => {
      expect(pruned).toHaveLength(2);
      expect(pruned).toContain('projectxavier-backup-1.json');
      expect(pruned).toContain('projectxavier-backup-2.sqlite');
      expect(pruned).not.toContain('projectxavier-backup-3.json');
      expect(pruned).not.toContain('projectxavier-backup-4.sqlite');
      expect(pruned).not.toContain('projectxavier-backup-5.sqlite');
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

  test('An empty dataset has a stable v2 signature', ({ given, then }) => {
    let data: BackupData;
    given(/^an empty dataset$/, () => {
      data = emptyData();
    });
    then(/^its backup signature should be "(.*)"$/, (sig: string) => {
      expect(backupSignature(data)).toBe(sig);
    });
  });

  test('Computing the signature twice for the same dataset is stable', ({
    given,
    when,
    then,
  }) => {
    let base: string;
    let next: string;
    given(/^an empty dataset$/, () => {
      base = backupSignature(emptyData());
    });
    when(/^I compute the signature again with nothing changed$/, () => {
      next = backupSignature(emptyData());
    });
    then(/^the signature should not change$/, () => {
      expect(next).toBe(base);
    });
  });

  test('Bumping the data revision changes the signature', ({ given, when, then }) => {
    let base: string;
    let next: string;
    given(/^an empty dataset$/, () => {
      base = backupSignature(emptyData());
    });
    when(/^I bump only the data revision$/, () => {
      const d = emptyData();
      d.dataRevision = 1;
      next = backupSignature(d);
    });
    then(/^the signature should change$/, () => {
      expect(next).not.toBe(base);
    });
  });

  test('Adding a transaction with no revision bump does not change the signature', ({
    given,
    when,
    then,
  }) => {
    let base: string;
    let next: string;
    given(/^an empty dataset$/, () => {
      base = backupSignature(emptyData());
    });
    when(/^I add one transaction without bumping the data revision$/, () => {
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
        pending: false,
      });
      next = backupSignature(d);
    });
    then(/^the signature should not change$/, () => {
      expect(next).toBe(base);
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

  test('A v2 signature can never equal a v1-format signature', ({ given, then }) => {
    let data: BackupData;
    given(/^an empty dataset$/, () => {
      data = emptyData();
    });
    then(/^its v2 signature should not equal any v1-format signature string$/, () => {
      const sig = backupSignature(data);
      expect(sig.startsWith('v2:')).toBe(true);
      // Every v1 signature was `count:count:count:count:count:createdAt:settingsSig`
      // — never prefixed with "v2:" — for any combination of counts/settings a
      // real dataset could have produced, so a v2 string can never collide
      // with one, guaranteeing exactly one catch-up auto-backup on upgrade.
      const sampleV1Signatures = [
        '0:0:0:0:0:0:',
        '1:2:3:4:0:0',
        '0:0:0:0:0:0:currency=SGD',
      ];
      for (const v1 of sampleV1Signatures) {
        expect(sig).not.toBe(v1);
      }
    });
  });

  test('shouldAutoBackup still clamps to the minimum interval with v2 signatures', ({
    given,
    and,
    then,
  }) => {
    let currentSig: string;
    let lastSig: string;
    let now: number;
    let lastAt: number;

    given(/^a current v2 signature different from the last v2 signature$/, () => {
      currentSig = backupSignature({ ...emptyData(), dataRevision: 2 });
      lastSig = backupSignature({ ...emptyData(), dataRevision: 1 });
      now = 1_700_000_000_000;
    });

    and(/^the last backup was 30 minutes ago$/, () => {
      lastAt = now - 30 * 60 * 1000;
    });

    then(/^shouldAutoBackup should return false$/, () => {
      expect(shouldAutoBackup(currentSig, lastSig, now, lastAt, MIN_INTERVAL_MS)).toBe(false);
    });
  });

  test('shouldAutoBackup still fires with v2 signatures once the interval has elapsed', ({
    given,
    and,
    then,
  }) => {
    let currentSig: string;
    let lastSig: string;
    let now: number;
    let lastAt: number;

    given(/^a current v2 signature different from the last v2 signature$/, () => {
      currentSig = backupSignature({ ...emptyData(), dataRevision: 2 });
      lastSig = backupSignature({ ...emptyData(), dataRevision: 1 });
      now = 1_700_000_000_000;
    });

    and(/^the last backup was 2 hours ago$/, () => {
      lastAt = now - 2 * HOUR_MS;
    });

    then(/^shouldAutoBackup should return true$/, () => {
      expect(shouldAutoBackup(currentSig, lastSig, now, lastAt, MIN_INTERVAL_MS)).toBe(true);
    });
  });
});

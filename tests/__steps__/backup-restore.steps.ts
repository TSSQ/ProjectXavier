import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { BackupData, serializeBackup, parseBackup } from '../../src/lib/backup';
import { makeAccount, makeTransaction } from '../support/world';
import { RecurringSeries } from '../../src/domain/types';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/backup-restore.feature')
);

function makeRecurringSeries(): RecurringSeries {
  return {
    id: 'series-1',
    rule: {
      freq: 'monthly',
      interval: 1,
      byDay: 1,
      anchor: Date.UTC(2026, 0, 1),
      end: { kind: 'never' },
    },
    template: {
      accountId: 'acc-1',
      type: 'expense',
      amount: 5000,
      currency: 'USD',
      categoryId: null,
      payeeId: null,
      transferAccountId: null,
      note: null,
    },
    lastPostedAt: null,
    postedCount: 0,
    paused: false,
    skippedDates: [],
    createdAt: Date.UTC(2026, 0, 1),
    archived: false,
  };
}

defineFeature(feature, (test) => {
  let original: BackupData;
  let serialized: string;

  test('Serialize and parse round-trips a dataset including recurringSeries', ({
    given,
    when,
    then,
  }) => {
    given(/^a dataset with 1 account, 2 transactions, and 1 recurring series$/, () => {
      const acc = makeAccount({ name: 'Checking', openingBalance: 100000 });
      original = {
        accounts: [acc],
        categories: [],
        payees: [],
        transactions: [
          makeTransaction({ type: 'expense', amount: 1500, accountId: acc.id }),
          makeTransaction({ type: 'income', amount: 5000, accountId: acc.id }),
        ],
        recurringSeries: [makeRecurringSeries()],
        settings: { currency: 'USD' },
      };
    });

    when(/^I serialize the backup$/, () => {
      serialized = serializeBackup(original, 1_700_000_000_000);
    });

    then(
      /^parsing the serialized backup should return the original data including recurringSeries$/,
      () => {
        const envelope = parseBackup(serialized);
        expect(envelope.data).toEqual(original);
        expect(envelope.data.recurringSeries).toHaveLength(1);
        expect(envelope.data.recurringSeries[0]!.id).toBe('series-1');
        expect(envelope.version).toBe(2);
        expect(envelope.exportedAt).toBe(1_700_000_000_000);
      },
    );
  });

  test('parseBackup rejects version 3', ({ given, then }) => {
    let json: string;

    given(/^a backup JSON with version 3$/, () => {
      json = JSON.stringify({
        version: 3,
        exportedAt: Date.now(),
        data: {
          accounts: [],
          categories: [],
          payees: [],
          transactions: [],
          recurringSeries: [],
        },
      });
    });

    then(/^parsing it should throw an unsupported version error$/, () => {
      expect(() => parseBackup(json)).toThrow(/unsupported backup version/i);
    });
  });

  test('parseBackup rejects a version-1 payload (no recurringSeries handling)', ({
    given,
    then,
  }) => {
    let json: string;

    given(/^a version-1 backup JSON without recurringSeries$/, () => {
      // No confirmed real v1 (AES-encrypted) file can exist (no public users
      // predate this format; KEEP=3 rotation would have pruned any that
      // did) — parseBackup no longer special-cases version 1, so a
      // v1-shaped payload (missing recurringSeries) is rejected like any
      // other malformed input, not silently normalised.
      json = JSON.stringify({
        version: 1,
        exportedAt: Date.UTC(2026, 0, 1),
        data: {
          accounts: [],
          categories: [],
          payees: [],
          transactions: [],
        },
      });
    });

    then(/^parsing it should throw a malformed-data error$/, () => {
      expect(() => parseBackup(json)).toThrow(/recurringSeries is not an array/);
    });
  });

  test('parseBackup throws on malformed JSON', ({ given, then }) => {
    let badJson: string;

    given(/^a malformed JSON string$/, () => {
      badJson = '{ not valid json :::';
    });

    then(/^parsing it should throw a parse error$/, () => {
      expect(() => parseBackup(badJson)).toThrow();
    });
  });
});

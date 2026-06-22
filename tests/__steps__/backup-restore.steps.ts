import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { BackupData, exportBackup, restoreBackup } from '../../src/lib/backup';
import { EncryptedBlob } from '../../src/lib/crypto';
import { makeAccount, makeTransaction } from '../support/world';
import { nodeCrypto } from '../support/nodeCrypto';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/backup-restore.feature')
);

defineFeature(feature, (test) => {
  let original: BackupData;
  let blob: EncryptedBlob;

  const buildDataset = () => {
    const acc = makeAccount({
      name: 'Checking',
      openingBalance: 100000,
    });
    original = {
      accounts: [acc],
      categories: [],
      payees: [],
      transactions: [
        makeTransaction({ type: 'expense', amount: 1500, accountId: acc.id }),
        makeTransaction({ type: 'income', amount: 5000, accountId: acc.id }),
      ],
    };
  };

  test('Backup and restore round-trips the data', ({ given, when, and, then }) => {
    given(/^a dataset with 1 account and 2 transactions$/, buildDataset);
    when(/^I export an encrypted backup with passphrase "(.*)"$/, async (pass) => {
      blob = await exportBackup(original, pass, nodeCrypto);
    });
    and(/^I restore the backup with the same passphrase$/, () => {
      /* restore happens in the assertion to compare directly */
    });
    then(/^the restored data should equal the original data$/, async () => {
      const restored = await restoreBackup(
        blob,
        'correct horse battery staple',
        nodeCrypto
      );
      expect(restored.data).toEqual(original);
    });
  });

  test('The app currency setting round-trips through a backup', ({
    given,
    when,
    then,
  }) => {
    given(/^a dataset whose app currency is "(.*)"$/, (code: string) => {
      original = {
        accounts: [],
        categories: [],
        payees: [],
        transactions: [],
        settings: { currency: code },
      };
    });
    when(/^I export an encrypted backup with passphrase "(.*)"$/, async (pass) => {
      blob = await exportBackup(original, pass, nodeCrypto);
    });
    then(/^the restored app currency should be "(.*)"$/, async (code) => {
      const restored = await restoreBackup(
        blob,
        'correct horse battery staple',
        nodeCrypto
      );
      expect(restored.data.settings?.currency).toBe(code);
    });
  });

  test('Restoring with the wrong passphrase fails', ({ given, when, then }) => {
    given(/^a dataset with 1 account and 2 transactions$/, buildDataset);
    when(/^I export an encrypted backup with passphrase "(.*)"$/, async (pass) => {
      blob = await exportBackup(original, pass, nodeCrypto);
    });
    then(/^restoring with passphrase "(.*)" should fail$/, async (wrong) => {
      await expect(restoreBackup(blob, wrong, nodeCrypto)).rejects.toThrow();
    });
  });
});

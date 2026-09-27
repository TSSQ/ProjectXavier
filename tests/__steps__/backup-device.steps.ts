import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { buildName, parseBackupName, deviceKindFromModel } from '../../src/domain/backupFilename';

const feature = loadFeature(path.resolve(__dirname, '../__features__/backup-device.feature'));

const MODEL_STEP = /^model (null|"[^"]*") with idiom (pad|phone) should be labelled "(iPhone|iPad)"$/;
const modelOf = (raw: string): unknown => (raw === 'null' ? null : raw.slice(1, -1));

defineFeature(feature, (test) => {
  test('The hardware model decides, whatever the idiom says', ({ then }) => {
    then(MODEL_STEP, (model: string, idiom: string, device: string) => {
      expect(deviceKindFromModel(modelOf(model), idiom === 'pad')).toBe(device);
    });
  });

  test('Without a usable model, the idiom is the fallback', ({ then }) => {
    then(MODEL_STEP, (model: string, idiom: string, device: string) => {
      expect(deviceKindFromModel(modelOf(model), idiom === 'pad')).toBe(device);
    });
  });

  test('The iPad label survives the filename round trip', ({ then }) => {
    then(/^a backup built on model "(.*)" should list as "(.*)"$/, (model: string, device: string) => {
      const name = buildName(1790000000000, deviceKindFromModel(model, false));
      expect(parseBackupName(name)?.device).toBe(device);
    });
  });
});

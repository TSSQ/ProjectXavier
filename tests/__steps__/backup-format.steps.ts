import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  buildName,
  parseBackupName,
  restoreRouteFor,
  BackupDevice,
} from '../../src/domain/backupFilename';
import { SQL_TABLES, missingTables } from '../../src/domain/sqliteBackupTables';

const feature = loadFeature(path.resolve(__dirname, '../__features__/backup-format.feature'));

defineFeature(feature, (test) => {
  test('buildName always produces a new .sqlite filename', ({ when, then }) => {
    let name: string;

    when(/^I build a backup filename for exportedAt (\d+)$/, (exportedAt: string) => {
      name = buildName(Number(exportedAt));
    });

    then(/^the filename should be "(.*)"$/, (expected: string) => {
      expect(name).toBe(expected);
    });
  });

  test('buildName includes the device idiom when given one (iPhone)', ({ when, then }) => {
    let name: string;

    when(/^I build a backup filename for exportedAt (\d+) and device "(.*)"$/, (exportedAt: string, device: string) => {
      name = buildName(Number(exportedAt), device as BackupDevice);
    });

    then(/^the filename should be "(.*)"$/, (expected: string) => {
      expect(name).toBe(expected);
    });
  });

  test('buildName includes the device idiom when given one (iPad)', ({ when, then }) => {
    let name: string;

    when(/^I build a backup filename for exportedAt (\d+) and device "(.*)"$/, (exportedAt: string, device: string) => {
      name = buildName(Number(exportedAt), device as BackupDevice);
    });

    then(/^the filename should be "(.*)"$/, (expected: string) => {
      expect(name).toBe(expected);
    });
  });

  test('parseBackupName recognises a device-suffixed .sqlite name (iPhone)', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(
      /^the parsed name should have exportedAt (\d+), device "(.*)", and format "(.*)"$/,
      (exportedAt: string, device: string, format: string) => {
        expect(parsed).toEqual({ exportedAt: Number(exportedAt), device, format });
      },
    );
  });

  test('parseBackupName recognises a device-suffixed .sqlite name (iPad)', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(
      /^the parsed name should have exportedAt (\d+), device "(.*)", and format "(.*)"$/,
      (exportedAt: string, device: string, format: string) => {
        expect(parsed).toEqual({ exportedAt: Number(exportedAt), device, format });
      },
    );
  });

  test('parseBackupName recognises an old .sqlite name without a device', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(
      /^the parsed name should have exportedAt (\d+), device null, and format "(.*)"$/,
      (exportedAt: string, format: string) => {
        expect(parsed).toEqual({ exportedAt: Number(exportedAt), device: null, format });
      },
    );
  });

  test('parseBackupName recognises a legacy .json name, which never carries a device', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(
      /^the parsed name should have exportedAt (\d+), device null, and format "(.*)"$/,
      (exportedAt: string, format: string) => {
        expect(parsed).toEqual({ exportedAt: Number(exportedAt), device: null, format });
      },
    );
  });

  test('parseBackupName treats an unrecognised device segment as no device, not a rejection', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(
      /^the parsed name should have exportedAt (\d+), device null, and format "(.*)"$/,
      (exportedAt: string, format: string) => {
        expect(parsed).toEqual({ exportedAt: Number(exportedAt), device: null, format });
      },
    );
  });

  test('parseBackupName rejects an unrelated file', ({ given, when, then }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(/^the parsed name should be null$/, () => {
      expect(parsed).toBeNull();
    });
  });

  test('parseBackupName rejects a .json name with a device-shaped segment', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(/^the parsed name should be null$/, () => {
      expect(parsed).toBeNull();
    });
  });

  test('parseBackupName rejects a filename with an implausibly long timestamp', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(/^the parsed name should be null$/, () => {
      expect(parsed).toBeNull();
    });
  });

  test('parseBackupName accepts a filename with exactly the maximum 15-digit timestamp', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(
      /^the parsed name should have exportedAt (\d+), device null, and format "(.*)"$/,
      (exportedAt: string, format: string) => {
        expect(parsed).toEqual({ exportedAt: Number(exportedAt), device: null, format });
      },
    );
  });

  test('parseBackupName rejects a filename with a 16-digit timestamp, one past the cap', ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(/^the parsed name should be null$/, () => {
      expect(parsed).toBeNull();
    });
  });

  test("parseBackupName rejects a .sqlite name whose device segment isn't alphanumeric", ({
    given,
    when,
    then,
  }) => {
    let filename: string;
    let parsed: ReturnType<typeof parseBackupName>;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its backup name$/, () => {
      parsed = parseBackupName(filename);
    });

    then(/^the parsed name should be null$/, () => {
      expect(parsed).toBeNull();
    });
  });

  test('restoreRouteFor routes .sqlite files to the sqlite restore path', ({ given, then }) => {
    let filename: string;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    then(/^it should route to the "(.*)" restore path$/, (expected: string) => {
      expect(restoreRouteFor(filename)).toBe(expected);
    });
  });

  test('restoreRouteFor routes .json files to the legacy restore path', ({ given, then }) => {
    let filename: string;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    then(/^it should route to the "(.*)" restore path$/, (expected: string) => {
      expect(restoreRouteFor(filename)).toBe(expected);
    });
  });

  test('missingTables reports nothing when every expected table is present', ({ given, then }) => {
    let actual: string[];

    given(/^an attached database with all 6 expected tables$/, () => {
      actual = [...SQL_TABLES];
    });

    then(/^missingTables should report no missing tables$/, () => {
      expect(missingTables(actual)).toEqual([]);
    });
  });

  test('missingTables reports absent tables in a foreign/corrupt file', ({ given, then }) => {
    let actual: string[];

    given(/^an attached database missing the "(.*)" and "(.*)" tables$/, (t1: string, t2: string) => {
      actual = SQL_TABLES.filter((t: string) => t !== t1 && t !== t2);
    });

    then(/^missingTables should report "(.*)" and "(.*)" as missing$/, (t1: string, t2: string) => {
      const missing = missingTables(actual);
      expect(missing).toContain(t1);
      expect(missing).toContain(t2);
      expect(missing).toHaveLength(2);
    });
  });
});

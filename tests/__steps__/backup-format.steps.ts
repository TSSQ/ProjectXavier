import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { buildName, parseExportedAt, restoreRouteFor } from '../../src/domain/backupFilename';
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

  test('parseExportedAt recognises the new .sqlite convention', ({ given, when, then }) => {
    let filename: string;
    let parsed: number | null;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its exportedAt$/, () => {
      parsed = parseExportedAt(filename);
    });

    then(/^the parsed exportedAt should be (\d+)$/, (expected: string) => {
      expect(parsed).toBe(Number(expected));
    });
  });

  test('parseExportedAt recognises the legacy .json convention', ({ given, when, then }) => {
    let filename: string;
    let parsed: number | null;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its exportedAt$/, () => {
      parsed = parseExportedAt(filename);
    });

    then(/^the parsed exportedAt should be (\d+)$/, (expected: string) => {
      expect(parsed).toBe(Number(expected));
    });
  });

  test('parseExportedAt ignores unrelated files', ({ given, when, then }) => {
    let filename: string;
    let parsed: number | null;

    given(/^the filename "(.*)"$/, (name: string) => {
      filename = name;
    });

    when(/^I parse its exportedAt$/, () => {
      parsed = parseExportedAt(filename);
    });

    then(/^the parsed exportedAt should be null$/, () => {
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

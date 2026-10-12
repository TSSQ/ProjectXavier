import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runMigrations, MigrationDriver } from '../../src/db/migrationPlan';
import { OPTIONAL_SQL_TABLES, SQL_TABLES, missingTables } from '../../src/domain/sqliteBackupTables';
import { RawBackupRows, RawRow, buildBackupDataFromRows } from '../../src/domain/sqliteBackupRows';
import { BackupData, parseBackup, serializeBackup } from '../../src/lib/backup';
import { PhraseMemoryRow } from '../../src/domain/phraseMemory';

const feature = loadFeature(path.resolve(__dirname, '../__features__/phrase-memory-backup.feature'));

function driverFor(db: DatabaseSync): MigrationDriver {
  return {
    execDdl: async (sql) => {
      db.exec(sql);
    },
    execAlter: async (sql) => {
      db.exec(sql);
    },
    columnNames: async (table) => {
      const rows = db.prepare(`PRAGMA table_info(${table});`).all() as unknown as { name: string }[];
      return new Set(rows.map((r) => r.name));
    },
  };
}

/** Reads an image the way sqliteFile.ts's readBackupDataFromAttached does. */
function readImage(file: string): BackupData {
  const image = new DatabaseSync(file);
  try {
    const present = (
      image.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as { name: string }[]
    ).map((r) => r.name);
    const missing = missingTables(present);
    if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`);
    const raw = {} as RawBackupRows;
    for (const t of SQL_TABLES) raw[t] = image.prepare(`SELECT * FROM ${t}`).all() as RawRow[];
    for (const t of OPTIONAL_SQL_TABLES) {
      if (present.includes(t)) raw[t] = image.prepare(`SELECT * FROM ${t}`).all() as RawRow[];
    }
    return buildBackupDataFromRows(raw);
  } finally {
    image.close();
  }
}

const INSERT =
  'INSERT INTO phrase_memory (key, verdict, type, category_id, payee_id, account_id, hits, reverts, last_used_at, updated_at) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
const insert = (db: DatabaseSync, r: PhraseMemoryRow) =>
  db
    .prepare(INSERT)
    .run(r.key, r.verdict, r.type, r.categoryId, r.payeeId, r.accountId, r.hits, r.reverts, r.lastUsedAt, r.updatedAt);
const readAll = (db: DatabaseSync): PhraseMemoryRow[] =>
  (db.prepare('SELECT * FROM phrase_memory ORDER BY key').all() as unknown as Array<Record<string, unknown>>).map((r) => ({
    key: r.key as string,
    verdict: r.verdict as PhraseMemoryRow['verdict'],
    type: r.type as PhraseMemoryRow['type'],
    categoryId: r.category_id as string | null,
    payeeId: r.payee_id as string | null,
    accountId: r.account_id as string | null,
    hits: r.hits as number,
    reverts: r.reverts as number,
    lastUsedAt: r.last_used_at as number,
    updatedAt: r.updated_at as number,
  }));

const ORIGINALS: PhraseMemoryRow[] = [
  { key: 'kopi', verdict: null, type: 'expense', categoryId: 'cat-dining', payeeId: 'pay-1', accountId: 'acc-cash', hits: 3, reverts: 1, lastUsedAt: 20, updatedAt: 21 },
  { key: 'on lunch', verdict: 'log', type: null, categoryId: null, payeeId: null, accountId: null, hits: 0, reverts: 0, lastUsedAt: 10, updatedAt: 10 },
];

defineFeature(feature, (test) => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phrase-memory-backup-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const migrated = async (): Promise<DatabaseSync> => {
    const db = new DatabaseSync(':memory:');
    await runMigrations(driverFor(db));
    return db;
  };

  test('An existing database gains the table, and migrating again changes nothing', ({ given, when, then }) => {
    let db: DatabaseSync;
    given('a database migrated before phrase memory existed', async () => {
      db = await migrated();
      db.exec('DROP TABLE phrase_memory');
      db.exec('DROP INDEX IF EXISTS idx_phrase_memory_used');
    });
    when('the migrations run twice', async () => {
      await runMigrations(driverFor(db));
      await runMigrations(driverFor(db));
    });
    then('it has a phrase_memory table with every column', async () => {
      const cols = await driverFor(db).columnNames('phrase_memory');
      expect([...cols].sort()).toEqual(
        ['account_id', 'category_id', 'hits', 'key', 'last_used_at', 'payee_id', 'reverts', 'type', 'updated_at', 'verdict'].sort()
      );
    });
  });

  test('Phrase memory round-trips through a backup image', ({ given, when, then }) => {
    let live: DatabaseSync;
    let restored: PhraseMemoryRow[] = [];
    given('a database holding two phrase memories', async () => {
      live = await migrated();
      ORIGINALS.forEach((r) => insert(live, r));
    });
    when('I back it up as a SQLite image and restore it into a fresh database', async () => {
      const file = path.join(dir, 'backup.sqlite');
      live.exec(`VACUUM INTO '${file}'`);
      const data = readImage(file);
      const fresh = await migrated();
      for (const r of data.phraseMemory ?? []) insert(fresh, r);
      restored = readAll(fresh);
    });
    then('the restored phrase memories equal the originals', () => {
      expect(restored).toEqual(ORIGINALS);
    });
  });

  test('An image from before phrase memory existed restores with none', ({ given, when, then }) => {
    let file: string;
    let data: BackupData;
    given('a backup image with no phrase_memory table', async () => {
      const db = await migrated();
      db.exec('DROP TABLE phrase_memory');
      file = path.join(dir, 'old.sqlite');
      db.exec(`VACUUM INTO '${file}'`);
    });
    when('I read it back', () => {
      data = readImage(file);
    });
    then('it is accepted with no phrase memories', () => {
      expect(data.phraseMemory).toEqual([]);
    });
  });

  test('A corrupt phrase memory row rejects the whole restore', ({ given, when, then }) => {
    let file: string;
    let error: Error | null = null;
    given(/^a backup image whose phrase memory verdict is "(.*)"$/, async (bad: string) => {
      const db = await migrated();
      insert(db, { ...ORIGINALS[0]!, verdict: bad as 'log' });
      file = path.join(dir, 'bad.sqlite');
      db.exec(`VACUUM INTO '${file}'`);
    });
    when('I read it back', () => {
      try {
        readImage(file);
      } catch (e) {
        error = e as Error;
      }
    });
    then('it is rejected naming the phrase_memory table', () => {
      expect(error?.message).toContain('phrase_memory');
    });
  });

  test('A legacy JSON backup never carries phrase memory', ({ given, when, then }) => {
    let json = '';
    let parsed: BackupData | null = null;
    given('a legacy JSON backup carrying a phraseMemory array', () => {
      const envelope = JSON.parse(
        serializeBackup({ accounts: [], categories: [], payees: [], transactions: [], recurringSeries: [] })
      );
      envelope.data.phraseMemory = [{ key: 'smuggled', verdict: 'log' }];
      json = JSON.stringify(envelope);
    });
    when('I parse it', () => {
      parsed = parseBackup(json).data;
    });
    then('it parses and carries no phrase memory', () => {
      expect(parsed).not.toBeNull();
      expect('phraseMemory' in parsed!).toBe(false);
    });
  });
});

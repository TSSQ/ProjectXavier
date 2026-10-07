import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runMigrations, MigrationDriver } from '../../src/db/migrationPlan';
import {
  DELETE_ALL_CHAT,
  SELECT_CHAT_ALL,
  SELECT_OLDEST_CHAT_DAY,
  buildInsertChatMessage,
  buildSelectChatDay,
  buildUpdateChatStatus,
} from '../../src/db/chatSql';
import { ChatMessage, NewChatMessage, RawChatRow, parseChatRow } from '../../src/domain/chatMessage';
import {
  EXPORT_STRIPPED_TABLES,
  OPTIONAL_SQL_TABLES,
  SQL_TABLES,
  stripExportSql,
} from '../../src/domain/sqliteBackupTables';
import { buildInsertBudget } from '../../src/db/budgetSql';
import type { ParameterisedStatement } from '../../src/db/sql';
import { CHAT_FIXTURES, CHAT_MARKER } from '../support/chatFixture';
import { MAX_SERIES_BUCKETS, QUERY_TOOL_NAMES } from '../../src/domain/queryTools';
import { TRANSACTION_NOTE_MAX_CHARS, transactionReadSchema } from '../../src/lib/validation';
import { budgetRow } from '../support/budgetFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-messages.feature'));
const root = path.resolve(__dirname, '../..');

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

const run = (db: DatabaseSync, stmt: ParameterisedStatement) => db.prepare(stmt.sql).run(...stmt.params);
const all = (db: DatabaseSync, stmt: ParameterisedStatement) =>
  db.prepare(stmt.sql).all(...stmt.params) as unknown as RawChatRow[];
const migrated = async (): Promise<DatabaseSync> => {
  const db = new DatabaseSync(':memory:');
  await runMigrations(driverFor(db));
  return db;
};
const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number }).n;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const good = CHAT_FIXTURES[0]!;

defineFeature(feature, (test) => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('Every kind round-trips through the table', ({ given, when, then, and }) => {
    let db: DatabaseSync;
    let back: ChatMessage[] = [];
    given('a migrated database', async () => {
      db = await migrated();
    });
    when('I append one message of every kind and read them back', () => {
      for (const m of CHAT_FIXTURES) run(db, buildInsertChatMessage(m));
      back = all(db, buildSelectChatDay('2026-10-05')).map((raw) => {
        const r = parseChatRow(raw);
        if (!r.ok) throw new Error(`row ${String(raw.id)} rejected: ${r.reason}`);
        return r.message;
      });
    });
    then('every message should come back equal to what was written', () => {
      const kinds = new Set(CHAT_FIXTURES.map((m) => m.kind));
      expect(kinds.size).toBe(14);
      expect(back).toHaveLength(CHAT_FIXTURES.length);
      back.forEach((m, i) => expect(m).toEqual({ ...CHAT_FIXTURES[i], seq: i + 1 }));
    });
    and('every one of the 7 query tools and both net_worth shapes should be covered', () => {
      const answers = back.filter((m) => m.kind === 'query_answer');
      const tools = new Set(answers.map((m) => (m.kind === 'query_answer' ? m.payload.tool : '')));
      expect([...tools].sort()).toEqual([...QUERY_TOOL_NAMES].sort());
      const worth = answers.flatMap((m) =>
        m.kind === 'query_answer' && m.payload.tool === 'net_worth' ? [m.payload.result] : []
      );
      expect(worth.some((r) => r.amountMinor !== undefined)).toBe(true);
      expect(worth.some((r) => r.series !== undefined)).toBe(true);
    });
  });

  test('A malformed row is skipped without throwing', ({ given, when, then, and }) => {
    let db: DatabaseSync;
    let reasons: string[] = [];
    let kept: ChatMessage[] = [];
    given(
      'a migrated database holding one good message and these bad rows',
      async (rows: Array<{ what: string }>) => {
        db = await migrated();
        run(db, buildInsertChatMessage(good));
        const insert = db.prepare(
          'INSERT INTO chat_messages (id, day_key, seq, role, kind, payload, status, data_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const secret = 'SECRET-CONTENT';
        const bad: Record<string, unknown[]> = {
          'payload is not JSON': ['b1', '2026-10-05', 10, 'user', 'user_text', `{${secret}`, 'live', null, 1],
          'payload misses its fields': ['b2', '2026-10-05', 11, 'user', 'user_text', JSON.stringify({ nope: secret }), 'live', null, 1],
          'kind is unknown': ['b3', '2026-10-05', 12, 'xavier', secret, '{}', 'live', null, 1],
          'role does not match kind': ['b4', '2026-10-05', 13, 'xavier', 'user_text', JSON.stringify({ text: secret }), 'live', null, 1],
          'status is unknown': ['b5', '2026-10-05', 14, 'user', 'user_text', JSON.stringify({ text: secret }), secret, null, 1],
        };
        for (const { what } of rows) insert.run(...(bad[what] as never[]));
        expect(rows).toHaveLength(5);
      }
    );
    when('I read the day back', () => {
      const results = all(db, buildSelectChatDay('2026-10-05')).map(parseChatRow);
      kept = results.flatMap((r) => (r.ok ? [r.message] : []));
      reasons = results.flatMap((r) => (r.ok ? [] : [r.reason]));
    });
    then('only the good message should be returned and nothing should throw', () => {
      expect(kept.map((m) => m.id)).toEqual([good.id]);
      expect(reasons).toHaveLength(5);
    });
    and('the skip reasons should not contain any message content', () => {
      for (const r of reasons) expect(['bad_json', 'bad_row']).toContain(r);
    });
  });

  test('An invalid message is refused on write without echoing content', ({ given, when, then }) => {
    let db: DatabaseSync;
    let message = '';
    given('a migrated database', async () => {
      db = await migrated();
    });
    when('I append a draft whose amount is negative and whose note holds a secret', () => {
      const draft = CHAT_FIXTURES.find((m) => m.kind === 'draft')!;
      try {
        run(
          db,
          buildInsertChatMessage({
            ...draft,
            payload: { ...draft.payload, amount: -5, note: CHAT_MARKER },
          } as NewChatMessage)
        );
      } catch (e) {
        message = (e as Error).message;
      }
    });
    then(/^the write should be rejected with "(.*)" and the table should stay empty$/, (code: string) => {
      expect(message).toBe(code);
      expect(message).not.toContain(CHAT_MARKER);
      expect(count(db, 'chat_messages')).toBe(0);
    });
  });

  test('The day key must be a real calendar date', ({ then }) => {
    then(
      /^day keys "(.*)" and "(.*)" are accepted and "(.*)", "(.*)" and "(.*)" are refused$/,
      (...keys: string[]) => {
        const withDay = (dayKey: string) => ({ ...good, dayKey });
        keys.slice(0, 2).forEach((k) => expect(() => buildInsertChatMessage(withDay(k))).not.toThrow());
        keys.slice(2).forEach((k) => expect(() => buildInsertChatMessage(withDay(k))).toThrow('chat_invalid_write'));
      }
    );
  });

  test("Payload caps sit exactly at the domain's own limits", ({ then, and }) => {
    const answer = (tool: 'spending_over_time' | 'net_worth', n: number) => {
      const series = Array.from({ length: n }, (_, i) => ({ label: `p${i}`, amountMinor: i }));
      return {
        ...CHAT_FIXTURES[0]!,
        role: 'xavier',
        kind: 'query_answer',
        payload: { tool, result: { notes: [], series }, currency: 'SGD', caption: null, comparison: null },
      } as NewChatMessage;
    };
    const search = (note: string) => {
      const base = CHAT_FIXTURES.find((m) => m.kind === 'query_answer' && m.payload.tool === 'search_transactions')!;
      const payload = base.payload as { result: { rows: Array<Record<string, unknown>> } };
      const rows = [{ ...payload.result.rows[0], note }];
      return { ...base, payload: { ...payload, result: { ...payload.result, rows } } } as NewChatMessage;
    };
    const draft = (note: string) => {
      const base = CHAT_FIXTURES.find((m) => m.kind === 'draft')!;
      return { ...base, payload: { ...base.payload, note } } as NewChatMessage;
    };
    then('series of MAX_SERIES_BUCKETS points are accepted and one more is refused', () => {
      for (const tool of ['spending_over_time', 'net_worth'] as const) {
        expect(() => buildInsertChatMessage(answer(tool, MAX_SERIES_BUCKETS))).not.toThrow();
        expect(() => buildInsertChatMessage(answer(tool, MAX_SERIES_BUCKETS + 1))).toThrow('chat_invalid_write');
      }
    });
    and('notes of the transaction note limit are accepted and one more is refused', () => {
      for (const make of [draft, search]) {
        expect(() => buildInsertChatMessage(make('n'.repeat(TRANSACTION_NOTE_MAX_CHARS)))).not.toThrow();
        expect(() => buildInsertChatMessage(make('n'.repeat(TRANSACTION_NOTE_MAX_CHARS + 1)))).toThrow(
          'chat_invalid_write'
        );
      }
    });
    and('the transaction schemas share that note limit', () => {
      const tx = {
        id: 't',
        accountId: 'a',
        type: 'expense',
        amount: 1,
        currency: 'SGD',
        occurredAt: 1,
        createdAt: 1,
        source: 'manual',
      };
      const ok = transactionReadSchema.safeParse({ ...tx, note: 'n'.repeat(TRANSACTION_NOTE_MAX_CHARS) });
      const tooLong = transactionReadSchema.safeParse({ ...tx, note: 'n'.repeat(TRANSACTION_NOTE_MAX_CHARS + 1) });
      expect(ok.success).toBe(true);
      expect(tooLong.success).toBe(false);
      expect(TRANSACTION_NOTE_MAX_CHARS).toBe(2000);
    });
  });

  test('A photo message holds a label and no image', ({ then }) => {
    then('the user_photo payload should reject any field other than a label', () => {
      const photo = CHAT_FIXTURES.find((m) => m.kind === 'user_photo')!;
      const withImage = { ...photo, payload: { label: '📷 Receipt', uri: 'file:///x.jpg', base64: 'AAAA' } };
      const stmt = buildInsertChatMessage(withImage as NewChatMessage);
      expect(JSON.parse(stmt.params[4] as string)).toEqual({ label: '📷 Receipt' });
      expect(() => buildInsertChatMessage({ ...photo, payload: { uri: 'file:///x.jpg' } } as never)).toThrow();
    });
  });

  test('Sequence numbers count up per day', ({ given, when, then }) => {
    let db: DatabaseSync;
    given('a migrated database', async () => {
      db = await migrated();
    });
    when('I append two messages on one day and one on the next', () => {
      run(db, buildInsertChatMessage({ ...good, id: 's1' }));
      run(db, buildInsertChatMessage({ ...good, id: 's2' }));
      run(db, buildInsertChatMessage({ ...good, id: 's3', dayKey: '2026-10-06' }));
    });
    then('the sequence numbers should be 1, 2 and 1', () => {
      const rows = all(db, SELECT_CHAT_ALL);
      expect(rows.map((r) => r.seq)).toEqual([1, 2, 1]);
      expect(all(db, SELECT_OLDEST_CHAT_DAY)).toEqual([{ day_key: '2026-10-05' }]);
    });
  });

  test('Chat statements bind every value', ({ when, then, and }) => {
    const evil = "x'; DROP TABLE chat_messages;--";
    let statements: ParameterisedStatement[] = [];
    when('I build the chat statements from values that look like SQL', () => {
      statements = [
        buildInsertChatMessage({
          ...good,
          id: evil,
          payload: { text: "'; DELETE FROM chat_messages;--" },
        } as NewChatMessage),
        buildSelectChatDay(evil),
        buildUpdateChatStatus(evil, 'stale'),
        SELECT_CHAT_ALL,
        SELECT_OLDEST_CHAT_DAY,
        DELETE_ALL_CHAT,
      ];
    });
    then('no statement should contain the value text', () => {
      for (const s of statements) {
        expect(s.sql).not.toContain('DROP TABLE');
        expect(s.sql).not.toContain('DELETE FROM chat_messages;--');
      }
    });
    and('every statement should use bound parameters', () => {
      for (const s of statements) expect((s.sql.match(/\?/g) ?? []).length).toBe(s.params.length);
    });
  });

  test('The chat repository builds SQL only through the parameterised builders', ({ when, then }) => {
    let source = '';
    when('I read the chat repository source', () => {
      source = fs.readFileSync(path.join(root, 'src/features/chat/repository.ts'), 'utf8');
    });
    then('it should contain no template-literal or concatenated SQL', () => {
      const code = stripComments(source);
      expect(code).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/);
      expect(code).not.toMatch(/(?:runAsync|getAllAsync|execAsync)\(\s*`/);
      expect(code).not.toMatch(/(?:runAsync|getAllAsync|execAsync)\([^)]*\+/);
    });
  });

  test('The migration creates chat_messages and is safe to run twice', ({ given, when, then, and }) => {
    let db: DatabaseSync;
    let thrown: unknown;
    given('an empty database', () => {
      db = new DatabaseSync(':memory:');
    });
    when('I run the migrations twice', async () => {
      try {
        await runMigrations(driverFor(db));
        await runMigrations(driverFor(db));
      } catch (e) {
        thrown = e;
      }
    });
    then('the chat_messages table should exist with its index', () => {
      const cols = db.prepare('PRAGMA table_info(chat_messages);').all() as unknown as { name: string }[];
      expect(cols.map((c) => c.name)).toEqual([
        'id',
        'day_key',
        'seq',
        'role',
        'kind',
        'payload',
        'status',
        'data_revision',
        'created_at',
      ]);
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_chat_day'")
        .all();
      expect(idx).toHaveLength(1);
    });
    and('the migrations should not have thrown', () => expect(thrown).toBeUndefined());
  });

  test('The exported backup image has no chat rows', ({ given, when, then, and }) => {
    let db: DatabaseSync;
    let file = '';
    given('a migrated database holding chat messages and a budget', async () => {
      db = await migrated();
      for (const m of CHAT_FIXTURES.slice(0, 3)) run(db, buildInsertChatMessage(m));
      run(db, buildInsertChatMessage({ ...good, id: 'secret', payload: { text: CHAT_MARKER } } as NewChatMessage));
      run(db, buildInsertBudget(budgetRow('dining', 500, '2026-10', null, 1)));
      expect(count(db, 'chat_messages')).toBe(4);
    });
    const exportImage = (vacuum: boolean) => {
      file = path.join(dir, `backup-${vacuum}.sqlite`);
      db.exec(`VACUUM INTO '${file}'`);
      const image = new DatabaseSync(file);
      // The export step runs this against the attached `plain` copy, then VACUUMs it.
      image.exec(stripExportSql('main'));
      if (vacuum) image.exec('VACUUM');
      const rows = [count(image, 'chat_messages'), count(image, 'budgets')];
      image.close();
      return { rows, bytes: fs.readFileSync(file) };
    };
    when('I export it as a backup image and strip it as the export step does', () => {
      const { rows } = exportImage(true);
      expect(rows).toEqual([0, 1]);
    });
    then('the image should hold no chat_messages rows and still hold the budget', () => {
      const image = new DatabaseSync(file);
      expect(count(image, 'chat_messages')).toBe(0);
      expect(count(image, 'budgets')).toBe(1);
      image.close();
    });
    and("the image file's raw bytes should not contain the chat marker", () => {
      expect(fs.readFileSync(file).includes(Buffer.from(CHAT_MARKER))).toBe(false);
    });
    and('without the VACUUM the marker would still be in the file', () => {
      expect(exportImage(false).bytes.includes(Buffer.from(CHAT_MARKER))).toBe(true);
    });
    and('the export step should VACUUM the image after the strip', () => {
      const src = stripComments(fs.readFileSync(path.join(root, 'src/features/backup/sqliteFile.ts'), 'utf8'));
      expect(src).toMatch(/stripExportSql\('plain'\)[\s\S]*execAsync\(`VACUUM plain;`\)/);
    });
  });

  test('Restore never reads or writes the chat table', ({ then, and }) => {
    then('chat_messages should be in neither SQL_TABLES nor OPTIONAL_SQL_TABLES', () => {
      expect(SQL_TABLES as readonly string[]).not.toContain('chat_messages');
      expect(OPTIONAL_SQL_TABLES as readonly string[]).not.toContain('chat_messages');
    });
    and('the export step should strip it exactly as it strips parse_metrics', () => {
      expect(EXPORT_STRIPPED_TABLES).toEqual(['parse_metrics', 'chat_messages']);
      expect(stripExportSql('plain')).toContain('DELETE FROM plain.parse_metrics;');
      expect(stripExportSql('plain')).toContain('DELETE FROM plain.chat_messages;');
      const file = stripComments(fs.readFileSync(path.join(root, 'src/features/backup/sqliteFile.ts'), 'utf8'));
      expect(file).toContain("stripExportSql('plain')");
      expect(file).not.toMatch(/DELETE FROM plain\.(?:parse_metrics|chat_messages)/);
    });
  });
});

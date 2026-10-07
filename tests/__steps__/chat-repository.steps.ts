import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { defineFeature, loadFeature } from 'jest-cucumber';

// A node:sqlite stand-in for the expo driver, plus an in-memory settings store.
// `mock`-prefixed names are the ones jest allows a hoisted factory to touch.
const mockState: {
  sqlite: DatabaseSync | null;
  settings: Map<string, string>;
  events: Array<{ table: unknown; inTx: boolean }>;
  inTx: boolean;
} = { sqlite: null, settings: new Map(), events: [], inTx: false };

jest.mock('../../src/db/client', () => ({
  expoDb: {
    getAllAsync: async (sql: string, params: unknown[]) => mockState.sqlite!.prepare(sql).all(...(params as never[])),
    runAsync: async (sql: string, params: unknown[]) => mockState.sqlite!.prepare(sql).run(...(params as never[])),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      mockState.inTx = true;
      try {
        await fn();
      } finally {
        mockState.inTx = false;
      }
    },
  },
  db: {
    delete: (table: unknown) => {
      mockState.events.push({ table, inTx: mockState.inTx });
      return Promise.resolve();
    },
    insert: () => ({ values: () => Promise.resolve() }),
  },
}));
jest.mock('../../src/features/settings/repository', () => ({
  getSetting: async (k: string) => mockState.settings.get(k) ?? null,
  setSetting: async (k: string, v: string) => void mockState.settings.set(k, v),
  applySettings: async () => undefined,
  getAllSettings: async () => ({}),
  getDataRevision: async () => 1,
  bumpDataRevision: async () => undefined,
}));
jest.mock('../../src/features/backup/icloud', () => ({}));
jest.mock('../../src/features/backup/sqliteFile', () => ({}));
jest.mock('../../src/features/recurring/repository', () => ({ postDueOccurrences: async () => undefined }));
jest.mock('../../src/features/widget/summary', () => ({ updateWidgetSummary: async () => undefined }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'id' }));

import { runMigrations } from '../../src/db/migrationPlan';
import { runExclusive } from '../../src/domain/backupGate';
import {
  appendChatMessage,
  checkChatDay,
  getChatResetNotice,
  listChatAll,
  listChatDay,
  setChatStatus,
  updateChatContent,
} from '../../src/features/chat/repository';
import { applyBackup } from '../../src/features/backup/repository';
import * as schema from '../../src/db/schema';
import { CHAT_FIXTURES, CHAT_MARKER } from '../support/chatFixture';
import type { ChatMessage, NewChatMessage } from '../../src/domain/chatMessage';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-repository.feature'));
const flush = () => new Promise((r) => setTimeout(r, 10));
const good = CHAT_FIXTURES[0]!;
const yesterday = (id: string): NewChatMessage => ({ ...good, id, dayKey: '2026-10-05' });
const noon = (iso: string) => new Date(iso).getTime();

async function freshTable(): Promise<void> {
  mockState.sqlite = new DatabaseSync(':memory:');
  mockState.settings = new Map();
  mockState.events = [];
  await runMigrations({
    execDdl: async (s) => void mockState.sqlite!.exec(s),
    execAlter: async (s) => void mockState.sqlite!.exec(s),
    columnNames: async (t) =>
      new Set(
        (mockState.sqlite!.prepare(`PRAGMA table_info(${t});`).all() as unknown as { name: string }[]).map(
          (r) => r.name
        )
      ),
  });
}

defineFeature(feature, (test) => {
  test('Twenty concurrent appends get unique sequence numbers', ({ given, when, then }) => {
    given('an empty chat table', freshTable);
    when('20 messages are appended at once', async () => {
      await Promise.all(Array.from({ length: 20 }, (_, i) => appendChatMessage({ ...good, id: `c${i}` })));
    });
    then('the sequence numbers should run 1 to 20 with no duplicates', async () => {
      const seqs = (await listChatDay('2026-10-05')).map((m) => m.seq);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });
  });

  test('A malformed stored row is skipped and logged without content', ({ given, and, when, then }) => {
    let warn: jest.SpyInstance;
    let listed: string[] = [];
    given('an empty chat table', freshTable);
    and('a good message and a malformed row holding a secret', async () => {
      await appendChatMessage(good);
      mockState
        .sqlite!.prepare('INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('row-zz9', '2026-10-05', 9, 'user', 'user_text', JSON.stringify({ nope: CHAT_MARKER }), 'live', null, 1);
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    when('the day is listed', async () => {
      listed = (await listChatDay('2026-10-05')).map((m) => m.id);
    });
    then('only the good message should come back', () => expect(listed).toEqual([good.id]));
    and('the log lines should not contain the secret', () => {
      expect(warn.mock.calls.length).toBe(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(CHAT_MARKER);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('row-zz9');
      warn.mockRestore();
    });
  });

  test('The reset check is one exclusive section', ({ given, and, when, then }) => {
    let release!: () => void;
    let backup: Promise<void>;
    let check: Promise<unknown>;
    given("a chat table holding yesterday's messages", async () => {
      await freshTable();
      await appendChatMessage(yesterday('y1'));
    });
    and('the backup gate is held by a running backup', () => {
      backup = runExclusive(() => new Promise<void>((r) => (release = r)));
    });
    when('an unlocked cold-launch check starts', async () => {
      check = checkChatDay({ now: noon('2026-10-06T12:00:00'), trigger: 'cold_launch' });
      await flush();
    });
    then('nothing should be cleared while the gate is held', async () => {
      expect(await listChatAll()).toHaveLength(1);
      expect(await getChatResetNotice()).toBe(false);
    });
    when('the backup finishes', async () => {
      release();
      await backup;
      await check;
    });
    then('the chat should be cleared and the notice armed', async () => {
      expect(await listChatAll()).toHaveLength(0);
      expect(await getChatResetNotice()).toBe(true);
    });
  });

  test('An append waits for the reset check instead of slipping into it', ({ given, when, then }) => {
    given("a chat table holding yesterday's messages", async () => {
      await freshTable();
      await appendChatMessage(yesterday('y1'));
      await appendChatMessage(yesterday('y2'));
    });
    when("a cold-launch check and an append of today's first message run together", async () => {
      const now = noon('2026-10-06T12:00:00');
      await Promise.all([
        checkChatDay({ now, trigger: 'cold_launch' }),
        appendChatMessage({ ...good, id: 'today', dayKey: '2026-10-06' }),
      ]);
    });
    then("yesterday's messages are gone and today's message survives with seq 1", async () => {
      const all = await listChatAll();
      expect(all.map((m) => [m.id, m.seq])).toEqual([['today', 1]]);
    });
  });

  test('A restore clears the chat inside its transaction', ({ given, when, then }) => {
    given("a chat table holding yesterday's messages", async () => {
      await freshTable();
      await appendChatMessage(yesterday('y1'));
    });
    when('a backup is applied', async () => {
      mockState.events = [];
      await applyBackup({ accounts: [], categories: [], payees: [], transactions: [], recurringSeries: [] });
    });
    then('the chat table should have been cleared inside the restore transaction', () => {
      expect(mockState.events).toContainEqual({ table: schema.chatMessages, inTx: true });
    });
  });

  test("A card's content and status can be rewritten, and an invalid rewrite is refused", ({ given, when, then, and }) => {
    const draft = CHAT_FIXTURES.find((m) => m.kind === 'draft')!;
    given('an empty chat table', freshTable);
    when('a draft card is appended, edited, and resolved', async () => {
      await appendChatMessage(draft);
      const [stored] = await listChatDay('2026-10-05');
      const edited = { ...stored!, payload: { ...(stored!.payload as object), amount: 9900 }, dataRevision: 7 };
      await updateChatContent(edited as ChatMessage);
      await setChatStatus(draft.id, 'resolved');
    });
    then('the stored draft should show the edit and be resolved', async () => {
      const [row] = await listChatDay('2026-10-05');
      expect(row).toMatchObject({ status: 'resolved', dataRevision: 7, payload: { amount: 9900 } });
    });
    and('a rewrite with an invalid amount should be refused and leave the row alone', async () => {
      const [row] = await listChatDay('2026-10-05');
      const bad = { ...row!, payload: { ...(row!.payload as object), amount: -1 } } as ChatMessage;
      await expect(updateChatContent(bad)).rejects.toThrow('chat_invalid_write');
      expect((await listChatDay('2026-10-05'))[0]).toMatchObject({ payload: { amount: 9900 } });
    });
  });
});

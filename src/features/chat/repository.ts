/**
 * Chat log data access (docs/design/xavier-daily-chat-spec.md §5). Every
 * statement comes from src/db/chatSql.ts, parameterised only. Payloads are
 * validated with zod on write (the builder) and on read (`parseChatRow`); a
 * malformed row is skipped and logged WITHOUT its content, never thrown.
 *
 * The daily reset runner and its settings flag live here too, wired to the
 * pure logic in src/domain/chatDay.ts. `useChatLog` calls `checkChatDay` on the
 * launch of the screen (which only mounts after the biometric unlock) and on a
 * resume, behind the lock cover if there is one.
 */
import { expoDb } from '../../db/client';
import {
  DELETE_ALL_CHAT,
  SELECT_CHAT_ALL,
  SELECT_OLDEST_CHAT_DAY,
  buildInsertChatMessage,
  buildSelectChatDay,
  buildUpdateChatContent,
  buildUpdateChatStatus,
} from '../../db/chatSql';
import {
  ChatMessage,
  ChatStatus,
  NewChatMessage,
  RawChatRow,
  parseChatRow,
} from '../../domain/chatMessage';
import {
  ChatDayStore,
  ChatResetDecision,
  ChatResetTrigger,
  clearNoticeOnMessage,
  resolveChatResetNotice,
  runChatDayCheck,
} from '../../domain/chatDay';
import { runExclusive } from '../../domain/backupGate';
import { getSetting, setSetting } from '../settings/repository';

const CHAT_RESET_NOTICE_KEY = 'chat_reset_notice';

/** Validates every row; malformed ones are dropped with a content-free log. */
function readable(rows: RawChatRow[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const raw of rows) {
    const result = parseChatRow(raw);
    if (result.ok) messages.push(result.message);
    else console.warn(`[chat] skipped a malformed message (${result.reason})`);
  }
  return messages;
}

/** One local day's messages, in order. */
export async function listChatDay(dayKey: string): Promise<ChatMessage[]> {
  const stmt = buildSelectChatDay(dayKey);
  return readable(await expoDb.getAllAsync<RawChatRow>(stmt.sql, stmt.params));
}

/** Every stored message, oldest first. */
export async function listChatAll(): Promise<ChatMessage[]> {
  return readable(await expoDb.getAllAsync<RawChatRow>(SELECT_CHAT_ALL.sql, SELECT_CHAT_ALL.params));
}

// Chat writes go through `runExclusive` (the backup gate) because a restore
// wipes and rewrites tables on the shared expo-sqlite connection: an append
// interleaved with it could land a card describing data that is being replaced.
// Cost: a send waits behind an in-flight backup/restore (including an upload).

/** Appends a message (validated by zod first; throws `chat_invalid_write` on an invalid one). */
export async function appendChatMessage(message: NewChatMessage): Promise<void> {
  const stmt = buildInsertChatMessage(message);
  await runExclusive(() => expoDb.runAsync(stmt.sql, stmt.params));
}

export async function setChatStatus(id: string, status: ChatStatus): Promise<void> {
  const stmt = buildUpdateChatStatus(id, status);
  await runExclusive(() => expoDb.runAsync(stmt.sql, stmt.params));
}

/** Rewrites a card's payload and revision (validated by zod first). */
export async function updateChatContent(message: ChatMessage): Promise<void> {
  const stmt = buildUpdateChatContent(message);
  await runExclusive(() => expoDb.runAsync(stmt.sql, stmt.params));
}

/** Deletes the whole chat. */
export async function clearChat(): Promise<void> {
  await runExclusive(clearChatUnlocked);
}

/** For callers already inside `runExclusive` (it is not re-entrant). */
async function clearChatUnlocked(): Promise<void> {
  await expoDb.runAsync(DELETE_ALL_CHAT.sql, DELETE_ALL_CHAT.params);
}

async function oldestChatDayKey(): Promise<string | null> {
  const rows = await expoDb.getAllAsync<{ day_key: unknown }>(
    SELECT_OLDEST_CHAT_DAY.sql,
    SELECT_OLDEST_CHAT_DAY.params
  );
  const key = rows[0]?.day_key;
  return typeof key === 'string' ? key : null;
}

/** The "yesterday's chat is cleared" note flag. Device-local (excluded from backups). */
export async function getChatResetNotice(): Promise<boolean> {
  return resolveChatResetNotice(await getSetting(CHAT_RESET_NOTICE_KEY));
}

export async function setChatResetNotice(on: boolean): Promise<void> {
  await setSetting(CHAT_RESET_NOTICE_KEY, on ? '1' : '0');
}

/** Call when the user sends the first message of the day. */
export function clearChatResetNoticeOnMessage(): Promise<void> {
  return clearNoticeOnMessage(store);
}

const store: ChatDayStore = {
  oldestDayKey: oldestChatDayKey,
  clearAll: clearChatUnlocked,
  getNotice: getChatResetNotice,
  setNotice: setChatResetNotice,
};

/**
 * Runs one reset check, atomically: the oldest-day read, the decision and the
 * clear are one exclusive section, so an append cannot slip between them.
 */
export function checkChatDay(input: {
  now: number;
  trigger: ChatResetTrigger | null;
}): Promise<ChatResetDecision> {
  return runExclusive(() => runChatDayCheck(store, input));
}

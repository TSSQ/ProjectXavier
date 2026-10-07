/**
 * Parameterised SQL for the `chat_messages` table (docs/design/
 * xavier-daily-chat-spec.md §5), as `{ sql, params }` like src/db/budgetSql.ts:
 * every value is a bound `?`. The repository feeds these to expo-sqlite; the
 * tests feed the same text to node:sqlite. Imports only pure modules.
 */
import type { ParameterisedStatement } from './sql';
import { ChatMessage, NewChatMessage, ChatStatus, parseNewChatMessage } from '../domain/chatMessage';

const COLUMNS = 'id, day_key, seq, role, kind, payload, status, data_revision, created_at';

/** All of one day's rows, in order. */
export function buildSelectChatDay(dayKey: string): ParameterisedStatement {
  return {
    sql: `SELECT ${COLUMNS} FROM chat_messages WHERE day_key = ? ORDER BY seq`,
    params: [dayKey],
  };
}

/** Every row, oldest day first: what the screen shows if a session ran past midnight. */
export const SELECT_CHAT_ALL: ParameterisedStatement = {
  sql: `SELECT ${COLUMNS} FROM chat_messages ORDER BY day_key, seq`,
  params: [],
};

/** The oldest day key still stored (one row, `day_key` null when empty). */
export const SELECT_OLDEST_CHAT_DAY: ParameterisedStatement = {
  sql: `SELECT MIN(day_key) AS day_key FROM chat_messages`,
  params: [],
};

/**
 * Appends a message, validating it first. `seq` is assigned inside the
 * statement (the day's next number) so two appends cannot collide.
 */
export function buildInsertChatMessage(message: NewChatMessage): ParameterisedStatement {
  const m = parseNewChatMessage(message);
  return {
    sql: `INSERT INTO chat_messages (${COLUMNS})
          SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?
          FROM chat_messages WHERE day_key = ?`,
    params: [
      m.id,
      m.dayKey,
      m.role,
      m.kind,
      JSON.stringify(m.payload),
      m.status,
      m.dataRevision,
      m.createdAt,
      m.dayKey,
    ],
  };
}

export function buildUpdateChatStatus(id: string, status: ChatStatus): ParameterisedStatement {
  return { sql: `UPDATE chat_messages SET status = ? WHERE id = ?`, params: [status, id] };
}

/**
 * Rewrites a card's payload (and revision) after an edit. The whole message is
 * re-validated, so a payload that no longer fits its kind throws
 * `chat_invalid_write` instead of reaching the table.
 */
export function buildUpdateChatContent(message: ChatMessage): ParameterisedStatement {
  const m = parseNewChatMessage(message);
  return {
    sql: `UPDATE chat_messages SET payload = ?, data_revision = ? WHERE id = ?`,
    params: [JSON.stringify(m.payload), m.dataRevision, m.id],
  };
}

/** Deletes the whole chat: the daily reset and the restore both use this. */
export const DELETE_ALL_CHAT: ParameterisedStatement = {
  sql: `DELETE FROM chat_messages`,
  params: [],
};

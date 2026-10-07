/**
 * Records the Assistant's conversation into today's chat log
 * (docs/design/xavier-daily-chat-spec.md §9) and hands the screen the log
 * state its feed renders.
 *
 * All sequencing lives in the pure recorder (src/domain/chatRecorder.ts); this
 * hook supplies ids, the clock and persistence. Every change the recorder makes
 * is diffed and written through the repository, in order. A persistence failure
 * (an invalid write, a database error) is logged with a content-free code and
 * dropped: it never throws into the send path.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChatLogState, EMPTY_CHAT_LOG, diffChatLog } from '../../domain/chatLog';
import { chatDayKey } from '../../domain/chatDay';
import { createChatRecorder } from '../../domain/chatRecorder';
import { newId } from '../../lib/id';
import { getDataRevision } from '../settings/repository';
import { appendChatMessage, listChatDay, setChatStatus, updateChatContent } from './repository';

/** A content-free code for a dropped write. */
const failureCode = (e: unknown): string =>
  e instanceof Error && e.message === 'chat_invalid_write' ? 'chat_invalid_write' : 'chat_db_error';

/**
 * Pending writes, in order. Module-scoped so a remounted screen waits for the
 * previous mount's writes before it reads the day back (no seq collision).
 */
let persistChain: Promise<void> = Promise.resolve();

export function useChatLog(idleGreeting: string) {
  const [state, setState] = useState<ChatLogState>(EMPTY_CHAT_LOG);
  // True once today's rows have been read (or the read failed): until then the
  // screen must not guess between the empty-day hero and the feed.
  const [loaded, setLoaded] = useState(false);
  // The session's day key (fixed at load), as state so the screen reacts to it.
  const [dayKey, setDayKey] = useState<string | null>(null);
  // Bumped by every clear of the day (the daily rollover, a restore), in the same
  // batch as the state clear: the layout resets the hero on it.
  const [resetEpoch, setResetEpoch] = useState(0);

  const recorder = useMemo(
    () =>
      createChatRecorder({
        newId,
        now: Date.now,
        idleGreeting,
        warn: (code) => console.warn(`[chat] ${code}`),
        onChange: (prev, next) => {
          setState(next);
          const diff = diffChatLog(prev, next);
          if (!diff.added.length && !diff.statusChanged.length && !diff.contentChanged.length) return;
          const write = async (op: () => Promise<void>) => {
            try {
              await op();
            } catch (e) {
              console.warn(`[chat] dropped a write (${failureCode(e)})`);
            }
          };
          persistChain = persistChain.then(async () => {
            for (const m of diff.added) await write(() => appendChatMessage(m));
            for (const c of diff.contentChanged) await write(() => updateChatContent(c));
            for (const s of diff.statusChanged) await write(() => setChatStatus(s.id, s.status));
          });
        },
      }),
    // Created once: the greeting is a module constant on the screen.
    []
  );

  useEffect(() => {
    let cancelled = false;
    // One reading of the clock decides both the rows loaded and the session day.
    const dayKey = chatDayKey(Date.now());
    (async () => {
      try {
        await persistChain;
        const [rows, revision] = await Promise.all([listChatDay(dayKey), getDataRevision()]);
        if (!cancelled) {
          recorder.load(rows, revision, dayKey);
          setDayKey(dayKey);
          setLoaded(true);
        }
      } catch {
        console.warn('[chat] chat_load_failed');
        if (!cancelled) {
          recorder.loadFailed(dayKey);
          setDayKey(dayKey);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recorder]);

  /** The day was cleared: empty the log, set the new day and tell the layout. */
  const reset = useCallback(
    (newDayKey: string) => {
      recorder.reset(newDayKey);
      setDayKey(newDayKey);
      setResetEpoch((n) => n + 1);
    },
    [recorder]
  );

  return { state, chat: recorder, loaded, dayKey, resetEpoch, reset };
}

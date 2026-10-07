/**
 * Records the Assistant's conversation into today's chat log
 * (docs/design/xavier-daily-chat-spec.md §9) and hands the screen the log
 * state its feed renders.
 *
 * Thin glue: all sequencing (the pure recorder, the day checks, persistence
 * order, reset/fence, the one-time note) lives in the framework-free
 * controller src/domain/chatSession.ts, which is where it is tested. This hook
 * injects the repository, the clock and the React state publishers, and
 * forwards AppState changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ChatLogState, EMPTY_CHAT_LOG } from '../../domain/chatLog';
import { createChatChain, createChatSession } from '../../domain/chatSession';
import { subscribeChatRestored } from '../../domain/chatRestoreSignal';
import { newId } from '../../lib/id';
import { getDataRevision } from '../settings/repository';
import {
  appendChatMessage,
  checkChatDay,
  clearChat,
  clearChatResetNoticeOnMessage,
  getChatResetNotice,
  listChatDay,
  setChatStatus,
  updateChatContent,
} from './repository';

/** The launch check runs once per app launch, not once per mount of the screen. */
let launchChecked = false;
/** One chain per app launch: a remounted screen's load waits for the previous mount's writes. */
const sharedChain = createChatChain();

/**
 * `busyRef` is read when the day clears: an operation still running then (a
 * parse, a save) belongs to the old day, so the log drops its late writes until
 * the screen calls `chat.unfence()`.
 */
export function useChatLog(idleGreeting: string, busyRef?: { readonly current: boolean }) {
  const [state, setState] = useState<ChatLogState>(EMPTY_CHAT_LOG);
  // True once today's rows have been read (or the read failed): until then the
  // screen must not guess between the empty-day hero and the feed.
  const [loaded, setLoaded] = useState(false);
  // The session's day key (fixed at load), as state so the screen reacts to it.
  const [dayKey, setDayKey] = useState<string | null>(null);
  // Bumped by every clear of the day (the daily rollover, a restore): the layout
  // resets the hero on it.
  const [resetEpoch, setResetEpoch] = useState(0);
  // Armed by a reset, shown in the hero until the first message (see `showResetNote`).
  const [notice, setNotice] = useState(false);
  // A day check that may clear the log is in flight: the screen holds its feed.
  const [held, setHeld] = useState(false);
  // Bumped synchronously by every clear of the day, so an async reply can tell,
  // after its await, that the day it started on is gone (`dayScope`).
  const epochRef = useRef(0);

  const session = useMemo(
    () =>
      createChatSession({
        chain: sharedChain,
        now: Date.now,
        newId,
        idleGreeting,
        isBusy: () => busyRef?.current ?? false,
        warn: (code) => console.warn(`[chat] ${code}`),
        checkDay: checkChatDay,
        listDay: listChatDay,
        getRevision: getDataRevision,
        getStoredNotice: getChatResetNotice,
        clearStoredNotice: clearChatResetNoticeOnMessage,
        clearAll: clearChat,
        appendMessage: appendChatMessage,
        updateContent: updateChatContent,
        setStatus: setChatStatus,
        launch: {
          done: () => launchChecked,
          markDone: () => {
            launchChecked = true;
          },
        },
        timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
        subscribeRestored: subscribeChatRestored,
        publish: {
          state: setState,
          dayKey: setDayKey,
          notice: setNotice,
          held: setHeld,
          loaded: () => setLoaded(true),
          epoch: () => {
            epochRef.current += 1;
            setResetEpoch((n) => n + 1);
          },
        },
      }),
    // Created once: the greeting is a module constant on the screen.
    []
  );

  useEffect(() => {
    void session.start();
    const sub = AppState.addEventListener('change', (to) => session.onAppState(to));
    return () => {
      sub.remove();
      session.dispose();
    };
  }, [session]);

  /**
   * Call before an await; the returned predicate says, after it, whether the day is
   * still the one the call started on. Guard only SCREEN-STATE writes after an
   * await with it; chat writes are fenced by the recorder.
   */
  const dayScope = useCallback(() => {
    const epoch = epochRef.current;
    return () => epochRef.current === epoch;
  }, []);

  const clearNotice = useCallback(() => session.clearNotice(), [session]);

  return {
    state,
    chat: session.recorder,
    loaded,
    dayKey,
    resetEpoch,
    dayScope,
    reset: session.reset,
    notice,
    held,
    clearNotice,
  };
}

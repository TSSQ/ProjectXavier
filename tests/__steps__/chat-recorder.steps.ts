import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { CardBody, ChatLogState, isInteractive, loggedTodayCount, presentationOf } from '../../src/domain/chatLog';
import { RecorderDeps, createChatRecorder } from '../../src/domain/chatRecorder';
import { stubTextFor } from '../../src/domain/chatCopy';
import { DISCARDED_TEXT, textBubble } from '../../src/domain/bubbleCopy';
import { ChatKind, ChatMessage } from '../../src/domain/chatMessage';
import { CHAT_FIXTURES } from '../support/chatFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-recorder.feature'));

const GREETING = 'Hi, I am Xavier.';
const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).getTime();

const cardOf = (kind: ChatKind, tool?: string): CardBody => {
  const f = CHAT_FIXTURES.find(
    (m) => m.kind === kind && (tool === undefined || (m.kind === 'query_answer' && m.payload.tool === tool))
  )!;
  return { kind: f.kind, payload: f.payload } as CardBody;
};
const receipt = (): ReturnType<typeof textBubble> =>
  ({ kind: 'receipt', headline: 'Saved SGD 18.00 to Transport.', lines: [] }) as never;

function setup(options?: { clock?: { t: number }; throwOnChange?: boolean }) {
  let n = 0;
  const clock = options?.clock ?? { t: at(10) };
  const changes: Array<{ prev: ChatLogState; next: ChatLogState }> = [];
  const warnings: string[] = [];
  const deps: RecorderDeps = {
    newId: () => `id-${++n}`,
    now: () => clock.t,
    idleGreeting: GREETING,
    warn: (code) => warnings.push(code),
    onChange: (prev, next) => {
      if (options?.throwOnChange) throw new Error('disk full: SECRET');
      changes.push({ prev, next });
    },
  };
  const rec = createChatRecorder(deps);
  const tick = () => {
    clock.t += 1000;
  };
  return { rec, changes, warnings, clock, tick };
}

defineFeature(feature, (test) => {
  let h = setup();
  const loaded = () => {
    h = setup();
    h.rec.load([], 1);
  };
  const msgs = (): ChatMessage[] => h.rec.state().messages;
  const byId = (id: string) => msgs().find((m) => m.id === id)!;
  const kinds = () => msgs().map((m) => m.kind);
  const present = (id: string) => presentationOf(byId(id), h.rec.state());
  const lines = (text: string) =>
    msgs().filter((m) => m.kind === 'xavier_text' && m.payload.text === text).length;

  test('Two drafts in a row are two cards', ({ given, when, then }) => {
    let a = '';
    let b = '';
    given('a loaded recorder', loaded);
    when('a draft is shown, the user sends another message, and a second draft is shown', () => {
      a = h.rec.showCard(cardOf('draft'), 1);
      h.rec.recordUser('lunch 12');
      b = h.rec.showCard(cardOf('draft'), 1);
    });
    then('the first draft should be a stub and the second should be live and interactive', () => {
      expect(present(a)).toBe('stub');
      expect(stubTextFor(byId(a))).toBe('Expense · not saved');
      expect(present(b)).toBe('live');
      expect(isInteractive(byId(b), h.rec.state())).toBe(true);
    });
  });

  test('Two query answers in a row are two cards', ({ given, when, then }) => {
    let a = '';
    let b = '';
    given('a loaded recorder', loaded);
    when('a query answer is shown, the user asks again, and a second answer is shown', () => {
      a = h.rec.showCard(cardOf('query_answer'), 1);
      h.rec.recordUser('and last month?');
      b = h.rec.showCard(cardOf('query_answer', 'spending_by_category'), 1);
    });
    then('both answers should be in the log and only the second should be interactive', () => {
      expect(kinds().filter((k) => k === 'query_answer')).toHaveLength(2);
      expect(present(a)).toBe('readonly');
      expect(isInteractive(byId(a), h.rec.state())).toBe(false);
      expect(isInteractive(byId(b), h.rec.state())).toBe(true);
    });
  });

  test('An afford card after an afford card is a new card', ({ given, when, then }) => {
    let a = '';
    let b = '';
    given('a loaded recorder', loaded);
    when('an afford card is shown and resolved by a pick, and another afford card is shown', () => {
      a = h.rec.showCard(cardOf('afford'), 2);
      h.rec.resolve(a);
      b = h.rec.showCard(cardOf('afford'), 2);
    });
    then('there should be two afford cards, the first hidden and the second live', () => {
      expect(kinds().filter((k) => k === 'afford')).toHaveLength(2);
      expect(present(a)).toBe('hidden');
      expect(present(b)).toBe('live');
    });
  });

  test('A set-budget card after a set-budget card is a new card', ({ given, when, then }) => {
    let a = '';
    let b = '';
    given('a loaded recorder', loaded);
    when('a set-budget card is shown and another set-budget card is shown with no message between', () => {
      a = h.rec.showCard(cardOf('set_budget'), 2);
      b = h.rec.showCard(cardOf('set_budget'), 2);
    });
    then('the first should be a stub and the second live', () => {
      expect(present(a)).toBe('stub');
      expect(present(b)).toBe('live');
    });
  });

  test('A confirmed tx_picker delete stays resolved after the revision moves', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a tx_picker built at revision 3 is shown, resolved by its delete, and then the revision moves to 4', () => {
      id = h.rec.showCard(cardOf('tx_picker'), 3);
      h.rec.resolve(id);
      h.rec.noteRevision(4);
    });
    then('the picker should be resolved, not stale', () => {
      expect(byId(id).status).toBe('resolved');
    });
  });

  test('A tx_picker nobody confirmed goes stale when the revision moves', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a tx_picker built at revision 3 is shown and the revision moves to 4', () => {
      id = h.rec.showCard(cardOf('tx_picker'), 3);
      h.rec.noteRevision(4);
    });
    then(/^the picker should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(byId(id))).toBe(stub);
    });
  });

  const updatePicker = (): CardBody => {
    const body = cardOf('tx_picker');
    return { ...body, payload: { ...(body.payload as object), op: 'update' } } as CardBody;
  };

  test('Picking a row for an update leaves the picker live until the edit is saved', ({ given, when, then }) => {
    let id = '';
    let livePresentation = '';
    given('a loaded recorder', loaded);
    when('an update tx_picker is shown, a row is picked, and the edit is saved', () => {
      id = h.rec.showCard(updatePicker(), 3);
      livePresentation = present(id);
      h.rec.resolve(id);
    });
    then('the picker should be live after the pick and hidden after the save', () => {
      expect(livePresentation).toBe('live');
      expect(present(id)).toBe('hidden');
    });
  });

  test('Walking away from the update editor stubs the picker', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('an update tx_picker is shown, a row is picked, and the editor is closed', () => {
      id = h.rec.showCard(updatePicker(), 3);
      h.rec.dismiss(id);
    });
    then(/^the picker should show the stub "(.*)" with no line$/, (stub: string) => {
      expect(stubTextFor(byId(id))).toBe(stub);
      expect(kinds()).toEqual(['tx_picker']);
    });
  });

  test('An update whose row vanished expires the picker', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('an update tx_picker is shown and the row is gone at save time', () => {
      id = h.rec.showCard(updatePicker(), 3);
      h.rec.expire(id);
    });
    then(/^the picker should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(byId(id))).toBe(stub);
    });
  });

  test('Narrowing the picker by account updates the same card', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a tx_picker is shown and then narrowed to one row', () => {
      const body = cardOf('tx_picker');
      const row = (body.payload as { rows: unknown[] }).rows[0];
      id = h.rec.showCard({ ...body, payload: { ...(body.payload as object), rows: [row, row] } } as CardBody, 3);
      h.rec.updateCard(id, { ...body, payload: { ...(body.payload as object), rows: [row] } } as CardBody);
    });
    then('there should be one picker card holding one row', () => {
      expect(kinds()).toEqual(['tx_picker']);
      expect((byId(id).payload as { rows: unknown[] }).rows).toHaveLength(1);
    });
  });

  test('A stale-draft explanation leaves a stub that says out of date', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a draft is shown and the stale-draft explanation expires it', () => {
      id = h.rec.showCard(cardOf('draft'), 1);
      h.rec.expire(id);
    });
    then(/^the draft should show the stub "(.*)" and not be hidden$/, (stub: string) => {
      expect(present(id)).toBe('stub');
      expect(stubTextFor(byId(id))).toBe(stub);
    });
  });

  test('Every kind of chat save is counted', ({ given, when, then }) => {
    given('a loaded recorder', loaded);
    when(
      'a receipt save, a series save, a plain Saved. save and a skipped-on-screen save are recorded as logged, with an edit, an account create and a budget change',
      () => {
        h.rec.recordXavier(receipt(), { logged: true });
        h.rec.recordXavier(textBubble('Every Friday: SGD 9.00.'), { logged: true });
        h.rec.recordXavier(textBubble('Saved.'), { logged: true });
        // The receipt the screen skipped because something newer spoke is still recorded.
        h.rec.recordXavier(receipt(), { logged: true });
        h.rec.recordXavier(textBubble('Updated Grab.'));
        h.rec.recordXavier({ kind: 'receipt', headline: 'Created Trip.', lines: [] } as never);
        h.rec.recordXavier({ kind: 'receipt', headline: 'Set Dining to SGD 500.', lines: [] } as never);
      }
    );
    then('the header count should be 4', () => {
      expect(loggedTodayCount(h.rec.state(), h.rec.sessionDayKey()!)).toBe(4);
    });
  });

  test('A dismiss before load gives exactly one line', ({ given, when, then }) => {
    let id = '';
    given('a recorder that has not loaded yet', () => {
      h = setup();
    });
    when("a draft is shown and dismissed before the load lands, and then the load lands", () => {
      id = h.rec.showCard(cardOf('draft'), 1);
      h.rec.dismiss(id, DISCARDED_TEXT);
      expect(msgs()).toHaveLength(0);
      h.rec.load([], 1);
    });
    then(/^the log should hold the draft stub followed by exactly one "(.*)" line$/, (line: string) => {
      expect(kinds()).toEqual(['draft', 'xavier_text']);
      expect(stubTextFor(byId(id))).toBe('Expense · not saved');
      expect(lines(line)).toBe(1);
    });
  });

  test('Where the screen shows no line, none is recorded', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when(/^a "(.*)" card is shown and dismissed with no line$/, (k: string) => {
      id = h.rec.showCard(cardOf(k as ChatKind), 1);
      h.rec.dismiss(id);
    });
    then('it should be a stub and no line should follow', () => {
      expect(present(id)).toBe('stub');
      expect(stubTextFor(byId(id))).not.toBeNull();
      expect(kinds()).toHaveLength(1);
    });
  });

  test('Where the screen says "No problem", the log records it once', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when(/^a "(.*)" card is shown and dismissed with the line$/, (k: string) => {
      id = h.rec.showCard(cardOf(k as ChatKind), 1);
      h.rec.dismiss(id, DISCARDED_TEXT);
    });
    then(/^it should be a stub and exactly one "(.*)" line should follow$/, (line: string) => {
      expect(present(id)).toBe('stub');
      expect(lines(line)).toBe(1);
    });
  });

  test('Cancelling the account Q&A before any card exists still records the line', ({ given, when, then }) => {
    given('a loaded recorder', loaded);
    when('the account Q&A is cancelled with no card on screen', () => {
      h.rec.dismiss(null, DISCARDED_TEXT);
    });
    then(/^exactly one "(.*)" line should be recorded$/, (line: string) => {
      expect(lines(line)).toBe(1);
      expect(kinds()).toEqual(['xavier_text']);
    });
  });

  test('A failed confirm that keeps its card leaves it live', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a set-budget card is shown and its confirm fails with the card kept', () => {
      id = h.rec.showCard(cardOf('set_budget'), 2);
      h.rec.recordXavier(textBubble("I couldn't save that budget — please try again."));
    });
    then('the card should still be live and interactive', () => {
      expect(byId(id).status).toBe('live');
      // The error line came after the card, but it did not end it.
      expect(present(id)).toBe('live');
    });
  });

  test('A failed confirm that clears the card abandons it with no line', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a set-budget card is shown and its confirm fails with the card cleared', () => {
      id = h.rec.showCard(cardOf('set_budget'), 2);
      h.rec.dismiss(id);
      h.rec.recordXavier(textBubble("I couldn't save that budget — please try again."));
    });
    then('it should be a stub and no line should follow', () => {
      expect(present(id)).toBe('stub');
      expect(lines(DISCARDED_TEXT)).toBe(0);
    });
  });

  test('One stale row skipped leaves the queue live', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a queue is shown and one row is skipped as stale and the queue advances', () => {
      id = h.rec.showCard(queue(0), 1);
      h.rec.updateCard(id, {
        kind: 'statement_queue',
        payload: { total: 8, saved: 0, skipped: 1, accountName: 'DBS Card' },
      });
    });
    then('the queue should still be live, now counting the skipped row', () => {
      expect(present(id)).toBe('live');
      expect((byId(id).payload as { skipped: number }).skipped).toBe(1);
    });
  });

  test("A query answer's dismiss appends no line", ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a query answer is shown and dismissed', () => {
      id = h.rec.showCard(cardOf('query_answer'), 1);
      h.rec.dismiss(id);
    });
    then('it should stay as read-only history and no line should follow', () => {
      expect(present(id)).toBe('readonly');
      expect(kinds()).toEqual(['query_answer']);
    });
  });

  test('A chip tap is a user bubble', ({ given, when, then }) => {
    given('a loaded recorder', loaded);
    when('Xavier asks which kind of account and the user taps a chip', () => {
      h.rec.recordXavier(textBubble('What kind of account is it?'));
      h.rec.recordUser('Savings');
    });
    then('the log should read xavier text then user text', () => {
      expect(msgs().map((m) => [m.role, m.kind])).toEqual([
        ['xavier', 'xavier_text'],
        ['user', 'user_text'],
      ]);
    });
  });

  const queue = (saved: number) =>
    ({ kind: 'statement_queue', payload: { total: 8, saved, skipped: 0, accountName: 'DBS Card' } }) as CardBody;

  test('A statement queue stopped midway ends resolved with its summary', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a queue is shown, two rows are confirmed, and the review is stopped', () => {
      id = h.rec.showCard(queue(0), 1);
      h.rec.recordXavier(receipt(), { logged: true });
      h.rec.updateCard(id, queue(1));
      h.rec.recordXavier(receipt(), { logged: true });
      h.rec.updateCard(id, queue(2));
      h.rec.recordXavier(textBubble('Saved 2 of 8 from your statement, 6 skipped.'));
      h.rec.resolve(id, { body: queue(2) });
    });
    then('the queue should be hidden, followed by two logged receipts and the summary', () => {
      expect(present(id)).toBe('hidden');
      expect(kinds()).toEqual(['statement_queue', 'xavier_receipt', 'xavier_receipt', 'xavier_text']);
      expect(loggedTodayCount(h.rec.state(), h.rec.sessionDayKey()!)).toBe(2);
    });
  });

  test('A statement queue left by a new message ends as a stub', ({ given, when, then }) => {
    let id = '';
    given('a loaded recorder', loaded);
    when('a queue is shown, one row is confirmed, and the user sends another message', () => {
      id = h.rec.showCard(queue(0), 1);
      h.rec.recordXavier(receipt(), { logged: true });
      h.rec.updateCard(id, queue(1));
      h.rec.recordUser('never mind');
    });
    then(/^the queue should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(byId(id))).toBe(stub);
    });
  });

  test('Calls made before the load keep their order and ids', ({ given, when, then }) => {
    let id = '';
    given('a recorder that has not loaded yet', () => {
      h = setup();
    });
    when('the user speaks, a card is shown and Xavier answers before the load lands', () => {
      h.rec.recordUser('coffee 4');
      id = h.rec.showCard(cardOf('draft'), 1);
      h.rec.recordXavier(textBubble('Here you go.'));
    });
    then('nothing should be written yet, and after the load they appear in order with the returned card id', () => {
      expect(h.changes).toHaveLength(0);
      h.rec.load([], 1);
      expect(kinds()).toEqual(['user_text', 'draft', 'xavier_text']);
      expect(msgs()[1]!.id).toBe(id);
      expect(msgs().map((m) => m.seq)).toEqual([1, 2, 3]);
    });
  });

  test('Stored rows reload with nothing interactive', ({ given, when, then }) => {
    given('a recorder that has not loaded yet', () => {
      h = setup();
    });
    when('a stored day with a live draft at the current revision and a live query answer loads', () => {
      const draft = CHAT_FIXTURES.find((m) => m.kind === 'draft')!;
      const answer = CHAT_FIXTURES.find((m) => m.kind === 'query_answer')!;
      h.rec.load(
        [
          { ...draft, id: 'd', seq: 1, status: 'live', dataRevision: 7 },
          { ...answer, id: 'q', seq: 2, status: 'live', dataRevision: 7 },
        ] as ChatMessage[],
        7
      );
    });
    then('the draft should be a stub, the answer read-only, and nothing interactive', () => {
      expect(present('d')).toBe('stub');
      expect(present('q')).toBe('readonly');
      expect(msgs().some((m) => isInteractive(m, h.rec.state()))).toBe(false);
      // The status changes the reload made are handed to persistence.
      const last = h.changes[h.changes.length - 1]!;
      expect(last.next.messages.map((m) => m.status)).toEqual(['abandoned', 'resolved']);
    });
  });

  test('The session day key survives midnight', ({ given, when, then }) => {
    const clock = { t: new Date(2026, 9, 5, 23, 50).getTime() };
    given('a recorder whose session started at 23:50', () => {
      h = setup({ clock });
      h.rec.load([], 1);
    });
    when('messages are recorded before and after midnight', () => {
      h.rec.recordXavier(receipt(), { logged: true });
      clock.t = new Date(2026, 9, 6, 0, 20).getTime();
      h.rec.recordUser('another');
      h.rec.recordXavier(receipt(), { logged: true });
    });
    then("every message carries the session's day and the saves all count for it", () => {
      expect(new Set(msgs().map((m) => m.dayKey))).toEqual(new Set(['2026-10-05']));
      expect(msgs().map((m) => m.seq)).toEqual([1, 2, 3]);
      expect(loggedTodayCount(h.rec.state(), '2026-10-05')).toBe(2);
    });
  });

  test('Reset starts a fresh day', ({ given, when, then }) => {
    given('a loaded recorder', loaded);
    when('messages are recorded, the chat is reset for a new day, and a message follows', () => {
      h.rec.recordUser('old news');
      h.rec.recordXavier(textBubble('Old reply.'));
      h.rec.reset('2026-10-06');
      h.rec.recordUser('fresh start');
    });
    then('only the new message should remain, on the new day, with seq 1', () => {
      expect(msgs().map((m) => [m.kind, m.dayKey, m.seq])).toEqual([['user_text', '2026-10-06', 1]]);
      expect(h.rec.sessionDayKey()).toBe('2026-10-06');
    });
  });

  test('The day key passed to load is the one used even when the clock moved on', ({ given, when, then }) => {
    given('a recorder that has not loaded yet', () => {
      h = setup({ clock: { t: new Date(2026, 9, 6, 0, 1).getTime() } });
    });
    when(/^load is given the day "(.*)" while the clock already reads the next day$/, (day: string) => {
      h.rec.load([], 1, day);
      h.rec.recordUser('hello');
    });
    then(/^messages carry "(.*)"$/, (day: string) => {
      expect(msgs().map((m) => m.dayKey)).toEqual([day]);
    });
  });

  test('The idle greeting is never recorded', ({ given, when, then }) => {
    given('a loaded recorder', loaded);
    when('Xavier says the idle greeting', () => {
      h.rec.recordXavier(textBubble(GREETING));
    });
    then('nothing should be recorded', () => expect(msgs()).toHaveLength(0));
  });

  test('A failing reducer or writer never throws into the caller', ({ given, when, then }) => {
    let thrown: unknown;
    given('a recorder whose persistence throws', () => {
      h = setup({ throwOnChange: true });
      h.rec.load([], 1);
    });
    when('the user sends a message', () => {
      try {
        h.rec.recordUser('coffee 4');
      } catch (e) {
        thrown = e;
      }
    });
    then(/^the call should not throw and the code "(.*)" should be reported$/, (code: string) => {
      expect(thrown).toBeUndefined();
      expect(h.warnings).toContain(code);
      expect(JSON.stringify(h.warnings)).not.toContain('SECRET');
    });
  });
});

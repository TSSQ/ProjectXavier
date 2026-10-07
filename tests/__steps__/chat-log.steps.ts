import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  CardBody,
  ChatAction,
  ChatBody,
  ChatLogState,
  EMPTY_CHAT_LOG,
  chatLogReducer,
  diffChatLog,
  isInteractive,
  loggedTodayCount,
  presentationOf,
} from '../../src/domain/chatLog';
import { dismissTextFor, stubTextFor } from '../../src/domain/chatCopy';
import { ChatMessage, chatMessageSchema, ChatKind } from '../../src/domain/chatMessage';
import { CHAT_FIXTURES } from '../support/chatFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-log.feature'));

let counter = 0;
const T0 = new Date(2026, 9, 5, 10, 0).getTime();
const stamp = () => {
  counter += 1;
  return { id: `id-${counter}`, now: T0 + counter * 1000 };
};

const fixture = (kind: ChatKind, tool?: string): ChatBody => {
  const f = CHAT_FIXTURES.find(
    (m) => m.kind === kind && (tool === undefined || (m.kind === 'query_answer' && m.payload.tool === tool))
  )!;
  return { kind: f.kind, payload: f.payload } as ChatBody;
};
const card = (kind: ChatKind): CardBody => fixture(kind) as CardBody;
const text = (t: string): ChatBody => ({ kind: 'xavier_text', payload: { text: t } });
const user = (t: string): ChatBody => ({ kind: 'user_text', payload: { text: t } });
const receipt = (logged = false): ChatBody => ({
  kind: 'xavier_receipt',
  payload: { headline: 'Saved SGD 18.00 to Transport.', lines: [], ...(logged && { logged: true }) },
});

defineFeature(feature, (test) => {
  let state: ChatLogState = EMPTY_CHAT_LOG;
  const run = (...actions: ChatAction[]) => {
    for (const a of actions) state = chatLogReducer(state, a);
  };
  const addCard = (body: CardBody, dataRevision: number | null = 1): string => {
    const s = stamp();
    run({ type: 'card', stamp: s, body, dataRevision });
    return s.id;
  };
  const say = (body: ChatBody) => {
    const s = stamp();
    run({ type: body.kind.startsWith('user') ? 'user' : 'xavier', stamp: s, body } as ChatAction);
    return s.id;
  };
  const msg = (id: string) => state.messages.find((m) => m.id === id)!;
  const emptyChat = () => {
    state = EMPTY_CHAT_LOG;
  };

  test('Messages append in order with a sequence per day', ({ given, when, then }) => {
    given('an empty chat', emptyChat);
    when('the user says something, Xavier replies and a receipt follows', () => {
      say(user('coffee 4'));
      say(text('Got it.'));
      say(receipt());
    });
    then('the log should read user, xavier text, receipt with seq 1, 2, 3', () => {
      expect(state.messages.map((m) => [m.kind, m.seq])).toEqual([
        ['user_text', 1],
        ['xavier_text', 2],
        ['xavier_receipt', 3],
      ]);
      state.messages.forEach((m) => expect(chatMessageSchema.safeParse(m).success).toBe(true));
    });
  });

  test('Resolving a card hides it and appends its receipt', ({ given, when, then, and }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a draft card appears and is resolved with a receipt', () => {
      id = addCard(card('draft'));
      run({ type: 'resolve', cardId: id, then: { stamp: stamp(), body: receipt(true) as never } });
    });
    then('the draft should be hidden and the receipt should follow it', () => {
      expect(presentationOf(msg(id), state)).toBe('hidden');
      expect(state.messages.map((m) => m.kind)).toEqual(['draft', 'xavier_receipt']);
    });
    and('nothing should be interactive', () => {
      expect(state.messages.some((m) => isInteractive(m, state))).toBe(false);
    });
  });

  test('A new user message abandons the live card into a stub', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a draft card appears and the user sends another message', () => {
      id = addCard(card('draft'));
      say(user('actually, lunch 12'));
    });
    then(/^the draft should show the stub "(.*)"$/, (stub: string) => {
      expect(presentationOf(msg(id), state)).toBe('stub');
      expect(stubTextFor(msg(id))).toBe(stub);
    });
  });

  test('A revision change marks the matching cards stale', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a set-budget card built at revision 3 sits live and the revision moves to 4', () => {
      id = addCard(card('set_budget'), 3);
      run({ type: 'stale', currentRevision: 4, kinds: ['set_budget'] });
    });
    then(/^the card should show the stub "(.*)"$/, (stub: string) => {
      expect(msg(id).status).toBe('stale');
      expect(stubTextFor(msg(id))).toBe(stub);
    });
  });

  test('A revision change leaves cards the screen does not drop', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a draft card built at revision 3 sits live and the budget-card revision check runs for 4', () => {
      id = addCard(card('draft'), 3);
      run({ type: 'stale', currentRevision: 4, kinds: ['afford', 'afford_pick', 'set_budget', 'tx_picker'] });
    });
    then('the draft should still be live', () => expect(msg(id).status).toBe('live'));
  });

  test('Only the newest card is interactive', ({ given, when, then, and }) => {
    let pick = '';
    let afford = '';
    given('an empty chat', emptyChat);
    when('a pick card and then an afford card appear', () => {
      pick = addCard(card('afford_pick'));
      afford = addCard(card('afford'));
    });
    then('only the afford card should be interactive', () => {
      expect(isInteractive(msg(afford), state)).toBe(true);
      expect(isInteractive(msg(pick), state)).toBe(false);
    });
    and(/^the pick card should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(msg(pick))).toBe(stub);
    });
  });

  test('A query answer stays as history and is interactive only while newest', ({ given, when, then, and }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a query answer appears and the user asks something else', () => {
      id = addCard(card('query_answer'));
      say(user('and last month?'));
    });
    then('the answer should be read-only and not interactive', () => {
      expect(presentationOf(msg(id), state)).toBe('readonly');
      expect(isInteractive(msg(id), state)).toBe(false);
    });
    and('it should have no stub', () => expect(stubTextFor(msg(id))).toBeNull());
  });

  test('A newest query answer can be dismissed', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a query answer appears', () => {
      id = addCard(card('query_answer'));
    });
    then('it should be live and interactive', () => {
      expect(presentationOf(msg(id), state)).toBe('live');
      expect(isInteractive(msg(id), state)).toBe(true);
    });
  });

  test('Stub wording per card kind', ({ then }) => {
    then(
      /^the "(.*)" card abandoned reads "(.*)" and stale reads "(.*)"$/,
      (kind: string, abandoned: string, stale: string) => {
        const base = CHAT_FIXTURES.find((m) => m.kind === kind)!;
        const m = (status: ChatMessage['status']) => ({ ...base, seq: 1, status }) as ChatMessage;
        expect(stubTextFor(m('abandoned'))).toBe(abandoned);
        expect(stubTextFor(m('stale'))).toBe(stale);
        expect(stubTextFor(m('live'))).toBeNull();
        expect(stubTextFor(m('resolved'))).toBeNull();
      }
    );
  });

  test('Other drafts and pickers have their own words', ({ then, and }) => {
    const as = (kind: ChatKind, patch: Record<string, unknown>) => {
      const base = CHAT_FIXTURES.find((m) => m.kind === kind)!;
      return {
        ...base,
        seq: 1,
        status: 'abandoned',
        payload: { ...(base.payload as object), ...patch },
      } as ChatMessage;
    };
    then(
      /^an income draft reads "(.*)", a transfer draft "(.*)" and an update picker "(.*)"$/,
      (income: string, transfer: string, update: string) => {
        expect(stubTextFor(as('draft', { type: 'income' }))).toBe(income);
        expect(stubTextFor(as('draft', { type: 'transfer' }))).toBe(transfer);
        expect(stubTextFor(as('tx_picker', { op: 'update' }))).toBe(update);
      }
    );
    and('a query answer and plain messages never stub', () => {
      for (const m of CHAT_FIXTURES.filter((f) =>
        ['query_answer', 'user_text', 'user_photo', 'xavier_text', 'xavier_receipt'].includes(f.kind)
      )) {
        expect(stubTextFor({ ...m, seq: 1, status: 'abandoned' } as ChatMessage)).toBeNull();
        expect(stubTextFor({ ...m, seq: 1, status: 'stale' } as ChatMessage)).toBeNull();
      }
    });
  });

  test("Dismissing a card stubs it and appends Xavier's line", ({ given, when, then, and }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a draft card appears and is dismissed', () => {
      id = addCard(card('draft'));
      run({ type: 'dismiss', cardId: id, stamp: stamp(), text: dismissTextFor('draft') });
    });
    then(/^the draft should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(msg(id))).toBe(stub);
    });
    and(/^Xavier should say "(.*)"$/, (line: string) => {
      const last = state.messages[state.messages.length - 1]!;
      expect(last.kind === 'xavier_text' && last.payload.text).toBe(line);
    });
  });

  test('Dismissing an account update says it was left as it was', ({ given, when, then }) => {
    given('an empty chat', emptyChat);
    when('an account update card appears and is dismissed', () => {
      const update = addCard(card('account_update'));
      run({ type: 'dismiss', cardId: update, stamp: stamp(), text: dismissTextFor('account_update') });
    });
    then(/^Xavier should say "(.*)"$/, (line: string) => {
      const last = state.messages[state.messages.length - 1]!;
      expect(last.kind === 'xavier_text' && last.payload.text).toBe(line);
    });
  });

  test('A stale-draft explanation stubs the card as out of date', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a draft card appears and is expired', () => {
      id = addCard(card('draft'));
      run({ type: 'expire', cardId: id });
    });
    then(/^the draft should show the stub "(.*)"$/, (stub: string) => {
      expect(presentationOf(msg(id), state)).toBe('stub');
      expect(stubTextFor(msg(id))).toBe(stub);
    });
  });

  test('The last-resort abandon stubs every live card and never resolves', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a draft card appears and the screen abandons its live cards', () => {
      id = addCard(card('draft'));
      run({ type: 'abandon_live' });
    });
    then(/^the draft should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(msg(id))).toBe(stub);
    });
  });

  test('Dismissing a query answer is not a discard', ({ given, when, then }) => {
    let id = '';
    let count = 0;
    given('an empty chat', emptyChat);
    when('a query answer appears and is dismissed', () => {
      id = addCard(card('query_answer'));
      count = state.messages.length;
      run({ type: 'dismiss', cardId: id, stamp: stamp() });
    });
    then('it should be read-only with no stub and no line appended', () => {
      expect(presentationOf(msg(id), state)).toBe('readonly');
      expect(stubTextFor(msg(id))).toBeNull();
      expect(state.messages).toHaveLength(count);
    });
  });

  test('A receipt is appended even when its card had already ended', ({ given, when, then }) => {
    given('an empty chat', emptyChat);
    when('a draft card is abandoned by a new message and then its save is resolved with a receipt', () => {
      const id = addCard(card('draft'));
      say(user('lunch 12'));
      run({ type: 'resolve', cardId: id, then: { stamp: stamp(), body: receipt(true) as never } });
    });
    then('the receipt should still follow', () => {
      expect(state.messages.map((m) => m.kind)).toEqual(['draft', 'user_text', 'xavier_receipt']);
    });
  });

  const stored = (revision: number | null, id = 'stored-1', seq = 1): ChatMessage =>
    ({ ...CHAT_FIXTURES.find((m) => m.kind === 'draft')!, id, seq, status: 'live', dataRevision: revision }) as ChatMessage;

  test('A live card reloaded at the same revision is a stub, not interactive', ({ when, then, and }) => {
    when(/^today's stored log with a live draft at revision (\d+) loads at revision (\d+)$/, (a: string, b: string) => {
      state = chatLogReducer(EMPTY_CHAT_LOG, { type: 'load', messages: [stored(Number(a))], currentRevision: Number(b) });
    });
    then(/^the draft should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(state.messages[0]!)).toBe(stub);
    });
    and('nothing should be interactive', () => {
      expect(state.messages.some((m) => isInteractive(m, state))).toBe(false);
    });
  });

  test('A live card reloaded at a newer revision is stale', ({ when, then }) => {
    when(/^today's stored log with a live draft at revision (\d+) loads at revision (\d+)$/, (a: string, b: string) => {
      state = chatLogReducer(EMPTY_CHAT_LOG, { type: 'load', messages: [stored(Number(a))], currentRevision: Number(b) });
    });
    then(/^the draft should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(state.messages[0]!)).toBe(stub);
    });
  });

  test('A stored live query answer reloads as read-only history', ({ when, then }) => {
    when("today's stored log with a live query answer loads", () => {
      const answer = {
        ...CHAT_FIXTURES.find((m) => m.kind === 'query_answer')!,
        id: 'q',
        seq: 1,
        status: 'live',
        dataRevision: 5,
      } as ChatMessage;
      state = chatLogReducer(EMPTY_CHAT_LOG, { type: 'load', messages: [answer], currentRevision: 5 });
    });
    then('the answer should be read-only and nothing should be interactive', () => {
      expect(presentationOf(state.messages[0]!, state)).toBe('readonly');
      expect(state.messages.some((m) => isInteractive(m, state))).toBe(false);
    });
  });

  test('Nothing reloads as interactive', ({ when, then }) => {
    when('a stored log with two live cards loads at their revision', () => {
      state = chatLogReducer(EMPTY_CHAT_LOG, {
        type: 'load',
        messages: [stored(2, 'old', 1), stored(2, 'new', 2)],
        currentRevision: 2,
      });
    });
    then('no card should be live', () => {
      expect(state.messages.map((m) => m.status)).toEqual(['abandoned', 'abandoned']);
    });
  });

  test('An unstored tail makes every stored card non-interactive', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a draft card appears and a tail is active', () => {
      id = addCard(card('draft'));
    });
    then('the draft should not be interactive and should be read-only', () => {
      expect(isInteractive(msg(id), state)).toBe(true);
      expect(isInteractive(msg(id), state, { tailActive: true })).toBe(false);
      expect(presentationOf(msg(id), state, { tailActive: true })).toBe('readonly');
    });
  });

  const queueBody = (saved: number): CardBody => ({
    kind: 'statement_queue',
    payload: { total: 8, saved, skipped: 0, accountName: 'DBS Card' },
  });

  test('A statement queue is one live card that ends in its summary', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a queue card appears, two rows are confirmed, and it finishes with a summary', () => {
      id = addCard(queueBody(0));
      say(receipt(true));
      run({ type: 'update', cardId: id, payload: queueBody(1).payload });
      say(receipt(true));
      run({ type: 'update', cardId: id, payload: queueBody(2).payload });
      say(text('Saved 2 of 8 from your statement, 6 skipped.'));
      run({ type: 'resolve', cardId: id, payload: queueBody(2).payload });
    });
    then('the queue should be hidden, two receipts and the summary should follow, and nothing is interactive', () => {
      expect(presentationOf(msg(id), state)).toBe('hidden');
      expect(state.messages.map((m) => m.kind)).toEqual([
        'statement_queue',
        'xavier_receipt',
        'xavier_receipt',
        'xavier_text',
      ]);
      expect(state.messages.some((m) => isInteractive(m, state))).toBe(false);
    });
  });

  test('Leaving a statement queue midway leaves a stub', ({ given, when, then }) => {
    let id = '';
    given('an empty chat', emptyChat);
    when('a queue card appears, advances to 2 of 8 saved, and the user sends another message', () => {
      id = addCard(queueBody(0));
      run({ type: 'update', cardId: id, payload: queueBody(2).payload });
      say(user('never mind'));
    });
    then(/^the queue should show the stub "(.*)"$/, (stub: string) => {
      expect(stubTextFor(msg(id))).toBe(stub);
    });
  });

  test('The account Q&A is bubbles in turn', ({ given, when, then }) => {
    given('an empty chat', emptyChat);
    when('Xavier asks a question and the user answers', () => {
      say(text('What should I call it?'));
      say(user('Trip'));
    });
    then('the log should read xavier text then user text', () => {
      expect(state.messages.map((m) => [m.role, m.kind])).toEqual([
        ['xavier', 'xavier_text'],
        ['user', 'user_text'],
      ]);
    });
  });

  test('The header counts only transactions saved from the chat today', ({ given, then }) => {
    given('a chat with saves for today, for yesterday and non-saves', () => {
      state = EMPTY_CHAT_LOG;
      run({
        type: 'xavier',
        stamp: { id: 'y', now: new Date(2026, 9, 4, 23, 0).getTime() },
        body: receipt(true) as never,
      });
      say(receipt(true));
      say({ kind: 'xavier_text', payload: { text: 'Saved.', logged: true } });
      say({ kind: 'xavier_text', payload: { text: 'Every Friday: SGD 9.00.', logged: true } });
      say(receipt(false));
      say(text('Saved.'));
    });
    then('the count for today should be 3', () => {
      expect(loggedTodayCount(state, '2026-10-05')).toBe(3);
      expect(loggedTodayCount(state, '2026-10-04')).toBe(1);
    });
  });

  test('An edit to a live card updates its payload and revision', ({ given, when, then }) => {
    let before: ChatLogState;
    let id = '';
    given('an empty chat', emptyChat);
    when('a draft card is edited', () => {
      id = addCard(card('draft'), 1);
      before = state;
      const edited = { ...(card('draft').payload as object), amount: 9900 } as CardBody['payload'];
      run({ type: 'update', cardId: id, payload: edited, dataRevision: 2 });
    });
    then('its payload and revision should change and the diff should say so', () => {
      expect(msg(id).dataRevision).toBe(2);
      expect((msg(id).payload as { amount: number }).amount).toBe(9900);
      expect(diffChatLog(before, state).contentChanged.map((m) => m.id)).toEqual([id]);
    });
  });

  test('The diff names what to write', ({ given, when, then }) => {
    let start: ChatLogState;
    let afterAdd: ChatLogState;
    let id = '';
    given('an empty chat', emptyChat);
    when('a card is added and later resolved', () => {
      start = state;
      id = addCard(card('draft'));
      afterAdd = state;
      run({ type: 'resolve', cardId: id });
    });
    then('the diff should list one added message and then one status change', () => {
      expect(diffChatLog(start, afterAdd).added.map((m) => m.id)).toEqual([id]);
      expect(diffChatLog(afterAdd, state)).toEqual({
        added: [],
        statusChanged: [{ id, status: 'resolved' }],
        contentChanged: [],
      });
    });
  });
});

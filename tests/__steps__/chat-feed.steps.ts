import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { ChatLogState } from '../../src/domain/chatLog';
import { ChatMessage } from '../../src/domain/chatMessage';
import {
  FeedRow,
  Tail,
  TailInput,
  buildFeedRows,
  computeTail,
  isNearBottom,
  arrivalsSince,
  batchEvent,
  layoutPhase,
  pillStillNeeded,
  scrollDecision,
} from '../../src/domain/chatFeed';
import { CHAT_FIXTURES } from '../support/chatFixture';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chat-feed.feature'));

const fixture = (kind: string, status: ChatMessage['status'] = 'live'): ChatMessage =>
  ({
    ...CHAT_FIXTURES.find((m) => m.kind === kind)!,
    status,
    id: `${kind}-${status}`,
    seq: 0,
  }) as ChatMessage;
const day = (...ms: ChatMessage[]): ChatLogState => ({
  messages: ms.map((m, i) => ({ ...m, seq: i + 1 })),
});

const NO_TAIL: TailInput = {
  busy: false,
  hasLiveCard: false,
  accountFlowStep: null,
  fmRefusal: false,
  budgetHint: false,
};
const SITUATIONS: Record<string, Partial<TailInput>> = {
  'nothing going on': {},
  'parsing with no card': { busy: true },
  'parsing with a card on screen': { busy: true, hasLiveCard: true },
  'the account Q&A on its subtype step': { accountFlowStep: 'subtype' },
  'the account Q&A on its name step': { accountFlowStep: 'name' },
  'the FM refusal card': { fmRefusal: true },
  'the no-budgets reply': { budgetHint: true },
  'an afford card reply': { budgetHint: false },
};
const describeTail = (t: Tail) =>
  t.thinking
    ? 'thinking'
    : t.subtypeChips
      ? 'chips'
      : t.accountProgress
        ? 'progress'
        : t.fmRefusal
          ? 'refusal'
          : t.budgetHint
            ? 'budget hint'
            : 'inactive';

defineFeature(feature, (test) => {
  let state: ChatLogState;
  let rows: FeedRow[];
  let tail: Tail;
  let action: string;

  const days: Record<string, () => ChatLogState> = {
    'a day with a user message, a Xavier message and a stubbed draft': () =>
      day(fixture('user_text'), fixture('xavier_text'), fixture('draft', 'abandoned')),
    'a day with a resolved draft and a query answer': () =>
      day(fixture('draft', 'resolved'), fixture('query_answer', 'resolved')),
    'a day with a live draft followed by nothing': () => day(fixture('draft')),
    "a day with a live query answer, then the screen's card": () => day(fixture('query_answer')),
    'a day with a user message only': () => day(fixture('user_text')),
    'a day with a live tx picker': () => day(fixture('tx_picker')),
    'a day with a live queue followed by three receipts': () =>
      day(
        fixture('statement_queue'),
        fixture('xavier_receipt', 'resolved'),
        { ...fixture('xavier_receipt', 'resolved'), id: 'r2' },
        { ...fixture('xavier_receipt', 'resolved'), id: 'r3' }
      ),
  };
  const builds = (pattern: string, live: boolean, tailActive: boolean) => ({
    pattern,
    run: () => {
      rows = buildFeedRows(state, { hasLiveCard: live, tailActive });
    },
  });

  const rowKinds = () => rows.map((r) => r.type).join(', ');

  test('Messages keep their order, each as its own kind of row', ({ given, when, then }) => {
    given(/^a day with a user message, a Xavier message and a stubbed draft$/, () => {
      state = days['a day with a user message, a Xavier message and a stubbed draft']!();
    });
    when('the feed rows are built with no live card and no tail', () => builds('', false, false).run());
    then(/^the rows should be "(.*)" in order$/, (expected: string) => expect(rowKinds()).toBe(expected));
  });

  test('The stub row carries its wording', ({ given, when, then }) => {
    given(/^a day with a user message, a Xavier message and a stubbed draft$/, () => {
      state = days['a day with a user message, a Xavier message and a stubbed draft']!();
    });
    when('the feed rows are built with no live card and no tail', () => builds('', false, false).run());
    then('the stub row text should not be empty', () => {
      const stub = rows.find((r) => r.type === 'stub');
      expect(stub && stub.type === 'stub' && stub.text.length).toBeGreaterThan(0);
    });
  });

  const rowsScenario = (
    name: string,
    givenText: string,
    whenText: string,
    live: boolean,
    tailActive: boolean
  ) =>
    test(name, ({ given, when, then }) => {
      given(givenText, () => {
        state = days[givenText]!();
      });
      when(whenText, () => builds('', live, tailActive).run());
      then(/^the rows should be "(.*)" in order$/, (expected: string) => expect(rowKinds()).toBe(expected));
    });

  rowsScenario(
    'A resolved non-query card draws nothing, a query answer stays as history',
    'a day with a resolved draft and a query answer',
    'the feed rows are built with no live card and no tail',
    false,
    false
  );
  rowsScenario(
    'The live row is the card the log holds, drawn once',
    'a day with a live draft followed by nothing',
    'the feed rows are built with a live card and no tail',
    true,
    false
  );
  rowsScenario(
    'The live row sits at the newest end, after every stored row',
    'a day with a live queue followed by three receipts',
    'the feed rows are built with a live card and no tail',
    true,
    false
  );
  rowsScenario(
    'A card the log never recorded still appears, at the end',
    'a day with a user message only',
    'the feed rows are built with a live card and no tail',
    true,
    false
  );
  rowsScenario(
    'A log-live card the screen is not showing is its stub, never nothing',
    'a day with a live draft followed by nothing',
    'the feed rows are built with no live card and no tail',
    false,
    false
  );
  rowsScenario(
    'An active tail leaves a stored live card as its stub',
    'a day with a live draft followed by nothing',
    'the feed rows are built with no live card and an active tail',
    false,
    true
  );
  rowsScenario(
    'A query answer the screen is not showing stays as an answer',
    "a day with a live query answer, then the screen's card",
    'the feed rows are built with no live card and no tail',
    false,
    false
  );

  rowsScenario(
    'A tx picker on its which-account step stays the live row, never a stub',
    'a day with a live tx picker',
    'the feed rows are built with a live card and no tail',
    true,
    false
  );

  test('What the tail shows', ({ when, then }) => {
    when(/^the tail is computed for (.*)$/, (situation: string) => {
      tail = computeTail({ ...NO_TAIL, ...SITUATIONS[situation] });
    });
    then(/^the tail should be (.*)$/, (shown: string) => {
      expect(describeTail(tail)).toBe(shown);
      expect(tail.active).toBe(shown !== 'inactive');
    });
  });

  test('Scroll decision', ({ when, then }) => {
    when(/^a (.*) arrives while the user is (.*)$/, (event: string, where: string) => {
      action = scrollDecision(event as 'sent' | 'incoming', where === 'near the end');
    });
    then(/^the feed should (.*)$/, (expected: string) =>
      expect(action).toBe(expected === 'show the pill' ? 'pill' : 'scroll')
    );
  });

  test('The pill leaves once the user is back at the bottom', ({ then }) => {
    then('the pill should stay while scrolled up and go when near the bottom', () => {
      expect(pillStillNeeded(true, false)).toBe(true);
      expect(pillStillNeeded(true, true)).toBe(false);
      expect(pillStillNeeded(false, false)).toBe(false);
    });
  });

  test('Near the bottom is a distance threshold', ({ then, and }) => {
    then(
      /^(\d+) points from the newest end with a threshold of (\d+) should be near the bottom$/,
      (d: string, t: string) => expect(isNearBottom(Number(d), Number(t))).toBe(true)
    );
    and(
      /^(\d+) points from the newest end with a threshold of (\d+) should not be near the bottom$/,
      (d: string, t: string) => expect(isNearBottom(Number(d), Number(t))).toBe(false)
    );
  });

  test('A batch with a user message counts as sent', ({ then }) => {
    then(
      'an empty batch is nothing, a user and Xavier message together are sent, and Xavier alone is incoming',
      () => {
        expect(batchEvent({ messages: [] }, 0)).toBeNull();
        const both = day(fixture('xavier_text'), fixture('user_text'), {
          ...fixture('xavier_text'),
          id: 'x2',
        });
        expect(batchEvent(both, 1)).toBe('sent');
        expect(batchEvent(both, 3)).toBeNull();
        expect(batchEvent(both, 2)).toBe('incoming');
      }
    );
  });

  test("A user message and Xavier's reply added together scroll even when scrolled up", ({ then }) => {
    then('a user message and a Xavier reply added together while scrolled up should scroll', () => {
      const before = day(fixture('xavier_text'));
      const after = day(fixture('xavier_text'), fixture('user_text'), {
        ...fixture('xavier_text'),
        id: 'x2',
      });
      const event = batchEvent(after, before.messages.length);
      expect(scrollDecision(event!, false)).toBe('scroll');
    });
  });

  test('Which layout shows', ({ when, then }) => {
    let phase = '';
    const quiet = { thinking: false, accountProgress: false, fmRefusal: false, budgetHint: false };
    const STATES: Record<string, Parameters<typeof layoutPhase>[0]> = {
      'not yet loaded, no messages': { loaded: false, messageCount: 0, hasLiveCard: false, tail: quiet },
      'not yet loaded, with rows': { loaded: false, messageCount: 4, hasLiveCard: false, tail: quiet },
      'loaded, empty day': { loaded: true, messageCount: 0, hasLiveCard: false, tail: quiet },
      'loaded, one message': { loaded: true, messageCount: 1, hasLiveCard: false, tail: quiet },
      'loaded, a live card only': { loaded: true, messageCount: 0, hasLiveCard: true, tail: quiet },
      'loaded, thinking only': {
        loaded: true,
        messageCount: 0,
        hasLiveCard: false,
        tail: { ...quiet, thinking: true },
      },
    };
    when(/^the layout is chosen for (.*)$/, (name: string) => {
      phase = layoutPhase(STATES[name]!);
    });
    then(/^the phase should be (.*)$/, (expected: string) => expect(phase).toBe(expected));
  });

  test('The first look after the load is not an arrival', ({ then }) => {
    then('the first look reports no event and no announcements, and the next look reports both', () => {
      const stored = day(fixture('user_text'), fixture('xavier_text'));
      expect(arrivalsSince(stored, 0, true)).toEqual({ event: null, xavier: [] });
      const more = day(fixture('user_text'), fixture('xavier_text'), { ...fixture('xavier_text'), id: 'x2' });
      const next = arrivalsSince(more, 2, false);
      expect(next.event).toBe('incoming');
      expect(next.xavier.map((m) => m.id)).toEqual(['x2']);
    });
  });

  test('Every Xavier message in a batch is announced, whatever else arrived', ({ then }) => {
    then('a user message with two Xavier messages announces both Xavier messages', () => {
      const batch = day(
        fixture('user_text'),
        { ...fixture('xavier_text'), id: 'x1' },
        { ...fixture('xavier_text'), id: 'x2' }
      );
      const got = arrivalsSince(batch, 0, false);
      expect(got.event).toBe('sent');
      expect(got.xavier.map((m) => m.id)).toEqual(['x1', 'x2']);
    });
  });
});

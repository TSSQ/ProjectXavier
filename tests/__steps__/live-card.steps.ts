import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  LIVE_KINDS,
  LiveCard,
  LiveKind,
  ScreenCards,
  liveCardOf,
  liveCardProblem,
} from '../../src/domain/liveCard';
import { ChatCardKind } from '../../src/domain/chatMessage';

const feature = loadFeature(path.resolve(__dirname, '../__features__/live-card.feature'));

type V = Record<LiveKind, string>;
const none = (): ScreenCards<V> =>
  Object.fromEntries(LIVE_KINDS.map((k) => [k, null])) as unknown as ScreenCards<V>;
const only = (...kinds: LiveKind[]): ScreenCards<V> => {
  const s = none() as Record<LiveKind, string | null>;
  kinds.forEach((k) => (s[k] = `${k}-value`));
  return s as ScreenCards<V>;
};

defineFeature(feature, (test) => {
  let screen = none();
  let options: { budgetReplyStored?: boolean } = {};
  let card: LiveCard<V> | null = null;
  let problem: string | null = null;
  const recompute = (logKind: ChatCardKind | null = null) => {
    card = liveCardOf(screen, options);
    problem = liveCardProblem(screen, options, logKind);
  };
  const noLive = () => expect(card).toBeNull();

  test('Nothing set means no live card', ({ when, then }) => {
    when('no flow is set', () => {
      screen = none();
      recompute();
    });
    then('there should be no live card', noLive);
  });

  test('A single flow is the live card', ({ when, then }) => {
    when(/^only the (.*) flow is set$/, (flow: string) => {
      screen = only(flow as LiveKind);
      recompute();
    });
    then(/^the live card should be (.*)$/, (flow: string) => {
      expect(card?.kind).toBe(flow);
      expect(card?.value).toBe(`${flow}-value`);
    });
  });

  test('A budget reply is live only when the log stores it', ({ when, then }) => {
    when('a budget reply is set that is stored', () => {
      screen = only('budget');
      options = { budgetReplyStored: true };
      recompute();
    });
    then('the live card should be budget', () => expect(card?.kind).toBe('budget'));
    when('a budget reply is set that is not stored', () => {
      options = { budgetReplyStored: false };
      recompute();
    });
    then('there should be no live card', noLive);
  });

  test('The tx picker stays live through its account question', ({ when, then }) => {
    when('a tx picker is set', () => {
      screen = only('tx_picker');
      options = {};
      recompute();
    });
    then(/^the live card should be (.*)$/, (flow: string) => expect(card?.kind).toBe(flow));
  });

  test('Two flows set at once pick one by precedence and are reported', ({ when, then, and }) => {
    when('a query answer and an account create are both set', () => {
      screen = only('query_answer', 'account_create');
      options = {};
      recompute('account_create');
    });
    then(/^the live card should be (.*)$/, (flow: string) => expect(card?.kind).toBe(flow));
    and(/^the problem should say (.*)$/, (text: string) => expect(problem).toContain(text));
  });

  test("The log's newest live card must be of the screen card's kind", ({ when, then }) => {
    when("a draft is set and the log's newest live card is an account_create", () => {
      screen = only('draft');
      options = {};
      recompute('account_create');
    });
    then(/^the problem should say (.*)$/, (text: string) => expect(problem).toContain(text));
    when("a draft is set and the log's newest live card is a statement_queue", () =>
      recompute('statement_queue')
    );
    then('there should be no problem', () => expect(problem).toBeNull());
  });

  test('A live card the screen is not showing is reported', ({ when, then }) => {
    when("no flow is set and the log's newest live card is a draft", () => {
      screen = none();
      options = {};
      recompute('draft');
    });
    then(/^the problem should say (.*)$/, (text: string) => expect(problem).toContain(text));
  });
});

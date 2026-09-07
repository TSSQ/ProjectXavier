import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { replySettleRule, ReplySettleRule } from '../../src/domain/replySettle';
import { AssistantOutcomeKind } from '../../src/domain/avatar';

const feature = loadFeature(path.resolve(__dirname, '../__features__/reply-settle.feature'));

defineFeature(feature, (test) => {
  let outcome: AssistantOutcomeKind;
  let cardOwnsScreen: boolean;
  let rule: ReplySettleRule;

  beforeEach(() => {
    cardOwnsScreen = false;
  });

  const compute = () => {
    rule = replySettleRule({ outcome, cardOwnsScreen });
  };

  const givenOutcome = (given: any) =>
    given(/^the last outcome is "(.*)"$/, (raw: string) => {
      outcome = raw === 'none' ? null : (raw as AssistantOutcomeKind);
    });

  const givenCardOwns = (and: any) =>
    and(/^a card flow owns the screen$/, () => {
      cardOwnsScreen = true;
    });

  test('A save settles at 5s and takes the reply with it', ({ given, then, and }) => {
    givenOutcome(given);
    then(/^it should settle$/, () => {
      compute();
      expect(rule.settles).toBe(true);
    });
    and(/^it should settle after 5000ms$/, () => expect(rule.delayMs).toBe(5000));
    and(/^it should reset the reply$/, () => expect(rule.resetsReply).toBe(true));
  });

  test('Spending money settles the same way as saving', ({ given, then, and }) => {
    givenOutcome(given);
    then(/^it should settle$/, () => {
      compute();
      expect(rule.settles).toBe(true);
    });
    and(/^it should settle after 5000ms$/, () => expect(rule.delayMs).toBe(5000));
    and(/^it should reset the reply$/, () => expect(rule.resetsReply).toBe(true));
  });

  test('An error settles at 4s but keeps its text', ({ given, then, and }) => {
    givenOutcome(given);
    then(/^it should settle$/, () => {
      compute();
      expect(rule.settles).toBe(true);
    });
    and(/^it should settle after 4000ms$/, () => expect(rule.delayMs).toBe(4000));
    and(/^it should not reset the reply$/, () => expect(rule.resetsReply).toBe(false));
  });

  test('A clarifying question settles at 4s but keeps its text', ({ given, then, and }) => {
    givenOutcome(given);
    then(/^it should settle$/, () => {
      compute();
      expect(rule.settles).toBe(true);
    });
    and(/^it should settle after 4000ms$/, () => expect(rule.delayMs).toBe(4000));
    and(/^it should not reset the reply$/, () => expect(rule.resetsReply).toBe(false));
  });

  test('No outcome never settles', ({ given, then }) => {
    givenOutcome(given);
    then(/^it should not settle$/, () => {
      compute();
      expect(rule.settles).toBe(false);
    });
  });

  test('A save while a card owns the screen settles the face but not the text', ({
    given,
    and,
    then,
  }) => {
    givenOutcome(given);
    givenCardOwns(and);
    then(/^it should settle$/, () => {
      compute();
      expect(rule.settles).toBe(true);
    });
    and(/^it should settle after 5000ms$/, () => expect(rule.delayMs).toBe(5000));
    and(/^it should not reset the reply$/, () => expect(rule.resetsReply).toBe(false));
  });

  test('Spending while a card owns the screen keeps its text too', ({ given, and, then }) => {
    givenOutcome(given);
    givenCardOwns(and);
    then(/^it should settle$/, () => {
      compute();
      expect(rule.settles).toBe(true);
    });
    and(/^it should not reset the reply$/, () => expect(rule.resetsReply).toBe(false));
  });
});
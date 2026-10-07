import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { replySettleRule, ReplySettleRule } from '../../src/domain/replySettle';
import { AssistantOutcomeKind } from '../../src/domain/avatar';

const feature = loadFeature(path.resolve(__dirname, '../__features__/reply-settle.feature'));

defineFeature(feature, (test) => {
  let outcome: AssistantOutcomeKind;
  let rule: ReplySettleRule;

  const compute = () => {
    rule = replySettleRule({ outcome });
  };
  const givenOutcome = (given: any) =>
    given(/^the last outcome is "(.*)"$/, (raw: string) => {
      outcome = raw === 'none' ? null : (raw as AssistantOutcomeKind);
    });
  const settles = (then: any) =>
    then(/^it should settle$/, () => {
      compute();
      expect(rule.settles).toBe(true);
    });
  const after = (and: any) =>
    and(/^it should settle after (\d+)ms$/, (ms: string) => expect(rule.delayMs).toBe(Number(ms)));

  test('A save settles the face at 5s', ({ given, then, and }) => {
    givenOutcome(given);
    settles(then);
    after(and);
  });
  test('Spending money settles the same way as saving', ({ given, then, and }) => {
    givenOutcome(given);
    settles(then);
    after(and);
  });
  test('An error settles the face at 4s', ({ given, then, and }) => {
    givenOutcome(given);
    settles(then);
    after(and);
  });
  test('A clarifying question settles the face at 4s', ({ given, then, and }) => {
    givenOutcome(given);
    settles(then);
    after(and);
  });
  test('No outcome never settles', ({ given, then }) => {
    givenOutcome(given);
    then(/^it should not settle$/, () => {
      compute();
      expect(rule.settles).toBe(false);
    });
  });
  test('No outcome resets any reply text', ({ then }) => {
    then('the rule carries no reply reset for any outcome', () => {
      for (const o of ['saved', 'spent', 'error', 'clarify', null] as AssistantOutcomeKind[]) {
        expect(Object.keys(replySettleRule({ outcome: o })).sort()).toEqual(['delayMs', 'settles']);
      }
    });
  });
});

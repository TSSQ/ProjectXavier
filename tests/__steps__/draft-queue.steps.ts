import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  batchProgress,
  startQueue,
  decideCurrent,
  currentDraft,
  queueDone,
  queueSummary,
  BatchProgress,
  DraftQueue,
} from '../../src/domain/draftQueue';
import { TransactionDraft } from '../../src/domain/assistant';

const feature = loadFeature(
  path.join(__dirname, '..', '__features__', 'draft-queue.feature')
);

/** Only the queue's shape matters here, not the draft's contents. */
const draft = (n: number): TransactionDraft =>
  ({
    accountId: 'a',
    type: 'expense',
    amount: n * 100,
    currency: 'SGD',
    categoryName: null,
    payeeName: `Payee ${n}`,
    note: null,
    occurredAt: 0,
    source: 'ai',
    defaulted: { account: false, payee: false, category: false, date: false },
  }) as TransactionDraft;

defineFeature(feature, (test) => {
  let total: number;
  let progress: BatchProgress;
  let queue: DraftQueue;

  const givenBatch = (given: any) =>
    given(/^a batch of (\d+)$/, (n: string) => {
      total = Number(n);
    });
  const whenComplete = (when: any) =>
    when(/^(\d+) are complete$/, (n: string) => {
      progress = batchProgress(Number(n), total);
    });
  const thenLabel = (step: any) =>
    step(/^the label should be "(.*)"$/, (expected: string) => {
      expect(progress.label).toBe(expected);
    });
  const thenFraction = (step: any) =>
    step(/^the fraction should be (.*)$/, (expected: string) => {
      expect(progress.fraction).toBeCloseTo(Number(expected), 5);
    });

  test('Progress through a batch', ({ given, when, then, and }) => {
    givenBatch(given);
    whenComplete(when);
    thenLabel(then);
    thenFraction(and);
    and('it should not be done', () => expect(progress.done).toBe(false));
  });

  test('A finished batch reports done', ({ given, when, then, and }) => {
    givenBatch(given);
    whenComplete(when);
    thenLabel(then);
    thenFraction(and);
    and('it should be done', () => expect(progress.done).toBe(true));
  });

  test('An empty batch is done with a full bar, not a stuck one', ({
    given,
    when,
    then,
    and,
  }) => {
    givenBatch(given);
    whenComplete(when);
    thenFraction(then);
    and('it should be done', () => expect(progress.done).toBe(true));
  });

  test('Over-counting cannot overflow the bar', ({ given, when, then, and }) => {
    givenBatch(given);
    whenComplete(when);
    thenLabel(then);
    thenFraction(and);
  });

  test('Deciding a card advances to the next', ({ given, when, then, and }) => {
    given(/^a queue of (\d+) drafts$/, (n: string) => {
      queue = startQueue(Array.from({ length: Number(n) }, (_, i) => draft(i + 1)));
    });
    when('I save the current card', () => {
      queue = decideCurrent(queue, 'saved');
    });
    then(/^the queue should be on card (\d+)$/, (n: string) => {
      expect(queue.index + 1).toBe(Number(n));
    });
    and('the queue should not be done', () => expect(queueDone(queue)).toBe(false));
  });

  test('Deciding the last card finishes the queue', ({ given, when, and, then }) => {
    given(/^a queue of (\d+) drafts$/, (n: string) => {
      queue = startQueue(Array.from({ length: Number(n) }, (_, i) => draft(i + 1)));
    });
    when('I save the current card', () => {
      queue = decideCurrent(queue, 'saved');
    });
    and('I skip the current card', () => {
      queue = decideCurrent(queue, 'skipped');
    });
    then('the queue should be done', () => expect(queueDone(queue)).toBe(true));
    and('there should be no current draft', () =>
      expect(currentDraft(queue)).toBeNull()
    );
    and(
      /^the summary should be (\d+) saved and (\d+) skipped$/,
      (s: string, k: string) => {
        expect(queueSummary(queue)).toEqual({
          saved: Number(s),
          skipped: Number(k),
        });
      }
    );
  });

  test('A double-tap on the last card cannot run past the end', ({
    given,
    when,
    and,
    then,
  }) => {
    given(/^a queue of (\d+) drafts$/, (n: string) => {
      queue = startQueue(Array.from({ length: Number(n) }, (_, i) => draft(i + 1)));
    });
    when('I save the current card', () => {
      queue = decideCurrent(queue, 'saved');
    });
    and('I save the current card', () => {
      queue = decideCurrent(queue, 'saved');
    });
    then('the queue should be done', () => expect(queueDone(queue)).toBe(true));
    and(
      /^the summary should be (\d+) saved and (\d+) skipped$/,
      (s: string, k: string) => {
        expect(queueSummary(queue)).toEqual({
          saved: Number(s),
          skipped: Number(k),
        });
      }
    );
  });
});

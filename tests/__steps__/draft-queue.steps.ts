import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  batchProgress,
  startQueue,
  decideCurrent,
  currentDraft,
  queueDone,
  queueSummary,
  stopReviewing,
  reviewProgress,
  statementSummary,
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

  const givenQueue = (given: any) =>
    given(/^a queue of (\d+) drafts$/, (n: string) => {
      queue = startQueue(Array.from({ length: Number(n) }, (_, i) => draft(i + 1)));
    });

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

  test('Stop reviewing skips every remaining card at once', ({
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
    and('I skip the current card', () => {
      queue = decideCurrent(queue, 'skipped');
    });
    and('I stop reviewing', () => {
      queue = stopReviewing(queue);
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

  test(
    'Reviewing the first card of a queue reads "1 of 6", not "0 of 6" (reviewer MINOR 6)',
    ({ given, then, and }) => {
      givenQueue(given);
      then(/^the review label should be "(.*)"$/, (expected: string) => {
        expect(reviewProgress(queue).label).toBe(expected);
      });
      and(/^the review fraction should be (.*)$/, (expected: string) => {
        expect(reviewProgress(queue).fraction).toBeCloseTo(Number(expected), 5);
      });
    }
  );

  test('Reviewing the second card reads "2 of 6"', ({ given, when, then }) => {
    givenQueue(given);
    when('I save the current card', () => {
      queue = decideCurrent(queue, 'saved');
    });
    then(/^the review label should be "(.*)"$/, (expected: string) => {
      expect(reviewProgress(queue).label).toBe(expected);
    });
  });

  test('A finished queue\'s review label reads "N of N"', ({ given, when, and, then }) => {
    givenQueue(given);
    when('I save the current card', () => {
      queue = decideCurrent(queue, 'saved');
    });
    and('I skip the current card', () => {
      queue = decideCurrent(queue, 'skipped');
    });
    then(/^the review label should be "(.*)"$/, (expected: string) => {
      expect(reviewProgress(queue).label).toBe(expected);
    });
    and(/^the review fraction should be (.*)$/, (expected: string) => {
      expect(reviewProgress(queue).fraction).toBeCloseTo(Number(expected), 5);
    });
  });

  test('An empty queue\'s review label is "0 of 0"', ({ given, then }) => {
    givenQueue(given);
    then(/^the review label should be "(.*)"$/, (expected: string) => {
      expect(reviewProgress(queue).label).toBe(expected);
    });
  });

  test(
    'The end-of-queue summary names unread rows only when there are any (reviewer MINOR 5)',
    ({ given, when, and, then }) => {
      givenQueue(given);
      when('I save the current card', () => {
        queue = decideCurrent(queue, 'saved');
      });
      and('I skip the current card', () => {
        queue = decideCurrent(queue, 'skipped');
      });
      then(/^the statement summary with (\d+) unread should be "(.*)"$/, (unread: string, sentence: string) => {
        expect(statementSummary(queue, Number(unread))).toBe(sentence);
      });
    }
  );
});

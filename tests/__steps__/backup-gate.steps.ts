import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { runExclusive, exclusive } from '../../src/domain/backupGate';

const feature = loadFeature(path.resolve(__dirname, '../__features__/backup-gate.feature'));

/** A promise plus externally-callable resolve/reject, for controlling exactly
 *  when an async step of a test "task" completes. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

defineFeature(feature, (test) => {
  test('Two enqueued tasks run FIFO and never overlap', ({ given, when, then }) => {
    const order: string[] = [];
    let firstGate: ReturnType<typeof deferred<void>>;
    let firstStarted: Promise<unknown>;
    let secondStarted = false;
    let allSettled: Promise<unknown[]>;

    given(/^a slow first task and a fast second task queued through the gate$/, () => {
      firstGate = deferred<void>();
    });

    when(/^both are run through runExclusive$/, () => {
      firstStarted = runExclusive(async () => {
        order.push('first-start');
        await firstGate.promise;
        order.push('first-end');
      });
      const secondStartedPromise = runExclusive(async () => {
        secondStarted = true;
        order.push('second-start');
      });
      allSettled = Promise.all([firstStarted, secondStartedPromise]);
    });

    then(/^the second task should not start until the first has resolved$/, async () => {
      // Give any wrongly-unqueued microtask a chance to run before we resolve
      // the first task's gate.
      await Promise.resolve();
      await Promise.resolve();
      expect(secondStarted).toBe(false);

      firstGate.resolve();
      await allSettled;

      expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    });
  });

  test('A rejecting task propagates its error without wedging the chain', ({
    given,
    and,
    when,
    then,
  }) => {
    let rejectingResult: Promise<void>;
    let secondRan = false;
    let secondResult: Promise<void>;

    given(/^a task that rejects$/, () => {
      // no-op: constructed in the `when` step below
    });

    and(/^a second task queued after it$/, () => {
      // no-op: constructed in the `when` step below
    });

    when(/^both are run through runExclusive$/, () => {
      rejectingResult = runExclusive(async () => {
        throw new Error('boom');
      });
      secondResult = runExclusive(async () => {
        secondRan = true;
      });
    });

    then(/^the first caller should see the rejection$/, async () => {
      await expect(rejectingResult).rejects.toThrow('boom');
    });

    and(/^the second task should still run$/, async () => {
      await secondResult;
      expect(secondRan).toBe(true);
    });
  });

  test('The return value passes through', ({ given, when, then }) => {
    let result: Promise<string>;

    given(/^a task that resolves with a value$/, () => {
      // no-op: constructed in the `when` step below
    });

    when(/^it is run through runExclusive$/, () => {
      result = runExclusive(async () => 'the-value');
    });

    then(/^the caller should receive that value$/, async () => {
      await expect(result).resolves.toBe('the-value');
    });
  });

  test('A restore fully completes before a queued backup observes state', ({
    given,
    and,
    when,
    then,
  }) => {
    let state = 'pre-restore';
    let restoreGate: ReturnType<typeof deferred<void>>;
    let observedByBackup: string | undefined;
    let allSettled: Promise<unknown[]>;

    given(/^a slow fake restore queued through the gate$/, () => {
      restoreGate = deferred<void>();
    });

    and(/^a fake backup queued after it that records the state it observes$/, () => {
      // no-op: constructed in the `when` step below
    });

    when(/^both are run through runExclusive$/, () => {
      const restoreDone = runExclusive(async () => {
        await restoreGate.promise;
        state = 'post-restore';
      });
      const backupDone = runExclusive(async () => {
        observedByBackup = state;
      });
      allSettled = Promise.all([restoreDone, backupDone]);
      restoreGate.resolve();
    });

    then(/^the backup should only observe post-restore state$/, async () => {
      await allSettled;
      expect(observedByBackup).toBe('post-restore');
    });
  });

  test("exclusive() invokes the wrapped function with its argument", ({ given, when, then }) => {
    let received: string | undefined;
    let effect: ReturnType<typeof exclusive<string>>;

    given(/^an exclusive effect that records the argument it was called with$/, () => {
      effect = exclusive(async (arg: string) => {
        received = arg;
      });
    });

    when(/^it is invoked with "(.*)"$/, async (arg: string) => {
      await effect(arg);
    });

    then(/^the wrapped function should have received "(.*)"$/, (expected: string) => {
      expect(received).toBe(expected);
    });
  });

  test('exclusive() serialises two concurrent calls through the gate', ({ given, when, then }) => {
    const order: string[] = [];
    let firstGate: ReturnType<typeof deferred<void>>;
    let secondStarted = false;
    let allSettled: Promise<unknown[]>;

    given(/^a slow exclusive effect and a fast exclusive effect queued back to back$/, () => {
      firstGate = deferred<void>();
    });

    when(/^both are invoked through exclusive\(\)$/, () => {
      const first = exclusive(async () => {
        order.push('first-start');
        await firstGate.promise;
        order.push('first-end');
      });
      const second = exclusive(async () => {
        secondStarted = true;
        order.push('second-start');
      });
      allSettled = Promise.all([first(undefined), second(undefined)]);
    });

    then(/^the second should not start until the first has resolved$/, async () => {
      await Promise.resolve();
      await Promise.resolve();
      expect(secondStarted).toBe(false);

      firstGate.resolve();
      await allSettled;

      expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    });
  });

  test('exclusive() still releases the chain when the wrapped function rejects', ({
    given,
    and,
    when,
    then,
  }) => {
    let rejectingResult: Promise<void>;
    let secondRan = false;
    let secondResult: Promise<void>;

    given(/^an exclusive effect that rejects$/, () => {
      // no-op: constructed in the `when` step below
    });

    and(/^a second exclusive effect queued after it$/, () => {
      // no-op: constructed in the `when` step below
    });

    when(/^both are invoked through exclusive\(\)$/, () => {
      const rejecting = exclusive(async () => {
        throw new Error('boom');
      });
      const second = exclusive(async () => {
        secondRan = true;
      });
      rejectingResult = rejecting(undefined);
      secondResult = second(undefined);
    });

    then(/^the first caller should see the rejection from exclusive$/, async () => {
      await expect(rejectingResult).rejects.toThrow('boom');
    });

    and(/^the second exclusive effect should still run$/, async () => {
      await secondResult;
      expect(secondRan).toBe(true);
    });
  });

});

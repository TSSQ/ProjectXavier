/**
 * A private FIFO promise chain: each `run(fn)` starts only after every
 * earlier `run` on the same queue has settled (resolved or rejected), and a
 * rejection reaches only its own caller — the queue keeps going. Same shape
 * as backupGate's `runExclusive`, but one chain per `createSerialQueue()`
 * call, so unrelated work (the corrections file, src/features/diagnostics/
 * corrections.ts) never waits on a backup. Not re-entrant: calling `run`
 * from inside a running `fn` on the same queue deadlocks.
 *
 * No React Native / Expo / DB imports — Node-testable
 * (tests/__features__/serial-queue.feature).
 */
export interface SerialQueue {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const next = chain.then(fn, fn);
      chain = next.catch(() => undefined);
      return next;
    },
  };
}

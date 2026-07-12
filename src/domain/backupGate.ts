/**
 * Serializes backup/restore work so a restore (`applyBackup`) can never
 * interleave with a backup snapshot (manual or auto) (assessment H1).
 *
 * A single module-level FIFO promise chain: each `runExclusive(fn)` call
 * enqueues `fn` to run only after every previously-enqueued fn has settled
 * (resolved or rejected). Not re-entrant — calling `runExclusive` again from
 * inside a running `fn` would deadlock, so callers must invoke the unlocked
 * variant of their own work internally (see src/features/backup/repository.ts).
 *
 * No React Native / Expo / DB imports — Node-testable.
 */
let chain: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn); // start regardless of predecessor outcome
  // Keep the chain alive even when `next` rejects — swallow here only; the
  // caller still observes the rejection via the returned `next`.
  chain = next.catch(() => undefined);
  return next;
}

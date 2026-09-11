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

/**
 * A function known — at the type level — to run inside exactly one
 * `runExclusive` call. `src/domain/restoreSequence.ts`'s `apply` effect is
 * typed as this, not a bare function, so a caller that passes an unwrapped
 * effect gets a `npm run typecheck` failure instead of an unserialised
 * write racing a concurrent backup on the shared `expoDb` connection (full
 * incident: docs/ship-runs/icloud-backup-sync.md, QA round 2). The brand
 * (`__exclusive`) has no runtime meaning — its only job is to make an
 * ordinary `(arg: T) => Promise<void>` NOT structurally assignable here.
 *
 * Deliberately NOT wired into `runRestoreSequence` itself — that chain is
 * not re-entrant (see above), and the legacy `.json` route's `apply`
 * effect (`applyBackup`) already wraps itself once; the sequencer wrapping
 * it again would deadlock that route's restore forever. The type only
 * guarantees SOME single `exclusive()` call produced the effect — each
 * route still owns choosing where its own single wrap happens.
 */
export type ExclusiveEffect<T> = ((arg: T) => Promise<void>) & {
  readonly __exclusive: true;
};

/**
 * The only sanctioned producer of an `ExclusiveEffect<T>`: wraps `fn` in
 * exactly one `runExclusive` call and brands the result. The parameter
 * rejects anything that already carries the brand (`__exclusive?: never`),
 * so `exclusive(applyBackup)` — double-wrapping an already-exclusive
 * effect — is a typecheck failure rather than a deadlock on the user's
 * restore path (probe results: docs/ship-runs/icloud-backup-sync.md).
 *
 * Residual the brand cannot close (review round 1): the check is on the
 * VALUE passed in, not on what that value's body does — `exclusive(async
 * (s) => { await runExclusive(...) })` and `exclusive(async (s) => {
 * await applyBackup(s) })` both still typecheck and would both deadlock.
 * Detecting a lock taken inside a wrapped function's own body would need
 * async context propagation Hermes doesn't have; this is a known, accepted
 * gap, not something the double-wrap case is closed against in general.
 */
export function exclusive<T>(
  fn: ((arg: T) => Promise<void>) & { __exclusive?: never },
): ExclusiveEffect<T> {
  return ((arg: T) => runExclusive(() => fn(arg))) as ExclusiveEffect<T>;
}

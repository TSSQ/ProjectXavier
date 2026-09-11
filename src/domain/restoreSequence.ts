import { ExclusiveEffect } from './backupGate';

/**
 * Pure sequencing for a backup restore (QA round 1 Major 2): wait for the
 * download to finish BEFORE reading/parsing the backup, and only then
 * apply it — nothing destructive runs before the file is confirmed on the
 * device (spec D2; guardrail #1: "back up/restore must round-trip").
 *
 * Framework-free (no React Native / Expo / DB imports) — the order itself
 * is asserted directly in the plain-Node suite
 * (tests/__features__/restore-sequence.feature) via effects that record
 * their own call order, rather than relying on a QA trace of
 * src/features/backup/repository.ts, which no test would catch regressing
 * if a future edit silently dropped the `ensureDownloaded` await.
 *
 * `apply` is typed as `ExclusiveEffect<TData>` (src/domain/backupGate.ts,
 * QA round 2 Major), not a bare function — every caller of
 * `runRestoreSequence` must pass a value produced by `backupGate.ts`'s
 * `exclusive()`, so the H1 serialization guarantee is a `npm run
 * typecheck` failure to drop, not a convention a future edit can silently
 * delete. This module still does NOT call `runExclusive`/`exclusive`
 * itself — the chain is documented as not re-entrant, and the legacy
 * `.json` route's `apply` effect (`applyBackup`) already wraps itself
 * exactly once; wrapping it again here would deadlock that route's
 * restore forever. `runRestoreSequence` only orders three injected
 * effects, strictly awaiting each one before starting the next — it does
 * NOT know or care what they do beyond `apply`'s type-level promise that
 * exactly one `runExclusive` already wraps it.
 *
 * `src/features/backup/repository.ts` wires the real effects — for the
 * `.sqlite` route, `readBackup` copies the file locally (the actual
 * attach-and-read stays bundled with `apply` inside the existing
 * `exclusive(...)` wrap, untouched — see that file's `restoreFromSqlite`);
 * for the legacy `.json` route, `readBackup` reads and parses the full
 * `BackupData`.
 */
export interface RestoreSequenceEffects<TData> {
  ensureDownloaded: () => Promise<void>;
  readBackup: () => Promise<TData>;
  apply: ExclusiveEffect<TData>;
}

/**
 * Runs the three restore effects in strict order — `ensureDownloaded`, then
 * `readBackup`, then `apply` — awaiting each before the next starts. A
 * caller that needs to observe the order (tests) has its injected effects
 * record it themselves (e.g. pushing a label into a shared array); this
 * function's only job is the ordering. Nothing enforces that the
 * destructive work actually lives in `apply` (QA round 3 minor 11) — a
 * future caller could put it in `readBackup` and pass a trivial `apply`,
 * which would still satisfy `ExclusiveEffect<TData>`'s type without ever
 * running under the lock; the ordering guarantee here is about WHEN each
 * effect runs, not WHAT each one does.
 */
export async function runRestoreSequence<TData>(
  effects: RestoreSequenceEffects<TData>,
): Promise<void> {
  await effects.ensureDownloaded();
  const data = await effects.readBackup();
  await effects.apply(data);
}

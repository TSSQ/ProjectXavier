# Spec: fix assessment H1 (restore/auto-backup race) + H2 (sourceText save dead-end)

Source: `docs/assessment-2026-07-12.md`, findings H1 and H2 — the two
highest-risk-reduction items on its Top-5 pre-submission list. Both are bug
fixes with an obvious shape; no product fork.

## Objective

1. **H1** — a restore (`applyBackup`) must never run concurrently with an
   auto-backup (`maybeAutoBackup`) or a manual backup (`createBackup`). Today
   `applyBackup` wraps its wipe-and-reinsert in `withTransactionAsync`
   ([src/features/backup/repository.ts:69](src/features/backup/repository.ts#L69)),
   which expo-sqlite documents as **unsafe against concurrent statements on the
   shared connection**. `maybeAutoBackup` fires on every `active→inactive`
   AppState flip ([app/_layout.tsx:74-81](app/_layout.tsx#L74-L81)) — Face ID
   sheet, Control Center, notification pull — so its `gatherBackupData()`
   SELECTs can interleave between the restore's DELETEs and re-INSERTs,
   serialize a half-wiped dataset to iCloud as the *newest* backup, and the
   KEEP=3 prune then deletes the oldest **good** backup. Data loss on both the
   live DB and the backups meant to save it.

2. **H2** — a confirmed draft whose `sourceText` exceeds 2000 chars (a long
   receipt scan is the realistic trigger) is **permanently unsaveable**: the
   raw utterance/OCR text is attached unbounded
   ([app/(tabs)/index.tsx:258](app/(tabs)/index.tsx#L258),
   [319](app/(tabs)/index.tsx#L319)), `transactionSchema` caps `sourceText` at
   2000 ([src/lib/validation.ts:41](src/lib/validation.ts#L41)), so
   `createTransaction` throws and the catch shows "Could not save. Please try
   again." — retrying can never succeed. Truncate before it reaches the schema.

## Approach

### H1 — app-level backup mutex (NOT `withExclusiveTransactionAsync`)

The assessment offers `withExclusiveTransactionAsync` *or* a
restore-in-progress gate. **Use the gate/mutex.** Rationale (verified against
`node_modules/expo-sqlite/build/SQLiteDatabase.d.ts:93-117`): the exclusive
API requires every statement inside to run on its `txn` handle, and concurrent
writes on the main handle abort with "database is locked". Our restore body is
Drizzle statements bound to the main `expoDb` connection — running them inside
the exclusive callback deadlocks/aborts unless Drizzle is rebound to `txn`,
which is riskier and untestable in the plain-Node suite. A promise-chain mutex
is deterministic, framework-free, and fully testable.

**New file `src/domain/backupGate.ts`** (framework-free, no imports beyond
stdlib — must run in the plain-Node BDD suite):

```ts
/** Serializes backup/restore work so a restore can never interleave with a
 *  backup snapshot (assessment H1). Single module-level FIFO promise chain. */
let chain: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn); // start regardless of predecessor outcome
  // Keep the chain alive even when `next` rejects — swallow here only;
  // the caller still sees the rejection via the returned `next`.
  chain = next.catch(() => undefined);
  return next;
}
```

(Exact implementation up to the implementer, but it MUST be: FIFO, exclusive —
`fn` N+1 does not start until `fn` N settled — error-propagating to the
caller, and never wedged by a rejection.)

**Wiring in `src/features/backup/repository.ts`** — serialize the three
public entry points; avoid re-entrant deadlock (the mutex is NOT re-entrant):

- Rename the current `createBackup` body to a private `createBackupUnlocked`.
- `export createBackup = () => runExclusive(createBackupUnlocked)` — covers
  the manual button in [app/backups.tsx:98](app/backups.tsx#L98).
- `applyBackup(data)`: wrap its ENTIRE current body (transaction + settings +
  `postDueOccurrences` + widget refresh) in `runExclusive`. Covers both
  restore paths (`restoreFromName` at backups.tsx:130, `restoreLatest`). The
  iCloud read in `restoreFromName` may stay outside the mutex.
- `maybeAutoBackup`: wrap the body INSIDE the existing try/catch in
  `runExclusive`, and call `createBackupUnlocked` (not the wrapped export)
  inside it. The gather + signature check + write must all sit inside one
  exclusive section — gathering outside would reopen the race.

Out of scope for H1: gating `updateWidgetSummary` callers (a mid-restore
widget read self-heals — `applyBackup` refreshes the summary at the end);
M2 (zod on backup import); M4 (edit-blind signature).

### H2 — truncate `sourceText` at the domain choke point

- In `src/lib/validation.ts`, extract the magic number:
  `export const SOURCE_TEXT_MAX_CHARS = 2000;` and use it in
  `transactionSchema`'s `sourceText: z.string().max(SOURCE_TEXT_MAX_CHARS)…`.
  (Leave `note`'s literal 2000 alone — different field, out of scope.)
- In `buildTransaction` ([src/domain/assistant.ts:216](src/domain/assistant.ts#L216)) —
  the single point every AI draft passes through on save (both `onConfirm` and
  `onEditSave` funnel through `saveAssistantDraft` → `buildTransaction`):
  `sourceText: draft.sourceText ? draft.sourceText.slice(0, SOURCE_TEXT_MAX_CHARS) : null`.
  Check import direction first: if `src/domain/*` doesn't already import from
  `src/lib/validation.ts`, define the constant in the domain module and import
  it INTO validation.ts instead — domain must stay framework-free and
  cycle-free. (zod itself runs fine in plain Node; a cycle does not.)
- Do NOT truncate at the `setPending` attach sites in index.tsx — the draft
  keeps the full text for display; only the persisted value is capped.

## Acceptance criteria (testable)

Plain-Node BDD suite (`tests/`), framework-free:

1. `runExclusive`: (a) two enqueued fns run FIFO and never overlap — the
   second does not start before the first resolves (assert via an order log +
   a deferred promise held open); (b) a rejecting fn propagates its error to
   its caller AND the next enqueued fn still runs; (c) return value passes
   through.
2. A restore-vs-auto-backup interleaving test at the gate level: start a slow
   fake "restore" via `runExclusive`, enqueue a fake "backup" that records
   what it observes, assert the backup observes only post-restore state
   (i.e. strict ordering — no snapshot of intermediate state is possible).
3. `buildTransaction` with a 5000-char `sourceText` produces a transaction
   whose `sourceText` is exactly `SOURCE_TEXT_MAX_CHARS` long and which passes
   `transactionSchema.parse` (the H2 repro: this exact parse is what threw).
4. `buildTransaction` with short text is unchanged; with `sourceText`
   null/undefined stays `null`.
5. Existing suite stays green: `npm run typecheck && npm run lint && npm test`
   in the worktree, 397+ tests.

Manual/QA-level (features layer, not reachable by the Node suite — verify by
reading the wiring, and note it):

6. `maybeAutoBackup` gathers inside the mutex; `createBackup` (manual) and
   `applyBackup` are wrapped; no call path enters `runExclusive` re-entrantly
   (deadlock check: maybeAutoBackup → createBackupUnlocked, never the wrapped
   export).

## Constraints

- ALL work in the worktree `.claude/worktrees/fm-spike`, branch
  `claude/account-creation-spike`.
- `src/domain/**` stays framework-free (no expo/react imports) — the BDD
  suite runs it in plain Node.
- No behavioural change to what the FM/heuristic parse produces; this touches
  only persistence.
- Keep `withTransactionAsync` in `applyBackup` (rollback-on-failure is still
  wanted); the mutex is added AROUND it, not instead of it.

## Edge cases

- `sourceText` exactly 2000 chars → saved unchanged (slice is a no-op).
- Restore throws mid-transaction → transaction rolls back (existing
  behaviour), mutex releases, a queued auto-backup then snapshots the intact
  pre-restore data. This is correct and desirable.
- Auto-backup already running when the user taps Restore → restore waits the
  few hundred ms for the snapshot to finish, then proceeds. Acceptable; do
  not add a timeout.
- Rapid double-tap of the manual Backup button → two serialized backups;
  second is a near-duplicate, pruned later by KEEP=3. Acceptable (backups.tsx
  already sets busy state).

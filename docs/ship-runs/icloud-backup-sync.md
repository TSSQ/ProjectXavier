# Ship run: icloud-backup-sync

> Durable, committed record of one `/ship` run. Agent verdicts are pasted
> verbatim. Committed with the `Ship-Run: icloud-backup-sync` commit trailer.

- **Feature:** A backup made on one device is listed and restorable **on the first try** on another device on the same iCloud account, and on the same device after iOS evicts the file. The Backups screen tells the truth about where each file is. New filenames carry the device idiom.
- **Branch:** claude/icloud-sync (cut fresh from `origin/main`)
- **Spec:** docs/design/icloud-backup-sync-spec.md
- **Started:** 2026-09-11

## Spec
Written by the user and approved on instruction — no fork to resolve, so the
gate passes without an `AskUserQuestion`. It is unusually complete: it traces
three defects to specific files and line numbers in `react-native-cloud-storage`
3.0.1, lists what is already landed so it is not redone, and names a fallback
(§9) if `NSMetadataQuery` proves unreliable on device.

**One correction made at the gate.** §6 asserts "scenarios ≥ 1135 + 14". The
real baseline on this branch is **1143** — `origin/main` has absorbed the glass
standard adoption's scenarios since the spec was written — so the bar is **1157**.
The same class of stale arithmetic the glass run hit; caught before implementation
rather than at QA.

**Commit shape, decided up front.** The user asked for I5 alone, then I1+I2+I3,
then I4, I6, I7. The previous run could not honour a split because its steps
edited the same files; here the groups are naturally disjoint (a pure filename
module, a new native module plus adapter plus domain, then the repository, the
screen, the tests). The implementer is therefore instructed to keep each step's
changes inside its own files so the split stays possible — the constraint that
was missing last time.

## Implement
Built by the implementer agent in the commit groups the user asked for, each
group inside its own files so the split stays possible:

| Step | Files |
| --- | --- |
| I5 filename | `src/domain/backupFilename.ts`, `tests/__features__/backup-format.feature`, `tests/__steps__/backup-format.steps.ts` |
| I1+I2+I3 bridge | `modules/icloud-bridge/` (new local Expo module), `src/features/backup/icloud.ts`, `src/domain/backupSync.ts` |
| I4 download-before-restore | `src/features/backup/repository.ts` |
| I6 screen | `app/backups.tsx` |
| I7 tests | `tests/__features__/backup-sync.feature`, `tests/__steps__/backup-sync.steps.ts` |

**Gate re-run by the main agent, not taken on report** (the implementer's
numbers and mine agree exactly):

```
typecheck  clean
lint       clean
test       119 suites / 2006 tests passed
eval       PASS - at or above baseline (65.6%), no case regressed
scenarios  1176  (bar was 1157)
```

`package.json` / `package-lock.json` untouched — the native module is a local
Expo module, autolinked, not a dependency.

**Signing checked after `pod install`.** The spec (§7) permits `pod install`
because that is how local modules are autolinked, but CocoaPods reserialises
`project.pbxproj`, which in this repo is hand-maintained and carries the
per-target manual signing. Verified intact afterwards: `CODE_SIGN_STYLE = Manual`
x2, profiles "Project Xavier" / "Project Xavier Widget", team `CFVNU6RD8C`.
This is the check the spec asked for as a pbxproj SHA comparison, which is not
possible here — `ios/` is entirely gitignored, so there is no committed
baseline to diff against. Asserting the signing settings themselves is the
stronger check anyway: it tests the property we care about rather than the
file's bytes.

**Two adaptations, both accepted.** `bg-surfaceAlt` named by the spec is retired
on this branch, so the screen uses `bg-wellRecessed`. The spec's scenario
baseline was already corrected at the spec gate (above).

## QA

### Round 1 — PASS-WITH-CONCERNS (2 Majors → sent back)

Verbatim verdict from the qa-tester agent:

> ## Verdict: PASS-WITH-CONCERNS
>
> ### Test + build results (independently reproduced, not from the implementer's report)
>
> ```
> npm run typecheck   → clean, no output
> npm run lint         → clean, no output
> npm test             → Test Suites: 119 passed, 119 total / Tests: 2006 passed, 2006 total (13.0s)
> ```
>
> Scenario-count arithmetic, independently recomputed (counting `Scenario:` + `Scenario Outline:` lines):
> - `origin/main` (= this branch's HEAD, since the branch hasn't diverged yet — only uncommitted changes sit on top) = **1143** scenarios, not the spec's stated 1135. This matches the implementer's own `docs/ship-runs/icloud-backup-sync.md`, which shows this was caught and corrected *before* implementation (bar raised to 1157).
> - New scenarios added by this diff: 10 in `backup-format.feature` + 23 in `backup-sync.feature` = 33.
> - 1143 + 33 = **1176**, exactly matching the implementer's reported total. Caveat (c) is a legitimate, pre-corrected adaptation, not a missed requirement.
>
> `package.json`/`package-lock.json`: no diff, confirmed. `ios/` is genuinely fully gitignored (`git check-ignore -v` → `.gitignore:12:/ios/`), so caveat (b) is a real, unavoidable limitation, not an excuse — and I independently verified the property the implementer substituted for it: `ios/ProjectXavier.xcodeproj/project.pbxproj` has `CODE_SIGN_STYLE = Manual` (×2), `PROVISIONING_PROFILE_SPECIFIER` = "Project Xavier" / "Project Xavier Widget", `DEVELOPMENT_TEAM = CFVNU6RD8C` — all intact, and `ios/Podfile.lock` genuinely contains a freshly-resolved `ICloudBridge (1.0.0)` pod entry, confirming `pod install` really ran. `bg-wellRecessed` (caveat a) is a real pre-existing token also used in `src/components/ui/PeriodSheet.tsx:132` and `SegmentedControl.tsx:23` — legitimate substitution.
>
> ### Mutation testing (`src/domain/backupSync.ts` — restored, verified byte-identical via `md5` before/after: `e78d324740df392fe8dd524fad699059`, and `git diff --stat` identical to session start)
>
> | Rule | Mutation | Result |
> |---|---|---|
> | `shouldKeepWaiting` | swap branch order (check `stalled` before `timedOut`) | **CAUGHT** — "prefers timedOut over stalled" scenario fails as expected. This is the precedence-collision scenario the implementer says it added after its first mutation slipped through; confirmed it genuinely bites. |
> | `shouldKeepWaiting` | `now - lastProgressAt >= limits.stallMs` → `>` (boundary) | **NOT CAUGHT** — all 23 backup-sync tests still pass. No scenario exercises the exact 30000ms boundary (closest is 31000ms, a 1000ms margin), so an off-by-one here is invisible to the suite. Independently reproduced twice. |
> | `rowState` | reorder so `isDownloading` is checked before `downloadingError`/`uploadingError` | **CAUGHT** — 2 scenarios fail ("download error beats..." / "upload error beats..."). |
> | `isRestorable` | `&&` → `||` | **CAUGHT** — 2 scenarios fail. |
>
> ### Findings
>
> **Major** — `src/features/backup/icloud.ts:295-317`, `ensureDownloaded` module-absent (fallback) branch: `const lastProgressAt = startedAt;` (line 300) is never reassigned — there is no progress signal on this path, so on every loop iteration `now - lastProgressAt === elapsedMs` exactly. Since `stallMs` (30s) < `maxMs` (120s), `shouldKeepWaiting`'s `'stalled'` branch will *always* fire before `'timedOut'` can ever be reached — the 120s budget is dead code on this call site. Any real download over the fallback path (module not linked: Expo Go, Android, or a build where the pod failed to link) that would have succeeded at, say, 40s instead throws `ERR_ICLOUD_STALLED` at exactly 30s. This contradicts spec I2's "poll `exists(name)` with the same limits" language. The implementer's own added smoke test (`tests/__steps__/backup-sync.steps.ts:44-56`, "Fallback ensureDownloaded double reports stalled when the file never appears") documents this exact behavior as the expected outcome rather than catching it as a defect — it never tests a slow-but-eventually-successful download on this path.
>
> **Major** — No automated test exercises the actual RN call sites (`src/features/backup/icloud.ts`, `src/features/backup/repository.ts`, `app/backups.tsx`) that this feature is built around. `jest.config.js` scopes the Node BDD suite to pure domain logic only; there is no RNTL test anywhere in the repo, and the only E2E layer (`e2e/*.yaml`, Maestro, gated behind an optional `EXPO_TOKEN` CI secret) has exactly two flows (`add-expense.yaml`, `add-account.yaml`) — none for backup/restore. I traced by hand that `restoreFromSqlite` (`repository.ts:343-359`) calls `ensureDownloaded` before `restoreScratchFile` exists, and that the watcher lifecycle in `backups.tsx` is well-guarded — but nothing in the automated gate would catch a regression if a future edit dropped that `await icloud.ensureDownloaded(...)` call or broke the watcher's cleanup. This is precisely the "rule correct, call site never verified" failure mode called out in the task brief, currently avoided only by manual review.
>
> **Minor** — `src/domain/backupFilename.ts`'s `NAME_RE` (`^projectxavier-backup-(\d+)(?:-([^.]+))?\.(sqlite|json)$`) accepts a device segment on `.json` names too: `parseBackupName('projectxavier-backup-1700000000000-iPhone.json')` → `{exportedAt:1700000000000, device:'iPhone', format:'json'}` (verified with a standalone regex probe matching the exact source). This contradicts the module's own doc comment ("`.json` names never carry a device") and is untested — the existing "legacy .json" scenario only covers a device-less name. Impact is confined to a cosmetic mislabel ("iPhone ·" instead of "Backup ·") for a hand-renamed/foreign file; routing still keys off the suffix, not `device`, so no destructive/data-integrity impact.
>
> **Minor** — `parseExportedAt` (`src/domain/backupFilename.ts:102`, re-exported `icloud.ts:383`) has zero production callers anywhere in `app/`/`src/` (repo-wide grep). It used to be called by the old `list()` before this diff replaced it with `listWithStatus`/`parseBackupName`. Tested-but-dead, exactly the pattern the brief asked to check for — harmless, but the "kept for callers" doc comment no longer matches reality.
>
> **Minor** — `restoreLatest()` (`repository.ts:368-373`) got new, meaningful `isRestorable`-preference logic in this diff, but has zero callers anywhere in the app (repo-wide grep confirms). Not exercised by any test or any UI flow. If it's ever wired up, note it doesn't forward `onProgress` to `restoreFromName`, so a cold download through this path gives no visible progress.
>
> **Minor** — `app/backups.tsx`'s `onConfirmRestore` (line ~257) calls `restoreFromName(entry.name)` without `onProgress`, even though `onDownloadThenRestore` already awaited a fully-progressed `ensureDownloaded`. In the near-certain case the file is already `current` this is a cheap no-op re-check, but if eviction/re-stall happens while the confirm `Alert` sits open (unbounded time), the second internal wait is invisible to the user and any resulting failure surfaces via the generic "Restore failed" copy rather than the download-specific copy.
>
> **Nit** — `Number(match[1])` on the timestamp digits has no length/overflow guard; a 29-digit filename parses to `1e+29` (float precision loss) instead of being rejected. Cosmetic only — the raw string, not the parsed number, drives all I/O; no real backup can have such a name.
>
> **Nit** — `entriesFromRawItems`/`mergeFallbackListing` have no dedup-by-`name` guard; a narrow OS-timing race (stub and materialized copy transiently both reported for one logical name) could theoretically produce two `CloudBackupEntry` rows sharing a React `key`. Speculative, not reproduced.
>
> ### What held up well (explicitly confirmed, not just claimed)
>
> - I4 ordering is real: `ensureDownloaded` awaited strictly before `restoreScratchFile`/scratch-file creation on both the `.sqlite` route (`repository.ts:347-348`) and the legacy `.json` route (`repository.ts:312-313`); the `runExclusive` body (`repository.ts:352-355`) is byte-identical in shape to before (`readBackupDataFromAttached` + `applyBackupUnlocked`), confirmed via diff.
> - The module-absent fallback can never present an un-downloaded stub as restorable: stub entries always resolve to `FALLBACK_STATUS` (`downloadStatus:'notDownloaded'`), and `isRestorable` correctly rejects them — traced through `listWithStatus`'s fallback branch line by line.
> - zod genuinely gates the native trust boundary: only `.safeParse` is used (never `.parse`) at both call sites in `icloud.ts` (`entriesFromRawItems`, `statusFor`); malformed items degrade to `FALLBACK_STATUS` without throwing.
> - `backupPolicy.ts` and `backupGate.ts` (H1 gate) are genuinely untouched (`git diff --stat` empty for both), matching the spec's "not touched" claim.

### Round 1 fixes

**Major 1** — fixed at the seam, not in the rule. `shouldKeepWaiting` now takes
`lastProgressAt: number | null`; `null` means "this path has no progress signal"
and skips the stall branch, leaving only the `maxMs` budget. The fallback branch
of `ensureDownloaded` passes `null` instead of a frozen `startedAt`. The
module-present branch, which has real progress, is untouched. New scenarios cover
a download resolving at ~40s (past the old false 30s stall), a real timeout at
120s, and the exact `stallMs` / `maxMs` boundaries that round 1 found unguarded.

**Major 2** — the ordering became a rule instead of a line. New
`src/domain/restoreSequence.ts` exports `runRestoreSequence({ ensureDownloaded,
readBackup, apply })`, framework-free and effect-injected; both the `.sqlite` and
legacy `.json` routes in `repository.ts` go through it. The destructive
`runExclusive` block moved inside the `apply` effect unchanged — the ordering
moved, the mutation did not. Swapping the two calls inside the sequencer fails
two named scenarios, which is the property that was missing: a future edit that
deletes the download step can no longer stay green.

Plus the seven smaller items: separate `SQLITE_NAME_RE` / `JSON_NAME_RE` so a
`.json` name cannot carry a device by construction, a `\d{1,15}` digit cap against
`Number()` overflow, dedup in both listing paths, `onProgress` forwarded from
`restoreLatest`, and a shared `downloadToDevice` helper so `onConfirmRestore`
re-confirms the file is present before anything destructive and routes failures to
the download-specific copy.

Gates after the fixes, re-run by the main agent: typecheck and lint clean,
**120 suites / 2019 tests**, eval PASS 65.6%, **1189 scenarios**, `package.json`
untouched, the five commit groups still disjoint.

### Round 2 — PASS-WITH-CONCERNS (1 new Major, created by the round-1 fix)

Verbatim verdict from the qa-tester agent:

> ## Verdict: PASS-WITH-CONCERNS
>
> Both round-1 Majors are genuinely fixed and independently reconfirmed via mutation testing. No live correctness bug found in the refactored restore path. One new, evidence-backed structural finding: the refactor traded a *visible* invariant for an *invisible* one on the single most dangerous line in the codebase.
>
> ### Priority 1 — the restore path refactor
>
> All five items verified by direct source trace, diff-hunk boundaries (`git diff -- src/features/backup/repository.ts` shows the hunks start at line 21/248/272/287 — `applyBackup`/`applyBackupUnlocked` at lines 110-230 are untouched by any hunk), and a restored mutation:
>
> 1. **Ordering/scope unchanged** — `restoreFromSqlite` still does `ensureDownloaded` → `copyToScratch` (inside `readBackup`) → `runExclusive(readBackupDataFromAttached + applyBackupUnlocked)` (inside `apply`), same three operations, same order, same lock scope as round 1. Legacy `.json` route's `apply: (data) => applyBackup(data)` calls the exact same pre-existing gated export (`repository.ts:110-112`, `await runExclusive(() => applyBackupUnlocked(data))`) — that function is byte-for-byte untouched.
> 2. **Exclusivity preserved** — the actual mutual-exclusion mechanism (`backupGate.ts`'s FIFO `runExclusive` chain) is completely untouched; both `createBackup` and both restore routes' `apply` steps still funnel through it, same as before. `runRestoreSequence` itself calls `apply` exactly once per invocation, syntactically (no loop) — cannot be entered twice within one restore.
> 3. **Error/rollback unchanged** — `applyBackupUnlocked`'s `expoDb.withTransactionAsync(...)` wipe-and-reinsert (untouched) still provides atomic rollback; `readBackupDataFromAttached`'s missing-table/row-validation throw (untouched) still runs before `applyBackupUnlocked` inside the same `runExclusive` callback. Confirmed a download failure can't reach `apply` at all (item 4).
> 4. **Sequencer can't be satisfied by a no-op** — mutated `runRestoreSequence` to `try { await effects.ensureDownloaded(); } catch {}` (swallow the rejection). Result: **CAUGHT** — "never reads or applies if ensureDownloaded rejects" fails (`rejected` is `undefined`, not an `Error`). Restored, `md5` confirmed byte-identical (`3cd97c32984519048ac32dbf793b98fd` before/after).
> 5. **Both routes go through the sequencer** — confirmed via repo-wide grep: `icloud.read`/`copyToScratch`/`downloadFile` are called *only* from inside `restoreFromName`'s/`restoreFromSqlite`'s `readBackup` effects. No bypass path exists anywhere in `app/`.
>
> **The one thing that got riskier (Major).** Before this refactor, `runExclusive(...)` was the outermost, unmissable call wrapping the destructive body — impossible to omit by accident without visibly restructuring the function. After the refactor, exclusivity is enforced *only* by convention: `RestoreSequenceEffects.apply` is typed as a bare `(data: TData) => Promise<void>` with no hint that it must be exclusive, and `restore-sequence.feature`'s tests assert ordering only — they use effects that never touch a shared resource, so they cannot and do not protect this property. I proved this is not hypothetical: I stripped `runExclusive` out of `restoreFromSqlite`'s `apply` callback (the single line standing between a restore and an unserialized wipe-and-reinsert against the shared `expoDb` connection) and re-ran the *entire* gate — `npm run typecheck` clean, `npm run lint` clean, `npm test` → **120 suites / 2019 tests, all green**, identical to the unmutated tree. Restored, `md5` confirmed byte-identical (`625168affcb33012d8b00b1e2d334ef2` before/after). This isn't a live bug today — items 1-3 above confirm current behavior is correct — but the refactor moved the safety-critical line into a position where nothing in the automated gate would notice if it were ever dropped, and the new sequencer's own dedicated test suite creates the *appearance* of rigor around exactly the path where none exists for this specific property. Given guardrail 1, this deserves the same weight as a live defect: `src/domain/restoreSequence.ts:24-28` (the `RestoreSequenceEffects` interface), `src/features/backup/repository.ts:373-377` (the unprotected `apply` wiring).
>
> ### Priority 2 — round-1 fixes, re-verified independently
>
> | Item | My mutation | Result |
> |---|---|---|
> | `shouldKeepWaiting` — `lastProgressAt` now `number \| null` | Coerced `null` to `0` instead of skipping the stall check | **CAUGHT** — 3 scenarios fail, exactly reproducing the original round-1 bug. The `null`-skip guard is genuinely load-bearing. |
> | `shouldKeepWaiting` — `stallMs` exact boundary (new scenario) | `>=` → `>` on the stall comparison | **CAUGHT** — "stalls at exactly the 30-second boundary" fails. Round-1's gap is closed. |
> | `shouldKeepWaiting` — `maxMs` exact boundary (new scenario) | `>=` → `>` on the timeout comparison | **CAUGHT** — 3 scenarios fail. |
> | Fallback double, "appears at ~40s resolves" | (baseline, not mutated) | Confirmed passing; the double now passes `lastProgressAt: null`, matching production, with a comment acknowledging the double previously reproduced the bug it should have caught. |
> | `SQLITE_NAME_RE`/`JSON_NAME_RE` split | Re-added a device capture group to `JSON_NAME_RE` | **CAUGHT** — "rejects a .json name with a device-shaped segment" fails. |
> | `\d{1,15}` digit cap | Widened to `\d{1,30}` | **CAUGHT** — both "implausibly long timestamp" scenarios fail, receiving `1e+29` instead of `null`. |
> | `\d{1,15}` digit cap — **my own mutation** | Off-by-one, `\d{1,15}` → `\d{1,16}` | **NOT CAUGHT** — all 21 tests still pass. No scenario probes the exact boundary. Same class of gap round 1 found in `shouldKeepWaiting`, now present here. |
> | `mergeFallbackListing` dedup (prefers `downloaded: true`) | last-write-wins instead of downloaded-wins | **CAUGHT** — the dedup scenario fails. |
> | `mergeFallbackListing` dedup — **my own mutation** | Inverted the `downloaded` flag itself | **CAUGHT** — the non-collision "mixes downloaded/stub" scenario fails (the collision scenario alone would have missed it by coincidence of input order). |
> | `entriesFromRawItems` dedup (`icloud.ts`) | Not mutation-tested | Code-reviewed only. **No automated test exists or can exist** — `icloud.ts` is RN code excluded from the Node suite by design. |
> | `downloadToDevice` / `onConfirmRestore` | Not mutation-tested | Code-reviewed only, confirmed correct: `onConfirmRestore` does `if (!(await downloadToDevice(entry))) return;` strictly before `restoreFromName`, and the catch shows the download-specific Alert. **No automated test exists or can exist** — RN component code. |
>
> ### Priority 3 — `parseExportedAt`, my read
>
> Delete it, and its scenarios, unless someone can name a concrete near-term caller. It is genuinely dead: zero callers anywhere in `app/`/`src/`/`modules/`, and its own doc comment admits as much. The spec's "(kept for callers)" is hedging language written before implementation, not evidence of a planned caller — and per your own framing, a passing scenario against a function the app never calls proves nothing about the app. The counter-argument (one-line, zero-risk pure wrapper, matches an approved spec line item) is real but weak.
>
> ### Debris check
>
> Grepped all modified/new feature files for `MUTATION`, `console.log`, `debugger`, `XXX`, `FIXME`, `TODO`, `TEMP`, `SCRATCH` — zero matches. No leftover scaffolding in `modules/icloud-bridge/`. `git status --porcelain` / `git diff --stat` confirmed identical to the round-2 starting state.
>
> ### Findings summary
>
> - **Major** — `src/domain/restoreSequence.ts:24-28`, `src/features/backup/repository.ts:373-377`: exclusivity of the destructive `apply` step is now an unenforced convention on a generic, reusable abstraction rather than a structurally-obvious inline call. Empirically demonstrated: removing `runExclusive` from the sqlite restore's `apply` leaves typecheck, lint, and all 120 suites/2019 tests green.
> - **Minor** — `src/domain/backupFilename.ts`'s `TS = '\d{1,15}'` digit cap has an untested exact boundary; `{1,16}` passes the full suite unnoticed.
> - **Minor** (carried, narrowed) — `entriesFromRawItems` and `downloadToDevice`/`onConfirmRestore` remain verifiable only by manual code trace; no RN/component test harness exists in this repo.
> - **Judgment call (not a defect)** — recommend deleting `parseExportedAt` and its scenarios.

**This Major is mine, not the implementer's.** My round-1 instruction said to move the
ordering into a sequencer with injected effects, and it did exactly that — but `apply`
as a bare `(data) => Promise<void>` says nothing about having to be exclusive, so the
one line standing between a restore and an unserialised wipe-and-reinsert became
deletable without a single test noticing. QA didn't argue this; it removed the line and
showed all 120 suites still green.

The fix is the same move applied one level further: exclusivity becomes part of the
rule rather than a convention at the call site. The sequencer takes `runExclusive` as
its own injected effect and wraps `apply` itself, so the test can assert the apply
happened *inside* the lock and a mutation that drops the wrap fails a named scenario.

The hazard this introduces is a nested lock: the legacy `.json` route currently passes
`applyBackup`, which already wraps `runExclusive` internally, and `backupGate`'s FIFO
chain is not reentrant — so wrapping again would deadlock a restore forever. That is a
worse failure than the one being fixed, so the round-3 instruction calls it out by name
and requires a scenario proving the lock is taken exactly once per restore.

### Round 3 — fixes, and the gate that now owns them

The Major from round 2 was closed in the type system rather than at runtime.
`src/domain/backupGate.ts` gained `ExclusiveEffect<T>` — a function type carrying
a brand only `exclusive()` can attach — and `RestoreSequenceEffects.apply` now
requires it. The exact deletion QA performed is a `npm run typecheck` failure:

```
src/features/backup/repository.ts(376,7): error TS2322:
  Type '(f: File) => Promise<void>' is not assignable to type 'ExclusiveEffect<File>'.
```

`applyBackup` became `exclusive(applyBackupUnlocked)` — identical runtime
behaviour, one wrap, public API intact, now branded — and the `.sqlite` route's
body is wrapped by `exclusive()` instead of an inline `runExclusive`. Three Node
scenarios now cover `exclusive()` itself (invokes with its argument, serialises
two concurrent calls, releases the chain on rejection), each mutation-tested.

Also: `parseExportedAt` and its six scenarios deleted — both QA and I reached the
same read, that a passing scenario against a function the app never calls proves
nothing about the app. **Corrected in review round 2:** this deletion was reversed
by the M3 fix below and then reported to me as "deleted in the I1+I2+I3 commit",
which I repeated here. That was not true and could not have been: with an
uncommitted tree there is no later commit to delete it in — the working tree *is*
the end state of every commit. The reviewer caught the record and the code
contradicting each other. Resolution recorded under review round 2. And the digit cap gained exact boundary scenarios at 15
and 16 digits, closing the hole QA found by mutating its own round-1 fix.

**The deliberate non-fix.** The obvious repair — inject `runExclusive` into the
sequencer so it wraps `apply` for every caller — was rejected on inspection.
`backupGate` documents the chain as **not re-entrant**, and the legacy `.json`
route passes `applyBackup`, which already wraps. A wrapping sequencer would
deadlock that restore forever: silent, unrecoverable, on the user's data. A
missing test is the lesser failure, so the fix had to be one that adds no second
wrap anywhere.

**One hole closed by the main agent, not the implementer.** Verifying the brand
with a throwaway probe rather than trusting the reported error showed that
`exclusive(alreadyBranded)` type-checked cleanly — the one remaining way to
reach the deadlock above, guarded only by a prose warning in a doc comment. On
this run, a prose convention on exactly this line is what failed. `exclusive`'s
parameter now carries `& { __exclusive?: never }`, and the probe confirms all
three directions:

| Probe | Result |
| --- | --- |
| bare `(arg) => Promise<void>` assigned to `ExclusiveEffect` | rejected, TS2322 |
| `exclusive(alreadyBrandedEffect)` | rejected, TS2345 |
| `exclusive(plain or named async fn)` | accepted |

Gates after round 3, re-run by the main agent: typecheck and lint clean,
**120 suites / 2018 tests**, eval PASS 65.6%, **1188 scenarios**, `package.json`
untouched.

**Gate: PASSED** — the round-2 Major is resolved and independently verified, so
QA closes as PASS-WITH-CONCERNS with every Major addressed. The two carried
Minors are accepted limitations, recorded in Review below: `entriesFromRawItems`
and `backups.tsx`'s download helper are RN code that the Node suite cannot reach,
so they are verified by trace rather than by test.


**My read of the two Majors — both accepted, both sent back.**

The first is a genuine defect and the more interesting one, because the test that
should have caught it instead *documented* it: the fallback smoke scenario asserts
`stalled` for a file that never appears, which is also what a file appearing at 40s
would produce. The rule is right; the call site feeds it a `lastProgressAt` that
cannot move, so one of its two branches is unreachable. Fix is at the seam, not in
the rule: a path with no progress signal must say so rather than pass a frozen
timestamp.

The second is the failure mode this repo keeps re-learning — *missing call vs wrong
rule*. A source-scanning guard was rejected: the glass run shipped a scanner that
matched a code sample in its own doc comment, so that shape has already burned us.
The fix instead moves the ordering itself into a pure domain sequencer with injected
effects, which makes "download before touching the file" a rule the Node suite can
mutation-test rather than a line a future edit can quietly delete.

The uncaught boundary mutation (`>=` → `>` at exactly `stallMs`) was reported in the
table rather than as a finding, but it is the same class of hole and went back too.


## Review

### Round 1 — REQUEST-CHANGES (1 blocker, 3 majors)

Verbatim verdict from the reviewer agent (abridged only by dropping its
nitpick list, which is reproduced in the fix instruction):

> ## Verdict: **REQUEST-CHANGES**
>
> One blocker, three majors. The brand you asked about is **sound** — I attacked it directly and it held. The problems are elsewhere: a spec-mandated fallback that is unreachable in the shipping configuration, and it takes two unrelated flows down with it.
>
> ### The `ExclusiveEffect` brand — **sound**, not the next fix-that-creates-a-defect
>
> I wrote a throwaway probe with `@ts-expect-error` on the cases I expected to fail, and `npm run typecheck` came back clean — meaning every expectation held:
>
> | Probe | Result |
> |---|---|
> | bare `(d: string) => Promise<void>` as `apply` | **rejected** |
> | `exclusive(alreadyBranded)` | **rejected** |
> | plain async arrow through `exclusive()` | accepted |
> | `ExclusiveEffect<unknown>` → `ExclusiveEffect<string>` (contravariance) | accepted, and safe |
>
> Residual holes, all of which require a *deliberate* act rather than an omission — which is the correct bar for a brand, and a real improvement over "delete one line and stay green":
>
> 1. `Object.assign(async (d) => {...}, { __exclusive: true as const })` type-checks with no `runExclusive` anywhere. Forgery, not accident.
> 2. `exclusive(async (s) => { await runExclusive(...) })` and `exclusive(async (s) => { await applyBackup(s) })` both compile and **would deadlock**. The `__exclusive?: never` clause only blocks wrapping a value that is *itself* branded; it cannot see a lock taken inside the body. Not fixable in the type system, and not fixable at runtime either (detecting re-entrancy needs async context propagation; Hermes has no `AsyncLocalStorage`).
> 3. `runRestoreSequence`'s generic signature does let a future caller put the destructive work in `readBackup` and pass a trivial `apply`. Nothing enforces "destructive work lives in `apply`".
> 4. `@typescript-eslint/no-explicit-any` is **off**, so `apply: fn as any` lints clean. Again: deliberate.
>
> **Exactly-one-lock, verified end to end.** `applyBackupUnlocked` is module-private — the only two paths to it are `applyBackup` (one wrap) and `restoreFromSqlite`'s `exclusive(...)` (one wrap). I also chased the deadlock direction *inside* the lock: `applyBackupUnlocked` calls `applySettings`, `postDueOccurrences`, `bumpDataRevision`, `updateWidgetSummary` — none of them reach `runExclusive`. No path with zero locks, no path with two.
>
> **`exclusive()` is in the right module.** It belongs with the mutex it wraps; `restoreSequence.ts` imports only the type. And `export const applyBackup: ExclusiveEffect<BackupData> = exclusive(applyBackupUnlocked)` is safe despite converting a hoisted `function` into a TDZ-bound `const`: `applyBackupUnlocked` is a hoisted function declaration, and a repo-wide grep shows **zero importers of `applyBackup` outside the file**.
>
> **The real belt is still `readBackupDataFromAttached`.** Even if every ordering guarantee were bypassed, `sqliteFile.ts:166-175` throws on `missingTables` before `applyBackupUnlocked` runs — a 0-byte or truncated file cannot wipe the live DB. Guardrail 1 holds with two independent defenses.
>
> ### zod at the trust boundary — **sound, and drawn in the right place**
>
> Only `.safeParse`, at both call sites. The schema lives in the pure domain module and the adapter applies it — the boundary is Node-testable and the RN file holds no policy. One malformed item degrades that item, never the list.
>
> ### "un-downloaded placeholder presented as restorable" — **cannot happen**
>
> Three independent reasons: the module path defaults to `"notDownloaded"` when the status key is absent, so a stub can never read `current`; the fallback marks only non-dotted names as downloaded and dedupes stub-vs-real with `downloaded: true` winning; and `isRestorable` requires `current && !isDownloading`. Plus the `missingTables` guard.
>
> ### A trap that *isn't* one
>
> The comment at `app/backups.tsx:403` contains the literal `bg-surfaceAlt`, which the glass scanner greps for — but that scanner runs `maskComments()` first, so the prose is masked. The "scanner matches its own doc comment" failure the ship-run remembers has already been fixed and does not recur here.
>
> ## Blocking
>
> ### B1 — The native listing has no failure path, and the spec-mandated fallback is unreachable in the shipping build
>
> `src/features/backup/icloud.ts:202-206` calls `ICloudBridge.listDocuments(...)` with **no try/catch**. It rejects on `ERR_ICLOUD_GATHER_TIMEOUT` (8s) and `ERR_ICLOUD_UNAVAILABLE`; nothing catches it anywhere up the stack. The library fallback below is reachable only when `ICloudBridge` is **null** — i.e. never on a real iOS build. Spec §8 requires exactly the opposite, and §9 names that same path as the whole fallback plan. As written, §9's fallback is dead code on device.
>
> Three separate flows break, and only the first is about the Backups screen:
>
> 1. **The list hangs forever.** A rejection is an unhandled promise rejection, `setHasGathered(true)` never runs, and the screen shows **"Checking iCloud…" permanently** with no error and no retry. The likeliest trigger is a slow first metadata sync — precisely acceptance criterion §6.1, "new device".
> 2. **A successful backup reports failure, and the container grows without bound.** Pruning lists *after* the upload already succeeded, so a gather timeout throws out of `createBackup` and the UI shows an error for a backup that exists. Via `maybeAutoBackup` the throw is swallowed but the throttle keys are never written, so every subsequent backgrounding uploads another file that is never pruned.
> 3. **Account deletion is blocked.** `accounts/repository.ts:107` wires `forcePreDeleteBackup: createBackupUnlocked`, awaited before any destructive statement. A metadata-gather timeout now aborts an unrelated user action.
>
> Before this change `list()` was `readdir` + `stat` — local, fast, effectively non-failing. Routing it through an 8-second network-dependent gather changed the failure profile of every caller.
>
> ## Major
>
> ### M1 — A malformed native payload is indistinguishable from "not downloaded", which turns any payload drift into a guaranteed 120-second hang and a failed restore
>
> `statusFor` maps a schema failure to `FALLBACK_STATUS` (`'notDownloaded'`). Right for the list; wrong for `ensureDownloaded`'s loop, where `isRestorable` can then never become true, so it polls the full `maxMs` and throws `ERR_ICLOUD_TIMEOUT` — "your download timed out" when the truth is "the native contract drifted".
>
> The coupling is live and asymmetric today: error fields are omitted when nil (matched by `.nullish()`), but the percentages are sent as `NSNull()` against a schema that is `.nullable()` but **not optional**. A future Swift edit following the file's other idiom breaks every restore. The Node suite cannot see this — the fixture is hand-written, not derived from the Swift dict.
>
> ### M2 — `NSMetadataQuery` and its observer list are mutated from two threads
>
> `startWatching`/`stopWatching` are synchronous `Function`s running on the **JS thread**, while `query.start()` is dispatched to main and both observers fire on `.main`. So `stop()` and `removeObserver` execute off the main thread, and the stored properties are written from the JS thread while `emit` runs on main. `NSMetadataQuery` requires a thread with an active run loop; a blur landing mid-`emit` can stop the query between its `disableUpdates()`/`enableUpdates()` pair. Spec §6.6 is exactly the check this would fail intermittently, and nothing in the Node suite can see it.
>
> ### M3 — Commit 1 (I5) does not stand on its own; it will not typecheck
>
> The I5 group deletes `parseExportedAt`, but at HEAD `icloud.ts:21, 75` still imports and calls it — and `icloud.ts` doesn't change until commit 2. So commit 1 fails `npm run typecheck` in isolation, breaking bisect and any per-commit check. (I verified the other four prefixes are self-consistent.) Cheapest fix: keep the one-line shim in the I5 commit — which is what spec §5 actually specified, "(kept for callers)" — and delete it in commit 2 where its last caller goes away.
>
> ## Minor
>
> - **`restoreLatest` is still dead code carrying new logic** — the `isRestorable` preference and `onProgress` forwarding both landed for a function with zero callers.
> - **`patchRowProgress` never clears `isDownloading`** — it only ever sets `true`. When the watcher isn't running or after a failure, the row is pinned to "Downloading…" for the life of the screen, and `isRestorable` stays false so the user re-enters the download path for a file that's already local.
> - **No per-row in-flight guard** — a second tap during a 120-second `ensureDownloaded` starts a second download and can stack two confirm Alerts.
> - **Prune's blast radius quietly widened** — `list()` now returns every remote backup including other devices', but `KEEP = 3` is applied to that larger set, so two devices sharing one container compete for three slots and each device's create can prune the other's. Probably intended, but it's an unstated data-retention change.
> - **Fallback listing reports `size: 0` for stubs** → "iPhone · <0.1 MB" for a 3 MB backup, against §6.1's "the real size".
> - **`readdir`'s return isn't shape-guarded** the way the module branch is. Same trust boundary, two standards.
> - **The sequencer's proof ships one commit after the sequencer** — `restoreSequence.ts` is in I4, its tests in I7. The whole point of the round-2 fix is that the rule and its mutation-detectable proof are inseparable.
> - **Dead guards** — `Number.isFinite(exportedAt)` is now unreachable since `\d{1,15}` guarantees a finite number.
>
> ## Things I checked and will not re-litigate
>
> Typecheck clean. `git status --porcelain` identical before and after my probe. Branch is 0 commits behind `origin/main`. No secrets, no string-built SQL added. `modules/icloud-bridge/`'s podspec, `package.json` and `expo-module.config.json` are byte-for-byte consistent with `widget-bridge`/`apple-ocr`, so autolinking behaves the same way. `requireOptionalNativeModule` + every consumer null-guarded — the Node suite and Expo Go degrade cleanly.

**Why B1 is the most valuable finding of the run.** Every earlier round argued
about whether a guard could fail. This one is about a guard that cannot even be
reached: the spec's entire §9 fallback plan is dead code in the only
configuration that ships. And the blast radius is the part worth remembering —
`list()` used to be `readdir` + `stat`, local and effectively non-failing.
Putting an 8-second network-dependent gather behind the same function changed the
failure profile of every caller, including account deletion, which has nothing to
do with iCloud listing and now aborts on an iCloud timeout. Three QA rounds of
mutation testing never touched it, because every one of them was aimed at rules
rather than at what happens when a call simply throws.

**M3 vindicates the split requirement.** The instruction that each step stay in
its own files was meant to make the user's requested commit order possible; the
reviewer checked the stronger property — that each commit *typechecks on its
own* — and found commit 1 fails it, because deleting `parseExportedAt` orphans a
caller that does not change until commit 2. The deletion is still right; it
belongs one commit later. I had planned to verify this after the fixes landed, by
extracting each prefix and running the gates against it; the reviewer got there
first by reading imports.

### Round 1 fixes

**B1** — a pure `listWithFallback(moduleListing, fallbackListing)` in
`backupSync.ts`, with `listWithStatus` routing through it, so a gather timeout
falls through to the library listing the spec always described instead of
rejecting unhandled. Separately `backupPolicy.ts` gained `pruneTolerantly`,
which tolerates a *listing* failure and not merely a per-file delete failure —
that one function fixes the unbounded-container flow and the account-deletion
flow together, because both reach pruning through it. Both mutation-tested by
stripping the catch and watching a named scenario fail.

**M1** — one idiom on both sides of the bridge: the percentages became
`.nullish()` and Swift omits them when nil. `parseCloudEntryOrThrow` +
`CloudStatusSchemaError` make a malformed payload fail immediately with a
diagnostic instead of masquerading as `notDownloaded` and burning the full
120-second budget before reporting a timeout that names the wrong cause.

**M2** — `startWatching`/`stopWatching` dispatch their whole bodies to the main
queue. **Carried caveat:** verified with `swiftc -parse` only. No `pod install`
or Xcode build was run — outside this run's constraints — so the Swift is
syntax-checked, not compile-checked against the Expo modules framework, and
§6.6's watcher behaviour remains a device check.

**M3** — the shim was restored so commit 1 would typecheck. It was reported as
"deleted in commit 2", which is not something an uncommitted tree can express;
the deletion is instead reconstructed at commit time (see review round 2). The
implementer verified the prefixes **mechanically** rather than by reading
imports: a disposable detached worktree off `origin/main`, each group's files
copied in cumulatively, `tsc --noEmit` at every stage, the final stage
`diff`-confirmed byte-identical to the real working tree.

**That mechanical check immediately earned its keep.** The first fix for the
`size: 0` minor widened `CloudBackupEntry.size` to `number | null`, which broke
the I4-alone prefix — `origin/main`'s not-yet-replaced `app/backups.tsx` declares
its own `BackupEntry { size: number }`. Nothing in the full-tree gates could see
it, because the full tree is the one state where the conflict does not exist.
Re-fixed with a `NaN` sentinel so no consumer's type changes until I6 lands.

All twelve minors and both nits were also taken.

Gates after the fixes, re-run by the main agent: typecheck and lint clean,
**120 suites / 2035 tests**, eval PASS 65.6%, **1205 scenarios**, `package.json`
untouched, no tracked `ios/` changes.

**Two things checked by the main agent before re-gating**, because both fixes
could reach further than their finding. The `NaN` sentinel is contained:
`formatSize` is the only render site and handles it, and `list()`'s `size` has
exactly one consumer, `pruneTolerantly`, which reads only `name`/`exportedAt`.
The new throw is contained too: `statusFor`'s only callers are
`ensureDownloaded`'s polling loop, and the listing path still `.safeParse`s per
item, so the reviewer's "one malformed item degrades that item, never the list"
property survives. One inconsistency was found and deliberately left for the
reviewer to adjudicate rather than fixed silently: the module path still uses
`?? 0` for a missing size while the fallback path uses `NaN`, so the same unknown
renders as "0.0 MB" on one path and "Size unknown" on the other.

### Round 2 — REQUEST-CHANGES (1 new Major; and the record was caught contradicting the code)

The reviewer re-derived B1 and all three Majors as genuinely fixed rather than
taking the report, and re-ran all five commit prefixes in its own disposable
worktree — running a deliberate positive control first (`const broken: number =
'positive control'` → TS2322, then removed) so it knew the harness was really
typechecking the copied tree rather than silently no-op'ing. Every prefix clean;
the final stage byte-identical to the working tree; 120/2035 independently
corroborated.

**The new Major (M4) is B1 one layer up.** B1's fix made the *module* call fall
through, but `listWithFallback` only wraps `moduleListing` — a throw from the
fallback inside the catch still propagates, and `listViaFallback`'s `readdir`
call is unguarded (only its resolved shape is). The reviewer read the library:
`react-native-cloud-storage`'s `listFiles` throws `readError` when the directory
cannot be read, **including when it does not exist yet**. So the trigger is
§6.1's opening state — fresh install on device B, iCloud `Documents` not yet
materialised — and the symptom is B1's exactly: "Checking iCloud…" forever, no
error, no retry, on the device check this feature exists for. The new scenarios
covered module-succeeds and module-throws but not both-throw; the branch nobody
considered is the branch that reaches the user.

**And the record was wrong.** Round 3 recorded `parseExportedAt` as deleted. The
M3 fix restored it, and that was reported to me as "deleted in the I1+I2+I3
commit" — which I repeated to the user and wrote here without testing whether it
could be true. It cannot: with an uncommitted tree the working tree *is* the end
state of all five commits, so a function present in it is present in the final
commit. Six scenarios were exercising a function with no production callers, and
counting toward the acceptance bar, while the record claimed they were gone.

The resolution keeps the earlier judgment rather than quietly reversing it: the
function is deleted from the working tree, and commit 1 is built from a snapshot
of the shim-bearing files taken before the deletion, so commit 1 typechecks with
the shim and commit 2 carries its removal. `backupFilename.ts` legitimately
appears in two commits. The file-disjointness rule was only ever a means to the
real requirement — every commit typechecks on its own — and that end is better
served by letting one file change twice than by shipping dead code to satisfy a
heuristic.

### Round 2 fixes

**M4**, three parts: the focus effect's whole body is now one try/catch with a
`gatherError` box that renders independently of `iCloudAvailable` and a Retry
that re-runs the effect without needing blur/refocus; `listViaFallback` guards
its own `readdir`, so the not-yet-materialised container the library throws on
is a normal empty listing; and the both-throw case became an explicit decision
— propagate the fallback's own rejection, since nothing generic over `T` can
synthesise a sensible default and the caller now has real error UI. All nine
minors landed with it, including a `console.warn` in each of the two previously
silent catches.

`parseExportedAt` is deleted for real this time — function, six scenarios, six
step blocks and the unused import. Commit 1 will be built from the pre-deletion
snapshot so it still typechecks; commit 2 carries the removal.

**One fix corrected by the main agent.** Minor 9 came back as a non-null
assertion, `ICloudBridge!.status(name)`, reported as making a future caller
outside the guard "a typecheck failure, not a silent wrong return". That is
exactly backwards: an assertion silences the compiler, so such a caller would
crash at runtime instead of failing to build. Replaced with the narrowing passed
as a value — `type LinkedBridge = NonNullable<typeof ICloudBridge>`, with both
call sites handing `statusFor` the value narrowed by their enclosing guard.
Mutation-tested: a call added outside the guard produces

```
error TS2345: Argument of type 'ICloudBridgeNativeModule | null'
  is not assignable to parameter of type 'ICloudBridgeNativeModule'.
```

and the file was restored byte-identical. This is the same move as the
`ExclusiveEffect` brand, one seam over: a precondition the compiler checks beats
a precondition the comment asserts. Worth recording that the incorrect claim was
plausible enough to pass unexamined — it used the right vocabulary for the fix
the run had already adopted.

Gates after round 2's fixes: typecheck and lint clean, **120 suites / 2030
tests**, eval PASS 65.6%, **1200 scenarios**, `package.json` untouched.

### Round 3 — APPROVE-WITH-NITS (gate passes)

> ## Verdict: **APPROVE-WITH-NITS**
>
> M4's three fixes are correct and I verified the mechanism rather than the claim. No blocking issues. Five nits, none of which should hold the merge — but the first one is worth fixing before commit because it re-enshrines the exact reasoning you correctly rejected.
>
> ### "Did M4's fixes create the next defect?" — yes, but only cosmetically. Two places.
>
> **The empty state and the error box now contradict each other** (`app/backups.tsx:480-489`). The ternary has no `gatherError` guard, so when availability resolves **true** and the listing then throws, the screen renders both "Couldn't check iCloud / Retry" **and** "No backups yet. Create one above." — a false statement about the user's only offsite copies, sitting directly below a box saying we couldn't check. A user who reads the second line and not the first concludes their backups are gone.
>
> **`onCreateBackup` still reports a successful backup as failed** (`:234-244`). This is B1's flow 2 in a different function: the create succeeded and uploaded; if the refresh rejects, the catch overwrites the outcome and the user is told the backup failed.
>
> ### The both-throw decision — **coupling holds**, verified caller by caller
>
> Every path that can now reject lands somewhere that renders it: the focus gather → `gatherError` + Retry; the create refresh → `statusMessage`; `pruneTolerantly` → its catch + `console.warn`. No unhandled rejection remains.
>
> ### `gatherError` rendering and Retry — **sound**, no worse-state path
>
> I checked the implementation rather than assuming. `useFocusEffect` has deps `[effect, navigation]` and runs the callback immediately when focused, so bumping `retryToken` gives `useCallback` a new identity → teardown (running `cancelled = true; unwatch()`) → immediate re-run. **It cannot loop** — `retryToken` changes only on a press — and it cannot double-watch. Placing the box outside both `iCloudAvailable` branches is right: availability can still be `null` when the gather fails at `getSetting`, and that is the state where the user would otherwise see nothing at all. Stale `backups` surviving a failed retry is the right choice (data plus error beats blanking the list).
>
> ### `NaN` unification — **complete and consistent**, nothing broken
>
> The three representations are now one, on both sides of the bridge. Consumer set unchanged: `formatSize` (handles it) and `pruneTolerantly`, whose parameter type still structurally cannot see `.size`. No arithmetic, no sort, no serialization.
>
> ### `LinkedBridge` — **correct, and don't spread it**
>
> Your replacement is right and the reasoning is right. Keep it at `statusFor` only. The principle that draws the line: **`statusFor` is the only one of the four seams where module-presence is a *precondition*** — there is no defined behaviour without the bridge. The other three are *branch points with real fallbacks*, and `listViaModule`'s throw is **load-bearing, not defensive**: it is how the module-absent case reaches `listWithFallback`'s catch. Converting it to a parameter would force `listWithStatus` to branch before choosing a branch — precisely the structure B1 removed. **Changing it would regress B1.**
>
> ### Nits
>
> 1. `icloud.ts:325-337` — the comment is half-edited and still carries the claim you rejected: it says the `!` makes an out-of-guard caller a typecheck failure, when there is no `!` any more and that was the wrong mechanism. The corrected rationale and the discredited one sit in the same block contradicting each other. **The code learned the lesson, the comment teaches the opposite.**
> 2. `backups.tsx:480-489` — guard the empty state on `gatherError === null`.
> 3. `backups.tsx:234-244` — don't let the post-create refresh convert a success into a reported failure.
> 4. `backups.tsx:343` — the schema-error Alert reads "Try again, or check for an app update" followed by the fixed "Check your connection, or open the file in Files" — two contradictory pieces of advice in one modal.
> 5. Commit 1 is no longer verifiable from the working tree, since it is built from a snapshot held outside the repo. Once the commits exist this is trivial: a throwaway detached worktree, `git checkout <sha> -- .` per commit, `npm run typecheck`.
>
> ### Re-checked and sound
>
> `listViaFallback` now wraps `readdir` and returns `[]`, closing the ENOENT-on-fresh-install path — §6.1's opening state is a normal empty listing, and the watcher self-heals when device A's backup arrives. `patchRowProgress` takes the override and the success path passes `'current'`. `downloadingNames` is a ref. `console.warn` in both previously-silent catches. `parseExportedAt` is genuinely deleted. The brand, the sequencer, exactly-one-lock on both restore routes, and `readBackupDataFromAttached`'s `missingTables` guard are untouched from round 1.
>
> One thing I looked at and decided is *not* a finding: the new warn also fires when the module simply isn't linked, because `listViaModule` signals that by throwing through the same catch. On iOS that only happens when the pod failed to link — exactly the condition the warning exists to surface.

**Four nits applied directly by the main agent** (the fifth is a process change,
adopted below).

Nit 1 was mine: my own edit had spliced the corrected rationale into the middle
of the old one, leaving a block that argued both sides — including the claim that
a non-null assertion produces a typecheck failure, which is the thing I had just
established is false. Rewritten so the comment states the mechanism, names the
assertion as the wrong fix and why, and points at `ExclusiveEffect` as the same
move one seam over. A comment that teaches the opposite of what the code does is
worse than no comment, because the next reader trusts it.

Nit 2 and nit 3 are the same defect in two places, and both are the B1 shape
again: a listing failure being allowed to speak for something it does not know
about. Now the empty state renders nothing rather than "No backups yet" when the
gather failed with no cached rows, and `onCreateBackup` reports success before
refreshing, so a failing refresh can no longer retract a backup that is already
uploaded.

Nit 4 revealed that `downloadErrorMessage` could not own the whole Alert body
without losing the connection/Files hint that the generic transfer failures
actually need. The hint moved inside the generic branch instead of being appended
to every error including the one it contradicts.

Gates after the nits: typecheck and lint clean, **120 suites / 2030 tests**,
eval PASS 65.6%, **1200 scenarios**.

## Verify

Run by the main agent in the worktree, not taken on report:

```
npm run typecheck   clean
npm run lint        clean
npm test            120 suites / 2030 tests passed
npm run eval        PASS — at or above baseline (65.6%), no case regressed
scenarios           1200   (bar 1157)
package.json        untouched
ios/ (tracked)      no changes
```

**Nit 5 adopted as the commit-time check.** The reviewer's point is that commit 1
is built from a snapshot held outside the repo, so the one commit that was ever
actually broken contains a file version nobody can verify from the working tree.
Before the snapshot was used, it was diffed against the final files to prove the
only delta is the `parseExportedAt` deletion — 115 removed lines, zero added,
across all three. After the commits exist, every one of the five is checked out
into a throwaway detached worktree and typechecked, which replaces a manual
snapshot step with a mechanical check on the real artifacts.

**Result of that check, on the real commits:**

| Commit | | typecheck | suite |
| --- | --- | --- | --- |
| `e38b879` | I5 filename | clean | 118 suites / 1989 |
| `4ff6b55` | I1+I2+I3 bridge | clean | — |
| `0ecccf5` | I4 download-before-restore | clean | 118 suites / 1995 |
| `120bcb3` | I6 screen | clean | — |
| `cb9fe53` | I7 tests + run record | clean | 120 suites / 2030 |

A **positive control ran first** — a deliberate type error in the copied tree,
confirmed to fail, then removed — so a harness that silently passed everything
could not masquerade as five green commits. That is the same discipline the whole
run turned on: a check that cannot fail proves nothing, whether it is a scenario,
a scanner, or a bisect harness.

## Build

**Soak — Xavier Beta 114 (1.2)**, installed on two devices: Pigu (iPhone 16 Pro
Max) and Terrence's iPad (iPad Pro 11-inch 3rd gen, iOS 26.6.1). The same IPA on
both, so a misbehaviour could not be blamed on a build difference. The iPad
needed no device registration or rebuild — its UDID was already in the profile.

This archive was **the first time the new Swift module had ever been compiled**.
Every gate before it used `swiftc -parse`, which catches syntax but not type
errors, a missing Expo API, or a broken podspec. It compiled clean. Verified in
the IPA rather than assumed: `ICloudBridgeModule.self` registered in the
generated `ExpoModulesProvider` (so the module is genuinely linked rather than
silently absent and degrading to the fallback), and the iCloud entitlements
present. That second one is what the reviewer warned about — a missing
entitlement would have made every module call fail and shown whoever ran the
device checks a plausible list from the fallback path.

**Store — 1.2 (96)**, `com.projectxavier.app`, Release signing, metrics OFF.
`VERIFY SUCCEEDED` then `UPLOAD SUCCEEDED`, delivery
`6bab7ee4-6105-4296-bd7c-7fbca2af80d4`.

96 was the next free number: 95 is the highest uploaded, and the 96 archived
earlier in this line was stopped before upload, so the number was never consumed.
Checked in the IPA before upload: app and widget both 96, app group on both
binaries, `iCloud.com.projectxavier.app` with the **Production** environment,
signed with `598BFA17…` (the other two Apple Distribution certs on this machine
are revoked), and **zero** `EXPO_PUBLIC_METRICS` occurrences in the JS bundle —
the soak build sets that flag deliberately, and the only difference between the
two archives is an environment variable, so it was checked rather than trusted.

## Result

Shipped to soak on two devices and uploaded to App Store Connect as 1.2 (96).
The user confirmed the device checks.

**Held deliberately at the submit.** 1.2 has no version record on ASC yet, and
the store screenshots predate the Glass adoption — they show the old tab bar,
opaque headers and the composer's retired quick chips. Apple does not reject for
stale screenshots, but they would misrepresent the app, and they are the one part
of a release that cannot be corrected after approval without submitting again.
That decision is the user's, and needs their devices.

**What no gate here could close, carried to the device:** the NSMetadataQuery
threading fix is compile-verified but its behaviour never was, and real iCloud
eviction timing cannot be simulated. Both live in §6.6 and §6.1 respectively.

**The shape of this run, for whoever reads it next.** Six adversarial rounds,
and in five of them the fix created the next finding: a frozen timestamp produced
the sequencer, the sequencer produced the unguarded `apply`, the brand produced
the double-wrap, a type widening produced a bisect break, and the blocker's fix
produced M4. None of those were caught by a green suite — every one was caught by
deliberately breaking the rule and checking that something failed. The two
findings that mattered most were invisible to mutation testing entirely: a
listing with no failure path, which made the spec's whole fallback plan dead code
in the only configuration that ships, and a commit that could not typecheck on
its own. The first was found by asking what happens when a call simply throws;
the second by running the real commits instead of reasoning about them.

## Release — 1.2 (97)

The store screenshots the user took against 96 caught a defect this run's gates
never looked at: the Dashboard rendered `credit_card` verbatim under an account
name. `ACCOUNT_SUBTYPE_CHOICES` already carried "Credit card"; three render
sites just never used it. Fixed in `a49e87b` with `src/domain/accountSubtypeLabel.ts`
and ten BDD scenarios, then re-soaked as beta 115 and confirmed on device.

That fix is why 97 exists. 96 was already uploaded, but it predates `a49e87b`,
so pairing it with the new screenshots would have shipped screenshots that
misrepresent the binary — the one asymmetry worth a whole extra build.

**Store — 1.2 (97)**, delivery `0e889e0a-c6a3-42c1-803c-bc3eafc794b4`,
`VERIFY SUCCEEDED` then `UPLOAD SUCCEEDED`, processed to `VALID`.

Verified in the IPA before upload, over and above the 96 checks: the regex
`/[_-]+/g` appears exactly once in `main.jsbundle`, and exactly once in the
source tree — in `accountSubtypeLabel.ts`. A grep for "Credit card" alone would
not have proved anything, since that string is the choice label and was already
in 96's bundle. The fingerprint had to be something only the fix introduces.

**ASC state.** Version record 1.2 created (`04e1e6bd`), build 97 attached,
release notes set on `en-GB` — the listing's only locale. Export compliance
reads `usesNonExemptEncryption: false`; the review notes carried over from 1.1.2
and still describe BYOK accurately.

**Still held at the submit, now for one reason only.** Creating the version
carried 1.1.2's four screenshots forward automatically, and those show the
pre-Glass app — old tab bar, the retired quick-action chips, the old Xavier
layout. Everything else a submission needs is in place.

## Release — 1.2 (98), and what taking the screenshots found

The 1.2 screenshots were reshot on a 6.9-inch simulator at 1320×2868, because
the copies of the user's device screenshots that reach an agent are downscaled
to 920×1999 and App Store Connect needs the originals. Four screens: the
assistant holding a draft with the ON-DEVICE badge, the Dashboard donut, the
ledger with day subtotals, and an account's own page.

Driving that simulator found a defect no gate in this pipeline would have.
Changing a transaction's account opens `AccountPickerSheet`, and it rendered
`credit_card` — the raw stored value — under the account name. So did
`AccountFilterSheet`, the dashboard's account filter. `a49e87b` had fixed three
screens and missed these two.

The reason is worth recording, because it is not carelessness. Both sheets had
**copied the expression**, and `AccountPickerSheet` says so in its own comment:
"Same icon + name + subtype/tag meta idiom as manage-accounts.tsx's renderRow".
The duplication was deliberate and documented, and a fix that walked call sites
still walked past it. Chasing instances of a copied expression is a losing
strategy; the expression has to stop being copyable.

`accountMetaLine()` now owns `kind · tag · Archived` and all five sites call it.
`archived` is opt-in because manage-accounts appends its own "· Archived" for
muted rows and would otherwise say it twice. Four scenarios pin the joined line;
mutating the helper to render the stored value kills three of them.

**Store — 1.2 (98)**, delivery `11299022-f9b0-4a82-a577-e8b736fdaf3f`,
`VERIFY SUCCEEDED` then `UPLOAD SUCCEEDED`.

**On proving the fix is in the binary.** For 97 there was a clean bundle-level
proof: `/[_-]+/g` is a regex literal only `accountSubtypeLabel` introduces, and
it appears exactly once in `main.jsbundle` and once in the source tree. 98 has
no equivalent, because the refactor adds no new string literal and the bundle
stores code in a packed string table rather than readable JS — two greps that
looked like fingerprints (`join(" · ")`, `filter(Boolean)`) turned out to prove
nothing either way, and one `grep` for the middle dot returned a false zero
purely from locale handling. What actually stands behind 98 is provenance and
behaviour: the archive was cut from a clean tree at `76a3756`, which contains
the fix, and a simulator build of that same tree renders "Credit card" and
"Bank" in the picker that used to show `credit_card`.

### 1.2 submission state

Build 98 processed to `VALID` and is attached. The record now holds: the
approved release notes on `en-GB` (the listing's only locale), four 1320×2868
screenshots in `APP_IPHONE_67`, export compliance exempt, and the review contact
and notes carried forward from 1.1.2. `appStoreState` is
`PREPARE_FOR_SUBMISSION` and there is no open review submission — **nothing has
been submitted.**

Two API details that cost time and are worth keeping. `APP_IPHONE_69` is not a
valid `screenshotDisplayType`; 6.9-inch screenshots go in `APP_IPHONE_67`.
And creating a version copies the previous version's screenshots forward into
**new** set objects under a **new** localization id — so the 1.2 localization is
`0cfe2736`, not 1.1.2's `60b130c7`, and a script that reuses the old id will
quietly edit the listing that is live on the store. That mistake was caught
before it ran, and 1.1.2 was re-checked afterwards: still four screenshots.

### Submitted

1.2 was submitted for review on 2026-09-13 at the user's word. Submission
`7d6b531d-6652-479d-b874-79ceb69fb928`, state `WAITING_FOR_REVIEW`, carrying
build 98. 1.1.2 stays `READY_FOR_SALE` until Apple approves; `releaseType` is
`AFTER_APPROVAL`, so it goes live on approval without another step.

The submit path is three calls — create a `reviewSubmission`, add a
`reviewSubmissionItem` pointing at the version, PATCH `submitted: true` — and
the script refuses to make the first one unless a `VALID` build is attached and
every screenshot reads `COMPLETE` with no delivery errors. That guard is cheap
and the failure it prevents is not: a submission that goes out against a record
someone was still assembling.

(`/v1/reviewSubmissions` rejects `sort` — list it unsorted.)

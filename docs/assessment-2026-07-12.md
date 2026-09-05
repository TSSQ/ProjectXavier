# Independent Third-Party Assessment — ProjectXavier ("Xavier")

**Branch:** `claude/account-creation-spike` @ `9911be5` (TestFlight build 27)
**Date:** 2026-07-12
**Scope:** Read-only pre-App-Store assessment. Assessed cold against repo evidence; docs, comments, and commit messages were verified against code, not trusted.

Two corrections to the engagement brief, verified from the repo:

- This branch is **Expo SDK 54 / RN 0.81.5 / React 19.1**, not SDK 52.
- The branch name is a red herring — "/account creation" is a Q&A flow for creating *ledger* accounts in the local DB (`src/domain/accountAssistant.ts`), not user sign-up. This branch is the real shipping line (50 commits ahead of `main`, incl. `40ab482` "fully local build — remove cloud parsing and Supabase auth").

---

## 1. Verdict

**Conditional Go.** Nothing in the repo is likely to cause App Store *rejection* — the privacy manifest, permission strings, entitlements, export-compliance flag, and Foundation Models availability guarding are genuinely in good shape, and the pure-local claim survives code-level scrutiny (zero network call sites, no telemetry SDKs, dead cloud code that never enters the bundle). What blocks an unconditional Go is not review risk but four High-severity product defects — two data-loss paths (a restore/auto-backup race and a receipt-scan save dead-end), a recurring-transaction date shift that affects the developer's own timezone (UTC+8), and a data-at-rest posture where the plaintext SQLite DB makes the Face ID gate largely symbolic. Fix those during the soak period, then submit.

---

## 2. Scorecard

| Dimension | Score | Justification |
|---|:---:|---|
| Correctness & data integrity | **3/5** | Integer-minor-unit money math is airtight and the pending flow is exemplary, but recurring dates shift a calendar day, restore can race auto-backup, and edits never trigger auto-backup. |
| Security & privacy | **3/5** | Excellent gate architecture (unmount-not-overlay, fail-closed) and clean secrets/network hygiene, undermined by a plaintext DB in device backups and a silent no-biometrics bypass. |
| AI-parse robustness | **4/5** | Double zod validation, grounding guards, and the amount-anchored pending guard are genuinely well engineered; one High save dead-end and unhandled heuristic edge cases (refunds, EU decimals). |
| App Store readiness | **4.5/5** | No Critical/High findings; polish items only (generic Face ID string, unused mic string, widget privacy manifest, missing `appleTeamId`). |
| Engineering quality | **4/5** | `tsc` clean, ESLint clean, 392/392 tests green in 33 suites; framework-free domain layer enabled real coverage — but the gaps sit exactly where the risk is (`applyBackup`, widget summary, timezone matrix). |

**Verification output (run in the worktree):**

- `npm run typecheck` → exit 0
- `npm run lint` → "No issues found", exit 0
- `npm test` → 33 suites / **392 tests passed** in 73.6s, exit 0

---

## 3. Findings (by severity)

### High

**H1 — Restore transaction is not exclusive; a mid-restore auto-backup can snapshot a half-wiped DB and prune a good backup.**
`applyBackup` uses `withTransactionAsync` (`src/features/backup/repository.ts:69`), which expo-sqlite documents as unsafe against concurrent statements on the shared connection. `maybeAutoBackup` fires on `active→inactive` (`app/_layout.tsx:74–81`) — Face ID sheet, Control Center, a notification pull — so its SELECTs can run between the DELETEs and re-inserts, serialize a near-empty dataset to iCloud, and the KEEP=3 pruning (`repository.ts:181–189`) then deletes the oldest *good* backup.
*Remediation: `withExclusiveTransactionAsync`, or a restore-in-progress gate.*

**H2 — A confirmed draft can be permanently unsaveable, with data loss disguised as a transient error.**
The raw utterance/OCR text is attached unbounded as `sourceText` (`app/(tabs)/index.tsx:258,319`; no input `maxLength`), but `transactionSchema` caps it at 2000 chars (`src/lib/validation.ts:41`) and `createTransaction` throws (`src/features/transactions/repository.ts:39`). The catch shows "I couldn't save that — please try again" (`index.tsx:509`) — retrying can never succeed. A long receipt scan is the likely trigger.
*Remediation: truncate before attach.*

**H3 — Recurring transactions post on the wrong local calendar day.**
The recurrence engine anchors on UTC days but everything buckets by local day. In UTC+8, creating a series before 08:00 local anchors it one day early (`app/(tabs)/transactions.tsx:251` → `startOfUTCDay` on a time-bearing local timestamp), and posted rows are written at 00:00 UTC (`src/features/recurring/repository.ts:122`) — in any UTC-negative zone, every recurring transaction lands in the previous local day, and on the 1st, in the previous month's totals and widget. All 17 recurrence scenarios are pure-UTC and can't catch it.
*Remediation: anchor and post at local noon (the parse pipeline already does this at `src/domain/deviceParsePrompt.ts:526–540`); add a `TZ=`-pinned test run.*

**H4 — The SQLite DB is plaintext, default file protection, and included in device backups.**
`openDatabaseSync('projectxavier.db')` (`src/db/client.ts:12`), no SQLCipher, no `NSFileProtection` override anywhere. Every transaction, payee, and the `biometric_lock` toggle itself are readable from any Finder/iCloud device backup — the Face ID gate protects none of it at rest.
*Remediation: `NSFileProtectionComplete` + exclude from backups, or SQLCipher; at minimum align marketing copy.*

### Medium

**M1 — The biometric gate silently passes with no auth when biometrics aren't enrolled.**
`if (!hasHardware || !enrolled) return true; // fall back to app-level auth` (`src/lib/secureStore.ts:30–32`) — but app-level auth no longer exists (stale comment from the sign-in era). Passcode-reset → open app, no prompt. Also `authenticateAsync` permits device-passcode fallback, so the gate is effectively "passcode", not Face ID.

**M2 — Backup import is the largest untrusted boundary and bypasses zod entirely.**
`parseBackup` only checks arrays-then-casts (`src/lib/backup.ts:92–108`); `applyBackup` inserts rows verbatim, and `applySettings` upserts arbitrary keys (`repository.ts:151–153`) — a hand-edited iCloud file (user-visible in Files) can inject junk rows and silently flip `biometric_lock` off. `recurringSeriesSchema` and friends exist (`src/lib/validation.ts`) but are never invoked here.

**M3 — Legacy v1 (AES-encrypted) backups are unrestorable, and current backups are plaintext in iCloud.**
`parseBackup` has no decryption path (`backup.ts:57–63` vs the version history at `backup.ts:8–10`); any real v1 file fails as "not valid JSON". The v1 round-trip test uses a plaintext v1 payload that per the version history never existed.

**M4 — Auto-backup is blind to edits.**
`backupSignature` = row counts + max `createdAt` (`src/domain/backupPolicy.ts:29–50`); editing an amount, archiving an account, renaming a category — none perturb it, so those changes are never auto-backed-up until an unrelated add/delete occurs.

**M5 — Parse robustness edges.**
No upper bound on amounts anywhere — `"spent 99999999999999"` yields minor units past `Number.MAX_SAFE_INTEGER` yet passes `.int()` (`validation.ts:31`); `"refund -$20"` drafts as an *expense* of $20 (`localParse.ts:107` — `refunded?` doesn't match "refund"; signs ignored); European decimals misparse (`"€1.234,56"` → €1.23); no timeout around the FM call, so a hung session bricks the input bar (`deviceParse.ts:83`, `editable={!busy}`).

**M6 — Widget gaps.**
The medium widget shows month income/expense with no auth and no `.privacySensitive()` (`targets/widget/XavierWidget.swift:94–148`) — a disclosure gap against "Face ID gates financial data". Two mutation paths skip the summary recompute (immediate posting on series creation, `transactions.tsx:270–271`; account archive, `manage-accounts.tsx:136`), and the `.never` timeline policy means unbounded month-rollover staleness under a "THIS MONTH" header.

**M7 — Currency switch silently relabels history.**
Transactions stamp their save-time currency, but every aggregation sums across codes and formats with the *current* setting (`dashboard.tsx:287`); only `forecastNetWorth` filters by currency — internally inconsistent. Accepted single-currency design, but the mixing is silent and untested.

### Low

- Restore can report "failed" after it committed (`applySettings`/`postDueOccurrences` run post-commit unguarded, `repository.ts:153–157`).
- Migrations lack a wrapping transaction and `user_version` stamp, and nothing enforces migrationPlan↔Drizzle-schema parity (currently in exact sync — verified column-by-column).
- Debug routes (`debug-fm` with `?autorun=1&text=`) ship deep-linkable in release.
- No privacy shield on `inactive` (lock only fires on `background`).
- Generic `NSFaceIDUsageDescription` and an unused `NSMicrophoneUsageDescription` (injected by expo-image-picker).
- Widget target lacks a `PrivacyInfo.xcprivacy` (no undeclared required-reason APIs, though).
- `accountSchema`/`categorySchema`/`payeeSchema` defined but never called (dead code).
- Missing `ios.appleTeamId` (expo-doctor 16/18); duplicate `react` resolvable from the parent checkout — build releases from a clean checkout given the EAS-packages-cwd gotcha.

---

## 4. Non-negotiables audit

| # | Guardrail (as stated) | Verdict | Evidence |
|---|---|:---:|---|
| 1 | SQLite source of truth; backup/restore round-trips | **PARTIAL** | All 6 tables gathered, transactional id-preserving restore, FK-correct ordering (`backup/repository.ts:35–149`); but the destructive DB half has zero test coverage, v1 encrypted backups can't restore, and H1's race is in this path. |
| 2 | Authentication before financial data renders | **PARTIAL** | Gate is architecturally right — the whole `<Stack>` unmounts, deep links queue behind it (`app/_layout.tsx:169–176`); but it's an opt-out preference, silently absent without enrolment (M1), and the widget renders totals with no auth (M6). Note: the worktree's CLAUDE.md quietly reworded this to "when enabled" — the code matches the reworded rule, not the stated one. |
| 3 | Parameterised SQL only | **PASS** | Drizzle builders throughout; hand-written SQL is `?`-bound (`src/db/sql.ts:22–45`, test-asserted); only identifier interpolation from compile-time constants (`migrationPlan.ts:189`). Zero concatenation hits repo-wide. |
| 4 | No PII beyond email + auth-provider id | **PASS** | The app now collects *nothing*: no accounts, no network call sites, no analytics SDKs; metrics are content-free buckets, prod-off (`src/domain/parseMetrics.ts:8–11`, `src/lib/flags.ts`). Caveat: confirm the legacy Supabase parse function is undeployed — if live, it caches raw expense text in Upstash for 24h (`supabase/functions/parse/index.ts:214–227`). |
| 5 | Zod at every trust boundary, incl. AI/OCR | **PARTIAL** | AI/OCR path is genuinely double-validated (`deviceParse.ts:83–102`, heuristic re-parsed at `index.tsx:290–293`) with grounding guards; but backup import/settings restore bypass zod entirely (M2), and the entity schemas are dead code. |

---

## 5. Top 5 pre-submission actions (by risk reduction)

1. **Make restore exclusive** (`withExclusiveTransactionAsync` or a restore-in-progress gate blocking `maybeAutoBackup`/widget writes) — closes the only path that can destroy both live data *and* the backups meant to save it (H1).
2. **Truncate `sourceText` to 2000 chars before attaching** — one line; eliminates the most likely real-user data-loss event, the long receipt scan (H2).
3. **Anchor recurrence on local days** (local-noon anchors + local-noon `occurredAt` in `postDueOccurrences`), and add a `TZ=America/New_York npm test` leg to CI — fixes day-shifted money in the developer's own timezone before more soak data accrues on wrong dates (H3).
4. **Decide the at-rest story and make the copy honest**: exclude the DB from device backups and/or raise file protection; make the no-biometrics case prompt or disclose instead of silently passing; disclose passcode fallback, plaintext iCloud backups, and unauthenticated widget totals (H4, M1, M3, M6). App Review privacy answers must match this.
5. **Apply the existing zod schemas on backup import and whitelist restorable settings keys** — closes the last real gap in guardrail 5 and the crafted-backup `biometric_lock` bypass (M2).

---

## Calibration (where the code is genuinely good)

This is a well-engineered codebase for its stage. The single mandatory confirmation card in front of every AI write, the two-layer distrust of model output, the `isCounted` single-predicate pending design, the unmount-not-overlay lock, integer-minor-unit discipline, the atomic scratch-file-rename widget write, and a 392-test framework-free domain suite are all better than typical for a solo pre-1.0 app. The defects cluster where code meets the OS lifecycle (timezones, AppState races, file protection) — exactly the places the plain-Node test suite structurally can't reach, which is worth treating as the next testing investment, not a coincidence.

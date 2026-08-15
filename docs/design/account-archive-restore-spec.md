# Spec: account archive → restore, and an opt-in "include archived" dashboard lens

**Branch:** `claude/phase2-byok` · **Status:** design · **Date:** 2026-08-05
**Builds on:** `account-chat-crud-spec.md` §5.4/§5.5 — the delete impact, typed-name confirm, and forced pre-delete backup this spec must not weaken.

## 1. Objective

Make **archiving** a safe, reversible alternative to permanent deletion, and let the user opt archived accounts back into the dashboard.

Two halves, in a required order:

1. **Ship a restore path**, so archiving stops being a one-way trip.
2. **Then** promote archive as the recommended alternative to delete, and add a session-scoped "Include archived" lens so the number movement archiving causes is explainable rather than mysterious.

## 2. The blocker this exists to fix (verified on this branch)

**Archiving is currently a one-way trip. There is no way back.**

- `app/manage-accounts.tsx` — `const active = accounts.filter((a) => !a.archived);` is the only list the screen ever builds. `filtered` derives from `active`, and the render draws `active`/`filtered` only. **No archived section, no archived filter, no unarchive action anywhere.**
- Archiving is reachable in one tap plus a confirm: the edit sheet's `headerRight` trash button (`accessibilityLabel="Archive account"`) writes `updateAccount({ ...acc, archived: true })`.
- A second entry point exists in chat — the "Archive instead" action on the delete-handoff card in `app/(tabs)/index.tsx`.
- Repo-wide, **no unarchive exists**: grepping `Unarchive|unarchive|archived: false` across `app/` and `src/` returns exactly one hit, in `app/(tabs)/transactions.tsx`, which is a new `RecurringSeries` literal — not an account restore.

So a user who archives today has **no in-app way to get it back**. The only recovery is restoring an iCloud backup taken before the archive, which rolls back everything else too. Stated plainly: **as shipped, archive is not a safer delete — it is an unlabelled, unrecoverable hide.** Every criterion that promotes archive is blocked on fixing that first (§6).

## 3. What archiving already does (each verified)

| Behaviour | Where |
| --- | --- |
| Net worth **excludes** archived balances | `src/domain/balances.ts` — `netWorth`, `netWorthAsOf`, `accountPeriodBalances` |
| Dashboard totals/charts **exclude** their transactions | `app/(tabs)/dashboard.tsx` — `visibleAccounts` → `allIds` → `selIds` → `selectedTxns` |
| Widget **excludes** them | `src/features/widget/summary.ts` |
| New-transaction picker **hides** them | `src/components/transactions/TransactionFormSheet.tsx` (source list and transfer choices) |
| Assistant scopes to active accounts | `src/domain/assistant.ts` |
| Transactions are **not** deleted | Archive is a single-column write through `updateAccount` |
| `archived` round-trips through backup/restore and is zod-validated | `src/lib/validation.ts`, `src/domain/sqliteBackupRows.ts`, `src/features/backup/repository.ts` |

Two things archiving deliberately does **not** do, both load-bearing here:

- ~~**The Transactions tab still lists an archived account's transactions.** Good — the ledger keeps telling the truth.~~ **REVERSED after device testing of build 63 (2026-08-05).** A user archived an account and was surprised to still find its transactions in the ledger. The original reasoning was mine and it was wrong: if archiving removes an account from the dashboard, net worth, the widget and every picker, then leaving its rows in the ledger makes "archive" mean two different things on two screens — and the rows carry no marker explaining why they are there. **The Transactions tab is now governed by the same "include archived" lens as the dashboard (§5.3a).**
- **Recurring series keep posting into an archived account.** `postDueOccurrences` gates only on the *series'* own flags and never inspects the target account. See §8.3.

## 4. Scope

**In:** the restore path; a session-scoped "Include archived" toggle rendered only when an archived account exists; toggle scope covering both period totals and headline net worth on that screen (widget excluded); a referential-integrity guard against dangling account references (§5.7); presentational promotion of Archive in the delete flow.

**Out of scope (explicit):**

- **Changing aggregation semantics so archived accounts stay in HISTORICAL totals while leaving net worth.** Arguably more correct — archiving is a statement about *today*, not about last March — but it rewrites the contract of `netWorth`/`netWorthAsOf`/`accountPeriodBalances`, consumed by the dashboard, the Ask-Xavier query tools, settings, and indirectly the widget, on a live shipped app. Its own spec, its own corpus cases, and a rewrite of `net-worth.feature`. Not here.
- Chat "unarchive my X" — no new intent op.
- Archive/restore for **recurring series** (`series.archived` is that screen's soft *delete* — same word, different concept; §8.3).
- Bulk archive/restore; a trash/undo for hard delete.
- Any "include archived" option for the widget (§5.6).

## 5. Approach

### 5.1 New pure module — `src/domain/accountArchive.ts`

Framework-free so it runs in the plain-Node suite.

- `matchesAccountQuery(account, query)` — lifts the inline predicate from `manage-accounts.tsx` verbatim (name/tag/subtype, case-insensitive; empty query matches everything).
- `splitAccountsForManage(accounts, query)` → `{ active, archived }` — one pass, order preserved, same predicate on both.
- `hasArchivedAccounts(accounts)` — the toggle's render gate.
- `archiveActionFor(account)` → `'archive' | 'unarchive'` — must treat `archived: undefined` as active (`Account.archived` is optional).
- `collidesWithActiveName(account, accounts)` — normalised-name collision check for restore (§8.4), reusing `normalizeName` from `src/domain/textMatch.ts`.
- `recommendArchiveOverDelete(impact)` — `impact.transactionCount > 0`. Consumes the already-computed `AccountDeleteImpact`, so no new data loading.

### 5.2 Restore path — `app/manage-accounts.tsx`

- Derive both lists from `splitAccountsForManage`, so search filters both.
- Render an **"Archived · N"** section below the active list, only when `N > 0`, **collapsed by default**. Zero added clutter for the majority who never archive.
- Archived rows reuse `renderRow` with muted treatment and an "Archived" meta suffix; tapping opens the **same** edit sheet.
- The edit sheet's `headerRight` becomes action-aware via `archiveActionFor`: today's destructive chip for an active account, and a neutral **restore** chip (`rotate-ccw`, `accessibilityLabel="Unarchive account"`) for an archived one.
- `onUnarchive` mirrors `onArchive` with `archived: false`. **Not** `style: 'destructive'` — restoring is additive. Copy: *"Restore account? It will show in your lists again and count toward net worth."*
- `onSave` already preserves `existing?.archived`, so editing an archived account cannot silently unarchive it. Keep that.
- **Fix the empty state:** today it renders "No accounts yet. Tap + to add one." whenever `active.length === 0` — a lie when the user has archived accounts. Show it only when *both* lists are empty; when `active` is empty and `archived` is not, point at the archived section.
- The chat delete deep link already searches the full `accounts` array, so it keeps working for an archived target unchanged. "View transactions" → `/account/[id]` also works, since that screen loads by id and never filters on `archived`.

### 5.3 Dashboard toggle — session-scoped, conditionally rendered

**Recommendation: per-session, not persisted.** Plain `useState(false)` in `DashboardScreen`; survives tab switches, resets on relaunch.

- **Precedent.** The sibling account filter is explicitly session-local (`src/domain/accountFilter.ts` is headed *"Session-local account filter helpers"*). A persisted archive lens next to an unpersisted account lens is an inconsistency the user must learn.
- **Safety.** This toggle moves the headline net worth. Persisting means a cold launch weeks later shows an inflated number whose only explanation is a switch flipped once. Default-off-per-launch guarantees the first number of every session matches the widget and Ask Xavier, which both exclude archived — one truth per glance.
- **Cost of being wrong is one tap**, and only for users with archived accounts.
- **No new settings key**, so nothing to add to `DEVICE_LOCAL_SETTINGS_KEYS`, nothing new crossing the backup boundary, no migration.
- **Escape hatch** if usage shows re-toggling every launch: promote to a setting **and** add it to `DEVICE_LOCAL_SETTINGS_KEYS`, so a restore can never flip another device's lens.

**Render gate:** only when `hasArchivedAccounts(accounts)`. **Placement:** under `AccountFilterPills`, in the same pill family so it reads as another lens, not a setting.

### 5.3a The lens must be SHARED, and it governs the Transactions tab too

Added after build-63 device testing (see §3). Archiving must mean one thing everywhere.

- **The Transactions tab hides archived accounts' transactions by default.** Today `periodTx` is built from every transaction with no archive filter (`activeAccounts` there is used only to seed the FAB's default account). It gains the same filter the dashboard uses.
- **One shared toggle, not two.** A per-screen `useState` would let the user hide on one screen and not the other, which recreates the very inconsistency this fixes. Lift `includeArchived` into a small **session-scoped** provider (plain React context, no persistence — the §5.3 reasoning for not persisting still stands) that both screens read. It is still off at every cold launch, and still only rendered where `hasArchivedAccounts(accounts)`.
- **Reachability is the trade, and it is acceptable.** With the toggle off, search on the Transactions tab will not surface those rows. Mitigated three ways: the toggle brings them back, the account remains reachable under "Archived · N", and its detail screen (`/account/[id]`) lists its full history regardless — that screen loads by id and never filters on `archived`.
- **Do NOT hide them on `/account/[id]`.** Navigating deliberately into an archived account and finding it empty would be a worse bug than the one this fixes.

### 5.4 Making the toggle actually move the number (the non-obvious part)

**Widening `visibleAccounts` is not sufficient.** `netWorthAsOf` re-filters `!a.archived` internally, and `accountPeriodBalances` does the same. With only a screen-level change:

- totals, cash flow and donuts **would** include archived (they key off `selectedTxns`), but
- the headline net worth and the per-account list + trend chart **would not**.

That split is worse than either extreme — the headline and the rows directly beneath it would disagree.

**Fix, without altering any existing caller** — separate *which accounts* (a screen policy) from *sum these accounts* (arithmetic), in `src/domain/balances.ts`:

- Add `netWorthOfAsOf(accounts, transactions, asOf)` and `periodBalancesOf(accounts, transactions, range)`, summing **exactly** the accounts handed to them with no internal filter.
- Reimplement `netWorth`, `netWorthAsOf` and `accountPeriodBalances` as one-line delegations that pre-filter `!a.archived` and call the new functions.

Every existing caller keeps identical behaviour, and `net-worth.feature` passes unmodified as the regression proof.

The dashboard then calls the `*Of` variants with `selectedAccounts`, making the screen's own filter the **single source of scope for both totals and net worth**. Pleasant side effect: this removes today's double filter (screen, then domain again), which is exactly what would let a future "include archived" change *look* like it works while quietly not.

Also: `visibleAccounts` becomes `includeArchived ? accounts : accounts.filter(a => !a.archived)`; archived accounts then appear in the filter pills, sheet, account list and chart legend, each needing a **muted "Archived" marker**. The stale-selection case is already handled — `effectiveIds` falls back to all ids when the selection resolves to nothing, so turning the toggle off while only archived accounts were selected lands on "All accounts" rather than an empty dashboard. Lock that in with a scenario (§7.10).

### 5.5 Explainer copy — the retroactive-history point

**Archiving retroactively changes historical totals.** Last March's income/expense/net — and net worth as of last March — all drop the archived account's rows, though nothing about March changed. That is the surprise this toggle exists to make explainable.

- The toggle carries a caption when ON: *"Archived accounts are included — totals and net worth for past periods will differ from the default view."*
- The archive confirm gets an honest, expanded body: hidden from lists and pickers, removed from net worth, **and removed from past totals too**; transactions are kept; it can be restored from Manage accounts at any time.

That last clause is only truthful once §5.2 ships — hence §6.

### 5.6 Widget stays excluded — deliberately

**No change to `src/features/widget/summary.ts`.** A widget is a glance surface with no toggle and no room for a caption; a number that can silently mean two things is worse there than anywhere else. The widget always equals the dashboard's **default (toggle-off)** number. Recorded as a criterion (§7.14) so nobody "fixes" the asymmetry later.

### 5.7 Referential-integrity guard (dangling account references)

Folded in here because this spec already owns the backup/restore round-trip and the account-lifecycle paths that could produce a bad reference.

**What was verified:**

- **No foreign keys.** `transactions.accountId` and `transferAccountId` are plain `text` columns in `src/db/schema.ts` — no `references()`, no `PRAGMA foreign_keys`. Nothing at the DB level prevents a transaction pointing at an account that does not exist.
- **No dangling-reference check anywhere.** The only "orphan" mentions in the codebase concern encryption sidecar files (`src/db/client.ts`) — unrelated.
- **Restore does not validate references.** `src/features/backup/repository.ts` re-inserts accounts and then re-inserts transactions; zod validates each row's *shape*, never that its `accountId` resolves to a real account.

**What is NOT a risk (stated so nobody builds a guard for it):**

- **Deleting a transfer transaction cannot orphan anything.** A transfer is one row (§8.2); nothing else references it. Deleting it removes the movement from both accounts simultaneously.
- **Deleting an account cannot leave a dangling transaction.** `deleteAccountCascade` sweeps `accountId = X OR transferAccountId = X`, so a transfer touching the deleted account goes with it.
- **Archiving cannot orphan anything** — the account row survives; only its visibility changes.

**The residual exposure** is therefore narrow but real: the **legacy `.json` restore path** (pre-M3 backups still restore, and a hand-edited or truncated file is user-reachable — the file is visible in Files), and any future code path that removes an account without going through the cascade. The whole-DB `.sqlite` image is complete-by-construction and stays consistent.

**Why it matters even though it is unlikely:** `accountBalance` iterates accounts and sums matching transactions, so a row pointing at a missing account is summed into **nothing**. It contributes to no balance and no net worth, yet still renders in the Transactions tab. Silently invisible money is painful to notice and worse to explain.

**Required:**

- Add a pure `findDanglingAccountRefs(transactions, accounts): { txId: string; missingAccountId: string; field: 'accountId' | 'transferAccountId' }[]` to `src/domain/accountArchive.ts` (or its own module — implementer's call). Framework-free, so the plain-Node suite covers it. It must check **both** columns; checking only `accountId` would miss exactly the transfer case this spec cares about.
- Call it on the **restore** path after inserting accounts and transactions. On a non-empty result: do **not** silently import. Report the count to the user and log it content-free (ids only, no amounts or payee names — guardrail #5). Whether to refuse the restore outright or import-and-warn is §12.2.
- Do **not** add `references()` / `PRAGMA foreign_keys` in this spec. That is a schema migration on a live shipped app with its own failure modes; if we want DB-level enforcement it deserves its own spec and its own migration test.

### 5.8 Promote Archive in the delete flow — presentational only

**Nothing about the destructive path changes.** All of these stay exactly as they are: the iCloud preflight; the impact disclosure (transaction count, transfer count, named counterparty accounts); the typed-name confirm; the forced pre-delete backup inside `deleteAccountCascade`.

The change is **which button is primary**, decided by `recommendArchiveOverDelete(impact)`:

- `transactionCount > 0` → the sheet leads with a full-width primary **"Archive instead"**, and **"Delete permanently"** demotes to the small text-link treatment already used elsewhere on that screen — still below the typed-name input, still gated on the name matching.
- `transactionCount === 0` → nothing to preserve; keep today's layout, since the recommendation would be noise.

The existing sentence *"Archive instead keeps everything."* becomes an actionable button rather than prose. The chat handoff card's success line should gain *"You can restore it from Settings → Manage accounts."* — **only after** §5.2 ships.

## 6. Sequencing (non-negotiable)

1. **§5.1 + §5.2 (restore path).** Then, and only then:
2. **§5.5 copy** that promises restorability, and **§5.8** promotion.
3. **§5.3 + §5.4 (dashboard toggle)** — same PR or later, but never before step 1.

Every promotion in step 2 makes a promise ("you can get it back") that is false until step 1 exists.

## 7. Acceptance criteria

**Node BDD** — `tests/__features__/account-archive.feature` + steps:

1. `splitAccountsForManage` partitions correctly, preserving input order.
2. It applies the same query predicate to both lists.
3. `matchesAccountQuery` matches name, tag and subtype case-insensitively; empty query matches everything.
4. `hasArchivedAccounts` false for empty and all-active; true when any is archived.
5. `archiveActionFor` returns `'unarchive'` for archived and `'archive'` otherwise — **including `archived: undefined`**.
6. `recommendArchiveOverDelete` true when `transactionCount > 0`, false at 0. Build the impact through `computeAccountDeleteImpact`, not by hand, so the two stay coupled.

**Balances:**

7. `netWorth` / `netWorthAsOf` / `accountPeriodBalances` still exclude archived when given the full list — the existing `net-worth.feature` scenarios pass **unmodified**.
8. `netWorthOfAsOf` sums exactly what it is given, archived included, and equals `netWorthAsOf` when handed a pre-filtered list.
9. `periodBalancesOf` returns one row per account given, with identical arithmetic.

**Filter interaction:**

10. A selection naming only archived ids collapses back to the full active list via `effectiveIds`.

**Screen-level (simulator):**

11. Archive → reopen Manage accounts → the account is under "Archived · 1"; Unarchive returns it to the active list and the dashboard.
12. No "Include archived" control when nothing is archived.
13. With one archived account, toggling changes **both** the headline net worth and the period totals; toggling off restores the previous values exactly.
14. The widget's monthly income/expense is **unchanged** by the toggle in either position.
15. Delete-confirm for an account with transactions leads with "Archive instead"; "Delete permanently" is still disabled until the typed name matches and still forces a pre-delete backup.
16. Delete-confirm for an account with zero transactions is unchanged.

**Round-trip (guardrail #1):**

17. Archive → back up → restore: returns archived, transactions intact. Plus the reverse: restore a backup taken while archived, unarchive, verify it persists as not archived.

**Referential integrity (§5.7):**

18. `findDanglingAccountRefs` returns `[]` for a consistent dataset.
19. It flags a transaction whose `accountId` names no existing account, reporting `field: 'accountId'`.
20. **It flags a transfer whose `transferAccountId` names no existing account, reporting `field: 'transferAccountId'`** — the case a naive `accountId`-only check would miss, and the one that matters for transfers.
21. It flags **both** fields when both dangle, as two entries for the same `txId`.
22. **Archiving an account produces no dangling refs** — the account row still exists (guards against a future "archive = soft delete" refactor quietly breaking this).
23. **`deleteAccountCascade` leaves no dangling refs**, including for a transfer whose *counterparty* was the deleted account — asserted over the pure cascade plan, not the DB.
24. **Deleting a single transfer transaction leaves no dangling refs** — the explicit regression test for the "orphan" concern, encoding *why* it cannot happen rather than only that it doesn't.
25. Reported entries carry ids only — no amount, payee, note or account name (guardrail #5).

## 8. Edge cases

**8.1 Archiving the last remaining account.** Net worth becomes 0 and the dashboard falls to an empty state saying "No accounts yet" — now false. The assistant also blocks logging with "Let's add an account first". **Required:** Manage accounts must distinguish "no accounts" from "all archived", and the dashboard's empty state should say so and point at the toggle. **Do not block** archiving the last account — a modal for a rare case, and the restore path makes it recoverable.

**8.2 Archiving a transfer counterparty.** Transfers are a single row, and archive keeps the row, so the *other* account's balance is untouched — materially different from delete, which rewrites the counterparty's history. The archived counterparty's **name still renders** on the surviving account's rows: correct, do not hide it. The transfer-destination picker already excludes archived accounts, so no *new* transfer can point at one — keep that. With the toggle ON, both sides are in scope and the transfer nets to zero across the pair exactly as before.

**8.3 Archiving an account with a recurring series.** `recurringSeries.archived` is a different concept wearing the same word — it is the recurring screen's soft-delete and has **no** relationship to `accounts.archived`. Verified consequence: `postDueOccurrences` checks only the series' own flags and never the target account, so a series pointed at an archived account **keeps minting transactions into it on every launch** — invisible on the dashboard yet real in the DB and visible in the Transactions tab.

**DECIDED 2026-08-05 (reverses the deferral below): archiving an account STOPS its recurring series from posting.** Leaving them running is indefensible once the ledger also hides archived rows — the series would keep minting transactions into an account the user believes is put away, and those rows would now be invisible by default too.

**Implementation: gate at post time, do not mutate the series.** `postDueOccurrences` skips a series whose target account is archived. This is the same doctrine as future-dated transactions — derive the behaviour from state we already store rather than adding a flag:

- **No `paused`/`archived` write on the series.** That was the original objection and it still holds: a silent mutation of a second entity behind a hide action, which unarchive could not reliably undo (it cannot know which series *it* paused versus which the user paused deliberately).
- **Unarchiving resumes posting automatically**, with nothing to reverse, because nothing was changed.
- A series whose target account is archived must also be **visibly marked** on `app/recurring.tsx` — otherwise it silently does nothing and looks broken. Something like a muted "Paused — account archived" state.

**Semantics: PAUSED, not deferred.** Archiving suspends the schedule; unarchiving resumes it **from that moment**. Nothing accrues in between and nothing is delivered late.

**The gap this avoids.** `dueOccurrences` advances its cursor from `lastPostedAt`, so a naive post-time skip alone would leave the cursor stranded in the past — and unarchiving after three months would **back-post three months of occurrences in one go**, the precise opposite of what archiving was asked to do. "Paused" must therefore also move the cursor forward at resume; skipping alone is not enough.

**Where the cursor moves: at unarchive, not on every launch.** Two writes could implement this — advancing the cursor on each post run while archived, or advancing it once when the account is restored. Prefer the latter:

- It is one write at a **well-defined user action**, not a background side-effect that fires whenever the app happens to open.
- If the app is never opened while the account is archived, the first approach does nothing anyway — so the unarchive write is both sufficient and easier to reason about.
- It keeps the archived period genuinely inert: no series state changes while an account sits archived.

So: `postDueOccurrences` skips series whose target account is archived (creating nothing), and **unarchiving advances `lastPostedAt` to now** for series targeting that account, so the next occurrence is computed forward from the restore. Still no `paused`/`archived` flag written on the series itself — which is what kept unarchive from having to distinguish "paused by the user" from "paused by us".

This is the one part of the decision that is not reversible after the fact, so it is worth a deliberate check on device: archive an account with a daily rule, leave it a few days, restore it, and confirm exactly one future occurrence follows rather than a burst of backdated ones.

**8.4 Restoring an account whose name now collides.** There is no uniqueness constraint on `accounts.name`, and neither the repository nor `accountSchema` enforces one — so a user can archive "DBS", create a new "DBS", then unarchive and hold two. Nothing breaks numerically (everything keys off ids). What breaks is **name-based resolution**: `findAccountMatch` for chat ops and the Ask-Xavier account tool, and the typed-name delete confirm, which would accept the same typed string for either twin.

**Spec'd behaviour:** unarchive does **not** block on a collision (blocking would strand the account), but the confirm warns when `collidesWithActiveName` is true and offers **"Rename while restoring"** alongside **"Restore anyway"**. Never auto-rename. Cover the pure check with a scenario.

**8.5 Archived account with a pending transaction.** Pending rows already contribute 0 everywhere, so archiving changes nothing for them. No action.

**8.6 Toggle ON, then the last archived account is unarchived.** The render gate goes false while `includeArchived` is still `true` — harmless, but **reset it to false whenever `hasArchivedAccounts` is false**, so a later archive doesn't silently resurrect a lens the user can no longer see.

**8.7 Search plus the archived section.** Search must look in both lists, and a match found only among archived accounts must **auto-expand** the archived section — otherwise the screen reads "No matching accounts" while the match sits collapsed one section below.

## 9. Constraints

- **Guardrail #1:** no column and no settings key is added (given §5.3), so the round-trip surface is unchanged and `archived` already round-trips. Verify anyway — criterion 17.
- **Guardrail #4:** unarchive goes through the existing Drizzle `updateAccount`. No new SQL.
- **Guardrail #6:** no new trust boundary; `archived` is already zod-validated on every read/restore path.
- New logic **framework-free** under `src/domain/`. No expo/react-native imports in `accountArchive.ts` or the new `balances.ts` helpers.
- `updateAccount` bumps the data revision, so an unarchive correctly triggers the next auto-backup, exactly as archive does today.
- Do **not** change the widget, the transaction pickers, the assistant's account scoping, or the query tools.
- `npm run typecheck`, `npm run lint`, `npm test` green before the PR.

## 10. Risks

1. **The de-double-filter refactor touches `src/domain/balances.ts`, which every money surface depends on.** Mitigation: existing exports keep both signatures *and* semantics (pure delegation); `net-worth.feature` and `period-balances.feature` run unmodified as the net; the `*Of` functions are purely additive.
2. **A headline number that changes with a toggle invites "the app showed me two net worths".** Mitigation: the toggle exists only when it can matter, defaults off every launch, carries the §5.5 caption; the widget and Ask Xavier keep exactly one answer.
3. **Users may read the archived section as a trash can.** Mitigation: label it "Archived", never "Deleted"/"Trash"; the confirm states transactions stay in the ledger.
4. **Promoting Archive grows an archived pile.** Acceptable — reversible and non-destructive is the point — but it makes the collapsed section and the recurring disclosure load-bearing rather than nice-to-have.
5. **Recurring series posting into archived accounts (§8.3)** is a pre-existing defect this spec surfaces but does not fix. If the disclosure ships without the follow-up, expect a support question. Track it separately.

## 11. Test plan

- **New:** `tests/__features__/account-archive.feature` + steps covering criteria 1–6 and the §8.4 collision check, building accounts with `makeAccount` from `tests/support/world.ts`.
- **Extend:** `net-worth.feature` with criterion 8, keeping the existing scenarios untouched as regression proof; `period-balances.feature` with criterion 9; `account-filter.feature` with criterion 10; `backup-sqlite-rows.feature` with the unarchive direction of criterion 17.
- **Manual simulator pass** for criteria 11–16, including the widget check with the toggle in both positions and one archive → relaunch → restore cycle proving nothing about the lens persisted.
- **New:** `tests/__features__/account-referential-integrity.feature` + steps covering criteria 18–25. All pure — no DB, no fixtures beyond `makeAccount`/`makeTransaction`.

## 12. Open questions

1. **Persisted vs session-scoped toggle (§5.3).** Recommended session-scoped, with the reasoning and the escape hatch stated. Worth revisiting if usage shows people re-toggling every launch.
2. **On a dangling reference at restore: refuse, or import-and-warn?** Refusing is safer but can leave a user with a corrupt-ish backup and no way in — which is worse than a slightly inconsistent import they can then fix. Import-and-warn keeps their data reachable but means the app knowingly holds rows that contribute to no balance. **Leaning import-and-warn**, with the count surfaced clearly and the affected ids logged, but this is a product call and should not be decided by whoever implements it.
3. **Should a dangling reference be repairable in-app** (e.g. "reassign these 3 transactions to an account")? Out of scope here, but it is the natural follow-up if telemetry ever shows this happening for real.
4. **DB-level enforcement** (`references()` + `PRAGMA foreign_keys`) is deliberately excluded (§5.7). If we ever want it, it needs its own spec and a migration test — turning it on against existing data that already violates it would fail at open time, which is a far worse failure than the one it prevents.

# Learned payee defaults — the user's correction sticks

**Status:** implemented (parse-quality plan, package C1). Pure rules in
`src/domain/learnedDefaults.ts`; BDD in
`tests/__features__/learned-defaults.feature`.

## 1. Problem

Every parse engine (on-device FM, BYOK cloud, heuristic) always fills
`category` — it is a required schema field. The save sequence only ever used
a payee's remembered `defaultCategoryId` when the draft had *no* category, so
for a known payee the engine's guess always won, and only a brand-new payee
ever learned anything. The parse-metrics edit rows showed users re-picking
the same category for the same payee, parse after parse.

## 2. Rules

All rules run as a pure post-step after `interpret()` (which stays
payee-agnostic) and before the budget "Log it" preset, in the assistant
screen's `presetDraft`.

### 2.1 Category

For a draft whose payee is an **exact** known payee (`findPayeeMatch(...).exact`
— a fuzzy "did you mean…?" is never trusted) with a `defaultCategoryId`:

- The remembered category replaces the engine's proposal, **unless the user
  typed the proposal themselves** — a fact check on their own words via
  `mentionedInText`, never a judgement about context. Typed wins.
- Not applied when the remembered category no longer exists, is of another
  kind (an expense default never lands on an income draft), or is what the
  engine proposed anyway.
- The replacement is flagged on the draft (`learnedCategory`) with exactly
  what to restore. The draft card shows *"Using Coffee as last time."* with a
  one-tap *"Use Food instead"* (or *"Clear it"* when the engine proposed
  nothing). Reverting also re-runs the proposal's "did you mean…?" reconcile.

### 2.2 Account

For the same exact payee, when it remembers a `defaultAccountId`:

- Applied only when the engine named **no** account (`defaulted.account`) and
  the user's words named none either (`unmatchedAccountName`,
  `ambiguousAccountNames` and `accountSuggestion` all unset — the card already
  handles those and a remembered account must never paper over them).
- Never applied to a transfer, to an archived/deleted account, or across
  currencies: `interpret()` forced `currency` to the draft account's own and
  only records a conflict with what the user typed in `mismatchedCurrency`,
  so the switch is made only when it cannot create a conflict this step can't
  see — same currency as the draft, or exactly the currency the user typed
  (which then *resolves* the conflict instead of hiding it).
- Flagged as `learnedAccount` with the account, currency and conflict the
  draft had before; the card's *"Using Visa as last time."* + *"Use Wallet
  instead"* restores all three.

### 2.3 Learning — last confirmed wins

`payeeDefaultsPatch(payee, { categoryId, accountId, kind }, categories)`
decides what to write back; `rememberPayeeDefaults`
(src/features/payees/repository.ts) writes it.

- After `createTransaction` in the AI save sequence (never before — a refused
  or failed write teaches nothing), an existing payee's defaults become the
  category and account the user just confirmed, when they differ. A new payee
  is created with both as its first-used defaults.
- A post-save edit of an AI-sourced row on the Transactions tab or the
  account screen (the `recordEditByTxId` path) teaches the same way.
- A missing category never clears a remembered one. Nothing is written when
  nothing changed. Silent by design: it is the user's own choice.
- One default category per payee, of one kind. A save of the other kind (an
  income refund from a payee that remembers an expense category) leaves the
  remembered category alone; the category is written only when the payee
  remembers none, when the remembered one no longer exists, or when it is of
  the saved transaction's kind. The account is still learned. (Apply time
  already skips a default of the wrong kind, §2.1 — letting the refund write
  would only cost the next expense its default.)
- Best-effort: the write-back runs after the row is written, so its failure
  is caught and logged (no user data) and never reaches the save's caller —
  otherwise the screen would report a failed save and a second tap would
  write the row twice.
- Statement-scan queue cards learn like any other confirmed draft (§4).
- Manual entry: a hand-entered row (create or edit) that names a NEW payee
  seeds that payee's defaults — it is created with the row's category and
  account. Manual edits never teach an EXISTING payee: only edits of
  AI-sourced rows do (above), and a hand-entered row with an existing payee
  teaches nothing.
- Deleting an account clears `default_account_id` on every payee that
  remembered it (inside the account-delete cascade's transaction); deleting
  a category clears `default_category_id` the same way (inside
  `deleteCategory`'s transaction).

## 3. Storage

`payees.default_account_id TEXT` (nullable), added via `ADD_COLUMNS` in
`src/db/migrationPlan.ts` for existing installs. `payeeSchema` accepts it as
optional, so a `.sqlite` image or legacy `.json` backup taken before the
column existed still restores (guardrail #1); the backup repository re-inserts
it. Covered by migration.feature, backup-sqlite-rows.feature and
backup-restore.feature.

## 4. Non-goals

- No change to the engines or their prompts.
- No "are you sure?" — the flag + revert on the card is the whole affordance.
- Statement-scan drafts adopt an exact payee's remembered category through
  the same `applyLearnedCategory` rule (`statementDrafts.ts`): same kind
  check, same flag on the card. A statement row has no engine proposal, so
  the card's revert clears the category, and no user text, so nothing counts
  as typed. Their account is the one the user chose for the scan, so the
  account rule does not apply there.

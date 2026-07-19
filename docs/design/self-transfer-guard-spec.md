# Spec: self-transfer guard (review F2 — copy can debit an account)

Fixes the confirmed critical from the 2026-07-18 repo review: copying an
**incoming** transfer from an account-detail screen pins `accountId` to the
viewed account while keeping the original `transferAccountId`
(`app/account/[id].tsx:171-179`), producing a transfer whose source and
destination are the same account. Nothing rejects that row —
`transactionSchema` only requires a destination (`src/lib/validation.ts:78-85`)
— and `signedDelta` tests the source side first (`src/domain/balances.ts:24-26`),
so the row books as pure outflow: the balance and net worth drop by the amount.

The assistant flow already makes self-transfers impossible by construction
(`src/domain/assistant.ts:271`); this spec closes the manual paths and adds the
invariant at every layer that can hold it today. No product forks — behaviour
is unambiguous. Smallest of the three critical fixes; ship first.

## Scope

**IN:**
1. **Copy preserves the transfer pair** — in `openCopy`, seed the form with
   `accountId: tx.accountId` instead of the route `id`. For expenses/incomes
   this is identical (rows only appear on their own account's screen); for
   transfers it duplicates the original A→X movement instead of forging X→X.
2. **Shared validation invariant** — add to `transactionSchema` and
   `recurrenceTemplateSchema` (`src/lib/validation.ts`):
   `.refine((t) => !t.transferAccountId || t.transferAccountId !== t.accountId)`
   with message "A transfer can't use the same account on both sides".
3. **Form-level guard in both manual save paths** — the destination account
   picker excludes the currently selected source account; if a stale selection
   slips through (source changed after destination picked), save shows the
   error instead of persisting. Applies to the transaction form used by
   `app/(tabs)/transactions.tsx` and `app/account/[id].tsx`.
4. **Neutral math as defence in depth** — `signedDelta`'s transfer branch
   returns `0` when `tx.accountId === tx.transferAccountId` (a self-transfer is
   economically neutral; `-amount` is simply wrong arithmetic). Existing bad
   rows stop distorting balances even before the user repairs them.
5. **One-time data scan** — pure helper `findSelfTransfers(transactions)` in
   `src/domain/balances.ts` (or a small `integrity.ts`); after DB init in
   `app/_layout.tsx`, if any exist, show a one-time alert listing date + amount
   of each (there can only be a handful — the bug needs the specific copy
   flow) and point the user at Transactions search to edit or delete them.
   Gate re-prompting behind a settings key (`selftransfer_scan_ack`).

**OUT:**
- SQLite `CHECK (transfer_account_id != account_id)` — correct end state, but
  adding a CHECK to an existing SQLite table means a table rebuild, and the
  migration machinery is unversioned (review F9). Goes in the migrations epic.
- Automatic repair of existing self-transfers — the original source account is
  not recoverable from the row; guessing would fabricate history. User repairs
  via edit with the alert's guidance.
- Refund semantics, amount bounds (M5) — separate spec.

## Approach (concrete)

### `app/account/[id].tsx` (~171)
```ts
const openCopy = (tx: Transaction) => {
  // …
  setInitial({
    accountId: tx.accountId,          // was: id — forged X→X for incoming transfers
    transferAccountId: tx.transferAccountId ?? '',
    // … rest unchanged (date: Date.now(), amount, names, note)
  });
```

### `src/lib/validation.ts`
Third refine on `transactionSchema`, sibling to the two existing
`transferAccountId` refines (:78-85); same predicate on
`recurrenceTemplateSchema` (templates carry `accountId` + `transferAccountId`
too, so a recurring series must not be able to encode a self-transfer either).

### `src/domain/balances.ts` (~24)
```ts
case 'transfer':
  if (tx.accountId === tx.transferAccountId) return 0; // self-transfer: neutral
  if (tx.accountId === accountId) return -tx.amount;
  if (tx.transferAccountId === accountId) return tx.amount;
  return 0;
```

### Form pickers
Wherever the destination-account options are built for the transfer form,
filter out `values.accountId`; on source change, clear the destination if it
now equals the source.

## Acceptance criteria
1. **Node suite green** — typecheck, lint, `npm test`. New BDD scenarios:
   - schema rejects a transfer with `accountId === transferAccountId`
     (transaction and recurring template)
   - schema still accepts a normal A→B transfer
   - `signedDelta` returns 0 for a self-transfer row, for both account views
   - `findSelfTransfers` finds the bad row among good ones, empty otherwise
2. **Copy behaviour (device/sim confirm)** — on account X, copy an incoming
   A→X transfer → the sheet opens pre-filled A→X; saving it moves A→X again;
   X's balance rises.
3. **Guard behaviour** — attempting to select the source as destination is
   impossible; a contrived same-account submit shows the error, saves nothing.
4. **Scan** — a seeded self-transfer row triggers the one-time alert;
   acknowledged → not re-shown; balances already exclude it (criterion 1).

## Edge cases
- **Copy of a transfer whose source account was deleted/archived** — archived
  accounts still resolve by id (archiving isn't deletion); if the id no longer
  resolves, fall back to current behaviour (pin to viewed account) — that copy
  is an outgoing transfer from X, which is at least coherent.
- **`transferAccountId: ''` sentinel** — the form uses `''` for "unset"; the
  refine must treat empty/null as "not a transfer pair", so the predicate
  checks truthiness first.
- **Recurring templates already in the DB** — the scan covers posted
  transactions; also check active series templates in the same pass (a
  self-transfer template would mint a new bad row every cycle).

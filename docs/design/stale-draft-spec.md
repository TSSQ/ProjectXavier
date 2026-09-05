# A pending draft must not outlive the data it points at

Status: spec, 2026-09-05. Branch `claude/repeat-parity`, worktree
`.claude/worktrees/fm-spike`. From a user report on build 98: "xavier
confirmation sometimes doesn't clear after certain actions."

## 1. Objective

The Assistant's confirmation card holds an `accountId` and a `currency`
resolved when it was created. Both can be invalidated by actions on other
tabs while the card is still on screen, and Save then writes regardless.
Close that, and stop leaving a card under a reply that contradicts it.

## 2. Verified findings (all confirmed in code, none speculative)

1. **No integrity check anywhere on the write path.**
   `transactions.accountId` is `text().notNull()` with **no**
   `.references()` (`src/db/schema.ts:41`); `transactionSchema` checks
   `z.string().min(1)` — shape, not existence (`src/lib/validation.ts`);
   `saveAssistantDraft` passes `draft.accountId` straight through
   (`src/features/ai/saveDraft.ts:83`). Deleting the account behind an open
   card and pressing Save inserts an orphan row. Silent.
2. **Currency conflict is computed once, at parse time**
   (`src/domain/assistant.ts:229-249`) and `pending.currency` is frozen to
   the account's currency at that moment. Settings' `relabelCurrency`
   rewrites every account and transaction row's currency code in place and
   knows nothing about in-memory state, so a card created before the
   relabel saves the old code into a relabelled ledger — bypassing
   guardrail 3's "ask, never convert" precisely because the ask already
   happened, against stale facts.
3. **Restoring a backup** replaces every table (`applyBackup`) with no
   reload or broadcast; a card built from the pre-restore world survives
   and saves into the new one.
4. **The queue has the same exposure, for longer**:
   `beginStatementQueue` resolves every row's `accountId` up front, and a
   30-row review has no timeout.
5. **The guard already exists for a sibling.** `loadContext` re-checks
   `dataRevision` on every focus and clears a stale `txOp` picker
   (`app/(tabs)/index.tsx:701-706`). `pending` and `queue` were never given
   the same treatment. This is the shape to reuse, not invent.
6. **Empty `/transactions`** returns before `runParse` — and therefore
   before `resetActiveDraftState()` — leaving the previous card under
   "Sure — what's the transaction?" (`app/(tabs)/index.tsx:1632-1635`).
   Cosmetic, but it is the cheapest reproduction of the report.

Tab switches do not unmount (`app/(tabs)/_layout.tsx` uses a plain
`<Tabs>`), which is why the card survives to meet the changed data.
Biometric relock DOES unmount and destroys the draft — the opposite
problem, out of scope here.

## 3. Approach — two layers, both wanted

The write-boundary guard is the one that must exist; the state guard is
what the user actually sees.

### 3.1 Refuse to write a draft that no longer makes sense

`saveAssistantDraft` (and the queue's save path) must, against the live
DB at save time:

- Reject a draft whose `accountId` matches no account. Throw a typed
  error the screen can catch and explain — not a silent no-op.
- Re-derive the currency conflict against the account's CURRENT currency
  and refuse rather than write a mismatched code, mirroring what
  `interpret` would have decided had it run now.

This is pure, testable in the plain-Node suite, and protects every path
including ones this spec did not enumerate.

### 3.2 Re-validate the card when the data changes underneath it

In `loadContext`, alongside the existing `txOp` revision check:

- When `dataRevision` has moved, re-validate `pending` and `queue` rather
  than blanket-clearing them. **Keep the card** when its account still
  exists with the same currency — the common case is the user visiting
  another tab and coming back, and silently binning something they typed
  would be its own bug.
- **Clear it** when the account is gone or its currency changed, with a
  reply that says why: e.g. "That account's gone now — tell me again?"
  Never leave it on screen, never clear it wordlessly.
- The queue: same rule per remaining card. If the queue's account is
  gone, stop the review and say so rather than dropping rows silently.

### 3.3 Empty `/transactions`

Reset like any other message before replying "Sure — what's the
transaction?".

## 4. Acceptance criteria

1. `saveAssistantDraft` throws a typed error when `accountId` matches no
   live account; the screen catches it and tells the user, and no row is
   written (assert the table count is unchanged).
2. It throws likewise when the account's currency no longer matches the
   draft's, and no row is written.
3. A draft whose account is untouched still saves exactly as today —
   byte-identical row.
4. Re-validation keeps a card when the revision moved but its account is
   unchanged (the Transactions-tab round trip must not eat a draft).
5. Re-validation clears the card, with an explanatory reply, when the
   account was deleted; and when its currency was relabelled.
6. The queue stops with an explanation when its account disappears
   mid-review; remaining rows are not silently dropped.
7. Empty `/transactions` clears any open card before replying.
8. `npm run typecheck`, `npm run lint`, `npm test` green.

## 5. Constraints

- Domain stays framework-free; the guard in 3.1 belongs where the
  plain-Node suite can reach it, taking the account list as an argument
  rather than reading the DB itself if that keeps it pure.
- Guardrail 1 (SQLite is the source of truth) and guardrail 3 ("ask,
  never convert") are the two this closes — say so in the code.
- No migration in this spec (see §6).

## 6. Follow-ups

1. **A real foreign key on `transactions.accountId`.** The runtime check
   above is the pragmatic fix; the schema-level one is the correct fix and
   needs a migration plus a decision about what to do with any orphans
   already written by this bug. Worth doing deliberately, separately.
2. **An orphan sweep** — find and report rows whose `accountId` matches no
   account, so an existing user's ledger can be repaired rather than
   silently carrying bad rows.
3. **Biometric relock destroys an in-progress draft** (the inverse of this
   bug). Minor UX papercut; worth preserving the draft across unlock.

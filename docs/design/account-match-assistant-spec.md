# The assistant should use the account matcher it already has

Status: spec, 2026-09-05. Branch `claude/repeat-parity`, worktree
`.claude/worktrees/fm-spike`. User report on build 98.

## 1. Objective

"Spent 20 at the singapore pools wallet" fails to find the account unless
the model echoes the name almost exactly. Wire the chat path to
`findAccountMatch`, the four-tier matcher this repo already ships and
already uses elsewhere.

## 2. Verified finding

`interpret` (`src/domain/assistant.ts:210-213`) resolves the model's
account name with a raw equality test:

```ts
const named = parsed.account
  ? active.find((a) => a.name.toLowerCase() === parsed.account!.toLowerCase())
  : undefined;
```

`interpretTransfer` (`:353`) does the same for its own named account.

Meanwhile `src/domain/accountMatch.ts`'s `findAccountMatch` offers, in
order: case-insensitive exact on a normalised name (trim + collapsed
whitespace + punctuation), token/substring containment, a subtype cue
("the card", "the wallet"), then fuzzy edit-distance as a suggestion —
returning `{account, confidence}` or `{confidence: 0, ambiguous: [...]}`.
`queryTools.ts:282` and `statementDrafts.ts` both use it.

Measured against accounts `["Singapore Pools Wallet", "OCBC 365"]`, over
twelve realistic model outputs, `interpret`'s rule matched 3;
`findAccountMatch` matched 12. The three that pass today are exactly the
ones differing only by letter case; a dropped word, a doubled space, a
trailing space or a full stop all fail.

This is not a weak matcher — it is a good matcher that one path was never
wired to.

## 3. Approach

Replace both raw lookups with `findAccountMatch`, and decide deliberately
what each of its three outcomes means. **Confidence must gate behaviour**
— silently adopting a 0.7 fuzzy guess would put a transaction in the
wrong account, which is worse than today's failure to match.

- **Confident match** (exact/containment, and the subtype cue when it
  resolves to exactly one account): use it, exactly as a verbatim name is
  used today. No warning.
- **Ambiguous** (`ambiguous` non-empty — e.g. "the wallet" with two
  wallets): do NOT guess. Fall back to the default account as today, and
  surface the ambiguity so the user can correct it rather than discovering
  it later. Reuse the existing `unmatchedAccountName` card affordance if
  it fits; propose better copy if it doesn't ("Which wallet — X or Y?").
- **Fuzzy-only / no match**: keep today's behaviour — default account plus
  the existing `unmatchedAccountName` warning. A low-confidence guess must
  never silently win.

Decide and document where the confidence cut sits, and justify it from
the tiers rather than picking a round number.

`interpretTransfer` gets the same treatment for its named account. Note
its `from`/`to` resolution has its own precedence (`fromMatch ??
namedMatch ?? defaultMatch ?? firstOther`) — preserve that ordering
exactly; only the matching within each step changes.

## 4. Acceptance criteria

1. Every variant in the table below resolves to "Singapore Pools Wallet"
   against accounts `["Singapore Pools Wallet", "OCBC 365"]`:
   `Singapore Pools`, `singapore pools`, `Singapore  Pools  Wallet`,
   ` singapore pools wallet `, `Singapore Pools wallet.`, `pools wallet`.
2. The three that already work still work, unchanged.
3. With two accounts both matching a cue ("Cash Wallet", "Travel
   Wallet") and the model saying "the wallet", NO account is silently
   chosen: the draft uses the default and the ambiguity is surfaced.
4. A name matching nothing keeps today's behaviour exactly — default
   account, `unmatchedAccountName` set.
5. An archived account is never matched (today's `active` filter must
   survive — pass only active accounts to the matcher).
6. `interpretTransfer`'s from/to precedence is unchanged; a transfer
   naming a source loosely resolves it, and a transfer whose named
   account equals the destination still falls through as today.
7. `npm run typecheck`, `npm run lint`, `npm test` green.

## 5. Constraints

- Domain stays framework-free; `findAccountMatch` is already pure.
- Do not change `findAccountMatch` itself — three call sites depend on
  it, and its tiers are tested. This spec changes who calls it, not what
  it does.
- No change to the scan/queue path, which resolves accounts up front from
  the user's own choice.

## 6. Follow-up

The same raw-equality shortcut may exist for payees and categories; worth
a sweep once this lands, since `findPayeeMatch`/`findCategoryMatch` exist
for the same reason.

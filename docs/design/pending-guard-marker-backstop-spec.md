# Build spec — pending guard becomes a marker-presence backstop (Option 3)

Worktree: `.claude/worktrees/fm-spike` (branch `claude/account-creation-spike`).
Decision made in /discuss (user chose Option 3) — no fork; Spec auto-passes.

## Objective
Fix the guard so a genuinely pending utterance is never dropped over phrasing
mechanics ("27.72$ on dinner pending" was rejected because of the trailing `$`).
Replace the amount-adjacency heuristic — a regex trying to judge *what a marker
refers to*, which it can't do reliably — with a **hallucination backstop**: keep
the FM's `pending=true` only when an explicit pending marker actually appears in
the user's own words, anywhere in the text. Same shape as the proven
`mentionedInText` guard for payees/accounts (which checks a *fact* — does the
name appear — not context).

## Why this is safe now (context that changed)
- The FM is reliable on these phrasings: the Mac probe (`fm-probe/probe.swift`,
  trailing-marker run) returned `pending=true` **25/25** for "27.72$ on dinner
  pending", "27.72 on dinner pending", "dinner 27.72 pending", "$27.72 dinner
  pending", and stayed false on plain "40 dinner". So the model proposes
  correctly; only the guard was rejecting.
- Since build 27, a false positive is **visible** — a Pending pill on the
  confirmation card plus the Edit toggle — not a silent totals change. The
  precision-over-recall asymmetry the adjacency check was built for is gone; a
  wrong pill is one tap to clear.

## Scope (in)
`src/domain/deviceParsePrompt.ts`:
- Replace `textAssertsPending(text, amount)` and its adjacency regexes
  (`MARKER_IMMEDIATELY_BEFORE` / `MARKER_SHORTLY_AFTER` / the per-number scan)
  with a single pure exported `textHasPendingMarker(text): boolean` that returns
  true iff a marker from `PENDING_MARKER` matches in `text` (word-boundary,
  case-insensitive). No amount argument, no positional logic.
- Keep the existing `PENDING_MARKER` set unchanged:
  `pending | provisional | tentative | unconfirmed | unpaid |
  not yet (paid|confirmed|final(ised|ized)?)`.
- In `applyGroundingGuards`, change the pending line to
  `pending: parsed.pending && textHasPendingMarker(text)` (drop the `amount`
  threading). The guard still only ever KEEPS the FM's `true` — it never invents
  pending when the model said false.

## Out of scope
- No change to the FM schema, the `.describe`/instruction wording, or the parse
  prompt (the model behavior is already probe-validated). No re-probe needed.
- No change to the DraftCard pill (build 27), the manual toggle, aggregation
  exclusion, or `TransactionDraft`.
- Marker set is unchanged — not adding "might"/"maybe"/"not sure" (too broad;
  those are the *implicit* cases we deliberately don't auto-flag).

## Behavior changes (and the accepted tradeoff)
With adjacency gone, any text containing an explicit marker word — that the FM
also flagged — now counts as pending:
- FIXED (now true): "27.72$ on dinner pending", "40 for dinner, still pending on
  my card", and any marker-far-from-amount phrasing.
- ACCEPTED regressions (now true, were false): marker-present-but-context-wrong
  cases — "pending tray return, 4 cai fan"; "pending 2 days shipping, lunch was
  40"; "unpaid 2 invoices … dinner 40"; "not yet confirmed 3 times … 40".
  These surface a visible pill the user clears at confirm time. This is the
  deliberate Option-3 cost.
- UNCHANGED (still false): no-marker text — plain transactions ("40 dinner",
  "salary 3000") and implicit uncertainty with no marker word ("I might have
  spent 20", "not sure yet, 30 groceries", "waiting for the bus 2.50", "might go
  back later, paid 25").
- UNCHANGED (backstop): FM proposes `pending=true` but the text has no marker
  word → guard drops it to false.

## Test changes (`tests/__features__/device-parse-prompt.feature` + steps)
Rewrite the pending-guard scenarios to the new semantics:
- Explicit-marker cases (pending/provisional/tentative/unconfirmed) → true.
- No-marker plain + no-marker implicit cases → false.
- Add "27.72$ on dinner pending" (and "dinner 27.72 pending") → true.
- Flip the trap/stray-number scenarios that assert false → assert **true**, and
  rename/comment them as "accepted: marker present, context wrong — visible pill"
  so the intent is explicit, not an accident.
- KEEP a backstop test: FM proposes pending=true for a no-marker text
  ("paid 30 for gas") → guarded pending false. This is the reason the guard
  still exists.
- KEEP: FM proposes false → guarded false (never invents).
- Drop the amount-anchoring-specific tests (null-amount, stray-number-≠-amount)
  since amount is no longer part of the guard; replace with the marker-presence
  cases above.

## Acceptance criteria
- [ ] `textHasPendingMarker("27.72$ on dinner pending")` is true; the guarded
      pending for that parse (FM true) is true.
- [ ] `textHasPendingMarker` is true for every explicit-marker utterance and
      false for every no-marker utterance in the suite.
- [ ] Backstop holds: FM `pending=true` + no marker word in text → guarded false.
- [ ] FM `pending=false` → guarded false regardless of text.
- [ ] `applyGroundingGuards` no longer references an amount for pending.
- [ ] `npm run typecheck && npm run lint && npm test` green.

## Constraints
- Domain module stays framework-free (plain-Node BDD covers `textHasPendingMarker`).
- Treat FM output as untrusted; `aiParsedExpenseSchema` still re-validates.
- Word-boundary matching so "spending 40" does NOT match "pending" (keep the
  `\b` that already protects this).

## Edge cases
- "spending 40" / "depending on" — must NOT match (word boundary). Add a test.
- Multi-word marker "not yet paid" across a line break / extra spaces — fine to
  require single spaces; note if punctuation splits it.
- Case-insensitivity ("PENDING 40") → true.

## Suggested handoff
> Use the implementer agent to build this in the fm-spike worktree. Then
> qa-tester on the diff (focus: the fixed case, the accepted flips are intended,
> the hallucination backstop still holds, and "spending" doesn't false-match),
> then reviewer.

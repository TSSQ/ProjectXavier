# Build spec — show Pending on Xavier's confirmation card (DraftCard)

Worktree: `.claude/worktrees/fm-spike` (branch `claude/account-creation-spike`).
Small, obvious-shape UI addition. No fork.

## Objective
When Xavier parses an utterance the guard flagged as pending (e.g. "pending $40
dinner"), the confirmation card (`DraftCard`) that appears before saving should
visibly show that the transaction is **Pending** — today the flag only surfaces
inside the edit sheet, not on the confirm card itself.

## Scope (in)
- `app/(tabs)/index.tsx`, the inline `DraftCard` component (~line 847). Add a
  **"Pending" pill** in the card's header row (the `flex-row items-center
  justify-between` at ~line 907, which currently holds the capitalized
  `draft.type` on the left and the source pill — "On-device"/"Offline"/"AI
  parsed" — on the right). Render the pill only when `draft.pending === true`.
- Place the Pending pill next to the type on the left (so the source pill stays
  put on the right). Style it like the existing pills but in a distinct
  attention tone — reuse the app's amber/pending treatment used for pending
  transaction rows (`TransactionRow`'s "Pending" pill, build 25) so the two read
  as the same status. Match that pill's text/border/rounded-pill styling and
  color token; do not invent a new color.

## Out of scope
- No change to parse, the guard, save behavior, or `TransactionDraft` — the
  `draft.pending` flag already flows here (build 26). This is display only.
- No change to the edit sheet (`TransactionFormSheet`), which already shows the
  Pending toggle.
- No dimming of the card the way list rows dim; the confirm card stays fully
  legible (it's an action surface, not a list row).
- The `AccountDraftCard` is unrelated — leave it.

## Approach
- In `DraftCard`, the header currently is:
  `<View className="flex-row items-center justify-between mb-2.5">` with
  `<Text>{draft.type}</Text>` on the left and the source-pill ternary on the
  right. Wrap the left side so the type and (conditionally) a Pending pill sit
  together (e.g. a nested `flex-row items-center` with a small gap), then the
  source pill remains the right-hand child.
- Pending pill: a `Text` styled to match `TransactionRow`'s pending pill —
  find that component (`src/components/ui/TransactionRow.tsx`) and reuse its
  exact classes/label ("Pending") and color token for consistency.

## Acceptance criteria
- [ ] When `draft.pending` is true, the DraftCard header shows a "Pending" pill;
      when false/undefined, no pill renders and the header is unchanged.
- [ ] The pill's styling/label/color match the pending pill already used on
      transaction rows (one visual language for "pending").
- [ ] The source pill ("On-device"/"Offline"/"AI parsed") still renders in its
      usual place; layout doesn't break when both the Pending pill and a long
      source label are present (small screens — wrap/gap sensibly).
- [ ] No behavior change: saving still persists `draft.pending`; the edit sheet
      still opens with the toggle pre-set.
- [ ] `npm run typecheck && npm run lint && npm test` green.

## Constraints & conventions
- Match existing pill styling (`rounded-pill`, `text-[11px] font-bold`, border)
  and theme color tokens via `useThemeColors()`/NativeWind classes; no hardcoded
  hex.
- `DraftCard` is RN/Expo UI, excluded from the plain-Node BDD suite — so there's
  no new domain test to add; correctness is by code review + device confirm.
  Do not force an artificial unit test around a presentational pill.

## Edge cases
- `draft.pending` undefined (older drafts / heuristic path that sets false) →
  no pill, exactly as false.
- Transfers can be pending too (the flag is type-agnostic) — the pill should
  show for a pending transfer draft as well; don't gate it on `type`.

## Suggested handoff
> Use the implementer agent to build the spec above. Then qa-tester on the diff
> (focus: pill only shows when pending, styling matches the row pill, no layout
> break, save unchanged), then reviewer.

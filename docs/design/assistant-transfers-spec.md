# Build spec — Assistant transfers + payee hallucination guard

_Branch: `claude/account-creation-spike` (worktree `.claude/worktrees/fm-spike`)._
_Fixes two device-confirmed bugs from build 14 (screenshots 2026-07-07)._

## Objective
1. **Transfers can't save via the assistant** — structurally: `TransactionDraft`
   has no transfer target and `buildTransaction` hardcodes
   `transferAccountId: null`, so the zod refine (`validation.ts:45`) rejects
   every assistant transfer with the generic "I couldn't save that." Build real
   transfer support into the assistant path.
2. **Payee hallucination** — "received $1000 salary today" produced payee
   "Malaysia Trip": the small model picks from the grounded payee list even when
   no payee is named. Apply the same `mentionedInText` guard the account field
   already has (`deviceParse.ts:95`).

## Scope (in)
- `TransactionDraft` gains `transferAccountId` + `transferAccountName`.
- Deterministic transfer-target/source extraction from the user's text (domain,
  pure, BDD-tested) — the model's output is never trusted for the target.
- `interpret()` transfer handling incl. clarify outcomes for missing/ambiguous
  targets; `buildTransaction` passes the target through; `summarize()` says
  "Transferred … to <account>".
- `DraftCard` transfer rendering (From/To rows, neutral amount).
- `saveAssistantDraft` skips payee/category machinery for transfers.
- Pure `applyGroundingGuards` (account + payee) in `deviceParsePrompt.ts`,
  called from `deviceParse.ts`, replacing the inline account guard.

## Out of scope (do not touch/build)
- The FM/cloud prompt or schemas (`deviceParseSchema`, `AiParsedExpense`,
  the proxy edge function) — the target comes from deterministic text
  extraction, NOT a new model field.
- `TransactionFormSheet` transfer editing (the Edit path). If the sheet already
  supports transfer targets, wiring may ride along ONLY if trivial; otherwise
  keep the current behavior. Do not redesign the sheet.
- The manual transactions screen, balances/dashboard logic (transfers already
  exist there via manual entry — reuse, don't modify).
- The heuristic parser's classification rules (`localParse.ts`) — whatever type
  it emits flows through the same new interpret() logic.

## Approach (concrete)

### 1. Pure domain: transfer account resolution (`src/domain/` — new or in `assistant.ts`)
```ts
export interface TransferAccounts {
  to: Account | null;    // "to <name>" match
  from: Account | null;  // "from <name>" match
}
export function resolveTransferAccounts(text: string, accounts: Account[]): TransferAccounts
```
- Match `\bto\s+<accountName>\b` / `\bfrom\s+<accountName>\b` case-insensitively
  against ACTIVE account names (regex-escape names; reuse the escaping approach
  of `mentionedInText`). Prefer the longest account-name match when several
  match at the same keyword (e.g. accounts "Invest" and "Investments").
- Pure string+list logic, framework-free, exhaustively BDD-tested.

### 2. `interpret()` (`src/domain/assistant.ts`)
- `AssistantContext` gains optional `text?: string` (the raw user utterance —
  the screen already has it; pass it in `app/(tabs)/index.tsx`).
- When `parsed.type === 'transfer'`:
  - `const { to, from } = resolveTransferAccounts(ctx.text ?? '', active)`.
  - **No `to` match →** `{ kind: 'clarify', message: "Which account should I
    transfer to? (e.g. \"transfer $100 from OCBC 360 to Budget\")", missing:
    ['transferAccount'] }`.
  - **Source:** `from`-match ?? model-named account (existing `named` logic) if
    it differs from `to` ?? default account if ≠ `to` ?? first active ≠ `to`.
    If no active account other than `to` exists → clarify ("You'll need a second
    account to transfer between.") — kind 'blocked' is also acceptable; pick one
    and pin it in BDD.
  - **Self-transfer guard:** source resolved to the same id as `to` must be
    impossible by construction of the rule above — assert via BDD scenario.
  - Draft: `payeeName: null`, `categoryName: null`,
    `transferAccountId: to.id`, `transferAccountName: to.name`,
    `defaulted: { account: <source was fallback, not from-match/named>, payee:
    false, category: false, date: <as today> }`.
- Non-transfer types: unchanged (all existing BDD must stay green).
- `summarize()`: transfer → `Transferred SGD 100.00 to Budget. Save it?`
- `buildTransaction()`: `transferAccountId: draft.transferAccountId ?? null`.

### 3. Grounding guards (`src/domain/deviceParsePrompt.ts` + `src/features/ai/deviceParse.ts`)
- New pure export:
```ts
export function applyGroundingGuards(
  parsed: NormalizedDeviceParse, text: string
): NormalizedDeviceParse
```
  - Drops `account` when not `mentionedInText` (move the existing inline guard).
  - Drops `payee` when not `mentionedInText(payee, text)` — same rationale; a
    genuinely new payee typed by the user ("paid John 20") survives because the
    name is in the text.
- `deviceParse.ts` calls `applyGroundingGuards` instead of the inline account
  check. Behavior otherwise identical.
- BDD: account kept/dropped (existing behavior), payee kept when in text
  (exact + case-insensitive), payee dropped when hallucinated ("salary" text,
  known payee "Malaysia Trip" returned), payee kept for new-name-in-text.

### 4. Screen (`app/(tabs)/index.tsx`)
- Pass `text` into `interpret()`'s ctx (all engines — FM, cloud, heuristic — go
  through the same call sites; find them all).
- `DraftCard` transfer mode (when `draft.type === 'transfer'`):
  - Rows: Amount (neutral tone — no `+`/`-` sign, plain `text-text`), `From`
    (account name; amber "?" pill when `defaulted.account`, same interaction as
    today), `To` (`transferAccountName`, plain value), Date (existing pill).
  - Hide Payee and Category rows entirely (no New badges / did-you-mean chips
    for transfers).
  - Header already shows the type ("Transfer") — keep.
- `onEditSave`: if `FormValues` can't express a transfer target, leave the
  existing comment-documented limitation; update the comment to reflect that
  the primary Save path now handles transfers.

### 5. Save path (`src/features/ai/saveDraft.ts`)
- For `draft.type === 'transfer'`: skip category/payee resolution entirely
  (both null), pass through to `buildTransaction` → `createTransaction`, which
  now receives a valid `transferAccountId` and passes the zod refine.

## Requirements / acceptance criteria
- [ ] BDD (plain Node): `resolveTransferAccounts` — to/from extraction, longest-
      name preference, case-insensitivity, no-match → nulls, punctuation-safe.
- [ ] BDD: interpret() transfer scenarios — happy path ("transfer 100 to
      budget", accounts OCBC 360 default + Budget → draft with source OCBC 360,
      target Budget, payee/category null, correct summarize text); "from X to
      Y" source override; missing target → clarify with the pinned message;
      single-account → pinned blocked/clarify; self-transfer impossible; amount
      still positive magnitude.
- [ ] BDD: `applyGroundingGuards` — the four payee cases above + account cases.
- [ ] All existing scenarios green (no regression to expense/income paths).
- [ ] Manual (device build 15): "transfer $100 to budget" → draft card shows
      From OCBC 360? / To Budget, Save succeeds, dashboard shows the transfer
      (OCBC 360 −100, Budget +100); "received $1000 salary today" → payee shows
      amber Add pill, NOT "Malaysia Trip".
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green.

## Constraints & conventions
- Framework-free domain: `resolveTransferAccounts` and `applyGroundingGuards`
  are pure, no RN imports; BDD in `tests/__features__` + `__steps__` pairs.
- Theme: any new DraftCard rows via NativeWind tokens / `useThemeColors` only
  (light + dark both fine).
- Parameterised SQL only (repository already does — don't bypass it).
- Do not change `aiParsedExpenseSchema`'s accepted shape (cloud + FM both
  validate against it); `transferAccountId` remains a draft/Transaction-level
  concern, not a parse-level one.
- Comment discipline: constraints, not narration.

## Edge cases & risks
- **"to" collides with payee text** in expenses ("paid $20 to John") — the
  transfer resolver only runs for `type === 'transfer'`; never touch other types.
- **Account named with regex metacharacters** or multi-word names ("OCBC 360")
  — escape + word-boundary; "transfer to ocbc 360" must match.
- **Both accounts mentioned without keywords** ("move 100 budget ocbc") — no
  `to` keyword match → clarify. Fine; don't get clever.
- **Currency**: use the SOURCE account's currency (existing
  `parsed.currency ?? account.currency` logic unchanged).
- **`defaulted.payee/category` false for transfers** so no amber Add pills
  appear for fields the card doesn't render.
- **Cloud parses** flow through the same interpret() — target extraction works
  identically; the payee guard, however, only runs in the FM tier
  (`deviceParse.ts`). That asymmetry is accepted for now (cloud model
  hallucinates less); note it in a comment where the guard is applied.
- **parseMetrics**: `resolved`/`edited` capture must not break for transfer
  saves — check the capture points still receive a valid draft.

## Suggested handoff
> Use the implementer agent to build the spec at
> `docs/design/assistant-transfers-spec.md` on `claude/account-creation-spike`
> (worktree `.claude/worktrees/fm-spike`). Then qa-tester on the diff, then
> reviewer. Then build 15 via the TestFlight pipeline.

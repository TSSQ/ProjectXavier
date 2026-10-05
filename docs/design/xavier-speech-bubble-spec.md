# Xavier speech bubble: spec

- **Status:** design approved 2026-10-05 (Option B, "every line is a bubble"); ready to build
- **Approved design:** https://claude.ai/artifact/YFJyKiuvn7XA3Y6sigDqUS (Version 2). A local copy is at `docs/design/xavier-speech-bubble-mock.html`; open it in a browser and use the ☾/☀ toggle to see both themes.
- **Branch:** `claude/xavier-speech-bubble`, cut from `claude/monthly-budgets` (PR #38). It depends on the budgets work: the saved-expense receipt and its budget line exist only there. Rebase onto `main` once #38 merges.
- **Ship run:** `docs/ship-runs/xavier-speech-bubble.md`

## 1. Objective

Everything Xavier says on the Assistant screen appears in **one speech bubble under the avatar**, with its tail pointing up at him. That covers the greeting, questions, errors and confirmations. Confirmations say what actually changed, and a saved expense carries its receipt and budget-left line inside the bubble. The separate saved-expense card down by the composer goes away.

The problem it fixes, from the device: saving "food 5" showed "Saved! Anything else?" as plain text under Xavier, plus a separate receipt card ("Food −SGD 5.00 · Food · savings · Today · Food · SGD 25 left this month") down by the composer. That is two voices for one moment, and the card reads like a system notification.

## 2. Scope

In scope:
1. A `SpeechBubble` component that replaces the plain reply `<Text>` in the hero (`app/(tabs)/index.tsx`, the `<Text … >{reply}</Text>` under `<AssistantAvatar>`, around line 3374).
2. Structured reply content: plain text for most lines, and a **receipt** variant for confirmations that carry details (lines, amount, an optional budget meter).
3. Rewritten confirmation copy (§5) so each confirmation says what changed.
4. Removal of `SavedBudgetCard` from the Assistant (`src/components/assistant/BudgetReplyActions.tsx`, the `saved && …` block). Its content moves into the bubble.

Out of scope:
- **Decision cards stay exactly as they are:** the draft confirm card, account create and update cards, the afford card, the set-budget confirm card, the delete handoff, the transaction picker, statement-queue cards, and the query answer cards. Their *question* line ("Change Groceries from $400 to $450, starting October?") moves into the bubble with everything else; the card and its buttons stay below.
- Chat history or a feed (still a separate future `/design`).
- Avatar faces, size and position; the composer; the tab bar.
- Settle timing (§6 keeps today's rules).

## 3. The bubble (match the mockup)

`src/components/assistant/SpeechBubble.tsx`:
- **Container:** `surface` background, 1px `borderAccent` border, radius 20, padding about 11/14/12, `elevation.raised` (light gets the shadow, dark gets none, as the tokens define it). Max width 300 (today's reply `maxWidth`), centred under the avatar with a 16pt gap. Taken from `mt-6` today and adjusted for the tail.
- **Tail:** a small rotated square (about 14pt) on the top edge, centred, pointing at Xavier. Same fill and border as the bubble, and only the top and left borders are visible, so it reads as part of the outline. Draw it with a rotated `View` or `react-native-svg`. It must not show a seam in either theme.
- **Text:**
  - The main line uses today's reply typography: `text-text`, bold, `s.role.body`, lineHeight × 1.3, and `s.role.prompt` during the /account Q&A, exactly as today.
  - Plain lines are centre-aligned, as in the mockup's greeting and catalogue. Receipt bubbles are left-aligned, as in the mockup's saved expense.
  - Secondary lines are `muted`, about 12–13pt (`typography.caption` 13).
  - Amounts use `tabular-nums`. Expense amounts are coloured `negative`.
- **Budget meter** (receipt variant only, when the expense's top-level category has a budget for the transaction's month):
  - A 5pt bar on a `wellRecessed` track. The fill is the used share (spent + scheduled ÷ budget, capped at 1), coloured by state: ok is `primary`, warn is `warn`, over is `negative`.
  - Below it, a line: "**SGD 25 left** in Food this month", or "**SGD 21 over** in Entertainment this month". The bold amount is coloured by state: `positive` for ok, `warn` for warn, `negative` for over.
  - Reuse `BudgetBar` (thin variant, no tick) if it fits; otherwise draw a minimal bar.
- **Accessibility:**
  - Keep `pointerEvents="none"`, the same as today's reply `Text`, so a tap passes through to the hero backdrop and dismisses the keyboard.
  - The bubble is one accessibility element whose label is the full text, receipt lines included.
  - No `numberOfLines`: Dynamic Type wraps rather than clipping.
- **Avatar state:** unchanged. The happy or angry face for saved and spent still comes from `lastOutcome`.

## 4. Reply model

Today `reply` is a `string` set through `setReply` (about 40 call sites in `index.tsx` plus `useBudgetReplies.ts`). Keep `setReply(string)` working everywhere, and add one structured setter for receipts:

```ts
type BubbleContent =
  | { kind: 'text'; text: string }
  | {
      kind: 'receipt';
      headline: string;          // "Saved SGD 5.00 to Food."
      amountText?: string;       // the amount inside headline, for colouring
      lines: string[];           // ["🏷️ Food · savings · Today"]
      budget?: {                 // only when that category has a budget that month
        usedRatio: number;       // 0..1
        state: 'ok' | 'warn' | 'over';
        amountText: string;      // "SGD 25"
        label: string;           // "left in Food this month" | "over in Entertainment this month"
      };
    };
```

- Build receipt content in a **pure, framework-free** module (`src/domain/bubbleCopy.ts`) so the plain-Node BDD suite covers it. Reuse `budgetCopy.ts` (`savedChip`, `formatBudgetMoney`, `monthName`) and `dateLabelFor` rather than re-deriving anything.
- `useBudgetReplies.showSavedChip` becomes `showSavedReceipt`. It always builds a receipt for a saved transaction with a `txId`, and adds `budget` only when that category has a budget. The current code returns early when there is no budget; that early return goes.
- The settle reset (`resetReplyToIdle`) returns the bubble to `{ kind: 'text', text: GREETING }`, and `clearSaved` goes away with the card.

## 5. Copy

Confirmations say what changed. Errors and questions keep their current wording, moved into the bubble. Use the user's data, and never invent detail that isn't known at the call site.

| Moment (call site) | Today | New bubble |
|---|---|---|
| Expense saved, quick confirm or edit form (`onConfirm`, edit-form save) | "Saved! Anything else?" + `SavedBudgetCard` | Receipt. Headline "Saved {amount} to {category}." Line "{icon} {category} · {account} · {date label}". Budget meter and line when budgeted. With no category: "Saved {amount} to {account}." |
| Income saved | "Saved! Anything else?" | Receipt. Headline "Added {amount} from {payee or category}." Amount in `positive`. No meter. |
| Transfer saved | "Saved! Anything else?" | Receipt. Headline "Moved {amount} from {from account} to {to account}." No meter. |
| Saved as a repeating series (`txId` null) | "Saved! Anything else?" | Text: "Set up {payee or note}, {amount}, repeating." If the rule has a human label available, append it ("…, repeating monthly."). |
| Statement queue finished | the existing summary | Unchanged text, now in the bubble |
| Account created (`onCreateAccount`) | `Created "{name}". Anything else?` | Receipt. Headline "Created {name}." Line "{subtype label} · opening balance {amount}", built with `accountMetaLine` / `formatMoney`. Leave out the balance part if it is 0. |
| Account updated (`onConfirmAccountUpdate`) | `Updated "{newName}". Anything else?` | Text describing the change: a rename is "Renamed {old} to {new}."; a retype is "{name} is now a {subtype label}."; a balance change is "Set {name}'s balance to {amount}."; for a combination, the first one in that order plus "and updated the rest". |
| Account archived (delete handoff) | `Archived "{name}". Anything else?` | Text: "Archived {name}." |
| Transaction updated (tx_op update) | "Updated! Anything else?" | Receipt. Headline "Updated {payee or category}." Line "{icon} {category} · {account} · {date label} · {amount}". |
| Budget set (chat confirm) | `setBudgetDoneText`: "Done. Groceries is now $450 a month, starting October." | Receipt. Headline "Groceries is now $450 a month." Line "Starting October · was $400" (just "Starting October" when there was no previous budget). |
| Cancelled / discarded | "No problem — cancelled. What else?" / "No problem — discarded. What else?" | Text: "No problem, I didn't save it." For a cancelled account update: "No problem, I left it as it was." |
| Greeting, questions, errors, query captions | as today | Same text, in the bubble |

Drop "Anything else?" from the confirmations. The settle back to the greeting already asks that.

## 6. Behaviour kept

- **Settle rules unchanged:** saved and spent settle after 5s and return to the greeting; error and clarify clear only the face; the first keystroke of a fresh draft settles early (`replySettleRule`, `src/domain/replySettle.ts`). The receipt settles with its bubble.
- **Stale-data guards unchanged:** `dropStaleReply` and the `dataRevision` checks still clear a budget card.
- **The /account Q&A** still promotes the question to the prompt type size; the step header and subtype chips stay where they are.
- **The hero stays vertically centred,** and tapping the backdrop still dismisses the keyboard.

## 7. Acceptance criteria

BDD tests (`tests/__features__/speech-bubble*.feature`) on the pure modules:
1. **Saved expense with a budget:** "food 5" from savings, Food budget 30 with 5 spent. Headline "Saved SGD 5.00 to Food.", line "🏷️ Food · savings · Today", meter usedRatio ≈ 0.17, state ok, "SGD 25 left in Food this month".
2. **Over budget:** state over, amount "SGD 21", label "over in Entertainment this month", usedRatio capped at 1.
3. **No budget:** receipt with no `budget` field.
4. **Income:** "Added …", with no budget field even when the category has an expense budget. **Transfer:** "Moved …".
5. **Repeating series:** the series text, with no receipt.
6. **Account confirmations:** created (with and without an opening balance), renamed, retyped, balance changed, combined change, and archived produce the §5 strings.
7. **Budget set:** with and without a previous budget.
8. **Cancelled and discarded** strings.
9. **No "Anything else?"** in any confirmation string (grep-style assertion over `bubbleCopy` outputs).
10. **`SavedBudgetCard` is no longer rendered by the Assistant.** Delete the file if nothing else uses it.
11. **Checks:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run eval:intent`, `npm run eval:query` and `npm run eval` are all green. Routing is untouched, so the evals must not move.

On device (screenshots in the ship-run record):
- **Both themes:** the bubble and tail, with no seam, a correct border, and the shadow in light only.
- **Largest Dynamic Type:** the greeting and a receipt with a meter wrap without clipping, and with a decision card on screen the card's buttons stay reachable above the keyboard. This is the main risk flagged at design time.
- **VoiceOver:** reads the whole bubble as one element.

## 8. Edge cases
- A long payee or category name wraps inside the bubble; nothing truncates silently.
- Multi-currency: the receipt uses the transaction's currency, the meter uses the budget's (the app currency), which is the same rule as the budgets feature.
- A save in another month: the budget line says "left in {category} in {Month}", as `savedChip` already does.
- A receipt whose transaction was deleted before it rendered: fall back to the text "Saved." Never show stale numbers.

## 9. Constraints
- Tokens and components only: no new colours. `surface`, `borderAccent`, `elevation.raised`, `wellRecessed`, `primary`, `warn`, `negative` and `positive` already exist (`src/theme/tokens.ts`).
- Copy and receipt building stay framework-free and BDD-tested; the React component stays thin.
- Keep the PR to this change. `index.tsx` should shrink, because the reply `Text` and the saved card both go.

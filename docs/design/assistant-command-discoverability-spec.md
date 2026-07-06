# Build spec — Make Xavier's commands discoverable

_Branch: `claude/account-creation-spike` (worktree `.claude/worktrees/fm-spike`).
Mockup: `scratchpad/xavier-commands-mockup.html` (rendered artifact)._

## Objective
The `/account` and `/transactions` commands are invisible — the assistant screen
is one free-text box (`placeholder="Describe an expense…"`) and nothing tells a
user those commands exist. Make the commands **discoverable and tappable** without
removing the fast typed path, and make the `/account` Q&A **tap-don't-type** for
its one constrained question.

## Scope (in)
Three additive UI moves on the assistant home (`app/(tabs)/index.tsx`), all
reusing existing domain logic and the existing confirm cards:

1. **Quick-action chips** on the idle hero — a tappable row under Xavier:
   `＋ New account`, `▣ Scan receipt`, `≡ All commands`. Shown only when idle.
2. **Slash-command menu** — typing a leading `/` shows a popover above the input
   listing commands (name + plain-language description), filtered as the user
   types. Tap runs it. Keep the typed `/account` / `/transactions` path working.
3. **Tappable choice chips in the `/account` Q&A `subtype` step** — Bank / Cash /
   Credit card / Savings / Skip; one tap answers and advances. The text field
   still accepts a free-typed answer.

Plus a tiny **flow affordance**: a `Step N of 3` marker + `Cancel` while the
`/account` Q&A is active.

## Out of scope (do not touch/build)
- The FM/cloud/heuristic parse ladder, `deviceParsePrompt.ts`, `assistant.ts`,
  the guessed-field amber pills, `DraftCard`.
- `accountAssistant.ts` domain logic — no behavioral change (see Constraints for
  the one allowed additive export).
- New commands beyond the two that exist. No `/help` screen, no settings.
- Free-form "add my DBS savings with 500" natural-language account creation
  (that's a separate future decision from the handoff — not this).
- Persisting chip state, any DB/schema change, currency question.
- `AccountDraftCard` and the transaction confirm card visuals.

## Approach (concrete)

All edits are in `app/(tabs)/index.tsx` unless noted. The single command source
of truth is a new module so the chips and the slash menu can't drift apart.

**New file `src/domain/assistantCommands.ts`** (pure, framework-free, BDD-testable):
```ts
export interface AssistantCommand {
  name: '/account' | '/transactions';
  title: string;        // "Set up a new account"
  keyword: string;      // "account" — for filtering
}
export const ASSISTANT_COMMANDS: AssistantCommand[];
/** Filter for the slash menu. `q` is the raw field text starting with "/". */
export function matchCommands(q: string): AssistantCommand[];
/** True when the field text should open the slash menu (starts with "/" and
 *  is not yet a completed command+space). */
export function isSlashQuery(text: string): boolean;
```
Reuse the existing regexes' intent; `isAccountCommand` / `transactionCommandBody`
in `accountAssistant.ts` stay the dispatchers in `onSend`.

**`accountAssistant.ts` — one additive export, no behavior change:**
```ts
export const ACCOUNT_SUBTYPE_CHOICES = [
  { label: 'Bank', value: 'bank' },
  { label: 'Cash', value: 'cash' },
  { label: 'Credit card', value: 'credit_card' },
  { label: 'Savings', value: 'savings' },
] as const;
```
The Q&A already normalizes typed answers (`normalizeSubtype`); tapping a chip
just calls the same `advanceAccountFlow(accountFlow, label)` path, so chip and
type stay consistent. `Skip` sends `"skip"` (already a `SKIP_WORDS` member).

**Screen wiring (`app/(tabs)/index.tsx`):**
- **Chips:** render a chip row inside the hero `View` (near line 680, under the
  `reply` Text) gated on `!pending && !pendingAccount && !accountFlow && !busy`.
  - `＋ New account` → the exact body of the `isAccountCommand` branch of `onSend`
    (extract to `startAccountCreation()` and call from both the chip and `onSend`).
  - `▣ Scan receipt` → existing `onScan`.
  - `≡ All commands` → open the slash menu (set field to `/`, focus input).
- **Slash menu:** derive `const slashItems = isSlashQuery(draft) ? matchCommands(draft) : []`.
  When non-empty, render an absolutely-positioned popover above the input bar
  (sibling of `inputBar`, inside the bottom container). Row tap → set `draft` to
  the command name and call `onSend` (for `/account`, which needs no argument) or,
  for `/transactions`, insert `"/transactions "` and keep focus so the user types
  the expense. Dismiss when `draft` no longer `isSlashQuery`.
- **Q&A choice chips:** when `accountFlow?.step === 'subtype'`, render a chip row
  (values from `ACCOUNT_SUBTYPE_CHOICES` + a muted `Skip`) in the hero under the
  question `reply`. Tap → `advanceAccountFlow(accountFlow, label)` then apply the
  result exactly like the `if (accountFlow)` branch of `onSend` (set state, reply,
  `setPendingAccount` if `ready`).
- **Progress + Cancel:** when `accountFlow` is non-null, show a small line above
  the avatar: `Step {n} of 3` (name=1, subtype=2, opening=3) + a `Cancel` pressable
  that runs `onDiscardAccount`. Use the existing `progress`/dots styling analog;
  match `tokens.ts` colors (`primary` = active, `positive` = done, `surfaceAlt`
  = pending).

Use existing components/utilities: `Feather` icons via the `icons` map from
`src/theme/assets.ts` (already imported in the screen). Every icon the chips need
exists — no additions: `＋ New account` → `icons.add` (`'plus'`), `▣ Scan receipt`
→ `icons.camera`, `≡ All commands` → `icons.transactions` (`'list'`). Also
`useThemeColors` and NativeWind classes already in the file (`rounded-pill`,
`bg-surfaceAlt`, etc.). Note: `src/domain/icons.ts` is unrelated (emoji picker
sets) — don't touch it.

## Requirements / acceptance criteria
- [ ] On the idle screen (no pending draft, no account draft, not mid-Q&A, not
      busy) three quick-action chips render under Xavier; they disappear the
      moment a draft card, account draft, or Q&A is active.
- [ ] Tapping `＋ New account` starts the identical Q&A that typing `/account`
      starts (same first question, same state).
- [ ] Tapping `▣ Scan receipt` invokes the existing `onScan`.
- [ ] Typing `/` opens a popover listing `/account` and `/transactions` with
      descriptions; typing `/a` filters to `/account` only; deleting back to empty
      or completing a command closes it.
- [ ] Tapping a slash-menu row runs the command: `/account` starts the Q&A;
      `/transactions` leaves `"/transactions "` in the field with focus retained.
- [ ] Typed `/account` and `/transactions [text]` still work exactly as before
      (no regression in `onSend`).
- [ ] During the `subtype` step, tapping Bank/Cash/Credit card/Savings/Skip
      advances the flow with the same result as typing that word; the text field
      still accepts a free-typed type.
- [ ] While the Q&A is active, a `Step N of 3` indicator and a working `Cancel`
      show; Cancel clears the flow (`onDiscardAccount`) and restores the idle hero.
- [ ] The account confirm card and its `Create`/`Discard` behavior are unchanged.
- [ ] New domain module `assistantCommands.ts` has BDD coverage following the
      repo pattern: a `tests/__features__/assistant-commands.feature` +
      `tests/__steps__/assistant-commands.steps.ts` pair (mirror the existing
      `account-assistant.feature`/`.steps.ts`). Cover `matchCommands` filtering
      (`/` → both, `/a` → `/account` only, `/x` → none) and `isSlashQuery`
      boundaries. Add a scenario to the account-assistant suite proving a chip
      label (`ACCOUNT_SUBTYPE_CHOICES` value or `"skip"`) drives
      `advanceAccountFlow` to the same state as the equivalent typed answer.
- [ ] **Light mode:** all new UI (quick-action chips, slash popover, choice
      chips, progress dots, Cancel) renders correctly in both light and dark —
      the app follows system appearance. Verify by toggling appearance in the
      simulator (Settings → Developer → Dark Appearance, or ⌘⇧A). Legible text
      contrast on every chip state in both themes; no dark-only hex anywhere.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green.

## Constraints & conventions
- **Framework-free domain.** All command-matching + choice constants live in
  `src/domain/*` as pure functions/consts so they're testable in the plain-Node
  BDD suite (`*.steps.ts`). No React in domain files.
- **No new deps.** Use `Feather`, NativeWind, `useThemeColors`, and existing
  primitives. Colors come from `src/theme/tokens.ts` — don't hardcode hex in JSX.
- **Theme-aware by construction.** Every color must resolve through
  `useThemeColors()` or a NativeWind token class (`bg-surface`, `text-muted`,
  `border-borderAccent`, …) so light mode works automatically — never the static
  `colors` export from `tokens.ts` (that's dark-only, reserved for non-React
  modules and the brand-fixed avatar). Selected-chip text on `surfaceBlue`
  must stay legible in both palettes — if no existing token gives enough
  contrast, use `primary` for the selected label rather than inventing a hex.
- **Additive only.** Don't change `advanceAccountFlow`/`parseOpeningBalance`
  signatures or the parse ladder. Chips are a second input into the same funcs.
- Match the file's existing style: `Pressable` + `className`, `rounded-pill`,
  `accessibilityLabel` on every tappable control (see `onScan`/send button).
- Guardrail #6 still applies to anything AI-derived — not touched here, but don't
  loosen zod validation on the save path.

## Edge cases & risks
- **Keyboard overlap:** the slash popover sits above the input bar, which is
  pinned above the keyboard inside `KeyboardAvoidingView`. Position it as a
  sibling of `inputBar` so it rides with the bar, not the scroll view.
- **`/transactions` with no arg:** current `onSend` replies "Sure — what's the
  transaction?" for empty body — keep that; the slash-menu tap should leave the
  trailing space and let the user type, not immediately send.
- **Chip vs. free-type consistency:** a chip must funnel through
  `advanceAccountFlow` (not set draft state directly) so normalization matches.
- **`≡ All commands` chip** is just a shortcut to open the slash menu — make sure
  it doesn't submit an empty parse.
- **Focus management:** opening the menu from a chip must focus the `TextInput`
  (keep a `ref`) so the keyboard is up when the menu shows.
- **Don't double-render chips + confirm card:** the gating condition must exclude
  `pending`, `pendingAccount`, and `accountFlow`.

## Suggested handoff
> Use the implementer agent to build the spec at
> `docs/design/assistant-command-discoverability-spec.md` on the
> `claude/account-creation-spike` branch (worktree `.claude/worktrees/fm-spike`).
> Then run qa-tester on the diff, then reviewer. Keep `npm run typecheck`, `lint`,
> and `test` green.

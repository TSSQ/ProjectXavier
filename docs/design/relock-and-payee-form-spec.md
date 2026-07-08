# Build spec — Re-lock on background resume + payee form polish

_Branch: `claude/account-creation-spike` (worktree `.claude/worktrees/fm-spike`)._

## Objective
1. **Re-lock:** the biometric gate currently runs only at cold start; returning
   from the background skips it. When the Face-ID toggle is ON, backgrounding
   the app must lock it and resuming must re-prompt. (Store-checklist item;
   biometrics are the app's only gate now.)
2. **Payee form polish** (`app/manage-payees.tsx`): richer list rows, labeled
   form fields, an emoji-aware category picker — and fix the silent-discard
   bug where a typed-new category name is thrown away on save.

## Scope (in)

### A. Re-lock (`app/_layout.tsx`, `Splash` in the same file)
- On the app transitioning **`active` → `'background'`** (NOT `'inactive'` —
  that fires for the Face ID prompt itself, permission dialogs, control
  center, and would loop): if `getBiometricLock()` is ON, `setUnlocked(false)`.
  Locking at background-time also makes the splash cover the app-switcher
  snapshot (privacy win — financial data not visible in the switcher).
- On **`'background'` → `'active'`**: if not unlocked, run the same
  `requireBiometricUnlock()` prompt (guard with a ref against concurrent
  prompts; use refs for current unlocked/lock-setting values inside the
  listener — it's registered once).
- Reuse/extend the existing AppState listener (the auto-backup one) rather
  than adding a second subscription; keep auto-backup behavior byte-identical.
- **Retry affordance:** the locked splash ("Locked — authenticate to
  continue") is currently a dead end if the user cancels Face ID. Add an
  "Unlock" Pressable (theme tokens, accessibilityLabel) to that splash state
  that re-runs the prompt. Applies to cold start too.
- Toggle OFF ⇒ all of this is inert (no lock on background, no prompt).

### B. Payee form polish (`app/manage-payees.tsx`, `src/components/ui/Combobox.tsx`)
- **List rows:** replace the generic grey `user` icon tile with, in order:
  the payee's default category's emoji (`category.icon`) when set; else a
  colored initial-letter circle — first character of the payee name,
  uppercase, on a stable per-payee background color (reuse the
  `accountColor(index)` palette approach from `src/lib/accountColor.ts` —
  derive the index from a simple stable hash of the payee name; add a tiny
  pure helper for the hash, e.g. in `src/lib/`, or reuse an existing one if
  found). Keep the row layout/typography otherwise identical to the
  categories screen's rows (`manage-categories.tsx:205`).
- **Form labels:** small uppercase field labels above the two controls
  ("Name", "Default category"), matching the muted-uppercase label style used
  elsewhere (`text-muted text-[10px] font-bold uppercase tracking-wide`).
- **Emoji in the category picker:** `ComboItem` gains optional `icon?: string`
  rendered as a leading emoji in each dropdown row (fallback: none — layout
  must not shift for items without icons). The payee form passes
  `icon: c.icon ?? undefined`. The combobox's collapsed/value display shows
  the selected category's emoji before the name when available.
- **Fix the create-category discard:** today `onCreate` sets
  `defaultCategoryName` with `defaultCategoryId = null`, and `onSave` persists
  only the id — a typed-new category silently vanishes. Fix: in `onSave`, when
  the trimmed `defaultCategoryName` is non-empty and there's no
  `defaultCategoryId`, call the categories repository's
  `findOrCreateByName(name, 'expense')` and use the resulting id (payee
  defaults feed the expense flow; document the kind choice in a comment).
  When `defaultCategoryName` is empty, save null (clearing the default must
  keep working).

## Out of scope
- Payee schema changes (no icon column for payees — the avatar is derived).
- The transaction form's payee/category pickers (`TransactionFormSheet`) —
  only `manage-payees.tsx` and the shared `Combobox` (additively).
- `manage-categories.tsx`, `manage-accounts.tsx` (they may adopt the icon
  prop later; don't touch them now).
- Any re-lock timer/grace-period sophistication — immediate lock on
  background is the contract.
- Blur/privacy overlay beyond the existing splash.

## Requirements / acceptance criteria
- [ ] Toggle ON: backgrounding the app (home swipe) then returning shows the
      locked splash and prompts Face ID; cancel leaves the splash with a
      working "Unlock" retry; success enters the app. (Manual, device.)
- [ ] Toggle OFF: background/resume never locks or prompts. (Manual, device.)
- [ ] Pulling down notification center / triggering a permission dialog /
      the Face ID prompt itself does NOT lock the app (inactive ≠ background).
      (Manual, device.)
- [ ] Auto-backup on background still fires (listener extended, not replaced).
- [ ] Payee rows show category emoji when a default category with an icon is
      set; otherwise a colored initial circle; visually consistent with the
      categories screen rows. Light + dark both legible.
- [ ] Both form fields have uppercase labels.
- [ ] Category dropdown rows show emoji; rows without icons align identically.
- [ ] Typing a brand-new category name in the picker and saving creates that
      category (kind 'expense') and sets it as the payee's default — verify
      via the categories screen afterward. Clearing the field still clears
      the default.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green (no domain
      changes expected; if the name-hash helper lands in `src/lib`, a small
      BDD/unit addition is welcome but not required — match repo conventions).
- [ ] Simulator build compiles (same xcodebuild Debug command as prior specs).

## Constraints & conventions
- Theme via `useThemeColors`/NativeWind tokens only; accessibilityLabel on
  every new tappable; comment discipline (constraints, not narration).
- The AppState listener must keep exactly one subscription; cleanup intact.
- `requireBiometricUnlock` itself must not be modified.
- Combobox change is additive — no behavior change for existing call sites
  that don't pass `icon`.

## Edge cases & risks
- **Prompt re-entrancy:** resume fires `active` while a prompt may already be
  in flight (cold start + fast background/resume) — the in-flight ref guard
  must make the second attempt a no-op.
- **Snapshot timing:** `setUnlocked(false)` must happen synchronously in the
  background transition handler (before `await`ing the setting read would be
  too late for the snapshot — read the toggle into a ref ahead of time, keep
  it fresh on app-active and after toggle changes; simplest: refresh the ref
  on every `active` transition and at startup, and accept the stale-by-one
  edge if the user toggles and immediately backgrounds).
- **Initial-letter avatar:** names starting with emoji/non-letters — take the
  first grapheme-ish char and uppercase only if alphabetic; never render an
  empty tile.
- **Combobox value display:** the selected-value emoji must not end up inside
  the TextInput's text (it's a text field) — render it as an adjacent element
  or accept name-only in the collapsed state if the component structure makes
  the emoji awkward; do not degrade text editing.

## Suggested handoff
> Use the implementer agent to build the spec at
> `docs/design/relock-and-payee-form-spec.md` on `claude/account-creation-spike`
> (worktree `.claude/worktrees/fm-spike`). Then qa-tester on the diff, then
> reviewer. Then build 20 via the TestFlight pipeline.

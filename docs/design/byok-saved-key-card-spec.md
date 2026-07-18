# BYOK "key saved" — make the saved state obvious (state-swap card + save-moment flash)

## Objective
Make it unmistakable that a BYOK API key is saved. Today the only signal is a
muted 12px caption ("A key is saved on this device.") above an always-visible,
always-empty obscured input — legible in theory, missable in practice (it was
missed during the build-46 device test). Replace the ambiguous
caption+empty-field with a saved-key **card** (option 3), and add an explicit
**save-moment flash** (option 2). User approved: showing the key's last 4
characters is fine.

## HARD CONSTRAINT — never affect the App Store version
- ALL work on `claude/phase2-byok` in worktree `.claude/worktrees/fm-spike`.
- NEVER commit/push/merge to `main`. `main` = build 42 (v0.1.0, iPhone-only) =
  the App Store binary, and it does NOT contain BYOK at all — `app/settings/
  byok.tsx` exists only on this feature branch. Nothing here can touch build 42.

## Scope
IN:
- `app/settings/byok.tsx`: swap the API-key section between two states —
  **saved card** (when a key is saved and not being replaced) vs **input**
  (no key, or "Replace" tapped). Add a transient success flash on a verified
  save.
- New pure helper `src/domain/byokKeyMask.ts` — `maskApiKey(key): string`
  (Node-testable; the screen renders its output). Keeps the last-4 logic out of
  the RN-only screen.
- Tests (`tests/`): `maskApiKey` unit behavior.

OUT:
- The keychain persistence fix (already shipped, build 46) — unchanged.
- `secureTextEntry` on the input — leave as-is (only shown in no-key/replace
  state now).
- A "saved on <date>" timestamp — deliberately skipped (would need a new
  persisted settings key + backup-policy consideration; the masked-key card is
  the strong signal). Note as possible future.
- Haptics — `expo-haptics` is NOT installed; do NOT add a native dep for this.
  The save-moment feedback is visual only. (Optional future.)
- `main`, build 42, the store submission.

## Approach (concrete)

### 1. `maskApiKey` (pure, Node-tested) — `src/domain/byokKeyMask.ts`
Reveal only the last 4 chars, never the rest:
- `key.length >= 8` → a fixed run of mask dots + the last 4 chars, e.g.
  `••••••••3f9k` (choose a constant dot count, e.g. 8, so length of the real
  key isn't leaked).
- `key.length < 8` → fully masked (all dots, count NOT equal to the key length
  — use the same constant), so a short/edge value never exposes recognizable
  characters.
- Never returns the full key; never throws. Trim is the caller's concern (keys
  are already trimmed before save).

### 2. Saved-key card vs input (state-swap) — `app/settings/byok.tsx`
New state:
- `savedKeyHint: string | null` — `maskApiKey` of the saved key, or `null`.
- `replacing: boolean` — user tapped "Replace key" to enter a new one.

Render the API-key section as:
- **Saved card** when `keySaved && !replacing`:
  - A green check (Feather `check-circle`) + bold "Key saved" line.
  - The masked key (`savedKeyHint`) in a monospace-ish muted style beneath it.
    If `savedKeyHint` is null (shouldn't happen post-fix), show "Key saved"
    alone — never block the card on the hint.
  - Actions: **Replace key** (secondary → sets `replacing = true`, reveals the
    input) and **Remove key** (existing `onRemoveKey`).
- **Input** when `!keySaved || replacing`:
  - The existing obscured `TextInput` + **Save key**. When `replacing` (a key
    already exists), also show a **Cancel** that returns to the card
    (`replacing = false`, clears `keyInput`/`saveError`).
  - Keep the existing "No key saved yet." caption ONLY in the true no-key state.

Wiring:
- `loadProvider`: read `getByokKey(provider)` once → derive `keySaved = !!key`
  AND `savedKeyHint = key ? maskApiKey(key) : null` (replaces the current
  `hasByokKey` call; `hasByokKey` internally reads the same secret, so this is
  equivalent + gives the hint). Reset `replacing = false`. All applied only
  when `isLatest()` (existing token guard).
- `onSaveKey` success: compute `savedKeyHint = maskApiKey(trimmed)` from the
  just-saved value BEFORE clearing `keyInput`; set `keySaved = true`,
  `replacing = false`, and trigger the flash (below) — all guarded by
  `isLatest()`.
- `onRemoveKey` success: clear `savedKeyHint = null`, `replacing = false`
  (existing `keySaved = false`) — guarded by `isLatest()`.

### 3. Save-moment flash (option 2) — visual only
- New `justSaved: boolean` (or a small "flash" state). On a verified save
  (only when `isLatest()`), set it true, render a brief green "✓ Key saved"
  line (reuse the existing green `testResult`-style treatment), and auto-clear
  after ~1.8s via a `setTimeout` that is (a) cleared on unmount and (b) a no-op
  if a newer provider/save token has superseded it. The card appearing already
  gives strong feedback; this is the explicit "it worked just now" beat.
- No haptic (no native dep). Note as optional future.

## Acceptance criteria
1. With a key saved: the API-key section shows the **saved card** (✓ "Key
   saved" + masked key ending in the real last 4) INSTEAD of the input+Save.
   The full key is never rendered.
2. With no key: the input + Save show exactly as today ("No key saved yet.").
3. **Replace key** reveals the input (+ Cancel). A verified save returns to the
   card showing the NEW last 4; a failed save shows the existing key-free
   `saveError` and stays in input mode (`keySaved` false / card not shown for a
   fresh key; for a replace, stays in replace input with the error).
4. On a verified save, a brief "✓ Key saved" flash appears, then the card
   settles; the flash auto-clears and cannot appear on / clobber a provider the
   user has since switched to.
5. **Remove key** returns to the no-key input state; card and `savedKeyHint`
   gone.
6. `maskApiKey` is pure + Node-tested: last 4 revealed for a normal key; a
   <8-char value fully masked; never returns the full key; constant dot count
   (doesn't leak length).
7. Guardrail #5: no key/header/body logged; only the last-4 mask is ever shown.
8. Race guard: switching provider while a save/remove/flash is in flight never
   applies stale `keySaved`/`savedKeyHint`/`saveError`/`justSaved` to the newly
   selected provider (extend the existing `requestTokenRef`/`isLatest` pattern).
9. `npm run typecheck && npm run lint && npm test` green; `main` untouched;
   diff entirely on `claude/phase2-byok`.

## Constraints
- Guardrail #5 (no key/PII logging; the key stays in the Keychain; only last-4
  is surfaced, on the user's own device).
- Pure logic (`maskApiKey`) stays Node-testable; the screen is RN-only I/O.

## Edge cases
- `getByokKey` returns null while `keySaved` is true (post-fix shouldn't happen)
  → card shows "Key saved" without the masked line; never crash.
- Very short / unusual key → fully masked (criterion 6).
- Rapid provider switch during save/remove/flash → token guard (criterion 8).
- Unmount during the flash timeout → timer cleared, no setState-after-unmount.
- Replace → Cancel → the previously saved key + its card are intact (no write
  happened).

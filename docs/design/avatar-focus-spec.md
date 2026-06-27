# Build spec: avatar focus — angry state, centered assistant, evolution preview

> Mock: [avatar-focus-mock.html](avatar-focus-mock.html). Progression mechanic:
> [ADR 0004](../adr/0004-avatar-evolution-mechanic-build.md). Shame-avoidance
> rationale: [ADR 0003](../adr/0003-avatar-evolution-gamification.md).

## Decision notes (resolved before spec)

- **"Angry when the user spends money"** conflicts with ADR 0003 (no shame
  mechanic) if it's persistent. Resolved as a **brief transient reaction** (a
  quick grumble that settles to idle in ~2.5s, like the existing happy-on-save),
  fired **only on expense saves**. Tunable later (e.g. only above an amount). A
  *persistent* angry state would be a different, riskier design — out of scope.
- **"Creature art consistency test"** can't produce real new art in code (that's
  the manual genAI workflow). What's buildable is the **harness** — a dev screen
  that steps the avatar through stages/states so real per-stage art can be
  dropped in later and transitions eyeballed.

## Objective
Make the assistant avatar the centerpiece of the home screen: remove the chat
feed and center the avatar, add an "angry" reaction when the user logs spending,
and add a dev-only preview screen to step the avatar through evolution stages and
states (the art-consistency harness).

## Scope (in)
- **A. Angry state + spend trigger:** new `'angry'` `AvatarState` with a distinct
  expression+animation; fired as a transient reaction when an **expense** is
  saved (income/transfer → happy as today).
- **B. Center the assistant, remove chat:** the home screen becomes an
  always-centered avatar + reply + input; the daily conversation feed (bubbles,
  per-day transaction list) is removed.
- **C. Evolution preview (dev harness):** a dev-gated screen that renders the
  avatar with a stage stepper (0→4) and a state selector (incl. angry), plus an
  all-stages row for the consistency test.

## Scope (out — do not touch/build)
- Real per-stage **creature artwork** — C only renders the existing blob with the
  current stage treatment.
- IAP / entitlements / purchase-gating; new avatar `kind`s; Rive/Lottie.
- The progression *mechanic* (ADR 0004) — reuse as-is; C must NOT write to the
  real `progression_*` settings.
- Transactions/Dashboard screens and all transaction data (removing the feed must
  not delete or hide transactions anywhere else).

## Approach

**A. Angry** (`src/domain/avatar.ts`, `src/components/ui/XavierPet.tsx`,
`app/(tabs)/index.tsx`)
- `AvatarState` gains `'angry'`; `AssistantOutcomeKind` gains `'spent'`;
  `avatarStateFor` maps `lastOutcome === 'spent' → 'angry'` (above the
  `'saved' → 'happy'` rule; all existing mappings unchanged).
- `XavierPet`: add an `'angry'` branch — slanted brows (two dark bars angled
  inward-down), narrowed eyes (extend `Eye`), a frown (downward arc, mirror of
  the happy mouth), and a sharp shake (faster variant of the `confused` shake)
  plus a brief reddish flash overlay. Reanimated + svg only, no new deps. Must
  not break any existing state.
- `index.tsx` `onConfirm`: after `saveAssistantDraft`, set `lastOutcome` to
  `'spent'` when `pending.type === 'expense'`, else `'saved'`. Reuse the existing
  ~2.5s timeout that clears `lastOutcome`.

**B. Center / remove chat** (`app/(tabs)/index.tsx`)
- Remove: `feed` state + `FeedItem`, the `ScrollView` chat, `Bubble` and
  `FeedRecord` usage, `pendingText` bubble, the `expanded` adaptive split, and
  the per-day feed construction.
- New layout (single, always-on): a centered column inside the existing
  `KeyboardAvoidingView` — avatar (hero size, vertically centered) → `LevelBadge`
  → Xavier's `reply` line → `DraftCard` when `pending` (and the payee suggestion
  prompt) → flexible spacer → `inputBar` pinned at bottom.
- Rename `loadFeed` → `loadContext`: loads accounts (for the draft card) and calls
  `refreshProgression`; no feed list. Keep `useFocusEffect`.
- Keep: parse → `interpret` → `DraftCard` confirm/discard, the parse-metrics
  capture calls, `saveAssistantDraft` (still stores `sourceText`), scan,
  progression, level badge.
- Remove now-unused imports (`Bubble`, `FeedRecord`, possibly `formatDMY`,
  `scrollRef`).

**C. Evolution preview** (new `app/debug-avatar.tsx`, `app/(tabs)/settings.tsx`)
- New screen gated by the existing dev flag `METRICS_ENABLED` (`src/lib/flags.ts`).
  Local component state only — `stage` (0..N) and `state` (AvatarState) — never
  persisted.
- Renders a large `AssistantAvatar`/`renderAvatar` with the chosen `stage`/`state`;
  an "Evolve →" button increments stage (wraps at max), a "Reset" button; a row
  of `Pressable`s to pick the state incl. `'angry'`; and a row showing the avatar
  small at every stage `0..EVOLUTION_STAGES.length-1`.
- Add an "Avatar preview" `Row` to the existing Settings → Developer section
  (already `METRICS_ENABLED`-gated, next to "Parse metrics"), routing to
  `/debug-avatar`.

**Build order:** A → B → C (C exercises both).

## Requirements / acceptance criteria
- [ ] `avatarStateFor({ lastOutcome: 'spent' })` returns `'angry'`; `'saved'` still
  returns `'happy'`; busy/typing/clarify/error/idle mappings unchanged. (BDD)
- [ ] `AvatarState` includes `'angry'`; `XavierPet` renders a visibly distinct
  angry face (brows + frown + narrowed eyes) and a shake, and renders without
  error for **every** state including `'angry'`.
- [ ] Saving an **expense** shows angry, then returns to idle within ~2.5s; saving
  **income/transfer** shows happy.
- [ ] Home screen shows **no** chat feed/bubbles and **no** per-day transaction
  list; avatar vertically centered; input bar pinned bottom; parse → DraftCard →
  save/discard works; `LevelBadge` shown.
- [ ] Transactions still persist and appear unchanged on Transactions/Dashboard
  after a save.
- [ ] Dev build (`METRICS_ENABLED`): Settings → Developer → "Avatar preview" opens
  a screen whose Evolve button cycles stages 0..4 and whose state control switches
  states incl. angry; the all-stages row renders. Production: row absent.
- [ ] The preview screen does **not** modify `progression_baseline`/
  `progression_highwater`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green; no unused imports in
  `index.tsx`.

## Constraints & conventions
- `avatarStateFor` stays pure and framework-free (extend its BDD tests).
- `XavierPet` stays Reanimated + `react-native-svg` only — no new dependencies.
- Dev gating mirrors `debug-metrics`: `METRICS_ENABLED` + hidden Settings →
  Developer row + a top-level `app/` route.
- Reuse the existing transient-outcome clear (`setTimeout` clearing `lastOutcome`)
  for the angry reaction — don't add a parallel timer.

## Edge cases & risks
- **Shame risk (flagged):** angry stays transient + expense-only; `lastOutcome`
  must reliably clear so the avatar never *sticks* angry. QA confirms it settles.
- **Removing chat — dangling refs:** `scrollRef`, `feed`, `FeedItem`, `Bubble`,
  `FeedRecord`, `pendingText` all removed cleanly; the utterance still persists
  via `saveAssistantDraft`'s `sourceText`.
- **Keyboard overlap:** `DraftCard` + keyboard must not hide Save/Discard — keep
  `KeyboardAvoidingView`; wrap just the content column (not a chat) in a plain
  `ScrollView` if it can overflow.
- **Preview isolation:** stage/state in `debug-avatar.tsx` are local state only;
  calling `refreshProgression`/the setters there is forbidden.
- **Angry vs confused motion:** both shake — make angry sharper/faster + red flash
  + brows so they're distinct.

## Suggested handoff
> Use the **implementer** agent to build the spec above, in order A → B → C. Then
> run **qa-tester** on the diff against the acceptance criteria (focus: angry
> reaction settles, no chat feed remains, transactions still appear elsewhere,
> preview screen is dev-gated and doesn't touch real progression). Then
> **reviewer**.

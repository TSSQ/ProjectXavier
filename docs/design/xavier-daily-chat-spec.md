# Daily chat with Xavier: spec and handoff

- **Status:** design approved 2026-10-05; ready to build
- **Approved design:** https://claude.ai/artifact/VyWz3zj5tjeGDenXyP3NWo (Version 3). A local copy is at `docs/design/xavier-daily-chat-mock.html`; open it in a browser. Phones are drawn 1:1 at iPhone 17 Pro Max (440 × 956 pt), with type from the app's own scale, and section 3 shows iPhone 17 and SE. The ☾/☀ toggle switches themes.
- **Ship run:** `docs/ship-runs/xavier-daily-chat.md`

## 0. Handoff: read this first

**Branch rules (decided by the user):**
- Work only on **`claude/xavier-daily-chat`**. It is cut from `claude/xavier-speech-bubble`, which is cut from `claude/monthly-budgets` (PR #38), because the chat uses the speech bubble as its message style and the budget receipts inside it.
- This is a **big new feature on its own long-lived branch. Do NOT open a PR into `main`.** Push the branch as you go, but don't merge it or open a PR until the user says so.
- When the base branches move (PR #38 merges, or the speech-bubble branch changes), bring them in with a **merge commit**, not a rebase or force-push, so the branch history stays intact.
- **Build order:** the speech bubble (`docs/design/xavier-speech-bubble-spec.md`) must land on its branch first. If it isn't finished when you start, build it first, or stop and ask.

**Process:** run `/ship` stages 1 to 6 on this branch: spec (this document, already approved), implement, QA, review, verify, then commit and push. Skip the "open a PR" step. A TestFlight or device build for the user to try is fine whenever it's useful.

**Watch out for:**
- **Size:** this rebuilds the Assistant screen (`app/(tabs)/index.tsx`, about 4,800 lines) around one message list. Do it in the slices in §9, keeping every check green after each one.
- **Design target:** the user designs for the iPhone 17 Pro Max first and scales down. Use the app's role ramp (`useScaledType` / `src/domain/scaleMath.ts`) for every size; never hard-code small literals. The budgets build looked too small on device for exactly that reason.

## 1. Objective

The Assistant keeps **today's conversation** as a chat:
- your messages on the right;
- Xavier's speech bubbles on the left;
- cards, such as the draft confirm and afford answers, inline where they happened.

It **clears itself on the first open of a new day**. Transactions, budgets and accounts are never affected; only the conversation is cleared.

Today each exchange replaces the last one, and a receipt fades after 5 seconds, so nothing you just logged or asked can be scrolled back to.

## 2. Scope

In scope:
1. A persistent day log (the `chat_messages` table) with a daily reset.
2. A feed that renders the day: user bubbles, Xavier bubbles and receipts, and inline cards.
3. **Empty day:** today's hero layout. Xavier is big (`avatarIdle`, 180 on Pro Max), **breathing and glowing exactly as now**, with the greeting in the speech bubble. On the first open after a reset only, add the note "Yesterday's chat is cleared. Everything you logged is in Transactions."
4. **First message of the day:** Xavier animates from the hero position to a **pinned header at the top-left**, where he stays **breathing and glowing**.
5. **Card lifecycle:** only the newest card is live. A resolved card collapses into its receipt, and an abandoned or stale card collapses into a dashed stub.

Out of scope:
- History beyond today; search; a "clear today" control (v1 leaves it out); sync.
- Any change to parsing, routing, or the content and buttons of the cards.
- The Dashboard, Transactions and Settings tabs.

## 3. Layout and sizes (match the mockup; Pro Max first)

All sizes come from `useScaledType()`. These are the Pro Max values, which scale down automatically:

| Element | Role / source | Pro Max 440 | iPhone 17 402 | SE 375 |
|---|---|---|---|---|
| Bubble text, user messages, composer | `role.body` | 19 | 18 | 16 |
| Buttons, chips | `role.control` | 18 | 16 | 15 |
| Card fields | `role.rowLabel` | 17 | 15 | 14 |
| Receipt lines, budget line, header status | `role.caption` | 16 | 14 | 13 |
| Header name "Xavier", draft amount | `role.sectionHeading` | 25 | 23 | 21 |
| Hero avatar (empty day) | `avatarIdle` | 180 | 160 | 148 |
| Header avatar (chatting) | new tier `AVATAR_HEADER = [42, 46, 52]` in `scaleMath.ts` | 52 | 46 | 42 |
| Screen padding · composer height | existing tiers | 28 · 52 | 24 · 48 | 24 · 48 |

**Pinned header**
- Placement: top-left, below the safe area, at `screenPadding` from the left edge.
- Content: the avatar, then "Xavier" (`sectionHeading`, weight 800) over "Today · N logged" (`caption`, `muted`). N is the number of transactions saved from the chat today.
- Background: a fade to the screen background, so feed content scrolls cleanly underneath it.

**User bubble**
- Right-aligned, max 76% width, `primaryFill` with white `body` text.
- Radius 21, except the bottom-right corner at 7.

**Xavier bubble**
- Left-aligned: the speech-bubble component in its **feed variant**. That variant has no up-tail; instead the top-left corner radius is 8.
- Receipts use the speech-bubble spec's receipt layout and copy.

**Cards** keep their current components and content, inline in the feed at full width minus the padding. Buttons keep 44pt touch targets.

**Empty day:** exactly today's hero (big Xavier with the greeting bubble with its up-tail), plus the one-time reset note in `caption`, `muted`, centred.

## 4. Xavier: alive in both places (user requirement)

The current breathing and glow loops live in `src/components/ui/XavierPet.tsx`:
- **Breathing:** scale 1 → 1.045 and a lift of −8, over 1.9s, alternating.
- **Halo pulse:** look colour, over 2.2s. Dark is opacity .40 → .75 with radius 16 → 28; light is .25 → .47 with radius 14 → 25.

Both must run on the **hero** and on the **header** avatar.
- Add size-relative motion to `XavierPet` so a small avatar doesn't bob: lift = `−8 × size / 180` (about −2.3 at 52), and halo radius scaled by `size / 180` with a 6pt floor. Opacities are unchanged.
- At 180, the behaviour must be **byte-identical to today**; pin that with a test on the pure motion maths.
- Reactions are unchanged and play on whichever avatar is visible: happy on a save, angry when over budget, thinking while parsing.

**Hero → header transition**
- Plays when the first user message of the day is sent.
- Xavier moves from the hero centre to the header slot and shrinks from `avatarIdle` to `AVATAR_HEADER` over about 450ms, with ease-in-out via Reanimated (already in use).
- The greeting bubble fades and lifts out in about 200ms, and the header text fades in after the move.
- The breathing and glow loops keep running through the move.
- With **Reduce Motion** on, there is no movement: cross-fade to the header layout.
- It plays once per day. On reopening the app mid-day, the screen starts directly in header layout.

## 5. Data

New table, added to `src/db/schema.ts` and `migrationPlan.ts` (idempotent):

```
chat_messages(
  id          TEXT PRIMARY KEY,
  day_key     TEXT NOT NULL,     -- local 'YYYY-MM-DD' the message belongs to
  seq         INTEGER NOT NULL,  -- order within the day
  role        TEXT NOT NULL,     -- 'user' | 'xavier'
  kind        TEXT NOT NULL,     -- see below
  payload     TEXT NOT NULL,     -- JSON, zod-validated on write AND read
  status      TEXT NOT NULL,     -- 'live' | 'resolved' | 'abandoned' | 'stale'
  data_revision INTEGER,         -- for cards: the revision they were built against
  created_at  INTEGER NOT NULL
)
CREATE INDEX IF NOT EXISTS idx_chat_day ON chat_messages(day_key, seq);
```

**Kinds:**
- `user_text`: what was typed.
- `user_photo`: label only, for example "📷 Receipt". **Never store the image.**
- `xavier_text`
- `xavier_receipt`: the speech-bubble receipt content.
- Card kinds: `draft`, `account_create`, `account_update`, `afford`, `afford_pick`, `set_budget`, `delete_handoff`, `tx_picker`, `query_answer`, `statement_queue`.

**Payload contents:**
- A card's payload holds what is needed to **render it read-only** and to describe its stub.
- A `query_answer` stores the tool result it rendered (charts redraw from it). Only the deterministic tool result is stored; no model prose beyond the existing caption.

**Rules:**
- **Parameterised SQL only**, with a repository at `src/features/chat/repository.ts`.
- **zod on read:** a row that fails to parse is skipped and logged without content. It must never crash the screen; this is guardrail 6.
- **Backups:**
  - The table is **excluded**: delete it from the plaintext image in the export step exactly as `parse_metrics` is (`src/features/backup/sqliteFile.ts`). It is not added to `SQL_TABLES` or `OPTIONAL_SQL_TABLES`.
  - Restore never writes it, and **a restore clears the chat** (old cards would describe data that no longer exists).
  - Add tests for both.
- **Privacy:** messages live in the SQLCipher database like everything else, and nothing leaves the device.

## 6. Behaviour

### 6.1 Daily reset
- **Day key:** the local calendar date (reuse `localDayNoon` from `src/domain/dates.ts`).
- **When it's checked:** only on **cold launch** and on **AppState → active after being backgrounded**, after the biometric unlock. Never on a timer, so a conversation running past midnight continues until the app is left.
- **What reset does:** if the stored day key differs from today, delete every row. Then show the empty day with the one-time note. Keep a `chatResetNotice` flag in settings, cleared after the first message or the next open.
- **Unconfirmed draft:** a live draft at reset time is dropped. That is the same as moving past it, and nothing is saved.

Put this logic in a pure module, `src/domain/chatDay.ts`, and BDD-test it: before and after midnight, a resume across midnight, time-zone changes, and DST.

### 6.2 Card lifecycle
Pure reducer: `src/domain/chatLog.ts`.
- **Only the newest card or chip row is interactive;** everything above it is read-only.
- **Resolved** (Confirm, Create, Log it, chip picked, and so on): the card is hidden and the resulting receipt or text bubble is appended. The mockup shows a confirmed draft becoming "Saved SGD 18.00 to Transport."
- **Abandoned:** the user sends a new message while a card is live. The card collapses to a dashed stub in `caption`, `muted`, using the kind's own wording, such as "Expense · not saved", "Account "Trip" · not created", "Budget change · not made" or "Delete · cancelled".
- **Stale:** the data revision moved, which is the same check `dropStaleReply` and `txOp` use today. The card collapses to its stub, with the same wording plus "· out of date".
- **Discard / Cancel / Not now:** the card collapses to its stub, and Xavier's "No problem, I didn't save it." bubble is appended.
- **Query answers** stay as cards in the history; their dismiss control goes away once they're no longer the newest.
- **Statement queue:** it is the live card while active, and each confirmed row appends a receipt. When the queue finishes, it collapses to its summary bubble.
- **/account Q&A:** questions are Xavier bubbles, answers are user bubbles, and the subtype chips are the live row.

### 6.3 Scrolling and keyboard
- The feed is bottom-anchored.
- Sending, or a new Xavier message, scrolls to the newest. If the user has scrolled up, don't yank them back on an incoming message; show a "↓ New" pill instead. Sending always scrolls down.
- Keep the existing keyboard-controller integration, so the composer and the newest card stay above the keyboard.

### 6.4 Settle rules change
- Receipts **stay in the history**; they no longer reset to the greeting after 5 seconds.
- `replySettleRule` keeps settling only **Xavier's face**, so `resetsReply` becomes false for the chat.
- Typing never clears anything.

## 7. Acceptance criteria

BDD, plain Node:
1. **`chatDay`:** reset when the day key changes on a cold launch or resume. No reset mid-session across midnight. Local-date correctness under TZ changes and DST.
2. **`chatLog` reducer:**
   - append;
   - resolve replaces the card with its receipt;
   - a new user message abandons a live card into its stub;
   - a revision change marks a card stale;
   - only the newest card is interactive;
   - stub wording for every card kind.
3. **Payload zod:** a valid round-trip for each kind; a malformed row is skipped and doesn't throw.
4. **Repository:** parameterised SQL (the same grep-style test as the other repositories); idempotent migration.
5. **Backup:** the exported image contains no `chat_messages` rows; restore leaves the chat empty.
6. **Motion maths:** at size 180 the lift and halo values equal today's exactly; at 52 the lift is about −2.3 and the halo is scaled with a 6pt floor.
7. **Header count:** "Today · N logged" counts only today's chat saves.
8. **Checks:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run eval:intent`, `npm run eval:query` and `npm run eval` are all green. Routing is unchanged, so the evals must not move.

On device (screenshots in the ship-run record; Pro Max first, then iPhone 17 and SE):
- **New day:** a big breathing, glowing Xavier with the greeting bubble and the one-time note.
- **First message:** the hero-to-header move is smooth, and he keeps breathing and glowing in the header. With Reduce Motion on, it cross-fades instead.
- **A busy day:** about 10 exchanges with a draft, an afford answer, a set-budget and a chart. Scroll back works, only the newest card is tappable, and the stubs read correctly.
- **Reset:** open the app after midnight to see the empty day and the note. Chatting across midnight without leaving the app doesn't reset.
- **Keyboard:** the composer and the live card stay visible on SE.
- **Both themes,** and the largest Dynamic Type size on SE.

## 8. Edge cases
- **Biometric relock mid-day:** the chat persists, and the reset check runs after unlock.
- **A transaction saved in the chat, then deleted elsewhere:** the receipt stays as history; it's a record of what Xavier said. Only *live* cards go stale.
- **Currency relabel:** existing receipts keep their text. Only live cards go stale, through the revision check.
- **App killed mid-parse:** no orphan "thinking" state on relaunch. The last user message simply has no reply.
- **Very long day:** no cap needed for v1, since rows are small. Use a virtualised list (`FlatList`), not a ScrollView of everything.

## 9. Suggested build slices (each green before the next)
1. Storage (`chat_messages`, repository, zod), the backup exclusion and restore clear, and `chatDay`, all with tests.
2. The `chatLog` reducer and stub wording, with tests. Wire it to record messages while the current single-exchange UI is unchanged.
3. Feed rendering: user and Xavier bubbles, inline cards (read-only vs live), scroll and keyboard. Remove the single-slot card state from `index.tsx` as each card kind moves into the feed.
4. The pinned header, `AVATAR_HEADER`, size-relative motion in `XavierPet`, and the hero-to-header transition, including Reduce Motion.
5. Reset UX (empty day plus the one-time note) and the settle-rule change, then device verification on three sizes.

## 10. Constraints
- Guardrails from CLAUDE.md: SQLCipher DB, parameterised SQL, zod at every boundary, nothing off-device, the biometric gate in front of the chat.
- Tokens and components only: no new colours.
- Domain logic stays framework-free and BDD-tested.
- Branch `claude/xavier-daily-chat` only, with **no PR into `main`** until the user asks.

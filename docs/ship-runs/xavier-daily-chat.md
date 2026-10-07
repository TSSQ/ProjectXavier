# Ship run: xavier-daily-chat

> Durable, committed record of the `/ship` run for the daily chat. Agent
> verdicts are pasted verbatim. The build goes in the five slices of spec §9.
> Each slice is committed with a `Ship-Run: xavier-daily-chat` trailer.
> Long-lived branch: **no PR into main** until the user asks (spec §0).

- **Feature:** the Assistant keeps today's conversation as a chat and clears itself on the first open of a new day
- **Branch:** claude/xavier-daily-chat
- **Spec:** docs/design/xavier-daily-chat-spec.md (approved 2026-10-05; design artifact VyWz3zj5tjeGDenXyP3NWo v3)
- **Started / finished:** 2026-10-07 / —

## Spec
Approved by the user, so it passes the gate.

Base: merge commit 5a250c9 brings in claude/budget-chat-commands. That branch carries the speech bubble (PR #40, merged into it at 6b545b8) and the budget chat flows (PR #39). This satisfies §0's "speech bubble must land first" without a later index.tsx conflict with #39. The gate was green after the merge: tsc, eslint, 3086 tests, eval:intent 283/283, eval:query 100%, eval 45.4% baseline.

## Slice 1: storage, backup exclusion, chatDay

### QA
Round 1 — **verdict:** PASS-WITH-CONCERNS

> No Critical or Major defects in slice 1. Every spec §7 item for this slice is implemented and holds under adversarial input. The concerns are minor hardening and test gaps.
>
> **Checks:** typecheck clean · lint clean · test 164/164 suites, 3110/3110 · test:tz chat-day 13/13 in America/New_York and Pacific/Auckland · eval:intent 283/283 · eval:query 100% · eval 45.4%, no regression.
>
> **Probes:**
> - All SQL values are bound; the atomic `COALESCE(MAX(seq),0)+1` gives seq 1,2,1 across days.
> - On a `user_photo`, a smuggled `uri`/`image` was stripped. Every cap holds, a role/kind mismatch is rejected, and model prose on a `query_answer` is stripped.
> - Malformed rows on read: `bad_json`/`bad_row`, logged with a fixed string and no content.
> - Backup: `parse_metrics` is unchanged. Chat is absent from the table lists. The clear runs inside `withTransactionAsync`, which both restore paths use.
> - `chatDay`: the midnight edges, resume, timer and locked cases all behave, and the oldest stored day is correct.
>
> **Findings:**
> 1. Minor: the `dayKey` regex only (`chatMessage.ts:281`).
> 2. Minor: no UNIQUE(day_key, seq) (`migrationPlan.ts:147`).
> 3. Minor: an `ai` transitive import (`chatMessage.ts:15-16`).
> 4. Minor: a ZodError on write can carry content (`repository.ts:63-66`).
> 5. Minor (test gap): export and restore are verified by source text and a node:sqlite simulation, not the real SQLCipher path.
> 6. Minor (test gap): the notice is not tested across skipped checks.

### Review
**verdict:** APPROVE-WITH-NITS (fix findings 1 and 2 before slice 2 writes)

> 1. **[should]** Write caps are tighter than what the domain produces:
>    - series `.max(400)` against `MAX_SERIES_BUCKETS = 750`;
>    - note `text(500)` against the 2000-character transaction note.
>
>    Valid data would be refused at append time.
> 2. **[should]** Deleted chat rows survive as free pages in the plaintext backup image (`sqliteFile.ts:134-138`). Confirmed with stock SQLite: a marker string was still in the file bytes after the DELETE. Fix with VACUUM or secure_delete, and add a byte-level test.
> 3. **[should]** The reset check is not atomic with appends (`chatDay.ts:102-116`). An append between the read and the clear is deleted.
> 4. **[should]** The DST scenario does nothing under UTC `npm test`. Auckland's `test:tz` run never crosses a 2026 transition.
> 5. **[should]** The `query_answer` round-trip covers only 2 of 7 tools.
> 6. **[should]** Document the reload rule: a live card loaded from storage is interactive only if `dataRevision` matches. Payloads mix ids and names.
> 7. **[nit]** Layering: the `ai` import exists only for two enum tuples.
> 8. **[nit]** Sends wait behind iCloud uploads through `runExclusive`; add a comment, and the chat must reload after a restore.
> 9. **[nit]** A thrown ZodError can carry content.
> 10. **[nit]** The note-on-message test cannot fail.
> 11. **[nit]** A duplicated guard in `chatDay.ts:106-108`.
> 12. **[nit]** The restore clear uses raw SQL among Drizzle deletes, and its test is brittle.
> 13. **[nit]** The day key for messages written after midnight is unspecified.

All QA and review findings were sent back as one fix round. The UNIQUE(day_key, seq) backstop is not added: the atomic single-statement insert plus `runExclusive` covers it, and a 20-way concurrency test pins it.

### Verify (slice 1)
Fix round applied for all 11 items. Gate run by the main agent:
```
typecheck ok · lint ok · test 165 suites / 3118 tests · test:tz 20+20 recurring, 15+15 chat-day (NY, Auckland)
eval:intent PASS 283/283 · eval:query PASS 100% · eval PASS 45.4% (baseline, no regression)
```
Review finding 2 was checked against the app's own SQLCipher, not stock SQLite. The vendored `expo-sqlite/vendor/sqlcipher/sqlite3.c` was compiled with the app's flags. The test ran ATTACH plain KEY '', then `sqlcipher_export`, then `DELETE FROM plain.chat_messages`, then `VACUUM plain`, then DETACH. Results:
- All statements returned ok, and the image keeps its other tables (budgets 1, chat 0).
- Marker occurrences in the file: 14 with no delete, 0 after the delete without VACUUM, 0 with VACUUM.

So SQLCipher already zeroes deleted pages, which means it runs with secure_delete. The finding applies to stock SQLite only. VACUUM is kept as a defence in depth and is proven to run in the export sequence.

## Slice 2: chatLog reducer, stub wording, record-only wiring

### QA
Round 1 — **verdict:** FAIL

> The gates are green and the visible UI is unchanged. But the card-recording logic has two blockers: a card goes missing, and a confirmed card gets the wrong status. Both are invisible until slice 3 renders the log.
>
> **BLOCKER 1: a second card of the same kind is never recorded** (`useChatLog.ts` `run()` ~96-100, `syncCard` ~197-199). When the user sends while draft A is live, `suppressedKindRef = 'draft'`. Then `syncCard(null, busy)` returns early without clearing it, and draft B is skipped. Replayed with the real reducer, the final log is `['draft:abandoned:500','user_text:resolved','xavier_text:resolved']`, with draft B absent. This applies to every kind on the send and photo paths.
>
> **BLOCKER 2: a confirmed card is marked stale.** A delete confirm bumps the revision, and the `tx_picker` stays live because `syncCard` is skipped while busy. `await loadContext()` then calls `noteRevision` and stales it, giving "Transactions · nothing deleted · out of date" above "Deleted…".
>
> **MAJOR 1:** `settle` misclassifies several cases:
> - a chip pick ends as abandoned;
> - a stale-draft explanation ends as resolved and hidden;
> - error text counts as resolved.
>
> **MAJOR 2:** the header undercounts. Series saves, the "Saved." fallback and the `!stillCurrent` skip are not counted. `logged` lives only on `xavier_receipt`.
>
> **MAJOR 3:** Cancel and Not now on delete-handoff, tx_picker and budget append no "No problem" line, unlike §6.2.
>
> **MINOR:**
> - `lastXavierText()` card text goes stale or empty;
> - /account chip answers are not recorded;
> - dismiss is double-recorded during the load window;
> - photo labels are recorded only on success;
> - the reload rule and the in-session stale scope are inconsistent;
> - a reloaded live card has no screen counterpart;
> - the whole log sits in React state;
> - the early return on busy is the root of both blockers.
>
> Probes OK: no visible UI change, a sound send path (fire-and-forget, ordered, content-free logs), privacy holds, stub wording is complete. The hook has no tests; both blockers live there.

### Review
**verdict:** REQUEST-CHANGES

> The reducer itself is a sound foundation. The problem is the bridge in `useChatLog.ts` (`syncCard` with its shown/suppressed refs): it drops whole cards in the most common flow, and "settle" marks unsaved cards as resolved.
>
> 1. **[blocker]** A second card of the same kind after a user message is never recorded. Identity is inferred from `kind` alone.
> 2. **[blocker]** "Settle" treats "Xavier spoke after the card" as "the card was acted on". `explainStaleDraft` hides an unsaved draft. A save whose receipt fails `stillCurrent()` gets stubbed as "not saved".
> 3. **[should]** Dismiss uses `skipTextRef` to de-duplicate, which depends on ordering. Pass the text instead.
> 4. **[should]** The header count misses some chat saves. Put `logged` on the save event.
> 5. **[should]** /account chip taps are not recorded as user bubbles.
> 6. **[should]** `lastXavierText()` cards are rewritten on every effect run.
> 7. **[should]** The reload stale scope differs from the in-session one, and draft and set_budget payloads can't be rehydrated as live.
> 8. **[should]** `run` can throw synchronously into the send path. Wrap it.
> 9. **[should]** Chips, Open Budget, no-budgets and the FM refusal have no stored kind. Render them as an ephemeral live tail, and make `isInteractive` tail-aware. Don't add `account_chips`.
> 10. **[nit]** Updating a same-kind card in place is fine only once cards have identity.
> 11. **[nit]** Photos are recorded only on success.
> 12. **[nit]** Dismiss with no live card still appends a line.
> 13. **[nit]** Stubs follow the screen, not the spec copy, for some Not-now cases.
> 14. **[nit]** Messages written after midnight get the next day's key. Stamp the session's day key instead.
> 15. **[nit]** The precedence effect should become a pure helper.
> 16. **[ok]** Privacy.
> 17. **[ok]** §6.2 consistency in the reducer.
>
> **Guidance for slice 3:**
> - Delete `syncCard` first, and dispatch explicitly at call sites.
> - Give cards identity (`showCard → cardId`).
> - Resolve explicitly at success sites with `logged`.
> - `dismiss(cardId, text)`.
> - Keep stale limited to the kinds the screen drops, and decide reload per kind.
> - Render an ephemeral tail.
> - Test the recorder as a pure state machine.

Rework round 1, decided by the main agent: all of the reviewer's slice-3 guidance is applied now, not deferred.
- **Reload rule:** nothing reloads as interactive. A query answer reloads as read-only; every other live card reloads as abandoned, or stale if its revision moved. Screen card state isn't persisted, so a live card can't be rehydrated.
- **Count:** series saves and fallback saves count as logged; edits, account creates and budget changes do not.
- **Stamp:** messages carry the session day key.

### QA
Round 2 (after the rework) — **verdict:** PASS-WITH-CONCERNS

> Both earlier blockers are fixed and replay clean (`sim2.ts` against the real recorder). Draft B is recorded as live, and a resolve followed by `noteRevision` leaves the `tx_picker` resolved. MAJORs 1–3 are fixed.
>
> Gates: tsc and eslint clean · 168 suites / 3208 tests · test:tz 4/4 · eval:intent 283/283 · eval:query 100% · eval 45.4%.
>
> New and remaining:
> 1. **MAJOR:** confirm errors (set_budget, create-category, remove, archive) leave a live card with no screen counterpart.
> 2. **MAJOR:** "Cancel" in the /account Q&A before a card exists loses "No problem", because `dismissCard` is a no-op when there's no live card.
> 3. **MINOR:** `cardRef` is never cleared.
> 4. **MINOR:** same-kind replacement depends on resolve-first. It's safe because the reducer abandons the older card.
> 5. **ACCEPTABLE:** "No problem" logged but not shown. Wording note: "didn't save it" is off for a delete handoff, the tx picker and a budget.
> 6. **MINOR:** the session day key across midnight, and the header must use it.
> 7. **MINOR:** the ready flag if the effect is cancelled before load.
> 8. **MINOR:** a narrow `noteRevision`-before-resolve race on focus.
>
> Probes: visible UI unchanged; send path safe; privacy OK; photos and chip answers OK.

### Review
Round 2 (after the rework) — **verdict:** APPROVE-WITH-NITS

> All four earlier blockers, and every should that needed a code change, are fixed. The rewrite is the right shape: a pure recorder, explicit card ids, explicit resolve/dismiss/expire, and no inference from what the screen shows.
>
> 2. **[should]** A transfer-row skip expires the whole statement queue (`index.tsx:1223` vs `:1237`).
> 3. **[should]** A row pick for update resolves the `tx_picker` before anything is saved, so cancelling the editor leaves no stub.
> 4. **[should]** Narrowing the picker by account doesn't update the stored card (`onChooseTxOpAccount`).
> 5. **[should]** Don't log a "No problem" line the screen never shows. Make dismiss's text optional, and keep the line only where the screen says it.
> 6. **[nit]** The budget confirm-error gap is a faithful record, because the screen keeps the card.
> 7. **[nit]** Same-kind replacement is correct by construction.
> 8. **[nit]** The day key is computed twice across a load that straddles midnight.
> 9. **[nit]** A remount can collide on `seq`.
> 10. **[nit]** Photo labels belong in `chatCopy.ts`.
>
> API ready for slice 3:
> - The feed renders from state.
> - The live card renders from screen state at its position.
> - Swap `cardRef`/`cardIdRef` for `newestLiveCard`.
> - Compute `tailActive`.
> - The header uses `sessionDayKey`.
> - Add `reset(dayKey)` before slice 5.

Decisions by the main agent:
- **(a) The log never claims a line the user didn't see** (review 5 over QA 5). "Not now" on a delete handoff, the tx picker or a budget only stubs the card. This deviates from the literal §6.2 "No problem" bubble on every Not now, because the stubs already say what happened and the copy didn't fit those kinds.
- **(b) The conflict on confirm errors** (QA Major 1 vs review nit 6) is settled by the rule "the log is live only while the screen shows that card". The implementer checks which way each catch path goes.

Final fix round sent: QA 1–3 and review 2–5 and 8–10, plus `reset(dayKey)`.

### Verify (slice 2)
Final fix round: all 10 items applied.
- **Item 1:** the screen keeps its card on the set-budget/remove/archive failures, so the log stays live there. The screen clears it only on the create-category failure, which now abandons the card with no line.

Gate run by the main agent:
```
typecheck ok · lint ok · test 168 suites / 3217 tests · test:tz 20+20 recurring, 15+15 chat-day
eval:intent PASS 283/283 · eval:query PASS 100% · eval PASS 45.4% (baseline, no regression)
```
Visible UI unchanged (QA probe). Not yet exercised on a device; the first device build comes after slice 3.

## Slice 3: feed rendering

Preview Beta 139 (the uncommitted slice 3 on top of d2a545e) was installed on Pigu before QA/review finished, to get on-device feedback early.

### QA
Round 1 — **verdict:** FAIL

> All gates are green, but there are two real functional defects (B1, B2) and one UX regression that makes the statement queue close to unusable (B3).
>
> - **B1 (blocker/major):** the live card sits at the log's card position, not at the end. In a statement queue the receipts pile up below the live card, so Save/Skip/Stop scroll out of view after a few rows. Probe: `[queue(live), r, r, r]` gives `live, xavier, xavier, xavier`.
> - **B2 (major):** "send always scrolls" is violated when the send and the reply land in the same render (`/account`, Q&A answers, `/transactions`). `[user, xavier]` while scrolled up gives the pill.
> - **B3 (major):** the live card and the log can disagree. The feed can draw a card twice (`['card','live']` with `tailActive`) or not at all (log-live with no screen card, e.g. the update-op `tx_picker` while the edit sheet is open).
> - **M1 (major):** Xavier's reactions play on an avatar that has scrolled out of view (the list footer).
> - **M2 (major, perf):** nothing is memoised, so every parent state change re-renders every cell.
> - **Minor:**
>   - m1: blank frame before load.
>   - m2: duplicate sentence on stored budget cards.
>   - m3: stale comments, and a tap doesn't close the menus.
>   - m4: accessibility (no grouped labels on read-only cards, no announcements).
>   - m5: legacy `text-xs` in card internals.
>   - m6: token rounding and Card border classes.
>   - m7: the "3 of 6" progress label gets baked into a stored line.
>   - m8/m9: OK.

### Review
Round 1 — **verdict:** REQUEST-CHANGES

> The pure-domain split is good, the inverted FlatList is the right call, and the settle change matches §6.4. The problem is the "screen's card state is the live card" model, which relies on an unenforced invariant, made worse by a kind-blind `liveCardId()`.
>
> 1. **[blocker]** The live slot can hold more than one card, and `liveCardId()` targets the wrong one. Repro:
>    1. A query answer is up.
>    2. `/account`: `queryAnswer` is never cleared, so the chart is drawn twice.
>    3. Q&A, then the account card.
>    4. Tap Clear. It dismisses the account card in the log.
>    5. Create. The log says "not created".
>
>    Fix: a single `liveCardOf()` union, plus kind-scoped targeting.
> 2. **[should]** The live card drifts away from the composer during a statement queue. Pin the live row to the newest end.
> 3. **[should]** The generic `describeCard` changes card content (badges, meters and dates lost; raw subtype ids) against §2/§3, and it is nearly dead code. Delete it; only `query_answer` needs a history renderer.
> 4. **[should]** Send-always-scrolls is not guaranteed. Scroll directly in `onSend`.
> 5. **[should]** The padding sits outside the list, so the feed is 16pt narrower than the mock and shadows clip.
> 6. **[should]** Every render re-renders every cell. Memoise.
> 7. **[should]** Double spinner on budget cards.
> 8. **[should]** The ephemeral rule is held in three places.
> 9. **[should]** A log-live card with no screen counterpart vanishes silently. Draw its stub.
> 10. **[should]** Tapping the empty feed no longer closes the + menu.
> 11–17. **[nit]** caption size; radii 22/8 vs 21/7; stale comments; dead code (`avatarFlow`, `lastShownId`); indentation; Q&A question size changed (`prompt` to `body`); a short gap after Save.
>
> **Guidance for slice 4:**
> - Not from the list footer.
> - One avatar in an overlay, moving between measured hero and header slots.
> - A layout phase `'hero' | 'moving' | 'header'`.
> - The header is a sibling over the list with a fade.
> - Cross-fade under Reduce Motion.
> - `loggedTodayCount(sessionDayKey)`.
> - Fix 1 and 2 first.

Fix round 1, decided by the main agent: every blocker, major and should, plus most nits.
- The live row is always last.
- `describeCard` is deleted, and a log-live card without a screen card shows its stub.
- `LiveCardSlot` and `FeedTail` are extracted.
- Kept as intended: the token radii (22/8, stub `md`), and Q&A questions at body size (flagged to the user).

### QA
Round 2 — **verdict:** PASS-WITH-CONCERNS

> B1, B2, B3 and M1 are fixed, and M2 is mostly fixed.
> - B1: `[queue(live), r, r]` gives `xavier, xavier, live`.
> - B2: `[user, xavier]` while scrolled up now scrolls, and a direct `scrollFeedToNewest` was added at 5 sites.
> - B3: tail plus live gives `[live]`; log-only gives `[stub]`.
>
> Gates: tsc and eslint clean, 170 suites / 3257 tests, test:tz green, eval:intent 283/283, eval:query 100%, eval 45.4%.
>
> Pressable wrapper: safe. Resetting active draft state: no flow breaks. Kind scoping: complete across 27 sites plus the budget hook. No stub flicker on normal transitions.
>
> - **N1 (minor to major):** the hero flashes before today's rows load.
> - **Minor 1:** VoiceOver can announce a history that contains only Xavier messages.
> - **Minor 2:** a misleading stub appears while the tx update editor or account-choice step is open.
> - **Minor 3:** `liveVersion` gives `extraData` a new identity on every render.
> - **Minor 4:** left-edge alignment needs checking on device.
> - **Minor 5:** `lastShown` is not cleared on expire.

### Review
Round 2 — **verdict:** APPROVE-WITH-NITS

> The blocker is fixed structurally: one `liveCardOf()` union, a `LiveCardSlot` that can't draw two cards, and kind-scoped reducer actions.
>
> Should:
> 1. The tx picker's "which account?" step shows a wrong "nothing deleted" stub.
> 2. VoiceOver misses Xavier replies that arrive in a send batch, and the initial load can announce history.
> 3. A mid-day reopen briefly shows the hero, which slice 4 would animate every launch. Needs a neutral loading phase.
> 4. Resolving with a broad `kinds` list can write a draft payload under the `statement_queue` kind. The reducer must guarantee they agree.
>
> Nits:
> 5. The negative margin sits outside the Pressable.
> 6. The budget hook resolves by kind, not by id.
> 7. The `extraData` identity trick and a ref written during render. Use a context.
> 8. The kind lists exist three times.
> 9. The dev-check deps are incomplete.
> 10. The `resetActiveDraftState` behaviour change: a widget scan deep link now drops an account card mid-edit.
> 11. Radii, a comment, an unused re-export.
>
> Q3: keep the Pressable. Q4: `LiveCardSlot` can stay in `index.tsx` for now; schedule a no-behaviour-change move of the card components before slice 4. Before slice 4: fix 1–4, do the pure move, then build on the phase state machine with a single overlay avatar.

Final fix round: review 1–9 and 11, QA N1 and minors 1, 2, 3 and 5.

Recorded as intended:
- token radii;
- `resetActiveDraftState` clears account and handoff cards on any new action, deep links included (review 10).

Preview Beta 140 (this round's code before the final fixes) is installed on Pigu.

### Verify (slice 3)
Final fix round: all 10 items applied.
- The tx picker is a phased live card (picker, choosing account, editing).
- `arrivalsSince` makes the first look silent and announces every Xavier line.
- `layoutPhase` loading/hero/feed.
- `resolve` requires `payloadKind`.
- `LiveSlotContext` replaces `extraData`.
- The kind lists are derived from `LOG_KINDS_OF`.

Gate run by the main agent:
```
typecheck ok · lint ok · test 170 suites / 3267 tests · test:tz 20+20 recurring, 15+15 chat-day
eval:intent PASS 283/283 · eval:query PASS 100% · eval PASS 45.4% (baseline, no regression)
```
Previews Beta 139 and 140 are installed on Pigu (pre-fix code), and the device verdict is pending.

Not yet done on device: the keyboard with a focused live-card input on SE, VoiceOver order on the inverted list, and left-edge alignment.

## Pure move (18196df)
Card components moved verbatim from index.tsx into src/components/assistant/ (5,213 → 3,732 lines), as the slice-3 review recommended before slice 4. The main agent checked it: the index.tsx diff adds only import lines, and the gate is unchanged (3267 tests, evals the same).

## Slice 4: pinned header, size-relative motion, hero → header

Preview Beta 141 (pre-fix slice 4 on top of 18196df) is installed on Pigu.

### QA
Round 1 — **verdict:** PASS-WITH-CONCERNS

> All gates are green and I found no blocker.
>
> 1. Identity at 180 is confirmed byte-identical. Every other size changes: the hero at 160/148 (the real iPhone 17 and SE hero sizes) loses halo and lift versus today, and budget (30) and welcome change too.
> 2. The halo floor is lost under the scale transform. The header's effective rest halo is 4.6pt dark, under the 6pt floor; `petMotion` is dead for the header.
> 3. **major (slice-5 trap):** `moveDone` is latched and `header` is terminal, so there's no path back to the hero.
>    - Minor: any transient non-quiet state triggers the move.
>    - Minor: one render frame of the old phase.
> 4. Timers are cleaned up.
> 5. **major (device):** the hero slot's `onLayout` runs on JS while the keyboard animates natively, so the avatar trails or jumps.
>    - Minor: `markReady` runs before `progress`.
>    - Minor: the header row swallows drags.
> 6. Header:
>    - the count is correct and live; the safe-area fade and inverted padding are correct;
>    - the fade colour versus DepthField needs a device check;
>    - the overlay isn't hidden from accessibility;
>    - the texts can overflow at the largest Dynamic Type.
> 7. Reactions reach the single overlay.
> 8. Reduce Motion is a fade-in only.
> 9. Tokens are fine.
> 10. Reanimated is transform/opacity only.

### Review
Round 1 — **verdict:** REQUEST-CHANGES

> The architecture is right and I'd keep it: one avatar that never remounts, an overlay moved by transform only, the header as a sibling, and a pure phase machine. Two acceptance items aren't actually delivered.
>
> 1. **[blocker]** `petMotion` isn't used for the header avatar, so the §4 6pt halo floor isn't met (4.6 dark, 4.0 light). The "at 52" test gives false assurance. Fix: a `visualScale` prop so motion is computed in visual space.
> 2. **[blocker]** The header row has a fixed height and overflows at large Dynamic Type, and the feed inset uses the same constant. Fix: `minHeight`, a measured height feeding `topInset`, and `maxFontSizeMultiplier`.
> 3. **[should]** The fade covers the status line, and flat `c.bg` cuts across DepthField. Make the row solid, put the tail below, and use a depth-like token.
> 4. **[should]** Accessibility: `role="header"`; tree order puts the header after the feed; it's focusable while transparent.
> 5. **[should]** Slot measurement is fragile because it depends on parent-relative coordinates, and the keyboard likely makes the hero avatar lag. Compute the header centre statically, use `measureLayout` for the hero, and follow the keyboard on the UI thread.
> 6. **[should]** The phase machine can't run again, which slice 5 needs: `moveDone`/`ready`/`seen.hero` are never reset, and the timer ends the move rather than the animation callback.
> 7. **[should]** Profile the cost of the 180pt shadow layer in the header, and watch for a stutter when the feed mounts at the start of the move.
> 8. **[should]** The count reads a non-reactive `sessionDayKey`, and the `?? ''` fallback hides failures.
> 9. **[should]** Scope: budget and welcome avatars change; call it out.
> 10. **[should]** Maintainability: add a `useLayoutPhase` hook and a `HeroHeaderStage`.
> 11–13. **[nit]** "cross-fade" wording; scroll indicator insets; `markReady` closure.
>
> **Slice 5 guidance:**
> - an explicit `dayReset` event, which a restore also sends;
> - reset per-run state;
> - snap, don't animate, behind the biometric gate;
> - a reactive `dayKey`;
> - the reset note fades with the greeting;
> - the device pass.

Fix round 1, decided by the main agent:
- `visualScale` + `motionReference = avatarIdle`, so the hero stays exactly as today on every device (user requirement "breathing and glowing exactly as now"). The header floor is met in visual space.
- Budget and welcome avatars get size-relative motion on purpose (reference 180).
- The phase machine becomes a reducer with `dayReset` now.
- Keyboard tracking runs on the UI thread.
- Pre-mounting the feed is deferred until device profiling.

### QA
Round 2 — **verdict:** FAIL (one blocker found by reading the code; gates green, the other fixes check out)

> **B1.** The pinned header paints over the avatar overlay, so Xavier is nearly invisible in the header. `PinnedHeader` has the new `zIndex: 2` and `TransitionAvatar` has none, so the 0.94 `c.bg` fill covers him. Fix: overlay `zIndex: 3`.
>
> **Re-checked:**
> - Identity at 160/148 is fixed, byte-identical to HEAD.
> - The halo floor is fixed: rest 6pt and peak 8.05pt on screen at 46/160.
> - The phase machine is fixed.
> - The `withTiming` completion is reliable; an interrupted move gives `finished=false`, which is a no-op.
> - The reset layout effect runs before the new slot's layout.
> - A switch to header does not restart breathing.
>
> **Minor:**
> - The halo pops by about 1.4pt when the phase reaches `header`.
> - The `notQuiet` effect keys on `[quiet]` only.
> - At the start of the keyboard animation the avatar can be up to about 17pt out of line.
> - Reduce Motion: `withTiming` defaults to `ReduceMotion.System`, so the 240ms fades become a cut.

### Review
Round 2 — **verdict:** REQUEST-CHANGES (one new blocker, a one-line fix)

> Nearly every round-1 item is properly resolved (table: 1, 2, 3, 8, 9, 10 and 11–13 resolved; 4, 5 and 6 mostly; 7 deferred to profiling).
>
> 1. **[blocker]** The header's `zIndex: 2` paints its 94% background over Xavier, against §4 "alive in both places". Fix: `zIndex: 3` on `TransitionAvatar`.
> 2. **[should]** `notQuiet` is edge-triggered, so a `dayReset` into a non-quiet state leaves the hero stuck and the content invisible. Make it level-triggered.
> 3. **[should]** A reset from `moving` leaves Xavier hidden indefinitely, because the hero slot doesn't remount and `ready` stays 0.
> 4. **[should]** `dayReset` from `loading` jumps to `hero` before rows are read. Stay in `loading`.
> 5. **[nit]** The keyboard formula doesn't model the stage, and works only because the constant cancels. Use `kb/2`.
> 6. **[nit]** The header row still swallows drags.
> 7. **[nit]** Document `reference = avatarIdle` in spec §4.
> 8. **[nit]** Add an eslint-disable comment explaining the partial deps.
>
> **Q2:** the reducer is the right foundation. `dayKey` alone misses a restore (same day), so add a `resetEpoch` that every clear bumps. Slice-5 notes:
> - snap behind the biometric gate;
> - fade the note with the greeting;
> - clear the notice on the `hero → moving` edge;
> - decide what screen state a reset clears.

Final fix round: both blockers, review 2–8, a `resetEpoch`, Reduce Motion `Never` on the reduced fades, the halo eased with `progress`, and the QA test suggestions.

Preview Beta 142 (round-1 fixes, with the zIndex bug) is installed on Pigu.

### Review
Round 3 (final fix round) — **verdict:** APPROVE-WITH-NITS

> All nine requested items are present and correct; nothing blocks merge.
> 1. Paint order — `TransitionAvatar` zIndex 3 over the header's 2, with a comment pinning it.
> 2. `notQuiet` is level-triggered on `[quiet, phase]`; the reducer ignores it outside `hero`.
> 3. Hero reset clears `ready`/`seen.hero` only when coming from `header`; a reset from `moving` keeps the slot's measurement.
> 4. `dayReset` in `loading` stays `loading` (tested).
> 5. `resetEpoch` + `reset(dayKey)` in one batched callback; `useLayoutPhase` keys on the epoch.
> 6. Keyboard lift is `-keyboardHeight/2` in both worklet and rest position.
> 7. Reduce Motion: the reduced fades use `ReduceMotion.Never`; the normal path keeps the system default.
> 8. Halo as a shared value: still Node-testable (`'worklet'` is inert there), no extra Fabric commits, no breathing restart; the 6pt floor now eases in during the move.
> 9. Header row children are `pointerEvents="none"`; VoiceOver focus and the `header` role are unaffected.
>
> **Nits:** (1) stale doc comment "`dayKey` changing is a day reset" at HeroHeader.tsx:70; (2) `visualScale` prop is now a fallback only (comment already says the shared value wins); (3) device checklist unchanged.
> **For slice 5:** call `useChatLog().reset(newDayKey)` from both the resume-after-unlock `checkChatDay` path and the restore path.

Nit 1 applied (comment now names `resetEpoch`). Nit 2 skipped (cosmetic; existing comment is accurate).

### Verify
Run by the main agent in the worktree, all green:
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm test` — 171 suites, 3296 tests passed
- `npm run test:tz` — pass (20/20/15/15)
- `npm run eval:intent` — 283/283
- `npm run eval:query` — 100%
- `npm run eval` — 45.4% (unchanged; heuristic gate passed)

### Build
Preview Beta 143 (slice 4 final) installed on Pigu (com.projectxavier.beta). Device checks pending: Xavier visible and breathing in the header (both themes), keyboard lift in the hero, Reduce Motion, header at the largest Dynamic Type, fade seam vs DepthField, header-idle CPU.

## Slice 5: reset UX (empty day, one-time note, restore)

### QA
Round 1 — **verdict:** PASS-WITH-CONCERNS (three majors, resolved before review)

> **Major**
> 1. Old chat is visible after unlock or resume until the async check resolves (`useChatLog.ts` `runResumeCheck`, `chatDay.ts` `chatCheckGateReduce`). The gate's "locked → wait" rule forces the flash; misses the spec's "snap behind the gate" intent. Cheap fix: run the check while still locked, or hide the feed until the resume check settles.
> 2. A send during an in-flight resume check can leave an orphan stale-keyed row; on the next open the oldest key is stale, so the reset wipes all of today's messages. Suggested fix: share the exclusive section between `checkChatDay` and the persist chain, or re-check the generation inside the write.
> 3. The hook wiring has no automated coverage (module flags, `reset()` reading `busyRef`, the fence/unfence effect, the AppState/lock subscription); several scenarios only restate pure predicates.
>
> **Minor:** a cold-launch check failure loads rows under today's key; a resume during load is never checked; a cancelled launch effect loses the note; `busyRef` lags `setBusy(true)` by a commit; fence coverage unverified for ops that don't set `busy`; any later no-reset check disarms the note (matches "next open").
>
> Restore atomicity verified: `applyBackupUnlocked` deletes `chatMessages` inside `withTransactionAsync`, so a failed restore rolls back the chat clear.

Decision (main agent): run the resume check behind the lock cover (it only touches the DB, keyed AFTER_FIRST_UNLOCK, never renders) and hold the feed hidden until it settles when a reset is possible. Spec §6.1 and §8 updated. Orchestration extracted to the framework-free `src/domain/chatSession.ts`.

Round 2 — **verdict:** PASS-WITH-CONCERNS (no blockers, no majors)

> The three previous majors are fixed in code. No way for `held` to stick short of a hung DB call (`finally` releases it on throw, unmount, overlapping resumes).
>
> **Minor**
> 1. A parse result that lands during the hold is replayed into the new day (`chatRecorder.hold()`/`reset()` keep `queued` when holding). Fix: drop queued entries from before a fenced reset.
> 2. Known restore gap: a write already past its generation check, waiting in the DB gate when a restore lands, survives as a ghost row; if its key is yesterday's, the next open wipes today. Harden by enqueueing the restore clear on the same chain.
> 3. Unfenced late writes matter mostly for `explainStaleDraft` (and budget `onPick`/`onRaise`/`onEditSave`).
> 4. No tests for a throwing check during a hold, a parse result during the hold, or overlapping holds.
> 5. Dev-only strict-mode double `start()`.
> 6. Hold covers a stale feed only in memory after a failed launch check — acceptable.

All of minors 1–5 sent back for fixing before review, plus a 3s hold timeout for a hung DB.

Round 3 (minors fixed: fenced-reset drops queued non-user calls, restore clear chained, dayEpoch guards, 3s hold timeout, idempotent start, 25 session scenarios) went straight to review.

### Review
**Verdict:** APPROVE-WITH-NITS

> The controller is the right shape. Pulling the sequencing out of `useChatLog` into `src/domain/chatSession.ts` is what made QA's round-1 majors testable in plain Node. One chain, a generation counter checked right before each DB write, a counted hold, and a fence — each piece maps to a failure QA actually found; not over-engineered. Guardrail #2 is respected: behind the cover the check only touches the DB and renders nothing.
>
> **Blocking:** none.
>
> **Should fix**
> 1. A user send during the hold kicks off a parse whose reply is then fenced and dropped (the composer stays usable while held; `reset` reads `isBusy()` after the send's parse set it). Fix: capture `busyAtStart` when `check()` starts; fence only if `busyAtStart && isBusy()`.
> 2. The write chain is now per session, not per module: a remount's `listDay` can read while the old session's appends are in flight (stale view, no corruption). Inject a module-level chain.
> 3. Messages sent after the 3s hold timeout are lost if the hung check later resets — acceptable (better than a ghost row); document it.
> 4. `dayEpoch` guards are spread across call sites; a `dayScope()` helper plus a comment would stop sprawl. Unguarded `onSuggestionYes`/`answerClarify` reads are low risk.
> 5. `dispose()` doesn't clear the hold timer (harmless).
>
> **Accessibility:** hidden stage is correct on both platforms. The note reads as its own element after the greeting (optionally merge). Without the lock cover, the first frame after "active" and the app-switcher snapshot can show yesterday's chat — accept and note it in the spec.
>
> **Tests:** the session feature drives the real `createChatSession` against a fake DB with deferred gates and fake timers; most scenarios are real interleavings. Gaps: finding 1 and a remount-while-writes-in-flight test.
>
> **Nitpicks:** stale repository.ts header; vestigial `unlocked` input; `mayReset` should be a plain key compare; comment the `[busy]` effect deps; `adoptDay` → `adoptDayIfEmpty`.

All five should-fix items, the nitpicks and the merged accessibility label applied (finding 3 documented, behaviour kept).

### Verify (slice 5)
Run by the main agent in the worktree, all green:
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm test` — 173 suites, 3338 tests passed
- `npm run test:tz` — recurring-local-day 20/20, chat-day suites 57/57 in both zones
- `npm run eval:intent` — PASS 283/283
- `npm run eval:query` — PASS, every graded dimension 100%
- `npm run eval` — 127/280 (45.4%), at baseline, no case regressed

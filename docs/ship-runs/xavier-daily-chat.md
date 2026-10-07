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

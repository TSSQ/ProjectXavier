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

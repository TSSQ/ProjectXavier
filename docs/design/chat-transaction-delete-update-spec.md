# Spec: chat transaction DELETE + UPDATE (op-only contract, the user picks the row)

**Branch:** `claude/phase2-byok` · **Status:** design (probe-driven) · **Date:** 2026-08-05
**Builds on:** `account-chat-crud-spec.md` (gate ops, `ParseContract`, handoff doctrine), `ask-xavier-queries-spec.md` (unified gate + corpus rule).
**Evidence:** `evals/txop/README.md` (committed, `f305afe`).

## 1. Objective

Let a user delete or edit an **already-recorded transaction** from chat, where **the model never identifies the row — the user picks it**.

- The model emits **one enum**: `delete | update | none`. No selector, no payee, no date, no free text.
- The app narrows the ledger **deterministically** (relative dates, "latest", payee/amount tokens), shows real rows, and the user taps one.
- Delete reuses `deleteTransaction`. Update opens `TransactionFormSheet`. **The assistant is a navigator, not a writer.**

## 2. Why this shape — the probes decided it

| Contract | FM (on-device) | gpt-4o-mini | claude-haiku-4-5 |
| --- | --- | --- | --- |
| **min** (op only) | **90%** (54/60) | 100% (60/60) | 100% (60/60) |
| **full** (op + selector) | **62%** (28/45) | 100% (60/60) | 100% (60/60) |

Four findings this spec honours:

1. **The model must not identify the row on-device.** On `full`, FM answered `delete/latest` for *"delete yesterday's transaction"* — right op, **wrong target**. Correct-op/wrong-selector is the dangerous failure. FM also emitted `delete/unspecified`, which has no safe handling.
2. **Handing row-selection to the user makes safety structural.** On `min` the model *cannot* name the wrong row, and every FM miss degrades to `none` — "I didn't understand" — which is safe. Worth more than the 28-point accuracy gain.
3. **Schema size costs accuracy AND stability.** The 7-field contract produced three `exceededContextWindowSize` failures (4,091 against a 4,096 limit) from unbounded strings. The 1-field contract: zero.
4. **No tier split.** Both tiers clear the bar on `min`. BYOK's advantage is a *shorter candidate list*, not a different feature.

The residual FM false positive — `paid mum 50` → `update` on 1/5 runs — is closed **by ordering, not prompting** (§5.1).

**Honest limit carried forward:** the 20-case set is saturated for BYOK and measured *classification*, not *resolution*. Resolving "the coffee one" against hundreds of real rows is untested. That is exactly why the picker matters at 100%.

## 3. Scope

**In:** deterministic candidacy gate ordered behind the query and account gates; one-field contract across FM + both BYOK providers; deterministic pre-filter; pure ranking + picker UI; delete via existing `deleteTransaction`; update via existing `TransactionFormSheet`; new corpus cases **landed first**.

**Out (v1):** bulk ops (explicitly refused, never executed); editing a recurring *series* (only posted occurrence rows are in scope); undo/trash/soft-delete (iCloud backup remains the undo story); merge/split/bulk re-categorise; multi-turn refinement ("no, the other one"); any change to the account delete flow.

## 4. What exists (assemble, don't invent)

| Capability | Where |
| --- | --- |
| Unified gate + order | `src/domain/intentGate.ts` (`detectIntent`) |
| Query / account gates | `src/domain/queryIntent.ts`, `src/domain/accountIntent.ts` |
| FM guided-generation doctrine | `src/domain/queryToolSelection.ts` |
| FM single-shot call shape | `src/features/ai/deviceParse.ts` → `deviceParseQuerySelection` |
| BYOK contract plumbing (provider-agnostic) | `src/features/ai/engines/shared.ts` → `ParseContract` |
| Relative / absolute dates | `src/domain/deviceParsePrompt.ts` → `resolveRelativeDate`, `resolveAbsoluteDate` |
| Period phrases | `src/domain/periodRange.ts` → `resolvePeriodFromText` |
| Payee / account matchers | `src/domain/payees.ts`, `src/domain/accountMatch.ts` |
| Ledger row | `src/components/ui/TransactionRow.tsx` |
| Transaction read/write | `src/features/transactions/repository.ts` |
| Edit form | `src/components/transactions/TransactionFormSheet.tsx` |
| Corpus + 100% bar | `tests/intent-corpus.jsonl` (191 lines), `evals-lite/intent-report.mjs` |

**Verified facts that shape the design:**

- **Transfers are a single row.** `transferAccountId` on the row (`src/db/schema.ts`); `signedDelta` credits the destination off that same row (`src/domain/balances.ts`). **There is no contra row.** `deleteAccountCascade`'s `accountId OR transferAccountId` sweep is the *account*-scoped sweep, not a per-row contra. So `deleteTransaction(id)` on a transfer *is* "delete both sides" — nothing extra to write. But it silently changes a **second** account's balance, so the picker must name the counterparty.
- **`deleteTransaction` has exactly one call site today** (`app/(tabs)/transactions.tsx`). The chat screen adding a second is the point of the feature, guarded by a routing test (§7.11).
- **Deleting a past recurring occurrence does not resurrect it** — `dueOccurrences`' cursor starts at `lastPostedAt`. **But `postedCount` is not decremented**, so a count-ended series finishes one occurrence early. Real, accepted, documented (§9.3).
- **Pending rows** are excluded from aggregations but visible. Valid candidates.

## 5. Design

### 5.1 Gate ordering — how the false positive is closed

```
1. detectQueryIntent      (existing, read-only, always wins)
2. detectAccountIntent    (existing, create | update | delete)
3. detectTransactionOpCandidate   ← NEW, deterministic, pure
4. expense parse ladder   (existing fall-through)
```

`UnifiedIntent` gains `'tx_op'`. Only on `'tx_op'` does the model contract ever run.

**`detectTransactionOpCandidate(text)`** — new pure function in `src/domain/transactionOpIntent.ts`. A hit requires **both**:

- **(a) a mutation verb** — `delete | remove | undo | edit | change | update | fix | amend | correct | get rid of | scratch`; and
- **(b) an existing-transaction REFERENCE** — a ledger noun (`transaction | entry | expense | purchase | charge | payment | record | one | it | that`), a recency marker (`last | latest | previous | most recent | just added`), or a date phrase the existing resolvers recognise.

Plus **three vetoes**, checked first:

1. **Stated-amount veto — this is what kills `paid mum 50`.** Reuse `queryIntent.ts`'s proven "STATES vs ASKS" doctrine (`hasStatedAmount`, currently module-private — export or lift it): a bare amount with no recency marker and no ledger noun is someone recording a NEW expense → veto, falls to the expense ladder, model never runs. Symmetrically `change yesterday's lunch to 15` carries both, so the amount does not veto it.
2. **Bulk veto.** `all | every | everything | each` adjacent to a ledger noun → not a candidate. This is the probe's `[SAFETY]` case. Reply with a plain refusal; execute nothing.
3. **Account-noun veto.** Ordering handles this — except for §5.1.1.

**Verified against the live gate:**

| Utterance | today | after |
| --- | --- | --- |
| `delete my last transaction` | `null` | `tx_op` |
| `delete yesterday's transaction` | `null` | `tx_op` |
| `delete my savings account` | `delete` | `delete` (unchanged) |
| `paid mum 50` | `null` | `null` (stated-amount veto) |
| `delete everything` | `null` | `null` (bulk veto) |
| `how do I delete a transaction` | `query` | `query` (read-only wins) |

#### 5.1.1 A real collision in shipped code — fix corpus-first

`detectIntent("delete the transaction in my wallet")` returns **`'delete'`** — the **account** delete flow. Verified by execution, not inspection.

Cause: `"in"` is in neither `DIRECTIONAL_PREPOSITIONS` (only `to|into|onto|from`) nor `CLAUSE_PREPOSITIONS`, so `wallet` is ungoverned, the trailing guard passes at end-of-string, and `delete` precedes it.

Severity: the account delete flow is **handoff-only** — it deep-links to Manage Accounts and cannot execute without a typed account name plus a forced backup. So this is alarming mis-navigation on a destructive screen, not silent data loss. It should still be fixed.

**Fix, in this order:**
1. Add the failing case to `tests/intent-corpus.jsonl` labelled `tx_op` (fails on old code).
2. Then change the gate. **Recommended: a ledger-noun veto inside `detectAccountIntent`** — if a ledger noun appears *before* the matched account noun, the account noun is a **location qualifier**, not the target. Narrower and more honest than adding `"in"` to `DIRECTIONAL_PREPOSITIONS`, which would regress the `change the balance ON my savings` recall that file explicitly protects.
3. Re-run `npm test` + `npm run eval:intent`; all 191 existing lines stay green.

**Decide + document:** `where do I delete a transaction` returns `null` today. Under this spec it becomes a `tx_op` candidate and shows a picker — non-destructive and arguably helpful, so accepted, with a corpus line carrying that reasoning in its `note`.

### 5.2 The contract — one enum, nothing else

`src/domain/transactionOpSelection.ts` (NEW), mirroring `queryToolSelection.ts`'s doctrine: flat, every field REQUIRED, sentinels, **no free-form dates**, **no unbounded strings**.

```ts
export const transactionOpSelectionSchema = z.object({
  op: z.enum(['delete', 'update', 'none']).describe(
    'What the user wants to do to a transaction they have ALREADY recorded. ' +
    '"delete" to remove one, "update" to change one, "none" for anything else. ' +
    'Recording a NEW expense ("lunch 12.50", "paid mum 50") is "none". A question ' +
    'about totals is "none". Anything about an ACCOUNT ("delete my savings ' +
    'account", "rename my wallet") is "none".'
  ),
});
```

- `buildTransactionOpInstructions()` — port `evals/txop/fm-min.swift` verbatim in substance, including *"You do NOT need to work out WHICH transaction they mean — the user will choose it themselves afterwards."* That line is load-bearing: it stops the model reaching for a selector it has no field for.
- `buildTransactionOpPrompt(text)` — `Message: ${text}` and nothing else (see §11.1 — a deliberate deviation from the probe that must be re-measured).
- `normalizeTransactionOpSelection(raw)` — loose zod coercion; anything outside the enum → `null`. **A hallucinated value is rejected, never coerced into a guess** (guardrail #6).

**Wiring — zero engine changes.** FM: `deviceParseTransactionOp` copying `deviceParseQuerySelection`'s shape. BYOK: a `TRANSACTION_OP_PARSE_CONTRACT`; `openaiParse<T>`/`anthropicParse<T>` are already generic, so both providers work with no new engine code.

**Floor behaviour:** when no engine produces an op (FM unavailable, no BYOK key), fall back to the **deterministic verb category**. The candidacy gate already established this is a transaction op; the verb alone is a safe classifier because the *picker*, not the classifier, protects the data. (See §12.1 — this needs a product call.)

### 5.3 Deterministic pre-filter — no model

`src/domain/transactionCandidates.ts` (NEW), pure, injected clock.

`buildCandidateFilter(text, ctx)` → `{ onDate, range, latest, payeeId, accountId, amountMinor }`, each from an **existing corpus-tested resolver** — no new date parsing. Payee matching uses **exact only**: a fuzzy hit widens the list rather than filtering, so a typo never hides the right row.

**The filter never empties the list.** Applied as a cascade: if the result is empty, **drop the most specific constraint and retry** (amount → payee → account → date), keeping recency order. A filter miss becomes a longer list, never a dead end, and every dropped constraint is reported ("I couldn't find one for $50 — here's everything from yesterday").

### 5.4 Ranking + picker sizing

`rankCandidates(transactions, filter, ctx)` — deterministic, total, stable, **no model input**. Score descending: exact date → payee id → exact amount → account id → in-range → recency. Ties broken by `occurredAt` desc then `id` asc, so order is reproducible in tests.

| Candidates | UI |
| --- | --- |
| **0** | No picker. Reply naming what was searched, offer "Open Transactions". Never a silent no-op. |
| **1** | **Confirm card — never auto-execute.** |
| **2–5** | Show all inline. |
| **>5** | Top 3 inline + "Show all N" opening a scrollable sheet. |

**Every row shows payee, amount, date AND account.** `TransactionRow` renders payee, amount and account/category but **not the date** (the ledger groups by day under a section header; the picker has no such header). Add one additive prop `dateLabel?: string`; existing callers unchanged.

### 5.5 Execution — no new write path

**Delete.** (1) Re-read by id via `getTransaction`; null or a fingerprint mismatch (`amount`, `occurredAt`, `accountId`, `payeeId`, `pending`) → abort and report (§9.5). (2) `Alert.alert` destructive confirm reusing the ledger's exact copy. (3) `await deleteTransaction(id)` — the existing primitive, which already bumps `data_revision` and refreshes the widget. (4) Reload; name the counterparty when the row was a transfer.

*Deliberate:* a single-row delete does **not** force a pre-delete backup. The account cascade does because it destroys a whole account's history; the ledger's own delete does not, and chat must not be more or less destructive than the screen.

**Update.** Opens `TransactionFormSheet` prefilled in `mode: 'edit'`, seeded exactly as `openEdit` does. `onSave` → `updateTransaction`. **No new form, no new write path, no new validation.** The chat screen already renders a sheet for the pending draft — the two must never be open at once.

### 5.6 Skipping the account step

No account step by default. Ask only when **all** hold: more than one non-archived account exists; the filter didn't already resolve an `accountId`; **and** the ranked list still exceeds the ">5" threshold. Single-account users, and anyone who said "yesterday" or named a payee, never see it.

### 5.7 One flow for both tiers

Identical UI, gate and picker. **No tier-gating.** The only difference is list length: a BYOK-served op may narrow more aggressively. A scoping constant, not a feature flag — the picker is mandatory in both.

### 5.8 Metrics

Reuse `recordParse`; widen `intent` to `'query' | 'tx_op' | null`. Record `confirm` when a picker renders, `clarify` on an empty list, `blocked` on a bulk refusal. Content-free: no payee names, amounts, or utterance text.

## 6. The corpus rule — non-negotiable, and it comes FIRST

Per `CLAUDE.md`, `.claude/commands/ship.md`, and the rule headers in `accountIntent.ts`, `queryIntent.ts` and `periodRange.ts`:

> **No gate/routing/extraction change without a corpus case FIRST** — one that fails on the OLD code and passes on the NEW.

`tests/intent-corpus.jsonl` is 191 lines at a **100% bar** (a plain `it.each`, not a threshold).

**Before any gate code changes:**

1. Add `'tx_op'` to `VALID_EXPECTATIONS` and to `evals-lite/intent-report.mjs`'s `CLASSES`.
2. Add **≥30 labelled lines**, each with a real `note`:
   - **(a) Positives → `tx_op`** (≥14): the 12 probe positives plus `undo my last entry`, `amend my last transaction`, **`delete the transaction in my wallet`** (the §5.1.1 collision — fails on old code), `where do I delete a transaction`.
   - **(b) Account-op disambiguation, must stay `create`/`update`/`delete`** (≥8): `delete my savings account`, `close my savings account`, `remove my credit card`, `get rid of my wallet`, `rename my wallet to Cash`, `add a DBS savings account with 500`. The pair `delete my savings account` → `delete` vs `delete my last transaction` → `tx_op` is the headline case and must sit **adjacent** in the file with a note saying so.
   - **(c) Negatives → `null` or `query`** (≥10): **`paid mum 50` → `null`** (the probe's residual false positive — this line is the regression test for §5.1), `lunch 12.50`, `coffee 4`, `add 500 to savings`, `move 200 into wallet`, `delete everything` **(SAFETY)**, `delete all my transactions` **(SAFETY)**, plus the query-gate cases.
3. All **191 existing lines stay green**; the new `tx_op` class must read `n/n`.

## 7. Acceptance criteria

1. **Gate order.** query → account → tx_op → null; all 221+ corpus lines pass at the 100% bar.
2. **`paid mum 50` never reaches the model** — asserted at both the predicate and the routing level.
3. **Bulk is refused, never executed** — no picker, no model call, no write.
4. **Account vs transaction disambiguation**, including `delete the transaction in my wallet` → `tx_op`.
5. **Contract shape** — exactly one key, a `z.enum`, no `.optional()`, no `.nullable()`, no `z.string()`. Asserted structurally against the generated JSON schema.
6. **Normalize rejects garbage** — `{}`, `{op:'DROP TABLE'}`, `{op:42}`, `null` → `null`; never throws.
7. **Pre-filter is deterministic** — identical input, identical output across 100 iterations.
8. **Ranking is total and stable** — byte-identical order on repeat calls over a 50-row fixture.
9. **Sizing rules** — 0/1/2–5/6 behave as §5.4, and 1 candidate performs **no** write until an explicit tap.
10. **Row content** — payee, amount, date, account on every row; transfers also show the counterparty.
11. **No new write path (routing test).** `app/(tabs)/index.tsx` still never imports `deleteAccountCascade`; it imports `deleteTransaction`; and the source contains **exactly one** `deleteTransaction(` call site.
12. **Update reuses the form** — no bespoke transaction-writing code in the chat screen.
13. **Stale-row guard** — a changed or missing row performs no write.
14. **Transfer disclosure** — counterparty named in the confirm and the reply.
15. **Metrics are content-free.**

## 8. Constraints

- Guardrail #1 — both primitives already `bumpDataRevision()`; no schema change.
- Guardrail #4 — parameterised SQL only; nothing new is written.
- Guardrail #6 — model output untrusted; unrecognised enum values **rejected**, not coerced.
- Guardrail #5 — no PII in metrics or logs.
- **The model never** sees or returns an id, amount, date, payee or account name. One enum in, one enum out.
- **The model never** decides which row. Only `rankCandidates` and the user's tap do.
- Domain code framework-free so the plain-Node suite covers it.
- Schema-size discipline: one field, no unbounded strings, no grounding lists.

## 9. Edge cases

**9.1 Deleting a transfer.** One row, no contra. Both balances self-correct. **But a second account's balance moves** — the picker row shows `to <counterparty>` and the confirmation names it. A **self-transfer** contributes 0 to every balance and is surfaced by `findSelfTransfers`; deleting one is the intended repair, so it must be a valid candidate.

**9.2 Editing a transfer.** The form already has the destination picker and the self-transfer guard. The chat path must pass the same guard the ledger does.

**9.3 Deleting a recurring occurrence.** Removes only that row; the series is untouched and the row is **not** re-posted. The picker row must show it's recurring (reuse the existing `🔁 recurring` treatment), and the confirmation says the rule keeps running, linking to the recurring screen. **Documented consequence:** `postedCount` is not decremented, so a count-ended series ends one occurrence early. Accepted for v1 — fixing it means teaching `deleteTransaction` about series, a new write path this spec forbids.

**9.4 Empty candidate list.** Never a silent no-op, never a fabricated row. Name what was searched; offer "Open Transactions". The constraint cascade makes this rare.

**9.5 Stale candidate list.** The chat screen reloads on focus and a series can post between render and tap. Re-read by id and compare the fingerprint immediately before executing; on mismatch abort, clear the picker, offer to re-run. Also clear the picker when the screen regains focus with a changed data revision, so a user returning from the Transactions tab never taps a row deleted there.

**9.6 Pending transactions.** Valid candidates — users delete mistaken pending entries. The row keeps its "Pending" chip so nobody is surprised that deleting it didn't move a balance.

**9.7 Zero accounts / transactions.** Falls out as §9.4 with copy pointing at onboarding.

**9.8 Ambiguous verb, no reference.** `delete` alone falls through to the expense ladder — an accepted miss, matching the account gate's "safer to fall through than risk a hijack" philosophy.

**9.9 Prompt injection.** The contract can emit only one of three enum values, so injection cannot exfiltrate or mutate anything. Include ≥2 injected-instruction corpus lines.

**9.10 `/transactions` bypass.** `forceExpense` skips every gate today and must skip this one too.

## 10. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Deleting the wrong row** | Critical | Structural — the model never names a row; even 1 candidate is a confirm card. |
| §5.1.1 ships unfixed | High | Corpus line first; ledger-noun veto; the account flow is handoff-only and cannot execute. |
| A gate widening hijacks a real expense | High | Verb **and** reference required, three vetoes, corpus-first, 100% bar. |
| The probe measured a prompt with grounding lists we're dropping | Medium | **Re-probe before implementing** (§11.1). Do not carry 90% over. |
| FM flapping run-to-run | Medium | Every miss degrades to `none` → expense ladder. The picker is unaffected by op accuracy. |
| Long candidate lists on FM feel worse than the ledger's own search | Medium | Constraint cascade + top-3 + "Show all N". Routinely >10 signals the pre-filter needs more corpus cases, not a model. |
| `postedCount` drift (§9.3) | Low | Documented in copy; accepted. |

## 11. Eval / test plan

### 11.1 Re-probe — DONE (2026-08-05), and it changed the numbers

This was a blocking pre-step; it has been run. Results are recorded in `evals/txop/README.md`.

The original 90% was measured with a grounding preamble the shipping contract does not send. Re-measured on the real prompt:

| FM `min` | positives | negatives | overall |
| --- | --- | --- | --- |
| with grounding | 54/60 (90%) | 39/40 | 93/100 |
| **without (shipping prompt)** | **60/60 (100%)** | 39/40 | **99/100** |

BYOK stayed 100% on both engines either way.

**Removing the irrelevant context made the small model better.** The three cases that used to flap became 5/5. Unusable context is not free for a 3B model — it is noise competing for a 4,096-token window. Grounding is now opt-in (`TXOP_GROUNDING=1`) in both probes so either number can be reproduced.

**The residual failure moved:** `paid mum 50` → `update` is now clean 5/5, and `delete everything` → `delete` appears at 1/5 instead. Both are caught by the deterministic vetoes in §5.1 *before* the model runs — the stated-amount veto and the bulk veto respectively — so neither utterance reaches the contract. And a leaked `delete` only opens a picker, from which the user taps one row; "delete everything" cannot delete everything. **Both corpus cases in §6(c) are therefore load-bearing regression tests, not decoration.**

Still outstanding before these numbers gate anything: the harder material the probe README asks for — typos, multi-clause requests, ambiguous references, non-English, and injection inside the message. The 20-case set is saturated for BYOK and now nearly saturated for FM, so it can no longer discriminate.

### 11.2 Corpus
≥30 new lines (§6), landed **first** and watched to fail. `npm run eval:intent` must show `tx_op` at `n/n`.

### 11.3 BDD suites (plain Node)
New: `transaction-op-intent.feature` (candidacy, the three vetoes, the collision set), `transaction-op-contract.feature` (schema shape, normalize rejection), `transaction-candidates.feature` (filter, cascade, ranking, sizing), `transaction-op-routing.feature` (the "no new write path" greps, modelled on `account-delete-routing.steps.ts`).

Must stay green untouched: `account-intent`, `account-intent-ops`, `account-delete-routing`, `pending-transactions`, `recurring`, `self-transfer-guard`, `transfer-accounts`.

### 11.4 Ship gate
`npm run typecheck && npm run lint && npm test && npm run eval`. The Tier-1 eval is the guard that no expense utterance was stolen by a gate placed ahead of the ladder.

### 11.5 Device confirm
`delete my last transaction` (1 candidate → confirm card), `delete yesterday's transaction` (date pre-filter), `remove the Starbucks one` (payee pre-filter), `delete my savings account` (**still** the account handoff), `paid mum 50` (**still** an expense), `delete everything` (refused), a transfer (counterparty named), a recurring occurrence (series survives), and a row already deleted elsewhere (stale guard).

## 12. Open questions

1. **Verb-only floor classification (§5.2).** Mapping the verb to the op when no engine is available means the "model emits the op" requirement is met by a deterministic stand-in offline. The alternative — refuse when no engine is available — is more literal but worse for the user. **Needs a product call.**
2. **Whether to widen `detectAccountIntent` at all (§5.1.1).** The ledger-noun veto is recommended over adding `"in"` to the preposition sets, but it has **not** been proven regression-free against all 191 lines. Measure, don't assume.
3. **Exact ledger-noun and recency vocabulary.** The corpus should drive it, not this document. Expect two adversarial rounds, as the account gate needed.
4. **Which sheet component for "Show all N"** — `BottomSheet` is richer and consistent with the form sheet, but its behaviour stacked over the chat screen's `KeyboardAvoidingView` is unverified.
5. **Post-delete undo.** No soft-delete exists anywhere; iCloud backup is the stated undo story. Out of scope — but the single most likely user request after shipping.
6. **`hasStatedAmount` is module-private.** Exporting it touches a corpus-governed file, which itself triggers the corpus rule. Confirm a pure extraction with no behaviour change is acceptable without new lines.

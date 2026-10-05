# Ship run: xavier-speech-bubble

> Durable, committed record of one `/ship` run. Agent verdicts are pasted
> verbatim. Committed in stage 6 with the `Ship-Run: xavier-speech-bubble`
> commit trailer.

- **Feature:** everything Xavier says on the Assistant appears in one speech bubble under the avatar, and saved items carry their receipt and budget line inside it
- **Branch:** claude/xavier-speech-bubble (stacked on claude/monthly-budgets, PR #38)
- **Spec:** docs/design/xavier-speech-bubble-spec.md
- **Started / finished:** 2026-10-05 / —

## Spec
The user approved the design on 2026-10-05: Option B, "every line is a bubble" (artifact YFJyKiuvn7XA3Y6sigDqUS v2). The spec passed at the gate because it was already approved, so there was no fork to resolve.

## QA
Round 1 — **verdict:** PASS-WITH-CONCERNS

> No blockers or Critical issues. Three Major concerns and several Minor ones. Not run on a device.
>
> **Checks (npm scripts):** typecheck clean · lint clean · test 159/159 suites, 2843/2843 tests · eval:intent PASS 253/253 · eval:query PASS, 100% on every graded dimension · eval PASS at baseline 45.4% (127/280), no regressions, heuristic.dev.json unchanged.
>
> **Major**
> 1. **Grammar: "a" before a vowel.** `src/domain/bubbleCopy.ts:~190` (the `accountUpdatedText` retype branch) hard-codes `is now a ${label}`. Investment gives "is now a Investment", which is a plain error. Savings gives "a Savings" and Cash gives "a Cash", which read awkwardly. A user-invented subtype hits the same problem, and the label is capitalised mid-sentence. The spec's literal "a {label}" is the root cause. Only one subtype is tested.
> 2. **Race between `setReply('Saved.')` and the receipt await** (`app/(tabs)/index.tsx:2702-2703` `onConfirm`, `:2873-2874` `onEditSave`). The await covers `getTransaction`, `listCategories` and `loadSummary`. `showSavedReceipt` calls `setReceipt` unconditionally when it resolves, with no stamp or revision guard. `setLastOutcome` runs only after the await, so "typing pre-empts a self-settling reply" cannot fire during it. If the user types, a settle fires, or something else sets a reply in that window, the receipt overwrites it and can sit on top of a fresh draft for 5s. `busy` mitigates most of this but not typing. Fix: capture `replyStamp` before the await and drop the receipt if it moved, or call `setLastOutcome` before the await.
> 3. **"Anything else?" remains in deletion confirmations** (`app/(tabs)/index.tsx:2470-2471` "Deleted. Anything else?" and "Deleted. {x}'s balance also changed. Anything else?"; `:2554` "Deleted N. ... Anything else?"). §5 says to drop it from "the confirmations". The table doesn't list deletes, so this is arguable, but the result is two voices. The BDD "no Anything else" test only covers `bubbleCopy` outputs, so it couldn't catch this. Either change these or record the decision.
>
> **Minor**
> - `seriesText`: a `custom` rule produces "repeating custom."; "annual" and "semi-annually" are only partly mapped.
> - `index.tsx` grew by 44 lines (4949 to 4993). The spec says it should shrink.
> - Stale comments at `index.tsx:538, 766, 2300, 2692` and `src/domain/replySettle.ts:9` still quote "Saved! Anything else?".
> - Dead code: `savedChip`, `SavedChip` and `setBudgetDoneText` in `src/domain/budgetCopy.ts:162-193` have no callers in app or src.
> - Receipt accessibility label: `bubbleText` appends "." to each line, so VoiceOver reads the emoji and interpuncts.
> - Meter drops scheduled spend: the hatched scheduled segment merges into the solid fill (this matches the spec).
> - `headline.indexOf(amountText)` colours the first match.
> - Retype detection compares raw strings, so a case-only difference counts as a retype.
> - On-device items not verifiable here: largest Dynamic Type, decision cards staying reachable above the keyboard, the tail seam in both themes, and VoiceOver.
>
> **Suggested tests:** retype for every subtype plus free text; warn state; exactly SGD 0 left; a past-month save; cross-currency; budget 0; seriesText custom/interval/yearly; exact `bubbleText` strings; a long payee (device); the race; extend "no Anything else" to index.tsx.

Resolution of the Majors (decided by the main agent):
1. Retype becomes "{name} is now {a|an} {lowercased label} account." (e.g. "Wallet is now an investment account."), with a tested a/an helper.
2. Stamp guard: the receipt is dropped if the reply changed during the await.
3. Deletes are confirmations too, so "Anything else?" is dropped there as well, and the scan is extended to `index.tsx`.

Round 2 — **verdict:** PASS-WITH-CONCERNS (Minor only, QA gate passed)

> All three Majors from round 1 are fixed. No Critical, Major or blocking issues in round 2. Not run on a device.
>
> **Checks:** typecheck clean · lint clean · test 160/160 suites, 2864/2864 tests · eval:intent 253/253 · eval:query 100% · eval PASS at baseline 45.4% (127/280), no regressions.
>
> - **Major 1 (retype copy), fixed:** `bubbleCopy.ts:221-244` builds "{name} is now {a|an} {lowercased label} account." Detection compares `accountSubtypeLabel()`, so it is case-insensitive.
>   - Minor: no scenario retypes TO cash.
>   - Minor: the vowel-letter heuristic gives "an unit trust".
> - **Major 2 (race), fixed with one residual hole:**
>   - `replyStampRef` is bumped synchronously in both `setReply` and `setReceipt` (`index.tsx:547-556`). Every reset path goes through those setters.
>   - The stamp is captured after "Saved." bumps it, so a legitimate receipt is never dropped.
>   - `stillCurrent()` is checked after the last await and also gates the fallbacks.
>   - Residual (Minor), `index.tsx:2703/2878`: typing does not bump the stamp, and `setLastOutcome` runs after the await. So a receipt can still land over a draft typed during the await. The window is narrow and cosmetic, and `busy` is true throughout it.
> - **Major 3 (deletes), fixed:** `deletedText` and `deletedManyText` are used at `index.tsx:2476` and `:2553`, and no "Anything else?" remains in app or src.
>   - Minor: the possessive reads "Wallet, Visa's balances also changed."
>   - Minor: the source scan covers only three files.
> - **Other items:**
>   - `seriesText` fixed.
>   - `updatedReceiptFor` has no direct test (Minor).
>   - Dead code is removed. The two deleted chip scenarios are replaced by equivalent states on new fixtures, so the tie-in to the mockup's figures is gone (acceptable).
>   - The edge steps hard-code their scenario counts (minor fragility).
> - **Still open from round 1:** the on-device items (Dynamic Type, VoiceOver, tail seam in both themes), and `index.tsx` remains about 41 lines longer (declared).

## Review
**verdict:** APPROVE-WITH-NITS (no blockers)

> 1. **[should]** `SpeechBubble.tsx:47`, `:50-65`: `elevation.raised` is on the bubble only. On RN 0.81.5 the shadowPath follows the bubble's rounded rect, so in light mode the tail has no halo and may read slightly flatter. **Do NOT fix this with a shadow on the tail**, because that paints a seam over the body. Confirm on device in light mode; if it shows, the fix is an SVG tail+body path.
> 2. **[should]** `bubbleCopy.ts:168-197`: the output of `updatedReceipt`/`updatedReceiptFor` is never asserted. Add a headline+line scenario and a 🏷️ fallback row.
> 3. **[should, follow-up OK]** `index.tsx` is net +41 lines against §9. Extracting a `useXavierReply()` hook (bubble state, stamp, ref, setters, `whileCurrent`) would remove the duplicated guard blocks at `:2693-2697` and `:2867-2871`. Log as debt.
> 4. **[nit]** `index.tsx:2693/2867`: "Saved." shows for a frame or two before the receipt. This is inherent and acceptable; check on device.
> 5. **[nit]** `index.tsx:548-551`: the functional `setReply` passes the punctuated a11y text. Narrow it to `string`.
> 6. **[nit]** `SpeechBubble.tsx:120-122`: `BudgetLine` parses the verb out of `label`. Carry it as a separate field.
> 7. **[nit]** `index.tsx:2275`: format the balance in `existing.currency`, not `appCurrency`.
> 8. **[nit, pre-existing]** `useBudgetReplies.ts:318-333`: "… a month / Starting {Month}" also shows for a this-month-only edit. The old copy had the same wording.
> 9. **[nit]** Commit the ship-run record. Keep `.claude/pipeline/*` and `evals/results/heuristic.json` out.
>
> **Rulings on QA residuals:** typing during the receipt await is acceptable (local reads, `busy` true, same ordering as the old code). The "Wallet, Visa's balances" wording is acceptable, with optional polish. A retype-to-cash row is acceptable, add if touched.
>
> **Security:** not applicable; no SQL, trust boundary, network or PII.

Applied after review: 2, 5, 6, 7, the several-deletes wording polish, and the retype-to-cash row.
Deferred (follow-ups): 1, which needs device confirmation in light mode; 3, the `useXavierReply` extraction; 8, the this-month-only wording (pre-existing). 4 is a device check.

## Verify
Run by the main agent in the worktree on 2026-10-05:
```
npm run typecheck   → exit 0
npm run lint        → exit 0
npm test            → Test Suites: 160 passed, 160 total · Tests: 2868 passed, 2868 total
npm run eval:intent → PASS — 253/253 cases.
npm run eval:query  → PASS — every graded dimension is 100%.
npm run eval        → Overall 127/280 (45.4%) · Parse 101/195 (51.8%) · Refusal 26/85 (30.6%)
                      PASS — at or above baseline (split=dev, 45.4%), no case regressed.
```
Routing is unchanged, as the spec requires: the evals didn't move.

## Build
Direct install to Pigu as Xavier Beta (no TestFlight upload). The build number is recorded in the PR.

## Result
Waiting on device confirmation. Spec §7 on-device items to check: the bubble and tail in both themes (including the light-mode tail halo, review finding 1), largest Dynamic Type with a decision card, and VoiceOver.
Follow-ups:
- the `useXavierReply()` extraction (index.tsx +44 lines);
- this-month-only budget-set wording;
- the "an unit trust" article heuristic.

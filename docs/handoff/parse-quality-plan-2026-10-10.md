# Parse quality and BYOK improvement plan (2026-10-10)

Three work packages, handed to three cloud sessions. Each package is two
sequential feature branches/PRs (one PR per branch, per CLAUDE.md), highest
priority first. Packages are split so they do not touch the same files at the
same time: A owns the cloud engines, B owns the on-device pipeline, C owns the
save/learn path and the feedback loop.

Baseline (committed eval results, parse-case accuracy):
heuristic 52% dev; on-device FM 87% dev / 87% holdout2; Anthropic Haiku 4.5
92% all / 97% holdout2; OpenAI gpt-4o-mini 82% all / 78% holdout2.

Constraints for every session:
- Cloud sessions cannot run the Apple Foundation Models probe (Mac only) and
  may have no OpenAI/Anthropic keys. Run `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run eval` (heuristic JS gate). Run `npm run eval:cloud` /
  `eval:openai` only if keys are present in the environment. State in the PR
  body which measurements were NOT run and that the owner must re-baseline
  (FM: `evals/README.md` "The FM Swift probe"; cloud: "BYOK reference run").
- Never log a key, header or request/response body. Keep `src/domain/**`
  framework-free. Validate every model output with zod (guardrail #6).
- A holdout look (`--split=holdout2 --confirm-holdout`) is logged and limited;
  do not spend one from a cloud session. Dev split only.

## Package A (P0): BYOK cloud path

### A1 — PR 1: fix the BYOK pipeline
1. Currency scaling bug. `normalizeExpenseParse` in
   `src/features/ai/engines/shared.ts` calls `normalizeDeviceParseOutput(raw)`
   and `applyGroundingGuards(..., text)` with no currency, so a JPY "coffee 500"
   via BYOK stores 50000 minor units. Add `currency` to `CloudParseContext`,
   pass it to both calls, pass `appCurrency` from `runCloudParse` in
   `app/(tabs)/index.tsx`, and from `evals/engines/run_node.mjs`. BDD case:
   JPY, "coffee 500" -> amount 500.
2. Determinism. Add `temperature: 0` to the OpenAI and Anthropic request
   bodies in `src/features/ai/engines/openai.ts` / `anthropic.ts` (and the
   query loop in `src/features/ai/queryLoop.ts`). OpenAI reasoning models
   (o1/o3/o4 ids) reject `temperature`; omit it for those ids. `testKey.ts`
   reuses the same fetch functions, so it inherits the change. Load the
   `claude-api` skill before editing the Anthropic body.
3. Default OpenAI model. `DEFAULT_BYOK_MODEL.openai` in
   `src/features/settings/repository.ts` is `gpt-4o-mini`, the weakest engine
   measured (sign errors on income/transfers). Replace with the current small
   non-reasoning GPT model per OpenAI docs (check via Context7); update the
   eval default `OPENAI_MODEL` and `evals/README.md`. Keep the user-saved
   model untouched.
4. Surface BYOK failure. `runCloudParse` swallows every failure to `null`,
   and the parse then falls through to on-device labelled "On-device", so a
   dead key is invisible. Return a small reason enum from the engines
   (`auth` for 401/403, `not_found` 404, `rate_limited` 429, `network`,
   `bad_output`) without ever logging the body; in `app/(tabs)/index.tsx`,
   when the provider engine failed and a later engine served the draft, show
   a one-line notice on the draft card (extend the existing `aiFallbackFrom`
   mechanism in `src/components/assistant/DraftCard.tsx`) such as "Your
   OpenAI key didn't answer (invalid key); parsed on-device instead". Record
   the reason in parse metrics (`src/features/diagnostics/parseMetrics.ts`).

### A2 — PR 2 (after PR 1 merges): port the tuned contract to BYOK
The cloud engines still run the pre-step-2 prompt (`buildDeviceParseInstructions`
+ `deviceParseSchema`): no refusal rule, "propose a new concise name" for
category (category sprawl via find-or-create on save), model-read amount.
`evals/thresholds.json` records this gap ("today no engine prompt encodes the
refuse rule"). Haiku therefore logs "budget 400 for groceries next month" and
"remind me I owe Priya 30" as expenses.
1. Build a cloud expense contract on the step-2/3 pieces:
   `buildFmParseInstructions`, `buildFmParsePrompt`, `deviceParseFmSchema`
   (closed category choice, `isTransaction`), `planFmAmount` +
   `finishFmParse` (code reads the amount; model picks from a closed choice).
   Generate the JSON schema per text the same way `deviceSchemas.ts` does.
   Keep the cloud models' own `occurredOn` only as the fallback the current
   code already uses (`resolveTypedDate(text) ?? model date`), since cloud
   models read undated text as today correctly.
2. `runCloudParse` in `app/(tabs)/index.tsx` must handle a `refused` outcome
   exactly like `runFmParse` (reply + "Log anyway"), and run `cueRefusal`
   before the network call (code decides where it can; no wasted request).
3. Keep `testByokKey` on a request shape that still round-trips.
4. Make the eval's `openai` engine call the shipping `openaiParse` (today it
   still goes through the Vercel SDK, unlike `anthropic`), so both cloud
   engines measure the real transport.
5. Retire the `reportSeparatelyFromRefusal.until` clause in
   `evals/thresholds.json` once every engine encodes the refuse rule.
6. Run `npm run eval:cloud` if keys exist; otherwise say so in the PR and ask
   the owner to re-baseline per `evals/README.md` "BYOK reference run".

## Package B (P1): on-device pipeline

Measured on the dev split (`evals/results/raw/fm.dev.jsonl`), the FM failures
are the MODEL's, not the code's: on HEAD `cueRefusal` returns null and
`resolveTypedDate` resolves "on monday"/"last sunday" correctly for every
failing text. The model (a) answers `isTransaction: false` for real spends
that contain a future- or cue-like word ("movie 20 on monday", "taxi 18
tomorrow", "Budget Taxi 12", "Remind Me Cafe 20", "coffee 4 could i be any
more tired", "What A Burger 9"), and (b) gets `type` wrong where the words
are unambiguous ("paid back Sam 20" -> income, "owed tax paid 300" -> income,
"found 20 on the street" -> expense, "returned shoes +59" -> transfer,
"courts furniture 450" -> transfer, "+3200 payday" scored wrong on payee).
Step 3's rule applies: code decides where it can.

### B1 — PR 1: code decides type and affirms obvious transactions
1. Deterministic sign reader in `src/domain/` (framework-free): a leading
   `+` or words like received/refund/refunded/reimbursed/payday/salary/bonus/
   interest/cashback/found/gave me -> income; paid/bought/spent/gave/
   paid back/for/at + merchant -> expense; moved/transferred/topped up/
   withdrew/put into + two own accounts -> transfer. Only decide when
   evidence is unambiguous; otherwise keep the model's `type`. Apply in
   `finishFmParse` (so the eval harness runs the same code) and reuse it in
   `localParse` where it is stricter than today's regexes. Do not break
   `resolveTransferAccounts` or the transfer dev cases.
2. Transaction affirmation: when the text has a strict past-tense money verb
   (reuse `notTransactionCues.ts`'s past-tense source) or matches a terse
   "<one to four words> <amount>" shape, and no cue fired, treat the model's
   `isTransaction: false` as a cold-start miss: keep the parse. Put the rule
   in `src/domain/fmRefusal.ts` / `fmParse.ts`, BDD-tested against the texts
   above. Estimate the dev effect offline by replaying
   `evals/results/raw/fm.dev.jsonl` through the new pipeline if the harness
   supports it (`evals/rescore.mjs`); otherwise list the expected flips in
   the PR and ask the owner to re-run the FM probe on a Mac.
3. Add every text above as a dev case if missing (they are already dev
   cases; confirm with `evals/dataset.jsonl`).

### B2 — PR 2 (after PR 1 merges): cap the grounding lists
The eval never sends more than 8 payees / 13 categories, but
`buildFmParsePrompt` and `buildDeviceParsePrompt` in
`src/domain/deviceParsePrompt.ts` send EVERY payee, category and account the
user has. The grounding guard then drops any payee/account not literally in
the text anyway. Real users after months have far longer lists, which is the
likeliest reason the phone feels worse than the eval.
1. Payees: send only those whose name (or a whole-word variant, see
   `textMatch.ts`) appears in the text, plus at most 10 most-recently-used.
   Accounts: all (few). Categories: all when <= 30, else the 30 most used
   plus any whose name appears in the text. Select in a pure function with
   BDD tests; the screen passes recency/usage counts from the repository.
2. Keep `evals/engines/run_node.mjs` on the same function so the eval sees
   the capped lists. Add dev cases with 60+ payees and 40+ categories so the
   eval exercises the cap.
3. This changes the model's input: it needs an FM dev run and one holdout
   look by the owner on a Mac before merging. Say so in the PR.

## Package C (P2): make corrections stick, and close the loop

### C1 — PR 1: the learned category actually wins
`saveDraftSequence.ts` uses the payee's learned default category only when the
draft has NO category, but both engines always fill one, so the user's past
choice never applies.
1. When the draft's payee is an exact known payee with a `defaultCategoryId`
   and the model's category was NOT typed by the user (not literally in the
   text), prefer the learned category. Flag it on the draft card as a
   "did you mean" the user can dismiss. Pure logic in `src/domain/payees.ts`
   / `assistant.ts`, BDD-tested.
2. When the user edits the category on a draft before saving, update the
   payee's `defaultCategoryId` (today only a brand-new payee learns).
3. Record, per payee, the last confirmed category/account so the next draft
   for that payee starts from it; keep it local, no new PII.

### C2 — PR 2 (after PR 1 merges): a real-world eval loop
`recordEditByTxId` already stores which field the user edited per engine, but
nothing reads it back.
1. In the diagnostics/parse-metrics screen, show per engine: save rate, edit
   rate by field, refusal-then-"Log anyway" rate. Pure aggregation in
   `src/domain/parseMetrics.ts`.
2. Add a "this parse was wrong" action on the draft card and transaction edit
   sheet that appends `{text, corrected fields, engine}` to a local export
   file in the eval `dataset.jsonl` shape (`evals/dataset-schema.mjs`), with
   `split` omitted, shareable from Settings > Developer. Nothing leaves the
   device unless the user shares the file.
3. Document in `evals/README.md` how to fold the exported cases into the dev
   split and re-run the on-device probe.

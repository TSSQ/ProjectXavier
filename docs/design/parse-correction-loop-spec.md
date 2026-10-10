# Parse correction loop — real-world corrections feed the eval set

**Status:** implemented (parse-quality plan, package C2). Pure rules in
`src/domain/parseCorrection.ts` and `src/domain/parseMetrics.ts`
(`aggregateByEngine`); file I/O in `src/features/diagnostics/corrections.ts`;
fold tooling in `evals/corrections/fold.mjs`. BDD:
`tests/__features__/parse-correction.feature`, `parse-metrics.feature`.

## 1. Problem

Parse metrics (docs/design/parse-metrics-spec.md) recorded per-engine
outcomes and which fields the user edited after saving, but nothing read that
back per engine — there was no way to see which engine was earning its
corrections. And a correction the user made on the phone was lost to the
eval harness: `evals/dataset.jsonl` only ever grew from hand-written cases.

## 2. Per-engine diagnostics

`aggregateByEngine(rows)` reduces `parse_metrics` rows to one block per
engine (`on_device`, `heuristic`, `openai`, `anthropic`, `floor`, `layout` —
whatever appears, no fixed list): parse count, confirm-card count, save
rate (saved ÷ confirms), post-save edit rate (edited ÷ saved) overall and per
field (amount / type / payee / category / date), refusal count and
refusal-then-"Log anyway" count. Shown under **By engine** in
Settings › Developer › Parse metrics. Content-free, like everything in that
table.

## 3. "This parse was wrong"

Diagnostics builds only (`METRICS_ENABLED`, the same gate as the rest of the
Developer section).

- **Draft card:** a link under Discard / Edit / Save opens the editor with the
  report flag set. When the edited draft is saved, the saved fields are the
  correction. A discarded fix teaches nothing.
- **Edit sheet** (Transactions tab, account screen) for an AI-sourced row
  that still carries its `sourceText`: a "This parse was wrong" toggle;
  on save, the saved fields are the correction. The row's `createdAt`
  stands in for the clock the parse ran against.
- Both write one line to `<documents>/parse-corrections.jsonl` via
  `recordCorrection`, which builds the case with `buildCorrectionCase` and
  validates it (zod) BEFORE any I/O — a malformed case never reaches the
  file.

### 3.1 The case shape

Exactly an `evals/dataset.jsonl` case (`evals/dataset-schema.mjs`), minus
`split`:

```json
{"id":"dv-uc-20261010-3f9a1c","axis":"user-correction",
 "text":"coffee 4.80 at starbux",
 "context":{"categories":[{"name":"Dining","kind":"expense"}],
            "payees":["Starbucks"],"accounts":["Wallet"],
            "nowISO":"2026-10-10T12:00:00+08:00"},
 "expected":{"amountMinor":480,"sign":"expense","dateISO":"2026-10-09",
             "category":"Dining","payee":"Starbucks"},
 "engine":"on_device"}
```

- `id` starts with `dv-` (`DEV_ADDITION_ID_PREFIX`, pinned to
  `evals/split.mjs`'s constant by a test) so `split.mjs` forces it into the
  dev split — a case written to be tuned against must never be hashed into a
  holdout.
- `context` is what the engine saw: the user's categories (name + kind),
  payee names, active account names, and the parse's own clock as `nowISO`
  with the device's UTC offset.
- `expected` is the user's corrected fields; a transfer carries null
  category/payee (the dataset models transfers by `sign` alone).
- `engine` is an extra field the dataset schema passes through, so a folded
  case still says which engine was wrong.

The app-side schema mirrors the harness's (the harness never ships, so it is
not imported); `parse-correction.feature` runs a built case through the real
`evals/corrections/fold.mjs --validate` to prove they agree.

### 3.2 Privacy (CLAUDE.md guardrail #5)

A correction holds the user's own words and names — by design, it is the
eval case. It is written only to the app's documents directory and leaves the
device only through **Settings › Developer › Share corrections file**, after
copy that says exactly what the file holds (text typed, fields fixed, payee /
category / account names) and that it stays on the device until shared.
**Clear corrections file** deletes it. No parse-metrics row ever carries any
of this.

## 4. Folding on a Mac

`node evals/corrections/fold.mjs <file>` validates every line against the
real dataset schema, refuses non-`dv-` ids and lines carrying a `split`,
skips ids already in the dataset, appends the rest to `evals/dataset.jsonl`,
then `node evals/split.mjs && node evals/split.mjs --check` assigns and
locks `dev`. Re-run the on-device probe with `npm run eval:fm`. Full steps in
`evals/README.md`, "On-device corrections".

## 5. Non-goals

- No automatic upload, sync, or background collection of any kind.
- No change to the engines or prompts; the loop only measures and collects.
- Statement-scan rows (no `sourceText`) have no report affordance.

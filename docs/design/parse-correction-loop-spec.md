# Parse correction loop — real-world corrections feed the eval set

**Status:** implemented (parse-quality plan, package C2). Pure rules in
`src/domain/parseCorrection.ts` and `src/domain/parseMetrics.ts`
(`aggregateByEngine`); file I/O in `src/features/diagnostics/corrections.ts`;
fold tooling in `evals/corrections/fold.mjs`. Per-field before/after and
automatic capture (§6) in `src/domain/correctionEdits.ts`. BDD:
`tests/__features__/parse-correction.feature`, `parse-metrics.feature`,
`correction-edits.feature`.

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
copy that says exactly what the file holds (text typed, what the parser
proposed and what the user saved for every field, including discarded
drafts, payee / category / account names), that capture is automatic in
test builds, and that it stays on the device until shared.
**Clear corrections file** deletes it. No parse-metrics row ever carries any
of this.

## 4. Folding on a Mac

`node evals/corrections/fold.mjs <file>` validates every line against the
real dataset schema, refuses non-`dv-` ids and lines carrying a `split`,
skips ids already in the dataset, cuts each case's payee/account lists down
to the names its text mentions plus a generic filler set, and prints every
case for review — writing nothing. Only `--commit-ready`, passed after the
owner has read and redacted those cases, appends them to
`evals/dataset.jsonl` (the dataset is committed and holds no real personal
data). Then `node evals/split.mjs && node evals/split.mjs --check` assigns and
locks `dev`. Re-run the on-device probe with `npm run eval:fm`. Full steps in
`evals/README.md`, "On-device corrections".

## 5. Non-goals

- No automatic upload or sync of any kind; nothing leaves the device unless
  the user shares the file.
- No change to the engines or prompts; the loop only measures and collects.
- Statement-scan rows have no "This parse was wrong" affordance (they are
  still captured automatically, §6).

## 6. What the user changed — automatic capture, per-field edits

Diagnostics builds only (`METRICS_ENABLED`), still local-only, still
validated before any I/O.

**When a case is written** (`shouldCapture`, `captureCorrection`):
- a confirm draft is saved — from the card or after Edit — and at least one
  field differs from the engine's proposal;
- a confirm draft is discarded (a statement row skipped mid-queue included);
- a saved AI-sourced row is edited later on the Transactions tab or the
  account screen and at least one field changed;
- or, in any of those, the user turned on "This parse was wrong" — the
  manual button stays for "it looked right but wasn't", and forces the case
  even when nothing changed.

Merely abandoning a draft (sending new text while a card is up) is not a
discard and writes nothing.

**The `edits` block** (`correctionEditsSchema`), one extra top-level key:

| key | meaning |
|---|---|
| `amount` … `note` | `{ from, to }` for amount (minor units), type, category, payee, account (names), date (`YYYY-MM-DD`), note. null = nothing. |
| `stage` | `draft`: `from` is the engine's OWN proposal — learned payee defaults reverted (`engineProposalOf`), before any budget preset. `post_save`: `from` is the row as it was saved. |
| `engine` | metric engine label (`on_device`, `openai`, `anthropic`, `heuristic`, `layout`); for `post_save`, read from the row's linked parse_metrics row. |
| `parseSource` | the card's source, incl. `heuristic_fallback`; null for `post_save`. |
| `appliedDefaults` | fields history pre-filled: `category`, `account` (learned payee defaults). Phrase memory will add its own entry when it exists. |
| `refused` | the draft exists because the user tapped "Log anyway" on a refusal. |
| `discarded` | the user threw the draft away; every `to` is null and the case's `expected` is null (no ground truth). |

Names compare case- and spacing-insensitively, so "starbucks" → "Starbucks"
is not an edit. With `from` measured before learned defaults, a save that
only keeps a learned default IS an edit (`appliedDefaults` says why).

**Folding** (`fold.mjs`): `edits` is validated (`evals/dataset-schema.mjs`'s
optional `editsSchema`) and then DROPPED — the dataset never carries the
user's before/after values. Discarded drafts and statement-scan rows
(engine `layout`) are counted and never folded. The edits live only in the
shared corrections file.

**Developer screen** (`aggregateCorrectionEdits`): under **By engine**, per
engine — captured cases / discarded / after a refusal, then per field the
edit count and the top 5 from→to pairs: category, payee, account and type
by value; date by day offset (`±1 day`, `±2–7 days`, `> 7 days
earlier/later`); amount by `digits changed` / `scale changed` / `other`;
note by `added` / `removed` / `changed`. Read from the corrections file on
the device itself; the parse_metrics table stays content-free.

A row can be captured twice — once at the card, again on a later edit —
under two ids; each is its own correction (`stage` tells them apart).

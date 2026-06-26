# Parse diagnostics (`parse_metrics`) — design spec

**Status:** Phase 1 (instrument the current cloud parse). Test-build-only.
**Goal:** measure how often local parsing would be *insufficient*, to decide
whether the cloud LLM layer (L2) is worth keeping/building.

## Principle

Test-build-only, content-free, local SQLite. **No row stores user content** —
no utterance text, no amounts, no dates, no names. Only *signal about the parse
process*. Field **names** (`"amount"`) are schema metadata, not content, so
they're allowed.

The parsing stack is layered:

- **L0 — heuristic** (deterministic, on-device, free, unabusable) — not built yet
- **L1 — on-device LLM** (Apple Foundation Models, capable iPhones, free) — not built yet
- **L2 — cloud Claude** (the residual; the only layer with cost + abuse surface)

Today only L2 exists. Phase 1 instruments L2 to establish a **baseline**: how
often users discard/edit even Claude's output, and the confidence distribution.
That baseline is the quality bar L0/L1 must approach. When L0/L1 land, they're
instrumented identically (only the `engine` tag changes) and compared.

## Decisions (locked)

### `amount_delta_bucket`
Included, as a **percentage** delta between the pre-edit and post-edit amount —
never the actual amount, so it stays content-free.

| Bucket | Meaning |
| --- | --- |
| 0 | no material change (≤1%) |
| 1 | ≤10% |
| 2 | ≤25% |
| 3 | ≤50% |
| 4 | >50% |

### Material-edit thresholds
A "material" edit means the user corrected something the parse got wrong.

| Field | Material when |
| --- | --- |
| amount | relative change > 1% (ignores rounding noise) |
| type | any change |
| payee | normalized names differ *beyond a near-typo*: `editDistance` > `fuzzyThreshold` (reuses [payees.ts](../../src/domain/payees.ts)) |
| category | same rule as payee |
| date | different calendar day (`isSameDay` from [dates.ts](../../src/domain/dates.ts)) |
| note | never material (free text) — ignored |

### Debug screen depth
**Both** — live in-app aggregates *and* raw export (Share sheet / clipboard).

## Schema (`parse_metrics`)

Written in stages: a row at parse time, updated at confirm (save/discard), and
again at post-save edit.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | parse_id, generated at parse start |
| `created_at` | int | coarse (test-build only) |
| `engine` | text | `cloud` (Phase 1); `heuristic` / `on_device` later |
| `outcome` | text | `blocked` / `clarify_missing` / `clarify_lowconf` / `confirm` / `error` |
| `confidence_bucket` | int? | 0–4, **bucketed**, null when no parse confidence |
| `input_len_bucket` | text? | `xs/s/m/l` — never raw length or text |
| `missing_fields` | text? | field *names* only |
| `null_fields` | text? | field *names* only |
| `grounding_counts` | text? | counts only, e.g. `cat:12,pay:30,acc:3` |
| `device_ai_capable` | int? | 0/1; null in Phase 1 (populated when L1's availability check exists) |
| `latency_ms` | int? | parse round-trip |
| `resolved` | text? | `saved` / `discarded` |
| `tx_id` | text? | saved transaction id, for post-save edit linkage |
| `payee_swapped` | int? | 0/1 — user took the "did you mean…?" suggestion |
| `edited` | int? | 0/1 — a post-save edit was recorded |
| `edited_amount` … `edited_date` | int? ×5 | 0/1 per material field |
| `amount_delta_bucket` | int? | 0–4 (see above) |

## Capture points

1. **Parse resolution** — [app/(tabs)/index.tsx](<../../app/(tabs)/index.tsx>) `runParse`,
   after `interpret()` (or in `catch` → `outcome:'error'`). Writes the row;
   keeps `parse_id` in a ref for the confirm step.
2. **Confirm** — `onConfirm` (after `saveAssistantDraft` returns the tx id) sets
   `resolved:'saved'`, `tx_id`, `payee_swapped`; `onDiscard` sets
   `resolved:'discarded'`.
3. **Post-save edit** — [app/(tabs)/transactions.tsx](<../../app/(tabs)/transactions.tsx>)
   `onSave` (edit path). When an `source:'ai'` transaction is edited, compute the
   material-edit delta (pre-edit tx vs new form values) and update the metric row
   by `tx_id`. First edit only.

Only the AI path is instrumented; manual entry is not a parse.

## Gating

- One constant: `METRICS_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_METRICS === '1'`,
  env var set only in the EAS preview/development profile.
- All writes go through `src/features/diagnostics/parseMetrics.ts`, which
  early-returns when disabled → production is a no-op.
- The table is created unconditionally in [migrate.ts](../../src/db/migrate.ts)
  (empty + harmless in prod; keeps migration branch-free).
- **Backups:** no change needed — [backup.ts](../../src/lib/backup.ts) serializes
  an explicit `BackupData` that doesn't include `parse_metrics`.

## Reading the data (test builds only)

- **Debug screen** (`app/debug-metrics.tsx`), reachable from a hidden Settings row
  when the flag is on: total parses; outcome breakdown; % saved/discarded; clarify
  rate; % payee-swapped; % edited (overall + per field); median latency; confidence
  distribution; split by engine.
- **Export**: dump raw rows as JSON via the Share sheet.

## Decision rule (pre-committed)

> Build/keep L2 if the material-edit rate after **L1** > 15%, **or** on non-AI
> devices (**L0** only) > 25%. If L1's edit rate is within ~5 points of the
> Phase-1 cloud baseline, L2 adds little → ship local-only.

## Guardrail check (non-negotiable #5)

No column stores text, amounts, dates, names, or the utterance. `created_at` is
coarse; confidence and length are bucketed; field references are names not values.
Local-only, excluded from backups, empty in production.

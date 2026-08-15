# Transaction-op probes — can a model be trusted to delete a transaction?

Exploratory probes run **before** any app code, to decide the shape of
chat-driven transaction delete/update. Nothing here ships; there is no
committed app contract for this yet, which is the point.

Recorded **2026-08-05**. Rerun with `./build.sh` then the runners below.

## The question

Two candidate designs:

- **full** — the model identifies WHICH transaction (op + selector + payee/date/amount).
- **min** — the model only says *delete / update / none*; **the user picks the row**.

## Results

20 cases (12 positive, 8 negative incl. a `delete everything` safety case).
Positives must open the right flow; negatives must open none.

| Contract | FM (on-device) | gpt-4o-mini | claude-haiku-4-5 |
| --- | --- | --- | --- |
| **min** (op only) | **90%** (54/60) | **100%** (60/60) | **100%** (60/60) |
| **full** (op + selector) | **62%** (28/45) | **100%** (60/60) | **100%** (60/60) |

FM = 5 runs/case, BYOK = 3 runs/case. BYOK showed **zero variance** — identical
answers on every run. FM flapped constantly on the same input.

## What the probes decided

1. **The model must not identify the row on-device.** On the `full` contract FM
   returned `delete/latest` for *"delete yesterday's transaction"* — right intent,
   **wrong target**. Correct-op/wrong-selector is the dangerous failure: the app
   would confidently delete the wrong row. It also emitted `delete/unspecified`
   (delete, but no way to say what), which has no safe handling.

2. **Handing row-selection to the user makes the safety property structural.**
   On `min` the model *cannot* pick the wrong row because it never names one.
   Every FM miss degrades to `none` — "I didn't understand" — which is safe.
   That is worth more than the 28-point accuracy gain.

3. **Schema size costs accuracy AND stability.** The 7-field contract dropped FM
   from 90% to 62% and produced three `exceededContextWindowSize` failures
   (4,091 tokens against a 4,096 limit) — unbounded `String` fields let the model
   ramble until the window blew. The 1-field contract had **zero** such errors.

4. **No tier split is needed.** Both tiers clear the bar on `min`, so one flow
   ships everywhere. BYOK's advantage becomes a *shorter candidate list*
   (it can also nail the selector), not a different feature.

5. **One residual false positive:** `paid mum 50` → `update` on 1/5 FM runs — a
   new expense read as an edit. Fixed by ordering, not prompting: the existing
   deterministic expense gate classifies it before this contract runs.

## Honest limits

- **The set is saturated for BYOK.** 20 cases both cloud engines ace with no
  variance cannot discriminate further. Before these numbers gate anything,
  add harder material: typos, multi-clause requests, ambiguous references,
  non-English, and prompt injection inside the message.
- **This measured classification, not resolution.** The probes supply three fake
  payees. Resolving *"the coffee one"* against hundreds of real transactions is
  untested here — and is why the picker still matters at 100%.
- FM numbers come from this Mac's Foundation Models, not a device.

## Files

| File | What |
| --- | --- |
| `fm-min.swift` | op-only contract (the recommended shape) |
| `fm-full.swift` | op + selector contract (kept for the negative result) |
| `run-fm-min.mjs` / `run-fm-full.mjs` | runners + scoring, `node run-fm-min.mjs [runs]` |
| `byok.mjs` | cloud probe, `node byok.mjs [runs] [openai\|anthropic\|both] [min\|full\|both]` |
| `build.sh` | compiles both Swift probes (binaries are gitignored) |

`byok.mjs` reads keys from the repo-root `.env` (gitignored) and mirrors the
app's real engines — OpenAI `response_format: json_schema`, Anthropic
`tool_choice` forcing a single tool — rather than inventing its own call shape.

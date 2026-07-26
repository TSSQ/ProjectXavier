# Spec: parse eval harness (dev-side, never ships)

## Objective
A developer tool to score the assistant's parse engines against a labeled set of
expense utterances, so we can measure — before shipping BYOK — whether OpenAI /
Anthropic actually beat on-device Foundation Models for **our** contract, and
catch prompt regressions across every engine at once. It runs on the developer's
Mac; it is NOT part of the app, a build variant, or the IPA.

Non-negotiable design principle: **engines run the REAL production code**, not a
re-implementation. The heuristic is `src/domain/localParse.ts`; the LLM engines
use the same `generateObject` + `src/domain/deviceParsePrompt.ts` (prompt /
schema / normalize / grounding) + `aiParsedExpenseSchema` re-validation the app
uses. What we measure is what ships. No Python port of parse logic (that would
drift).

## Location & isolation
- Everything under a new top-level `evals/` directory (like `tests/` — in the
  repo, outside the app build; never bundled).
- **Must NOT change the app's RUNTIME dependencies or its build.** Build 42 (the
  App Store binary) must be unaffected. Anything the harness needs
  (`@ai-sdk/openai`, `@ai-sdk/anthropic`, a TS runner like `tsx`, FastAPI) goes
  in an **isolated** place — either root `devDependencies` (dev-only, never
  bundled) OR a self-contained `evals/package.json` + `evals/requirements.txt`.
  Prefer whichever keeps `package.json`'s `dependencies` (runtime) list byte-
  identical. Do not perturb the lockfile's runtime graph.
- `src/domain/**` stays framework-free and UNMODIFIED — the harness imports it,
  never edits it.

## Architecture (engines in Node for fidelity; orchestration/scoring in Python)
```
evals/
  dataset.jsonl            labeled cases
  engines/run_node.mjs     Node: runs {heuristic, openai, anthropic} over a batch
                           by importing the REAL src modules; emits parses as JSON.
                           (FM slot: shells to the Swift probe if present, else skips.)
  server.py  (FastAPI)     POST /run → invoke run_node → score vs expected →
                           aggregate → JSON report ; GET / → dashboard table
  scoring.py               pure field comparison (amount/sign/date/category/payee)
  requirements.txt / package.json, README.md
```
- **Node runner** (`engines/run_node.mjs`, run via `tsx`/loader): for each case +
  engine, produce the validated `aiParsedExpenseSchema` object (or null). Reuse
  `localParse` for `heuristic`; for `openai`/`anthropic` call `generateObject`
  with `@ai-sdk/openai` / `@ai-sdk/anthropic` and the SAME
  `buildDeviceParseInstructions` / `buildDeviceParsePrompt` / `deviceParseSchema`
  as `src/features/ai/deviceParse.ts`, then normalize + re-validate identically.
  Context (categories/payees/accounts/now) comes from the dataset/case so
  grounding is realistic and reproducible.
- **Python/FastAPI** is a thin orchestrator: it calls the Node runner
  (subprocess), then scores the returned parses against `expected`. Scoring is
  pure field comparison — no parse logic — so no drift risk living in Python.
  Serves a `/` dashboard: an engine × field accuracy table + a drill-down of
  each failing case (expected vs got). (If the Python↔Node boundary proves
  fiddly, a pure-Node harness emitting a static HTML report is an acceptable
  fallback — the ONLY hard requirement is engines-run-real-production-code.)
- **Foundation Models** runs natively only. Wire the Mac-side Swift probe
  ([[fm-probe-harness]]) if it exists in the repo/scratchpad; otherwise leave a
  clearly-documented `fm` slot that reports "skipped (no probe)" and note adding
  it as the next step. macOS 26 has the same on-device model as iOS 26, so the
  probe is a faithful proxy — do not block v1 of the harness on it.

## Dataset (`evals/dataset.jsonl`)
One JSON object per line:
```
{ "text": "lunch 12.50 at Subway",
  "context": { "categories": ["Dining","Groceries",...], "payees": ["Subway",...],
               "accounts": ["Checking","Cash"], "nowISO": "2026-07-16T12:00:00+08:00" },
  "expected": { "amountMinor": 1250, "sign": "expense", "dateISO": "2026-07-16",
                "category": "Dining", "payee": "Subway" } }
```
Ship a **starter set of ~30 cases** covering the axes that actually break parsers
(these double as the M5 edge-case coverage):
- plain (`coffee 4.80`), payee-bearing (`groceries 64.20 at FairPrice`),
  relative dates (`lunch 12 yesterday`, `rent 1500 on the 1st`), income
  (`salary 3200`, `+3200 payday`), **refunds/negatives** (`refund 20 from Amazon`
  → income, not a $20 expense), **large amounts** (`spent 99999999`),
  **EU decimals** (`€1.234,56 groceries`), multi-word categories, currency-word
  vs symbol, ambiguous (`paid 50`), and a couple that SHOULD fail-to-parse
  (gibberish) so we measure false-positives too.
- Keep amounts wholesome; label `expected` carefully by hand (this is the ground
  truth — accuracy is meaningless if labels are wrong).

## Scoring (`scoring.py`, unit-tested)
Per case × engine, compare the produced parse to `expected`:
- `amountMinor` — exact integer match
- `sign` — exact (`income`/`expense`)
- `dateISO` — exact (after the engine's own relative-date resolution)
- `category` — normalized match (case/whitespace-insensitive; the app's own
  normalize rules where practical)
- `payee` — normalized match
- plus an `overall` = all-five-correct (the strict "usable parse" bar)
Aggregate: per-engine accuracy per field + overall, and a per-case pass/fail with
the diff for failures. For fail-to-parse cases, correct = engine returned null.

## Acceptance criteria
1. **Runs end-to-end offline on the heuristic** engine: `POST /run` (or the CLI)
   over the starter dataset produces a scored report with per-engine/per-field
   numbers and a failing-case drill-down — demonstrated with NO API keys set
   (heuristic needs none; cloud engines gracefully report "skipped: no key").
2. **Cloud engines wired** (`openai`, `anthropic`) via the real `generateObject`
   path + shared prompt; they run when `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
   (+ optional model env) are set, and skip cleanly otherwise. Model defaults
   documented (e.g. `gpt-4o-mini`, `claude-3-5-haiku`). Do NOT commit any key.
3. **Fidelity**: the heuristic path imports the actual `src/domain/localParse.ts`;
   the LLM path uses the actual `deviceParsePrompt.ts` builders +
   `aiParsedExpenseSchema` — grep-verify no re-implemented parse/prompt logic.
4. **Isolation**: `package.json`'s runtime `dependencies` are unchanged (verify a
   diff); the app still `npm run typecheck && npm run lint && npm test` green
   (541); `src/domain/**` unmodified.
5. **`evals/README.md`**: how to install + run, env vars, how to add cases, how
   to wire the FM Swift probe next, and a one-liner that it never ships.
6. Scoring has its own unit tests (pure comparison — trivial to test).

## Out of scope (later)
- The FM Swift probe itself if not already present (documented slot).
- The BYOK in-app feature (Phase 2 step 2 — separate ship).
- CI integration / regression gating on eval scores.
- RAG / Ask-Xavier.

## Constraints
- Worktree `.claude/worktrees/fm-spike`; SSH remote; commit only `evals/**` +
  this spec (+ root devDeps IF that route is chosen). NEVER a TestFlight build —
  this is tooling.
- No secrets in the repo. `.gitignore` any local `.env` under `evals/`.

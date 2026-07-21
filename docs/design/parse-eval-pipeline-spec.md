# Spec: incorporate the parse-eval harness into the delivery pipeline

## Context — this EXTENDS existing work, it does not rebuild
`evals/` already exists on this branch (base `claude/phase2-byok`) and is good:
`evals/engines/run_node.mjs` runs the **real** production parse code — the
`heuristic` engine calls `src/domain/localParse.ts`; the `openai`/`anthropic`
engines reuse the exact `buildDeviceParseInstructions`/`buildDeviceParsePrompt`/
`deviceParseSchema`/`normalizeDeviceParseOutput`/`applyGroundingGuards`/
re-validate pipeline. `evals/dataset.jsonl` has 30+ hand-labelled cases (incl.
prompt-injection, terse, fail-to-parse axes). `evals/scoring.py` +
`evals/server.py` score and dashboard it. Full background:
`docs/design/eval-harness-spec.md` and `evals/README.md`. **Do not modify
`src/domain/**` parse logic; the harness only imports it.**

## Objective
Turn this dev-only harness into a **pipeline gate**, and close its two gaps:
1. Wire the **Foundation Models** engine (currently a `skipped (no probe)` slot).
2. Make the **Claude** engine call the app's **real raw-fetch integration**
   (not `@ai-sdk` `generateObject`), on the current model.
Then gate `/ship` and `/build` on the results.

## Branch / constraints
- Branch `claude/parse-eval` (off `claude/phase2-byok`). NEVER `main` — note
  this branch carries BYOK, so it is NOT for merging into the pure-local store
  line as-is; the Tier-1 gate can be cherry-picked to `main` separately later.
- The harness still **never ships** (dev-only; not referenced by Expo/EAS, not
  in the IPA). Its only app-build footprint stays the existing `devDependencies`.
- Never commit API keys. Never log the key or request/response bodies
  (the real engines already honor this).
- `src/domain/**` and the app's parse/prompt code are **read-only** here.

## Work items

### 1. Claude engine → real raw-fetch integration  (user decision)
In `evals/engines/run_node.mjs`, replace the `anthropic` engine's
`generateObject` call with the app's **actual** path: import and call
`anthropicParse(text, ctx, apiKey, modelId)` from
`src/features/ai/engines/anthropic.ts` (which does `fetchAnthropicRaw` →
forced `record_expense` tool → `extractAnthropicToolInput` → `runCloudParse`'s
normalize/guard/validate). This exercises the real transport
(`cloudParseTransport.ts`, `cloudParseSchema.ts`, `engines/shared.ts`), so
integration bugs — not just model quality — are caught.
- Key from `ANTHROPIC_API_KEY` (unset → `skipped: no key`, unchanged).
- `ANTHROPIC_MODEL` default bumped `claude-3-5-haiku-latest` → **`claude-haiku-4-5`**
  (current Haiku; also update `DEFAULT_ANTHROPIC_MODEL` + the README env table).
  **Load the `claude-api` skill** before touching the model id / any API detail.
- Confirm `engines/shared.ts` + `anthropic.ts` import cleanly under `tsx` in
  Node (they must be RN-free: `fetch`/`AbortController` are Node built-ins). If
  a stray RN import blocks it, the eval wraps the transport call, not a re-impl.
- OpenAI engine: leave as-is ("just Claude for now") — do not delete, just don't
  change it. FM below.

### 2. Foundation Models engine — build + wire the Swift probe (Tier 2)
Per `evals/README.md` "Wiring the FM Swift probe":
- Commit `evals/fm/probe.swift`: a `@Generable` struct mirroring
  `deviceParseSchema` field-for-field with the **verbatim** `@Guide`
  strings from `src/domain/deviceParsePrompt.ts` `.describe()`s, fed the exact
  `buildDeviceParseInstructions()`/`buildDeviceParsePrompt()` output. Accepts
  `probe "<text>" '<json context>'`, prints a `deviceParseSchema`-shaped JSON
  object. (Recreate from the session `fm-probe` harness if present; else author
  from `deviceParsePrompt.ts`.)
- `evals/fm/build.sh` → `swiftc -O -parse-as-library -o evals/fm/probe evals/fm/probe.swift`
  (the compiled binary is gitignored; add to `evals/.gitignore`).
- The `fm` engine already shells to `FM_PROBE_PATH` — no runner change needed
  beyond documenting `FM_PROBE_PATH=evals/fm/probe`.
- **Contract-sync guard** `evals/fm/check-sync.mjs`: assert the canonical
  instruction + each `@Guide`/`.describe()` string present in `probe.swift`
  matches `deviceParsePrompt.ts` (fail on drift). Runs in the JS gate (cheap,
  no FM) so the two prompt copies can't silently diverge.
- FM is nondeterministic + Mac-only → the FM gate runs each `model`-axis case
  **N=5** times and scores pass-rate; SKIP cleanly (exit 0, loud note) when
  `SystemLanguageModel` is unavailable so a non-AI machine never hard-blocks.

### 3. JS scorer + `npm run eval` (Tier 1 gate, no Python, no keys)
So `/ship`-verify and CI don't need a Python venv:
- `evals/score.mjs`: port `scoring.py`'s field comparison exactly
  (`amountMinor`/`sign` exact; `dateISO` exact UTC-day; `category`/`payee`
  normalized via the same trim/collapse/lowercase as `normalizeName`;
  `overall` = all five; `null`-vs-`null` fail-to-parse handling). Add
  `evals/test-score.mjs` mirroring `test_scoring.py`'s cases so the JS scorer is
  proven equal to the Python one.
- `npm run eval` (root `package.json` script): run `run_node.mjs heuristic
  evals/dataset.jsonl`, score with `evals/score.mjs`, print a compact
  per-axis/per-field accuracy table, and **exit non-zero** if heuristic
  `overallAccuracy` drops below the committed baseline in
  `evals/baseline.json` (seed it with the current heuristic accuracy) or any
  previously-passing case regresses. Also run `check-sync.mjs`.
- `npm run eval:cloud` (on-demand): same, engine `anthropic`, key-gated; applies
  the lenient thresholds below; NOT part of `npm run eval` (cost).

### 4. Thresholds
`evals/thresholds.json`: `{ "model": { "overall": 0.80, "perCase": 0.60 } }`
(lenient, per user). Applies to the FM and cloud tiers. Tier-1 heuristic uses the
`baseline.json` no-regression check, not a fixed %.

### 5. Pipeline wiring
- `/ship` **verify**: checks become `typecheck && lint && test && eval`
  (heuristic + sync guard, JS-only). Update `.claude/commands/ship.md`.
- `/build` **preflight**: run the FM eval (`FM_PROBE_PATH` set) and print the
  score table. **REPORT-ONLY** — a threshold FAIL does NOT block the archive
  (accepted product decision: the asserted-field baseline needs to be trusted
  over several builds before it gates a store binary; a nondeterministic 3B
  model straddling the lenient 0.80 bar must not block a release on noise). SKIP
  cleanly when FM is unavailable. Flip to blocking once the baseline is trusted.
  Update `.claude/commands/build.md` + the release-manager agent.
- `/probe --suite` note: point it at the committed `evals/fm/probe.swift` so the
  ad-hoc probe and the eval share one harness. Update `.claude/commands/probe.md`.
- Dashboard: add an `eval` chip (heuristic overall %) to `.claude/pipeline`
  checks so a run surfaces the score.
- Cloud (`eval:cloud`) stays on-demand/manual — documented in README, not gated.

## Acceptance criteria
1. `anthropic` engine calls the real `anthropicParse` (raw fetch) — verified by
   reading the diff; with a key set it returns real parses, without a key it
   `skipped: no key`; model default is `claude-haiku-4-5`.
2. `evals/fm/probe.swift` exists, mirrors `deviceParseSchema`/instructions
   verbatim; `check-sync.mjs` passes now and would fail on a deliberate drift;
   with `FM_PROBE_PATH` set on an FM-capable Mac the `fm` engine returns parses;
   on a non-FM machine the FM gate SKIPs (exit 0) with a clear note.
3. `evals/score.mjs` matches `scoring.py` on `test_scoring.py`'s cases
   (`test-score.mjs` green). `npm run eval` prints the table, passes on the
   current dataset, and exits non-zero if the heuristic baseline regresses or the
   sync guard fails (prove both with a temporary deliberate break, then revert).
4. `/ship` verify, `/build` preflight, `/probe`, and the dashboard are updated
   per §5 (docs + command files).
5. `npm run typecheck && npm run lint && npm test && npm run eval` all green. No
   `src/domain/**` parse behaviour changed. No keys committed; `.env` gitignored.
6. The harness still never ships (no new runtime `dependencies`, no Expo/EAS
   reference); only `devDependencies`/`evals/**`/docs/commands change.

## Out of scope
- OpenAI engine changes (kept as-is).
- Query-intent eval (`query.swift`).
- Merging any of this into `main`/the store line (branch carries BYOK).
- The Python dashboard rewrite — it stays the dev-time deep-dive; only the gate
  is re-homed to JS.

## Edge cases
- **RN import leak:** if `anthropic.ts`/`shared.ts` transitively import an
  RN-only module, wrap the raw `fetchAnthropicRaw` + the real `runCloudParse`
  normalize rather than re-implementing — never fork the parse logic.
- **FM unavailable / key absent:** SKIP, never fail (build not blocked spuriously).
- **Model nondeterminism:** pass-rate over N, thresholds in a committed file.
- **Prompt drift:** `check-sync.mjs` is the backstop for the Swift/TS copies.
- **Scale/date reproducibility:** runner already pins `TZ=UTC` + fixed `nowISO`.

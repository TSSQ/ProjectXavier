# Ship run: parse-eval-pipeline

> First run under the committed-run-record convention. Agent verdicts below are
> pasted **verbatim**. Committed in stage 6 with the `Ship-Run: parse-eval-pipeline`
> trailer.

- **Feature:** Provider-agnostic parse-eval harness wired into the delivery pipeline — heuristic + Claude (real raw-fetch, Haiku 4.5) + Apple FM (Swift probe) scored against a 39-case labelled dataset, with asserted-field scoring, a Tier-1 `npm run eval` gate in /ship-verify, a report-only FM preflight in /build, a drift guard, and committed per-run provenance artifacts.
- **Branch:** claude/parse-eval (based on origin/claude/phase2-byok — carries BYOK; NOT for merge into the pure-local main)
- **Spec:** docs/design/parse-eval-pipeline-spec.md

## Spec
Incorporate the existing `evals/` harness into delivery as a gate and close its two gaps: (1) point the Claude engine at the app's real raw-fetch integration (anthropicParse, claude-haiku-4-5) instead of @ai-sdk generateObject; (2) build + wire the Foundation Models Swift probe. Plus: JS scorer (no Python venv for the gate), asserted-field scoring (category/payee scored only where the label asserts them, so a smarter model isn't penalised against heuristic-traced labels), lenient thresholds, a contract-sync guard, and committed provenance artifacts. User decisions: both tiers; Claude via real raw-fetch; asserted-field scoring; FM /build preflight report-only.

## QA
**Verdict: PASS-WITH-CONCERNS** (qa-tester, verbatim excerpts)

> The core engineering is solid and I could not break the gate logic, the scorer parity, or the "real code, not reimplementation" rule under adversarial testing. But there is one genuine **spec-vs-implementation gap** (FM gate is report-only, not blocking, contradicting the spec's own acceptance criterion) plus several minor hygiene gaps.

Test/build results (verbatim): `typecheck` → ONE error `app/(tabs)/settings.tsx(313,36)` (pre-existing, unrelated — stale gitignored `.expo` router types for the valid `/settings/byok` route); `lint` → ESLint no issues; `test` → 50 suites / 618 passed; `test-score.mjs` 22/22; `test_scoring.py` 22/22; `check-sync.mjs` PASS; `npm run eval` → 21/32 (65.6%) PASS at baseline, exit 0. Adversarial gate-refactor testing (sandboxed copies): confirmed exit 0 on pass / non-zero on fail for heuristic-baseline, model-threshold single-run, and model `--n` pass-rate paths; artifact written on pass AND fail; skip paths exit 0 with a `status:"skipped"` artifact and don't pay for N−1 runs; `check-sync` fails on a 1-char `@Guide` drift and ignores comment-only edits. No `src/domain`/`src/features/ai` changes; `.env` gitignored + absent from status; no key/token in any `evals/results/*.json`; `evals/**` never ships (devDeps only, compiled probe binary gitignored).

Findings:
- **Major — spec/acceptance mismatch:** spec §5 required `/build` to "block the archive on a threshold fail"; delivered `build.md` makes the FM gate report-only. "A reasonable, transparently-documented engineering call, but it does not satisfy the spec's stated acceptance criterion as written."
- Minor — `npm run lint` (`--ext .ts,.tsx`) never lints the gate-critical `evals/*.mjs`.
- Minor — `@ai-sdk/anthropic` devDependency is now unused (raw-fetch switch).
- Minor — `probe.md` referenced the invalid `npm run eval --engine=fm`.
- Minor — a `check-sync` failure exits before `emitResult`, so that failure mode writes no `evals/results/*.json`.
- Informational — a bad/expired `ANTHROPIC_API_KEY` is indistinguishable from a bad model (both → ~0%), by design.

**Resolution (coordinator):**
- Major RESOLVED by aligning the spec: the report-only FM preflight was an explicit product decision (nondeterministic 3B model straddling the lenient 0.80 bar must not block a store binary); `docs/design/parse-eval-pipeline-spec.md` §5 now documents report-only as the accepted decision. No code change — spec now matches implementation.
- Fixed: `probe.md` invalid command → `npm run eval:fm`; added an expired-key debugging note to `evals/README.md`.
- Deferred (noted follow-ups): eslint `.mjs` coverage needs a node-env override (the gate `.mjs` have dynamic coverage via the fixture-tested exit paths + `test-score.mjs`); remove the dead `@ai-sdk/anthropic` dep (avoided lock churn in this commit); a `run-eval.mjs` exit-code unit test + a `check-sync.mjs` unit test; the `check-sync`-fail-without-artifact gap (accepted — a distinct pre-flight guard, fails loud on exit 1).

## Review
**VERDICT: APPROVE-WITH-NITS** (reviewer, verbatim excerpts)

> The harness is well-built and fits the codebase cleanly. The "real code, never a re-implementation" rule holds end-to-end … The gate/emit refactor is readable, single-write on every path, and no path double-writes. Scorer parity and the asserted-fields change are mirrored field-for-field … Security is clean. Everything I flag below is non-blocking; none of it should hold the merge.

Blocking: **None.**

Non-blocking (verbatim, condensed):
1. "The two model-tier gates measure different denominators against the same 0.80 bar" — single-run `overallAccuracy` is over the 32 non-fail cases; the `--n` gate's reliable-fraction is over all 39. Harmless while FM is report-only + cloud on-demand; reconcile before flipping FM to blocking.
2. "The committed artifact schema is not stable across invocation modes" — single-run writes `overall`+`fields`; `--n` writes `passRate` and no `fields`, under one filename. Add a discriminator.
3. "`check-sync.mjs` does not cover the user-turn prompt" — it verifies the `@Guide`/`.describe()` + instructions but not `buildDeviceParsePrompt`'s hint-sentence assembly, which `probe.swift` hand-mirrors. A wording tweak could silently diverge with the guard green.
4. "`emitResult` runs before `process.exit` and can mask the exit code" — if `writeFileSync` throws, a passing gate would surface as a spurious exit 1.

Agreements (verbatim): "check-sync-fail writes no artifact — acceptable"; "Report-only FM preflight is the right gate design … the committed fm.json shows 0.75 single-sample against a 0.80 bar — exactly the noise-straddling case that must not block a store binary"; "Security confirmed. emitResult writes only scores/model-id/SHA/timestamp; … never the key; .env is gitignored; no key token appears in any evals/results/*.json."

Metric note (verbatim, condensed): asserted-fields is "the correct call for the current heuristic-traced labels," but category is scored on only 14/32 and payee on 6/32 non-fail cases — "a model emitting plausible-but-wrong categories on the other 18 cases stays green." A measurement gap, not a correctness one (reconcile drops unknown categories downstream). Long-term: relabel to ideal ground truth.

**Resolution (coordinator — applied substantive nits, noted deferrals):**
- APPLIED #2: added a `mode` field (`single-sample` | `pass-rate` | `skipped`) to every emitted artifact so consumers branch on `mode`, not on which keys exist (`evals/run-eval.mjs`).
- APPLIED #4: wrapped `emitResult` in try/catch so a provenance-write failure logs and never changes the gate's exit code.
- APPLIED #1 (interim): a load-bearing doc-comment on `gateAgainstThresholdsNRuns` flags the denominator mismatch; `build.md`'s flip criterion now requires reconciling it before FM blocks.
- APPLIED #3 (interim): a ⚠️ mirror-warning comment on `probe.swift`'s `buildPrompt` (can't touch `src/domain/deviceParsePrompt.ts` — production code the harness must not modify).
- APPLIED (agreement): concrete `/build` flip criterion — FM `--n=5` reliable-rate ≥ 0.85 across 3 consecutive builds AND the denominator reconciled.
- DEFERRED (noted follow-ups): full denominator reconciliation + extending check-sync to the prompt assembly (both interim-mitigated, to land before FM ever blocks); relabel-to-ideal ground truth so category/payee are scored everywhere; remove the dead `@ai-sdk/anthropic` dep (lockfile churn); de-dup the default model ids (`run_node.mjs` isn't import-safe — needs a guard); a `run-eval.mjs`/`check-sync.mjs` unit test.

## Verify
Run by the coordinator (not claimed):
```
npm run typecheck → 1 error, PRE-EXISTING + UNRELATED:
  app/(tabs)/settings.tsx(313,36): TS2345 "/settings/byok" not assignable
  Cause: a stale, gitignored .expo/types/router.d.ts that predates the route's
  own screen (app/settings/byok.tsx exists and is a valid route). Not committed,
  not a code bug, not from the eval feature (which adds only .mjs/.py/.json/.md,
  zero TS). Regenerates correctly on a full `expo start`/`expo export`.
npm run lint      → ESLint: No issues found
npm test          → Test Suites: 50 passed / Tests: 618 passed
npm run eval      → check-sync PASS; Overall 21/32 (65.6%); PASS at baseline, exit 0
node evals/test-score.mjs     → 22/22 passed
node evals/fm/check-sync.mjs  → PASS (10 field descriptions + instructions match)
```
Gate: the eval feature is TS-clean; lint/test/eval/scorer-parity/sync all green.
The single typecheck error is a pre-existing, uncommitted `.expo` cache artifact.

Eval provenance artifacts (committed): evals/results/heuristic.json (65.6%),
evals/results/anthropic.json (Claude Haiku 4.5 = 100%), evals/results/fm.json
(Apple FM = 75.0%, report-only).

## Build
- Delivery UUID: n/a — dev-tooling change, `evals/**` never ships (not referenced by app.config.ts / eas.json / expo prebuild; only devDependencies).

## Result
Committed on `claude/parse-eval` with a `Ship-Run: parse-eval-pipeline` trailer +
`Co-Authored-By: Claude`. Dev tooling — `evals/**` never ships (no build cut).
Not for merge into the pure-local `main` (this branch carries BYOK). QA
PASS-WITH-CONCERNS (Major resolved) → Review APPROVE-WITH-NITS (nits applied /
noted) → Verify green (bar the pre-existing stale-.expo typecheck artifact).
NOTE: the `.claude/` command-doc wiring (verify-gate line, FM preflight,
run-record convention) is applied in the working tree but left UNTRACKED per the
owner's call, so it is not captured in this commit.

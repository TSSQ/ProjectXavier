# Parse eval harness

Dev tooling only — **this never ships**. It is not part of the app, a build
variant, or the IPA; nothing here is bundled, referenced by Expo, or touched
by `expo prebuild`. See `docs/design/eval-harness-spec.md` for the full spec
this implements.

## Why

Scores the assistant's parse engines (on-device heuristic, and — once wired
with a key — OpenAI/Anthropic BYOK candidates) against a hand-labeled set of
expense utterances, so we can measure whether a cloud model actually beats
the on-device heuristic for **our** parse contract before shipping BYOK, and
catch prompt regressions across every engine at once.

**The #1 rule: engines run the real production code, not a re-implementation.**
`evals/engines/run_node.mjs` imports `src/domain/localParse.ts` directly for
the heuristic engine, and reuses the exact `buildDeviceParseInstructions` /
`buildDeviceParsePrompt` / `deviceParseSchema` / `normalizeDeviceParseOutput`
/ `applyGroundingGuards` from `src/domain/deviceParsePrompt.ts` — the same
functions `src/features/ai/deviceParse.ts` uses for Apple Foundation Models —
for the OpenAI/Anthropic engines, only swapping the `model:` passed to
`generateObject`. Every engine re-validates its output against the real
`aiParsedExpenseSchema` (`src/lib/validation.ts`) before returning it, same
as the app. `src/domain/**` is never modified by this harness, only imported.

## Install

Node side (engines): `tsx`, `@ai-sdk/openai`, `@ai-sdk/anthropic` live in the
**root** `package.json`'s `devDependencies` — dev-only, never bundled into
the app build, so build 42 (the App Store binary) is unaffected. No separate
`evals/package.json` is needed; `npm install` at the repo root is enough.

Python side (orchestration/scoring/dashboard) is a **self-contained venv**
under `evals/.venv` (gitignored — recreate it, don't commit it):

```bash
cd evals
uv venv .venv --python 3.12         # or: python3 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
# (no uv? `.venv/bin/pip install -r requirements.txt` works too)
```

## Run

**Offline, no API keys** — runs the heuristic engine only (openai/anthropic
report "skipped: no key", fm reports "skipped (no probe)"):

```bash
cd evals
.venv/bin/python server.py                 # all engines, prints JSON report to stdout
.venv/bin/python server.py heuristic       # just one engine
```

**Dashboard + `/run` API** (same report, either as an HTML table or JSON):

```bash
cd evals
.venv/bin/uvicorn server:app --reload
open http://127.0.0.1:8000/                       # engine × field accuracy table + failing-case drill-down
curl -X POST http://127.0.0.1:8000/run             # full JSON report
curl -X POST "http://127.0.0.1:8000/run?engines=heuristic,openai"   # subset
```

**Just the Node runner** (one engine, prints its raw per-case results):

```bash
npx tsx evals/engines/run_node.mjs heuristic evals/dataset.jsonl
```

### Env vars (cloud engines)

Put these in `evals/.env` (gitignored — never commit keys) and `source` it,
or export them directly:

| Var | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | unset → openai engine reports `skipped: no key` |
| `OPENAI_MODEL` | `gpt-4o-mini` | any `generateObject`-compatible OpenAI model id |
| `ANTHROPIC_API_KEY` | — | unset → anthropic engine reports `skipped: no key` |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | current Claude Haiku 4.5 (no date suffix) |
| `FM_PROBE_PATH` | — | unset → fm engine reports `skipped (no probe)`; see below |

Cloud engines never crash the run when a key is missing or a request errors
— they report a per-case `status` of `skipped` or `error` and the report
still renders for the engines that did run.

> **Debugging a red `eval:cloud`:** a **bad/expired key** and a genuinely bad
> model look identical here — both surface as a near-100% miss (the app's
> `runCloudParse` in `src/features/ai/engines/shared.ts` swallows all request
> failures to `null` by design, matching production). If `eval:cloud` suddenly
> scores ~0%, check the key before blaming the model.

**Anthropic engine transport:** unlike `openai` (which still calls the Vercel
AI SDK's `generateObject`), the `anthropic` engine calls the app's real
shipping BYOK path — `anthropicParse` (`src/features/ai/engines/anthropic.ts`),
a raw `fetch` to `POST /v1/messages` forcing the `record_expense` tool, not
`generateObject` (whose HTTP path depends on web-streams RN/Hermes doesn't
provide — see `docs/design/byok-raw-fetch-spec.md`). This exercises the exact
transport/schema/normalize/guard/validate pipeline the app ships, not a
harness-only re-implementation.

## Dataset (`dataset.jsonl`)

One JSON object per line: `{ id, axis, text, context, expected }`.

```json
{"id":"payee-01","axis":"payee-bearing","text":"groceries 64.20 at FairPrice",
 "context":{"categories":[{"name":"Groceries","kind":"expense"}, ...],
            "payees":["FairPrice", ...],"accounts":["Checking","Cash"],
            "nowISO":"2026-07-16T12:00:00+08:00"},
 "expected":{"amountMinor":6420,"sign":"expense","dateISO":"2026-07-16",
             "category":"Groceries","payee":"FairPrice"}}
```

`expected: null` marks a case that SHOULD fail to parse (gibberish) — correct
means the engine also returns `null`.

**Schema note (interpretation call):** the spec's own illustration shows
`categories` as a flat name array. This harness uses `{name, kind}` objects
instead, because `src/domain/types.ts`'s `Category` — and the kind-scoped
matching in `src/domain/categories.ts` that `localParse` depends on — requires
a `kind` (`expense`/`income`/`transfer`); a bare name can't drive that real
code path. `payees`/`accounts` stay flat name strings as the spec shows,
since no parse-relevant code path reads anything else off them.

To add a case: pick an `id`, write `text`, reuse or extend `context`, and
hand-label `expected` **by tracing the real code**, not by guessing — the
harness's `id` fields are stable so a failing-case diff in the dashboard maps
straight back to a line here. A good way to hand-verify a new label before
committing it: run the case's `text` through `localParse`/`resolveRelativeDate`/
`resolveAbsoluteDate` directly (`npx tsx -e "import {localParse} from './src/domain/localParse.ts'; console.log(localParse('...', {categories, payees, now: Date.now()}))"`)
so the ground truth is anchored to what the real code can and can't do,
not an assumption.

The starter 30 cases cover: plain, payee-bearing, relative dates, an
ambiguous "on the 1st" date, absolute calendar dates (both `"June 24"` and
`"24/06/2026"` forms), income, refunds (including a case where the
heuristic's `refund(?:ed)?`-shaped regex misses bare "refund"), a large
amount, EU decimal notation (`€1.234,56`), spelled-out vs. symbol currency,
a multi-word category, ambiguous text, transfers, and two fail-to-parse
(gibberish) cases. `nowISO` is fixed (`2026-07-16T12:00:00+08:00`) across
every case so relative-date resolution is reproducible.

`fail-03`..`fail-07` (axis `fail-to-parse`) extend the fail-to-parse category
with off-topic/generic/prompt-injection text (a trivia question, "ignore
previous instructions…", "tell me a joke", a role-play attempt, small talk) —
`expected: null` — added to measure the scope guardrail in
`buildDeviceParseInstructions` (`src/domain/deviceParsePrompt.ts`): the model
must extract, not answer or obey, and must refuse only when there's truly
nothing to extract. They deliberately avoid any digit in the text — a
digit-bearing off-topic input (e.g. "2+2") would also trip the heuristic's own
amount regex (a bare number reads as an amount to `localParse` regardless of
context), which is a pre-existing heuristic limitation unrelated to the LLM
prompt guardrail and out of scope to "fix" via a regex change here.

`terse-01`..`terse-04` (axis `terse`) are the other side of that guardrail:
short, real, amount-bearing expenses ("coffee 4", "40 groceries", "paid mum
50", a bare "12.50") that must still be extracted normally, never refused —
they guard against the guardrail over-firing on terseness alone. `expected`
was hand-labeled by tracing `localParse` directly (`category: "Groceries"`
for `terse-02` because "Groceries" is an exact known-category match in the
text; `category`/`payee`: null elsewhere, since `localParse` only extracts a
payee from an explicit "at X"/"from X" anchor — "paid mum 50" has neither).
**These are only meaningful signal on the cloud (OpenAI/Anthropic) engines
with real keys** — the heuristic parses them via its amount regex regardless
of any prompt guardrail, so a passing heuristic run here doesn't prove the
guardrail avoids over-refusal, only that the heuristic itself is unaffected
(which the `overallAccuracy` regression check already covers).

## Scoring (`scoring.py`)

Pure field comparison — no parse logic. Per case × engine: `amountMinor` and
`sign` exact; `dateISO` exact (engine's own date resolution, compared as a
UTC calendar day — the Node runner pins `TZ=UTC`); `category`/`payee`
normalized (trim/collapse-whitespace/lowercase, mirroring
`src/domain/textMatch.ts`'s `normalizeName`); `overall` = all five correct.
A `null` parse against a non-null `expected` fails every field; a `null`
parse against a `null` `expected` (fail-to-parse case) is the one case where
`null` is *correct*.

Unit tests: `evals/test_scoring.py` (`.venv/bin/pytest test_scoring.py`, or
plain `python3 test_scoring.py` — no pytest required either way).

## `npm run eval` (JS gate, Tier 1 — no Python, no keys)

`evals/score.mjs` is a plain-JS port of `scoring.py` (proven equal to it by
`evals/test-score.mjs`, which mirrors `evals/test_scoring.py`'s cases —
`node evals/test-score.mjs`), so `/ship`-verify and CI don't need a Python
venv to gate the pipeline on parse quality:

```bash
npm run eval          # heuristic engine only — the offline, no-key floor
npm run eval:cloud     # anthropic engine — needs ANTHROPIC_API_KEY, else prints skipped and exits 0
npm run eval:fm        # rebuilds the FM probe, then N=5 pass-rate — needs a Mac with Apple Intelligence
```

`npm run eval` first runs `evals/fm/check-sync.mjs` (the FM Swift-probe
contract-sync guard, below — fails the whole gate on any drift, before any
scoring runs), then `run_node.mjs heuristic evals/dataset.jsonl`, scores it
with `score.mjs`, prints a per-axis/per-field accuracy table, and **exits
non-zero** if the heuristic `overallAccuracy` drops below the committed
baseline in `evals/baseline.json`, or if any case that passed at baseline now
fails. `npm run eval:cloud` runs the same thing against the `anthropic`
engine and, when a key is present, grades against the lenient thresholds in
`evals/thresholds.json` instead of the baseline file — it is on-demand only
(costs real API calls) and is never part of the default `npm run eval` gate.
`npm run eval:fm` (`bash evals/fm/build.sh && FM_PROBE_PATH=$PWD/evals/fm/probe
node evals/run-eval.mjs --engine=fm --n=5`) is the one-command on-device
equivalent — N=5 repeats per case, gated on pass-rate against
`evals/thresholds.json`. `node evals/run-eval.mjs --engine=fm` (no `--n`) runs
a single sample instead; `--engine=<fm|anthropic> --n=<N>` is the general
form. **`/build`'s FM preflight currently runs `eval:fm` report-only** — see
`.claude/commands/build.md` — it prints the score table but does not block
the archive on a threshold FAIL yet, since the dataset's category/payee
labels were only just corrected for asserted-field fairness (see
docs/design/parse-eval-pipeline-spec.md); re-tighten to a real gate once that
baseline has proven stable over a few builds.

## The FM Swift probe (`evals/fm/`)

Foundation Models has no Node binding — it only runs natively. `evals/fm/probe.swift`
is a Mac-side Swift CLI (macOS 26, Apple Intelligence on) that mirrors the
app's real on-device parse contract: a `@Generable` struct with the same
`@Guide` description strings as `deviceParseSchema`'s `.describe()`s (copied
verbatim from `src/domain/deviceParsePrompt.ts`), fed the exact
`buildDeviceParseInstructions()` / `buildDeviceParsePrompt()` output — the
same approach the `fm-probe-harness` used for prompt-tuning without device
builds; macOS 26 runs the same on-device model family as iOS 26, so it's a
faithful proxy. Only the source is committed — the compiled binary is
gitignored (`evals/.gitignore`), rebuild it locally:

```bash
bash evals/fm/build.sh                     # swiftc -O -parse-as-library -> evals/fm/probe
export FM_PROBE_PATH=$PWD/evals/fm/probe   # run_node.mjs's fm engine shells out to this
npx tsx evals/engines/run_node.mjs fm evals/dataset.jsonl   # raw per-case results
node evals/run-eval.mjs --engine=fm                          # scored, lenient thresholds
node evals/run-eval.mjs --engine=fm --n=5                    # /build's preflight: N-repeat pass-rate gate
```

With `FM_PROBE_PATH` unset (or on a non-Mac/pre-macOS-26 machine), the `fm`
engine reports `skipped (no probe)` and every gate above exits 0 — Foundation
Models unavailability never blocks a build.

**Sampling.** The probe passes `GenerationOptions(sampling: .greedy)` to
`respond`, matching the app's real binding: `AppleLLMImpl.swift`'s
`createGenerationOptions` defaults to `.greedy` whenever the caller doesn't
set `topP`/`topK`, and `deviceParse.ts`'s `generateObject` call never does.
Before this the probe used the SDK's default (non-greedy/random) sampling, so
per-case pass-rates were noisier than what the app ships.

**KNOWN GAP — schema path (not closed by the greedy-sampling fix above, a
later step).** The probe's `@Generable DeviceParse` struct is a STATIC
schema, driven through `session.respond(to:generating:options:)`. The app's
real binding is different: `deviceParse.ts` hands `generateObject` a zod
schema, which `@react-native-ai/apple` converts to a `DynamicGenerationSchema`
at runtime and calls `session.respond(to:schema:includeSchemaInPrompt: true,
options:)` instead (`AppleLLMImpl.swift` ~L50-80, ~L256
`createGenerationOptions`). A dynamic schema is injected into the prompt
textually (`includeSchemaInPrompt: true`); a static `@Generable` type's
constraint is compiled in — the two are not guaranteed to constrain or sample
the model identically, so the probe's numbers are a proxy for the app's real
on-device behavior, not a byte-for-byte reproduction of it. Closing this gap
needs a native module that reuses this probe's `@Generable` struct/schema
machinery directly from the app's own binding rather than a Mac-side CLI —
tracked as follow-up work, out of scope for the harness-only changes here.

**Contract-sync guard.** `evals/fm/check-sync.mjs` is a pure string check (no
FM, no Swift compile — plain `node evals/fm/check-sync.mjs`) that extracts
every `@Guide`/instructions string from `probe.swift` and confirms each
matches `deviceParsePrompt.ts`'s `.describe()`s / `buildDeviceParseInstructions()`
output verbatim, failing loudly (naming the diverged field) on any drift.
`npm run eval` runs it automatically before scoring anything (see below), so
the Swift and TS prompt copies can't silently diverge even on a machine with
no Swift toolchain or Foundation Models at all.

## Never ships

`evals/**` is dev tooling that runs on the developer's Mac from the repo
checkout. It is not referenced by `app.json`/`eas.json`, not touched by
`expo prebuild`, and its only footprint on the app's build is three
`devDependencies` entries in the root `package.json` (`tsx`, `@ai-sdk/openai`,
`@ai-sdk/anthropic`) — dev-only, never bundled. The runtime `dependencies`
block is unchanged.

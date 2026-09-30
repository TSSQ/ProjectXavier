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
`src/domain/textMatch.ts`'s `normalizeName`) but only ASSERTED — scored only
on the cases whose hand-written label actually gives a non-null value for
that field, since the dataset's labels were traced from the heuristic and
leave `category`/`payee` `null` on many cases where a real model legitimately
proposes something the heuristic never could. A case's `overall` is true iff
every field its label actually asserts is correct — `amountMinor`/`sign`/
`dateISO` always, `category`/`payee` only when non-null in the label. A
`null` parse against a non-null `expected` fails every asserted field; a
`null` parse against a `null` `expected` (a refusal/fail-to-parse case) is
the one case where `null` is *correct*.

`aggregate()`'s `overallAccuracy` spans BOTH populations in the dataset — the
"parse cases" (a real expense, most of the 39) and the "refusal cases"
(`expected: null`, 7 of the 39) — with a refusal case counted correct on a
`None`/`null` return; `parseAccuracy`/`failToParseAccuracy` split that same
combined population back out, and `axisAccuracy` breaks it down further by
the dataset's `axis` label. A `status: 'error'` case (a HARNESS fault — see
"Model errors vs. harness faults" below) counts as a FAILED case in every one
of those denominators, never `null`/skipped, though it's still listed
separately in `errors` for diagnosability — a broken probe/runner must never
shrink or flatter the score by quietly excluding its own failures from the
count.

**Reading a red/green `fm` run.** The dataset has ~39 cases (32 parse-case,
7 refusal-case) — a swing of ±1–2 cases moves either population's accuracy by
several points (1/32 ≈ 3pp, 1/7 ≈ 14pp). Treat a small, one-off change as
noise, not signal, unless it repeats across runs or a case that was
previously reliably passing (`--n=5`'s per-case pass-rate) starts failing.

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

`npm run eval` first runs, in order, `evals/fm/check-sync.mjs` (the FM
Swift-probe contract-sync guard, below), `evals/test-score.mjs` (the scorer's
own unit tests), `evals/test-gates.mjs` (the gate/scoring helpers' own unit
tests — `evals/gates.mjs`, review N5) and `evals/test-score-parity.mjs` (the
JS/Python scorer-lockstep differential test, below) — each fails the whole
gate before any real scoring runs, so a broken guard/scorer/gate can never
produce a passing result. It then runs `run_node.mjs heuristic evals/dataset.jsonl`,
scores it with `score.mjs`, prints a per-axis/per-field accuracy table, and
**exits non-zero** if the heuristic `overallAccuracy` drops below the
committed baseline in `evals/baseline.json`, or if any case that passed at
baseline now fails. `npm run eval:cloud` runs the same thing against the
`anthropic` engine and, when a key is present, grades PARSE-case and
REFUSAL-case accuracy SEPARATELY against `evals/thresholds.json` (below)
instead of the baseline file — it is on-demand only (costs real API calls)
and is never part of the default `npm run eval` gate. `npm run eval:fm`
(`bash evals/fm/build.sh && FM_PROBE_PATH=$PWD/evals/fm/probe node
evals/run-eval.mjs --engine=fm --n=5`) is the one-command on-device
equivalent — N=5 repeats per case, gated on pass-rate against
`evals/thresholds.json`. `node evals/run-eval.mjs --engine=fm` (no `--n`) runs
a single sample instead; `--engine=<fm|anthropic> --n=<N>` is the general
form. **`/build`'s FM preflight currently runs `eval:fm` report-only** — see
`.claude/commands/build.md` — it prints the score table but does not block
the archive on a threshold FAIL yet; re-tighten to a real gate once the
current (real-dynamic-schema-path) baseline has proven stable over a few
builds.

### Thresholds (`evals/thresholds.json`)

```json
{ "model": { "parse": 0.80, "refusal": 0.85, "perCase": 0.6 } }
```

Model-tier engines (`fm`/`anthropic`) are gated on PARSE-case accuracy
(`model.parse`) and REFUSAL-case accuracy (`model.refusal`) SEPARATELY, not
one blended `overall` bar — 7 of the dataset's 39 cases are refusals the
model reliably gets right, so a single blended average could stay above 0.80
even when parse-case accuracy alone was well below it; both populations must
individually clear their own bar. `model.perCase` is unchanged: the `--n=<N>`
pass-rate mode's bar for a single case's pass-rate to count as "reliable"
before either population's reliable-fraction is graded against
`model.parse`/`model.refusal`.

**Reading a red/green `fm` run.** With ~39 cases (32 parse-case, 7
refusal-case), a swing of ±1–2 cases moves either population's accuracy by
several points (1/32 ≈ 3pp, 1/7 ≈ 14pp) — treat a small, one-off change as
noise, not signal, unless it repeats across runs or a case that was
previously reliably passing starts failing.

### Model errors vs. harness faults

A `status: 'error'` result is a HARNESS fault — bad args, a spawn
failure/missing probe binary, Foundation Models unavailable, a probe timeout
or crash — NEVER a model generation failure (a guardrail refusal, a decoding
failure, or — review B2 — a raw response that fails
`deviceParseSchema.parse(JSON.parse(text))`): those are swallowed by the SAME
retry loop the app itself uses (`src/domain/deviceParseAttempts.ts`'s
`runDeviceParseAttempts`, shared verbatim between `deviceParse.ts` and
`run_node.mjs`'s `runFM`) and scored as a normal miss or a normal (possibly
correct, on a refusal case) `null` return. `evals/fm/probe.swift` prints the
RAW text the binding handed back (mirroring `toModelMessages()`/`ai`'s own
`extractTextContent` — never a hand-decoded shape, so a later schema field
change needs zero probe edits) and signals a harness-vs-generation split via
its exit code — non-zero-and-not-2 (or a timeout) for a harness fault, `2` for
a probe-side generation failure (`session.respond` threw or produced no
text). `run_node.mjs`'s `attempt()` then mirrors `generateObject`'s own
validation EXACTLY on that raw text — `JSON.parse` then
`deviceParseSchema.parse(...)`, throwing (a normal generation failure, caught
by the shared retry loop) on either step failing — so a schema-invalid raw
response is classified correctly even though the probe itself exited 0. See
its header and `run_node.mjs`'s `attempt()` doc comment for the full
contract. `status: 'error'` counts as a FAILED case in every scoring
denominator (never `null`/skipped) while still being listed separately in
`errors` — see "Scoring" above. Once a harness fault is recorded for a case
(review N7), every further retry attempt for that SAME case short-circuits —
it re-throws immediately without invoking the probe again (a harness fault is
unsalvageable by retrying) — before the case is reported `status: 'error'`.

## The FM Swift probe (`evals/fm/`)

Foundation Models has no Node binding — it only runs natively.
`evals/fm/probe.swift` is a Mac-side Swift CLI (macOS 26, Apple Intelligence
on) that runs the app's REAL on-device parse contract — not a
re-implementation of it. `@react-native-ai/apple`'s `generateText`
(`ios/AppleLLMImpl.swift`) converts the JSON Schema `generateObject` derives
from `deviceParseSchema` into a `DynamicGenerationSchema` via its own
`AppleLLMSchemaParser`, then calls
`session.respond(to:schema:includeSchemaInPrompt: true, options:)` on a
session built from a `Transcript`. The probe now does exactly that:

- `AppleLLMSchemaParser` (and its `AppleLLMError` dependency) are vendored
  VERBATIM from the installed `@react-native-ai/apple` binding — never
  hand-edited (see the probe's own header for the exact source/version).
- The probe reads ONE JSON object from stdin —
  `{ "instructions": string, "prompt": string, "schema": <JSON Schema> }` —
  built by `evals/engines/run_node.mjs`'s `runFM` from the REAL
  `buildDeviceParseInstructions()`, `buildDeviceParsePrompt()`, and the exact
  JSON Schema `deviceParseSchema` produces via `ai`'s own `zodSchema()` (the
  same function `generateObject` calls internally — see `run_node.mjs`'s
  import comment for the full traced call chain). There is no longer any
  prompt/schema STRING hand-copied into the probe.
- The session is built the way the app's binding builds it: a `Transcript`
  with one `.instructions` entry, then
  `LanguageModelSession(model:tools:transcript:)` — not the
  `LanguageModelSession { instructions }` closure initializer.

Only the source is committed — the compiled binary is gitignored
(`evals/.gitignore`), rebuild it locally:

```bash
bash evals/fm/build.sh                     # swiftc -O -parse-as-library -> evals/fm/probe
export FM_PROBE_PATH=$PWD/evals/fm/probe   # run_node.mjs's fm engine shells out to this
npx tsx evals/engines/run_node.mjs fm evals/dataset.jsonl   # raw per-case results
node evals/run-eval.mjs --engine=fm                          # scored, thresholds.json gates
node evals/run-eval.mjs --engine=fm --n=5                    # /build's preflight: N-repeat pass-rate gate
```

With `FM_PROBE_PATH` unset (or on a non-Mac/pre-macOS-26 machine), the `fm`
engine reports `skipped (no probe)` and every gate above exits 0 — Foundation
Models unavailability never blocks a build.

**Sampling.** The probe passes `GenerationOptions(sampling: .greedy)` to
`respond`, matching the app's real binding: `AppleLLMImpl.swift`'s
`createGenerationOptions` defaults to `.greedy` whenever the caller doesn't
set `topP`/`topK`, and `deviceParse.ts`'s `generateObject` call never does.

**Cold vs. warm (review D2).** Every probe invocation is a FRESH process — the
binding creates a new `LanguageModelSession` per call with no prewarm inside a
process that itself only lives for one call, so this harness cannot measure
prewarm/warm-session behavior at all; every sample here is a cold start
(mirroring the app's own worst case, a cold first message, not its typical
warmer subsequent one). `attemptsPerRun`/`firstAttemptUsefulPerRun` in a
committed artifact's per-case diagnostics record how many of `--n`'s repeated
per-case runs needed a retry — a rough cold-start-rate signal — but ACTUAL
warm/prewarm effects can only be judged by on-device measurement (e.g. timing
successive in-app messages), not by this eval.

**Schema-order diagnostics (review D1/B2).** Swift `Dictionary`/`NSDictionary`
iteration order is randomized per CALL/cast, not merely per process —
`AppleLLMSchemaParser.parseObjectSchema` iterates the schema's `properties`
dict, so the ORDER `DynamicGenerationSchema` receives the app's fields in (and
therefore what `includeSchemaInPrompt: true` injects into the prompt text) can
differ call to call, including within the SAME process/launch (proven
empirically: two independent `as? [String: Any]` casts of the same
`Any`-boxed value can iterate differently even back-to-back). The app's real
RN bridge hands `AppleLLMSchemaParser` a fresh `NSDictionary` on every real
call too, so this instability is a genuine property of the shipped app, not
only an eval-harness artifact. The probe logs the order it saw to stderr on
every call — sourced from the ACTUAL constructed `GenerationSchema`'s
`debugDescription` `"x-order"` field (review B1), i.e. the same schema object
handed to `session.respond`, never a second independent dictionary cast that
could silently diverge from it; `run_node.mjs`'s `runFM` captures it into each
result's `diagnostics.fieldOrders`, and a committed artifact's per-case
diagnostics record the distinct orders observed (`fieldOrdersObserved`) for
any FAILING case.

**Contract-sync guard.** `evals/fm/check-sync.mjs` (no FM, no Swift compile —
plain `node evals/fm/check-sync.mjs`) runs two checks. First, it extracts the
vendored `AppleLLMSchemaParser` block from BOTH `probe.swift` and the
installed `@react-native-ai/apple` binding's `ios/AppleLLMImpl.swift`,
whitespace-normalizes each, and fails loudly on any difference — so a binding
upgrade that changes how a JSON Schema becomes a `GenerationSchema` can't
silently diverge from what the probe runs. Second (review N1), it checks a
handful of stable-substring "anchors" against the installed binding's source
for behavior that lives OUTSIDE that one struct and so isn't covered by the
diff above: `includeSchemaInPrompt: true` is still passed to
`session.respond`, `.greedy` is still `createGenerationOptions`'s default
sampling mode, the session is still built from a `Transcript`,
`toModelMessages()`'s output shape is unchanged, and `ai-sdk.ts`'s
`doGenerate` still passes `responseFormat.schema` through. `npm run eval` runs
both automatically before scoring anything (see above), so this holds even on
a machine with no Swift toolchain or Foundation Models at all.

### Committed result artifacts (`evals/results/*.json`)

Each engine's last run is committed as `evals/results/<engine>.json` —
scores, gate outcome, and provenance (`gitSha`, `generatedAt`, `dirty`, and
for `fm` an `fmEnvironment` block: macOS `sw_vers` product/build version plus
the installed `@react-native-ai/apple` version, review N4) — so a repo reader
can trace "what did the eval say" without re-running it or needing a key/FM.

**No-op-rewrite suppression.** `emitResult` (`run-eval.mjs`) compares the
about-to-be-written artifact against the currently-committed one, ignoring
ONLY `gitSha`/`generatedAt` (the two fields that trivially change on every
run regardless of whether anything about the SCORE did). If every other field
is identical, the file is left UNTOUCHED — it keeps its OLDER `gitSha`/
`generatedAt` — rather than rewritten, so `git diff` on a clean re-run of an
unrelated change stays empty instead of showing a no-op timestamp/SHA bump.
Concretely: re-running `npm run eval:fm` twice in a row with nothing else
having changed leaves `evals/results/fm.json` byte-for-byte identical to
before the second run, still showing the FIRST run's `gitSha`/`generatedAt`.
A real score/gate/environment change always overwrites the file normally.

**`test-score-parity.mjs` only guards LOCAL runs.** It skips itself (exit 0,
no failure) whenever `evals/.venv` doesn't exist — which is ALWAYS true in CI
(the venv is gitignored and CI never creates it; see "Python side" above).
So this differential test is a real guard only on a developer machine that
has run the `uv venv .venv`/`pip install` setup above; in CI it's a no-op
that always reports success, not an indication the JS/Python scorers were
actually cross-checked that run.

## Never ships

`evals/**` is dev tooling that runs on the developer's Mac from the repo
checkout. It is not referenced by `app.json`/`eas.json`, not touched by
`expo prebuild`, and its only footprint on the app's build is three
`devDependencies` entries in the root `package.json` (`tsx`, `@ai-sdk/openai`,
`@ai-sdk/anthropic`) — dev-only, never bundled. The runtime `dependencies`
block is unchanged.

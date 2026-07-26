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
| `ANTHROPIC_MODEL` | `claude-3-5-haiku-latest` | Anthropic's alias for the current 3.5 Haiku snapshot |
| `FM_PROBE_PATH` | — | unset → fm engine reports `skipped (no probe)`; see below |

Cloud engines never crash the run when a key is missing or a request errors
— they report a per-case `status` of `skipped` or `error` and the report
still renders for the engines that did run.

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

## Wiring the FM Swift probe next

Foundation Models has no Node binding — it only runs natively. `run_node.mjs`
already has an `fm` engine slot; wire it by:

1. Building a Mac-side Swift CLI (macOS 26, Apple Intelligence on) with a
   `@Generable` struct mirroring `deviceParseSchema` field-for-field (same
   `@Guide` description strings, taken verbatim from
   `src/domain/deviceParsePrompt.ts`'s `.describe()`s), fed the exact
   `buildDeviceParseInstructions()` / `buildDeviceParsePrompt()` strings —
   this is the same approach as the `fm-probe-harness` used for prompt-tuning
   without device builds; macOS 26 runs the same on-device model family as
   iOS 26, so it's a faithful proxy.
2. Compile it (`swiftc -parse-as-library -o probe probe.swift`) so it accepts
   `probe "<text>" '<json context>'` and prints a `deviceParseSchema`-shaped
   JSON object to stdout.
3. `export FM_PROBE_PATH=/path/to/probe` — `run_node.mjs`'s `fm` engine
   already shells out to it, then runs the SAME normalize/guard/date/
   revalidate pipeline as the other engines.

No probe is currently wired in (`fm` reports `skipped (no probe)`) — this is
the documented next step, deliberately out of scope for v1 per the spec.

## Never ships

`evals/**` is dev tooling that runs on the developer's Mac from the repo
checkout. It is not referenced by `app.json`/`eas.json`, not touched by
`expo prebuild`, and its only footprint on the app's build is three
`devDependencies` entries in the root `package.json` (`tsx`, `@ai-sdk/openai`,
`@ai-sdk/anthropic`) — dev-only, never bundled. The runtime `dependencies`
block is unchanged.

# ProjectXavier

An expense tracker for the laziest user: **describe an expense in plain language,
scan a receipt, or just ask a question about your money** — and an avatar-driven
assistant called Xavier turns it into structured data or a real answer. Manual
entry, multi-account net-worth tracking, and time-period dashboards are all built
in.

> iOS first, on one **React Native + Expo (TypeScript)** codebase. Data is
> **local-first** — an on-device SQLite database is the only source of truth,
> encrypted at rest with SQLCipher. There is no account, no sign-in, and no
> server operated by us.

> **Built by an AI agent, directed by a human.** All code in this repository is
> written by Claude (Anthropic's coding agent), working through the stage-gated
> [`/ship` agentic loop](#how-this-app-is-built--the-ship-agentic-loop) below.
> Product direction — goals, scope, design decisions, and release sign-off — is
> human: the human sets what to build and approves every gate; the agent specs,
> implements, tests, reviews, and ships against those calls.

## Status

**v0.2.0 (build 62) is submitted to the App Store.** iPhone-only.

- ✅ Pure, tested domain layer: balances, net worth, period drill-down, money,
  multi-currency relabel with explicit user consent.
- ✅ Local SQLite (Drizzle) + parameterised SQL; **encrypted at rest** with
  SQLCipher (key in the Keychain, `AFTER_FIRST_UNLOCK`).
- ✅ zod validation at every trust boundary, including untrusted AI/OCR output.
- ✅ Assistant home, dashboard, accounts, settings; **opt-in** Face ID app-lock;
  home/lock-screen widget (redacts when locked); first-run capability carousel.
- ✅ Backup/restore to the user's **own** iCloud container, plus auto-backup on
  by default as an opt-out safety net.
- ✅ **83 test suites / 1,363 tests** (616 Gherkin scenarios) + Maestro E2E flows
  + three [eval harnesses](#evals).

### What Xavier can do

| | |
| --- | --- |
| **Log** | "lunch 12.50", "paid mum 50", or scan a receipt → a confirm card before anything saves |
| **Ask** | "how much did I spend on dining last month?", "this month vs last month" → a real figure or a chart, computed on-device |
| **Manage accounts** | create, rename, adjust and delete accounts conversationally (deleting cascades to its transactions, including the contra side of transfers) |

Every AI-produced action is **schema-validated and shown on an editable confirm
card before it writes**. Nothing the model produces reaches the database unseen.

## Privacy

The app is **fully local by default** and collects nothing — no server, no
analytics, no advertising or tracking SDKs, no account. Financial data stays on
the device.

Two deliberate exceptions, both documented:

- **Backups** go to the user's **own iCloud Documents container** as a whole-DB
  SQLite image. They are **not encrypted by the app** — at-rest protection is
  Apple's iCloud encryption plus the device lock. This is a deliberate UX
  tradeoff, recorded in [ADR 0006](docs/adr/0006-icloud-unencrypted-backups.md).
- **BYOK** (below) sends assistant requests to a provider the user chooses, with
  their own key. Off by default.

Full policy: <https://tssq.github.io/ProjectXavier/privacy.html> ·
Architecture and non-negotiable guardrails: [`docs/SECURITY.md`](docs/SECURITY.md)

## The assistant — two tiers

**The model plans; deterministic code computes.** The model picks *which*
question to ask of the data and never touches a number, a date, or an entity id.

### On-device (default) — Apple Foundation Models

No network, no key, no account. Parsing and query tool-selection run through
guided generation with a schema shaped around what a small model measurably does
reliably: every field required (an optional field reads as licence to omit it),
sentinels instead of nulls, a closed enum of period tokens rather than free-form
dates. Queries get **exactly one shot at one tool** — no chaining
([`src/domain/queryToolSelection.ts`](src/domain/queryToolSelection.ts)).

Falls back to a deterministic heuristic parser, then to an honest failure that
points at manual entry. The app is fully functional with no model at all.

### BYOK (optional, off by default)

A user can add their **own** OpenAI or Anthropic API key so the assistant uses
that provider instead. Requests go **directly from the device to the provider**,
on the user's own billing relationship — never through infrastructure we run,
because we run none. The key lives in the Keychain.

Here the model drives a genuine **three-round tool loop**
([`src/features/ai/queryLoop.ts`](src/features/ai/queryLoop.ts)): seven read-only
tools (`total_spent`, `total_income`, `spending_by_category`,
`spending_over_time`, `top_payees`, `net_worth`, `search_transactions`) are
exposed as native function definitions, and the model chooses which to call, sees
the results, and can chain a follow-up — which is what makes "this month vs last
month" render as a two-bar chart.

What the loop is *not* allowed to do:

- every parameter set is **zod-validated before execution**; a rejected call
  returns an error to the model and is recorded as `null`, so a hallucinated call
  can never masquerade as data
- the **period is deterministically re-derived** from the user's own words and
  overrides the model's chosen token — a validated token is still a *model-chosen*
  token
- the model **never sees raw amounts**: figures are formatted to display strings
  in the model-facing copy while raw values flow untouched to the card, removing
  arithmetic from the model's job
- entity names are **re-resolved through the real matchers**, never trusted as ids
- hard caps on rounds and series buckets

## Evals

Routing and extraction are **gated by labelled corpora**, not vibes. The rule in
the gate files: *no gate/routing/extraction change without a corpus case first.*

| Command | Set | Bar | Needs a key? |
| --- | --- | --- | --- |
| `npm run eval:intent` | 191 cases | 100% | no |
| `npm run eval:query` | 59 cases | 100% on every dimension | no |
| `npm run eval` | 39 cases (32 scored + 7 must-not-parse) | at/above committed baseline, no case regresses | no |
| `npm run eval:cloud` / `eval:openai` / `eval:fm` | same 39 | report-only, per engine | yes (or a Mac probe) |

The first three are deterministic, free, and run offline. Model-tier runs write a
committed artifact to `evals/results/<engine>.json` carrying the score, the git
SHA and the gate outcome.

> **Known gap:** the evals are **not yet wired into CI** — `.github/workflows/ci.yml`
> runs typecheck, lint, BDD, gitleaks and Maestro, but no eval. They are currently
> run by the coordinator at the Verify stage.

## Develop

```bash
npm install --legacy-peer-deps   # see note below
npm test          # BDD domain suite (jest-cucumber)
npm run typecheck
npm run lint
npm run eval:intent && npm run eval:query   # deterministic gates, no keys
npm start         # Expo dev server (press i for iOS simulator)
```

> Note: the Expo/React-Native dependency graph requires `--legacy-peer-deps`.
> The BDD suite runs in plain Node — domain logic is kept framework-free so it
> stays testable there; native/Expo code is excluded.

> **Running on iOS:** the app uses native modules (SQLite, secure store, Face ID,
> Foundation Models), so it needs a **custom dev build** — Expo Go won't work. See
> **[`docs/RUNNING.md`](docs/RUNNING.md)**.

> **Builds are local, not cloud.** Releases are cut with `xcodebuild` and manual
> two-target signing (app + widget extension), verified as an IPA, and uploaded
> with `altool` — see [`.claude/commands/build.md`](.claude/commands/build.md).
> GitHub Actions runs typecheck/lint/BDD, a gitleaks secret scan, and Maestro E2E.

## How this app is built — the `/ship` agentic loop

Features and fixes flow through a **stage-gated pipeline** (`/ship`): specialised
agents do the work, and **the human is the gate at the decisions that matter**. A
stage that hasn't passed closes the gate — nothing downstream runs until it does.

1. **Spec** — a design doc under `docs/design/`. *Human go-step: product-shaped
   work pauses here for approval.*
2. **Implement** — an implementer agent builds the spec.
3. **QA** — an adversarial tester on the diff; every **Major** loops back to the
   implementer and is resolved before the gate opens. The verdict is recorded
   **verbatim** in `docs/ship-runs/<slug>.md`.
4. **Review** — a reviewer agent, final read; substantive nits applied, skipped
   ones noted. Verdict also recorded verbatim.
5. **Verify** — `typecheck + lint + test + eval` re-run by the coordinator, not
   claimed.
6. **Commit + push** — only the feature's own files plus the run record, over
   SSH, with a `Ship-Run:` trailer that makes pipeline commits countable.
7. **Build + upload** — a release-manager agent archives, signs, verifies the IPA,
   and uploads to TestFlight.
8. **Device confirm** — *human go-step: you test on a real device; only your
   confirmation closes it.*

**Human-gated "go" steps — nothing outward-facing happens without an explicit
yes:** spec approval for product-shaped work; device-confirm sign-off before a
feature is "done"; and any history rewrite (force-push), `main` fast-forward, or
App Store submission is always the human's call. Agents never self-approve past
these.

A machine-readable extract of the pipeline, its stage definitions, a real QA
rejection and current eval scores lives in
[`site-data/pipeline.json`](site-data/pipeline.json) — including a `missing` array
listing what could **not** be grounded in the repo.

## Layout

| Path | What |
| --- | --- |
| `src/domain` | Framework-free financial logic, parse/query prompts and routers (fully unit-tested) |
| `src/lib` | validation (zod), Keychain secure-store, crypto interface, backup |
| `src/db` | Drizzle schema, parameterised SQL, SQLCipher client, migrations |
| `src/features` | accounts, transactions, ai (on-device + BYOK engines, query loop), settings, widget |
| `app` | Expo Router screens |
| `tests` | `__features__` (Gherkin) + `__steps__` (jest-cucumber) + labelled eval corpora |
| `e2e` | Maestro end-to-end flows |
| `evals` | Parse eval harness — scores every engine against a labelled set; **never shipped** |
| `evals-lite` | Deterministic intent/query gate reports (no keys, 100% bar) |
| `docs/design` | Per-feature specs (the `/ship` Spec stage) |
| `docs/ship-runs` | Committed run records — verbatim QA and review verdicts |
| `.claude` | Agent definitions, slash commands, and the pipeline dashboard state |
| `site-data` | Grounded extract of the pipeline for the portfolio site |

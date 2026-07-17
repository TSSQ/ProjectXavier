# ProjectXavier

An expense tracker for the laziest user: **describe an expense in plain language
or scan a receipt**, and an avatar-driven assistant parses it into structured
data — asking clarifying questions when something is unclear. Manual entry,
multi-account net-worth tracking, and time-period dashboards are all built in.

> iOS first, on one **React Native + Expo (TypeScript)** codebase that extends
> to Android and web. Data is **local-first** (on-device SQLite) with optional
> **end-to-end encrypted** backup/sync.

## Status

**v1 is submission-ready (TestFlight build 42, iPhone-only).** The app is
**fully local — no accounts, no server, no data collection.** (An earlier
Supabase auth + cloud-parse-proxy design was removed on 2026-07-07; the app has
had no online endpoints since.)

- ✅ Pure, tested domain layer: balances, net worth, period drill-down, money.
- ✅ Local SQLite (Drizzle) + parameterised SQL; **encrypted at rest** with
  SQLCipher (key in the Keychain). Backups are a plaintext whole-DB SQLite image
  in the user's **own** iCloud container — never a server we run.
- ✅ zod validation at every trust boundary, incl. untrusted AI/OCR output.
- ✅ Assistant home, dashboard, accounts, settings; **opt-in** Face ID app-lock;
  home/lock-screen widget (redacts when locked); first-run welcome carousel.
- ✅ **On-device parse ladder** — describe or scan → Apple Foundation Models
  (on-device, no network) → deterministic heuristic → honest failure pointing at
  manual entry; every parse is schema-validated and shown on a confirm card
  before it saves.
- ✅ BDD suite (jest-cucumber) green (552 scenarios) + Maestro E2E flows.

**Phase 2 (in progress, branch `claude/phase2-byok`):** optional **BYOK** — a
user can add their own OpenAI/Anthropic key so the assistant parses with a cloud
model. Direct device→provider (no server), opt-in, key in the Keychain; the
default stays fully local. Plus a dev-side **eval harness** (`evals/`, never
shipped) that scores every parse engine against a labeled set.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full architecture and the
non-negotiable guardrails.

## Develop

```bash
npm install --legacy-peer-deps   # see note below
npm test          # BDD domain suite (jest-cucumber)
npm run typecheck
npm run lint
npm start         # Expo dev server (press i for iOS simulator)
```

> Note: the Expo/React-Native dependency graph requires `--legacy-peer-deps`.
> The pure BDD suite runs without the native stack.

> **Running on iOS / shipping:** the app uses native modules (SQLite, secure
> store, Face ID), so it needs a **custom dev build** — Expo Go won't work. See
> **[`docs/RUNNING.md`](docs/RUNNING.md)** for `expo run:ios`, Maestro E2E, and
> the full EAS build → TestFlight → App Store flow.

> **CI/CD:** a hybrid pipeline — GitHub Actions for typecheck/lint/BDD, EAS for
> iOS builds/submit. Rationale and the self-host revisit trigger are in
> [`docs/RUNNING.md` §6](docs/RUNNING.md#6-cicd-pipeline-hybrid).

## How this app is built — the `/ship` agentic loop

Features and fixes flow through a **stage-gated pipeline** (`/ship`): specialized
agents do the work, and **the human is the gate at the decisions that matter**. A
stage that hasn't passed closes the gate — nothing downstream runs until it does.
A live status dashboard is redeployed at every transition.

The stages:

1. **Spec** — a design doc under `docs/design/` (objective, scope, approach,
   testable acceptance). *Human go-step: product-shaped work pauses here for
   approval.*
2. **Implement** — an implementer agent builds the spec.
3. **QA** — an adversarial tester on the diff; every **Major** is looped back to
   the implementer and resolved before the gate opens.
4. **Review** — a reviewer agent, final read; substantive nits applied.
5. **Verify** — `typecheck + lint + test` re-run by the coordinator, not claimed.
6. **Commit + push** — only the feature's own files, over SSH.
7. **Build + upload** — a release-manager agent archives, signs, verifies the
   IPA, and uploads to TestFlight.
8. **Device confirm** — *human go-step: you test on a real device; only your
   confirmation closes it.*

**Human-gated "go" steps — nothing outward-facing happens without your explicit
yes:** spec approval for product-shaped work; device-confirm sign-off before a
feature is "done"; and any history rewrite (force-push), `main` fast-forward, or
App Store submission is always the human's call. Agents never self-approve past
these.

## Layout

| Path | What |
| --- | --- |
| `src/domain` | Framework-free financial logic + parse prompt/router (fully unit-tested) |
| `src/lib` | validation (zod), Keychain secure-store, crypto interface, backup |
| `src/db` | Drizzle schema, parameterised SQL, SQLCipher client, migrations |
| `src/features` | accounts, transactions, ai (on-device + BYOK engines), settings, widget |
| `app` | Expo Router screens |
| `tests` | `__features__` (Gherkin) + `__steps__` (jest-cucumber) |
| `e2e` | Maestro end-to-end flows |
| `evals` | Dev-side parse eval harness — scores every engine; **never shipped** |
| `docs/design` | Per-feature specs (the `/ship` Spec stage) |

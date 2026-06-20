# ProjectXavier

An expense tracker for the laziest user: **describe an expense in plain language
or scan a receipt**, and an avatar-driven assistant parses it into structured
data — asking clarifying questions when something is unclear. Manual entry,
multi-account net-worth tracking, and time-period dashboards are all built in.

> iOS first, on one **React Native + Expo (TypeScript)** codebase that extends
> to Android and web. Data is **local-first** (on-device SQLite) with optional
> **end-to-end encrypted** backup/sync.

## Status

Phase 0–1 scaffold:

- ✅ Pure, tested domain layer: balances, net worth, period drill-down, money.
- ✅ Local SQLite schema (Drizzle) + parameterised SQL layer.
- ✅ Encrypted backup/restore (portable, provider-injected crypto).
- ✅ zod validation incl. untrusted AI-output validation.
- ✅ App scaffold: assistant home (avatar + text box), dashboard, accounts,
  settings; biometric app-lock; DB bootstrap.
- ✅ BDD test suite (jest-cucumber) — 14 scenarios green — plus Maestro E2E flows.

See [`docs/SECURITY.md`](docs/SECURITY.md) and the approved plan for the full
architecture, AI scaling strategy, and monetisation.

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

## Layout

| Path | What |
| --- | --- |
| `src/domain` | Framework-free financial logic (fully unit-tested) |
| `src/lib` | validation (zod), crypto interface, encrypted backup |
| `src/db` | Drizzle schema, parameterised SQL, client, migrations |
| `src/features` | accounts, transactions, ai (per-feature repos/clients) |
| `app` | Expo Router screens |
| `tests` | `__features__` (Gherkin) + `__steps__` (jest-cucumber) |
| `e2e` | Maestro end-to-end flows |
| `backend` | AI proxy + Supabase (sync/auth) — see `backend/README.md` |

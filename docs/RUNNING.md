# Running, testing & shipping ProjectXavier

This guide covers the full loop: local quality checks → running the app on a
simulator/device → end-to-end tests → shipping to TestFlight and the App Store.

---

## 1. Quality suite (no device needed)

The domain layer is decoupled from React Native, so these run in plain Node and
need no simulator or Xcode:

```bash
npm install --legacy-peer-deps   # first time only (the RN/Expo graph needs this flag)
npm test          # BDD scenarios (jest-cucumber)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

These three run in CI on every push and PR (`.github/workflows/ci.yml`, `test` job).

---

## 2. Run the app

> **Expo Go will not work for this app.** It uses native modules — `expo-sqlite`,
> `expo-secure-store`, and `expo-local-authentication` (Face ID) — which require a
> **custom dev build**, not the generic Expo Go client.

### Prerequisites
- A **Mac with Xcode** (for the local iOS simulator route).
- Node 22 and the repo deps installed (`npm install --legacy-peer-deps`).

### Build & launch the dev client on a simulator

```bash
npx expo run:ios          # compiles a dev build and opens the simulator
```

After the first build, day-to-day you can just start the bundler:

```bash
npm start                 # dev server; press "i" to open iOS (uses the dev build)
```

### Simulating Face ID
The biometric app-lock uses `expo-local-authentication`. In the iOS Simulator:
**Features → Face ID → Enrolled**, then **Features → Face ID → Matching Face**
to satisfy the unlock prompt.

### On a physical iPhone
Build the `development` profile and install via the EAS link / QR code:

```bash
eas build --profile development --platform ios
```

---

## 3. End-to-end tests (Maestro)

The flows live in `e2e/*.yaml`. Against a running simulator with the app
installed:

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash   # one-time install
npm run e2e
```

In CI the `e2e` job (macOS) builds a simulator `.app` with EAS, installs it, and
runs these flows. It requires an **`EXPO_TOKEN`** repo secret (see §5); without
it the job no-ops green.

---

## 4. Ship to iOS (EAS Build + Submit)

Shipping uses [EAS](https://docs.expo.dev/build/introduction/) — Expo's cloud
build service. Profiles are defined in [`eas.json`](../eas.json).

### Prerequisites
- An **Apple Developer Program** membership (**$99/yr**).
- `npm i -g eas-cli` and `eas login`.

### Build & submit

```bash
eas build:configure                       # one-time, if not already set up
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

`eas build` handles signing certificates and provisioning profiles for you.
`eas submit` uploads the build to **App Store Connect**, where it appears in
**TestFlight** for internal/external testers. From there, submit for **App Store
review** in App Store Connect.

### Values you must supply
Fill the placeholders in `eas.json` under `submit.production.ios`:

| Field | Where to find it |
| --- | --- |
| `appleId` | Your Apple Developer account email |
| `ascAppId` | App Store Connect → your app → App Information → Apple ID |
| `appleTeamId` | Apple Developer → Membership → Team ID |

> Do **not** commit real Apple credentials beyond these non-secret identifiers.
> EAS stores signing secrets on Expo's servers, not in the repo.

---

## 5. CI secrets

| Secret | Purpose | Required for |
| --- | --- | --- |
| `EXPO_TOKEN` | Non-interactive EAS auth | The `e2e` CI job and any CI-driven `eas build` |

Create one at **expo.dev → Account → Access Tokens**, then add it under the
repo's **Settings → Secrets and variables → Actions**.

---

## 6. CI/CD pipeline (hybrid)

The pipeline is split into two independent layers, on purpose:

| Layer | Tool | Config | Runs |
| --- | --- | --- | --- |
| **Orchestration** | GitHub Actions | `.github/workflows/ci.yml` | typecheck + lint + BDD on every push/PR (Linux); gated Maestro E2E (macOS) |
| **iOS build & signing** | EAS Build / Submit | `eas.json` | on-demand `eas build` / `eas submit`, and the CI E2E simulator build |

**Why hybrid:** the Linux checks are free and fast, so they run on every PR via
GitHub Actions. The iOS-specific work — cloud macOS builders and, critically,
**managed code signing** (certs + provisioning profiles) — is handed to EAS, so
there's no Mac to maintain and no Fastlane signing setup to babysit while the app
is pre-launch and build volume is low. The `EXPO_TOKEN` secret (see §5) is what
lets CI drive EAS non-interactively.

### Revisit trigger — when to self-host the build layer

Only the **iOS build layer** is worth reconsidering later; the GitHub Actions
orchestration stays exactly as-is. Move iOS builds to a **self-hosted Mac +
[Fastlane](https://fastlane.tools/)** (`gym` to build, `pilot` to submit) when
either of these becomes true:

1. **Cost / queue pain** — monthly EAS build spend or build-queue wait times
   outgrow the cost and upkeep of running your own Mac (e.g. a Mac mini).
2. **Compliance** — a requirement that signing keys never leave your own
   infrastructure (EAS stores them on Expo's servers).

At that point you'd swap the EAS build/submit steps for Fastlane lanes on a
self-hosted runner — the test/lint jobs and the rest of `ci.yml` don't change.

---

## What's not wired yet

- The **backend AI proxy + Supabase** (`backend/`) are designed but not deployed.
  Receipt scanning and natural-language AI parsing (Phase 2) stay inactive until
  that's stood up. Manual expense tracking, accounts, net worth, dashboards, and
  encrypted backup/restore all work without it.

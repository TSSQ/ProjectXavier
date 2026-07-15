# App Store submission answer sheet

Practical checklist the user answers App Store Connect (ASC) from. Every
answer below is tied to code evidence in this repo, not aspiration — re-check
this file if the data model or backup format ever changes.

Build under submission: **build 36**, archived with `EXPO_PUBLIC_METRICS`
**unset** (metrics OFF — see `docs/design/store-prep-spec.md`).

## 1. App Privacy questionnaire → **Data Not Collected**

Answer **"No, we do not collect data from this app"** on every category ASC
asks about (Contact Info, Financial Info, Location, Usage Data, Diagnostics,
Identifiers, etc.).

Evidence:
- **Zero network call sites.** No `fetch`/`XMLHttpRequest`/`axios` calls and
  no Supabase client anywhere in `src/` or `app/` — grepped clean. The
  `supabase/` directory (the old cloud-parse edge function the on-device
  prompt was originally modelled on) has been **removed from the repo
  entirely**; only a comment in `src/domain/deviceParsePrompt.ts` still notes
  the history. The app has been fully local since 2026-07-07 (no online
  endpoints at all, per the working agreement). **Important:** deleting the
  source from this repo does **not** undeploy any server instance that was
  ever actually deployed — if a Supabase project/edge function (and its
  Upstash cache) for this app was provisioned, the developer must separately
  delete that deployed function/project (and the Upstash store) server-side
  before relying on "no server / Data Not Collected" for this app.
- **No analytics/tracking/crash-reporting SDK.** `package.json` has no
  Sentry, Amplitude, Mixpanel, Segment, Firebase, or Crashlytics dependency.
- **Parse metrics are production-off and content-free.**
  `METRICS_ENABLED` (`src/lib/flags.ts`) is `__DEV__ || EXPO_PUBLIC_METRICS
  === '1'`; build 36 sets neither, so every `recordParse()` call
  (`src/features/diagnostics/parseMetrics.ts`) is a no-op and the
  `parse_metrics` table stays empty. Even when it *is* enabled (dev/preview
  builds only), the rows never contain user content — only enums, booleans,
  bucketed lengths/confidences, and a random transaction id
  (see the table's own doc comment). Rows never leave the device; there is
  no export/upload path, only an in-app Share-sheet JSON export the user
  triggers themselves from `app/debug-metrics.tsx` (now redirect-guarded —
  see §5).
- **Backups go only to the user's own iCloud container**, not to any
  developer-controlled server. `react-native-cloud-storage` writes a plain
  `.sqlite` snapshot to the app's iCloud Documents container
  (`iCloud.com.projectxavier.app`) — Apple's iCloud, gated by the user's own
  Apple ID, never seen by us. See §3 for the format.
- **No PII collected beyond what's already on-device.** The app has no
  accounts, no sign-in, no email/name collection anywhere in the UI or DB
  schema.

**Net answer:** every ASC data-type question → **"Data Not Collected."**

## 2. Export compliance → Exempt

`ios.infoPlist.ITSAppUsesNonExemptEncryption: false` in `app.config.ts`.

Basis for the exemption (developer's good-faith determination — not legal
advice): the app's only cryptography is **SQLCipher**, a *bundled third-party*
library using the **standard, published AES algorithm** to encrypt the live
local SQLite DB at rest (ADR 0001, "H4" build). It is used **solely to protect
the user's own data on their own device** — encryption is not a primary
function of the app, no proprietary/non-standard crypto is involved, no
third-party data is protected, and nothing is transmitted. That fits the EAR
exemption for apps using standard encryption limited to protecting the user's
own data, which is the basis for setting `ITSAppUsesNonExemptEncryption:
false`.

Note the distinction the code makes: this is **not** the "uses only Apple's
OS-provided encryption (iOS Data Protection / Keychain)" exemption — SQLCipher
bundles its own AES implementation, so the applicable exemption is the
standard-algorithm / own-data-at-rest one, not the Apple-provided-crypto one.
The Keychain is used here only to store the SQLCipher *key*, not to do the DB
encryption itself.

Because this is a case-specific determination, **confirm** — don't assume —
whether an **annual self-classification report** to BIS applies to your use
before relying on "nothing further required"; the common outcome for
standard-algorithm own-data encryption is that a self-classification report is
still expected even though no CCATS/license is. With the plist key set to
`false`, ASC does **not** prompt the encryption question at submission at all,
so there is no in-ASC sub-question to answer — the attestation is the plist
value itself.

## 3. Data storage & backup disclosure

- **Live DB:** SQLCipher-encrypted at rest. Key is random CSPRNG bytes
  generated on first launch and stored in the iOS **Keychain** via
  `expo-secure-store` with `AFTER_FIRST_UNLOCK` accessibility
  (`src/db/encryptionKey.ts`) — the key is unavailable before the device's
  first unlock after boot, matches the biometric-lock threat model, and
  never leaves the device.
- **Backups:** a **plaintext whole-DB SQLite image** (`.sqlite`, format v3),
  produced via `sqlcipher_export` with an empty attach key, written to the
  user's **own** iCloud Documents container
  (`iCloud.com.projectxavier.app`) — see ADR 0006 and
  `docs/design/sqlite-backup-format-spec.md`. Confidentiality relies on
  Apple's iCloud encryption + the user's device lock + app sandboxing, not
  an app-level passphrase (deliberate UX tradeoff, documented in ADR 0006 —
  one-tap backup/restore, no key-escrow burden). `parse_metrics` is
  excluded from the exported image.
- **Legacy backups:** any `.json` backup created before the M3 format
  change (format v2, per-row JSON envelope) still **restores** — the app
  reads both `.sqlite` (v3) and `.json` (v2/v1-shape) files on restore.
- If ASC or Review asks "is user data encrypted in transit / at rest in the
  cloud": at rest in iCloud → Apple's standard iCloud encryption (not an
  app-level encryption claim); on-device → yes, SQLCipher; in transit → N/A,
  there is no network transport in this app (iCloud sync is Apple's own
  transport, outside the app's control surface).

## 4. Face ID — opt-in, not required

- Default is **OFF** (`getBiometricLock()` in
  `src/features/settings/repository.ts` defaults to `false` when unset —
  see `docs/design/faceid-opt-in-spec.md`).
- Turning it ON requires passing a **live biometric check first**
  (`requireBiometricUnlock()`); it can only be enabled when biometrics
  actually work on the device, avoiding a lockout on first run.
- `NSFaceIDUsageDescription` (added this ship, `app.config.ts`):
  *"ProjectXavier uses Face ID to unlock the app so only you can see your
  finances."* — replaces the expo-local-authentication plugin's generic
  default string with an honest, specific purpose tied to what the app
  actually does with it.
- ASC "does your app use Face ID" → **Yes, optional, user-initiated**, not a
  hard requirement to use the app.

## 5. Debug/diagnostic surface — inert in production

- Four dev-only screens (`app/debug-fm.tsx`, `debug-ocr.tsx`,
  `debug-metrics.tsx`, `debug-avatar.tsx`) exist for on-device testing.
  Their Settings → Developer entry points are already gated behind
  `METRICS_ENABLED` (hidden in production). This ship additionally
  short-circuits each screen's render with `<Redirect href="/" />` when
  `!METRICS_ENABLED`, so a deep link
  (`projectxavier://debug-fm?autorun=1&text=…`) is inert in the release
  build — it lands on the home screen and runs nothing.
- Nothing under `app/debug-*` performs a network call or exfiltrates data;
  they exercise on-device OCR/parse/avatar code paths only.

## 6. Platform / model requirements

- **iOS 26.0+** (`ios.deploymentTarget: '26.0'` in `app.config.ts`), required
  by `@react-native-ai/apple`'s on-device Foundation Models binding. ASC's
  minimum-OS field should read iOS 26.0.
- **Foundation Models availability fallback:** the assistant's parse ladder
  is FM (Apple Foundation Models, on-device, no network) → deterministic
  heuristic parser (also fully on-device, no model) → an honest failure
  message that points the user at manual entry (`app/(tabs)/index.tsx`
  `runParse`: *"I couldn't parse that. Try '/transactions lunch 12.50', or
  add it manually below."*). The app never blocks or degrades core
  functionality (adding a transaction) if Foundation Models is unavailable
  on a given device/region — FM is a convenience layer, not a dependency.

## 7. Widget

- The widget (`targets/widget/XavierWidget.swift`) shows income/expense
  totals from a shared app-group file (`src/features/widget/summary.ts`), no
  separate network or account. The totals appear only on the **medium
  (Home Screen) family**; the Lock Screen accessory (`accessoryCircular`) is
  shape-only and shows no figures.
- Redaction (`.privacySensitive()` on the amount `Text` in `MoneyRow`, this
  ship): WidgetKit blurs the numbers whenever the widget renders in a
  private/locked context — in practice **StandBy while the device is locked**
  (the medium family isn't placed on the Lock Screen itself) — and shows them
  normally on the unlocked Home Screen. Addresses "financial data visible
  with no auth" for the surface where it can actually be seen locked.

## Quick-reference answers for ASC's App Privacy flow

| ASC question | Answer |
| --- | --- |
| Does this app collect data? | No |
| Contact Info / Financial Info / Location / Identifiers / Usage Data / Diagnostics / etc. | Not collected (skip all) |
| Uses non-exempt encryption? | No — `ITSAppUsesNonExemptEncryption:false`; standard-algorithm (SQLCipher/AES), own-data-at-rest exemption. Confirm annual self-classification report applicability (see §2). |
| Uses Face ID / biometrics? | Yes — optional, user-enabled, for app unlock only |
| Minimum iOS version | 26.0 |
| Third-party analytics/ad SDKs | None |

## Follow-ups (out of scope for this ship, noted for the user)

- M5 parse edges (refund sign, amount upper bound, FM timeout) and M4
  (edit-triggers-backup) are real but not submission blockers — separate
  fast-follow per `docs/design/store-prep-spec.md`.
- M7 (single-currency-only) is an accepted design constraint, not a defect.

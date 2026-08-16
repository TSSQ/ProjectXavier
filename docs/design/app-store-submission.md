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
- **No developer-operated endpoint.** There is no server, backend, or
  analytics collector of ours anywhere in the app, and no Supabase client. The
  `supabase/` directory (the old cloud-parse edge function the on-device
  prompt was originally modelled on) has been **removed from the repo
  entirely**; only a comment in `src/domain/deviceParsePrompt.ts` still notes
  the history. **Changed since build 51 — read §8 before answering this
  section:** the app is no longer network-free. Opt-in BYOK (off by default)
  makes direct device→provider calls to the user's *own* OpenAI/Anthropic
  account with the user's own key. Those are the only outbound calls, they
  never touch infrastructure we operate, and we receive nothing from them.
  **Important:** deleting the
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

That answer still holds with BYOK shipping, because ASC's questionnaire asks
what **you, the developer**, collect: we run no server, receive no telemetry,
and have no access to anything the user sends to their own provider account.
It is *not* a claim that the app never transmits data — §8 documents what does
leave the device, when, and to whom.

Two things this answer **depends on**, both of which must be true before you
submit:

1. **The privacy policy discloses optional third-party AI processing** — that
   enabling BYOK sends the text of the user's request (which can include
   transaction descriptions, payee/category names and amounts) to OpenAI or
   Anthropic under *the user's own* agreement with that provider, and that
   the provider's terms and retention govern it, not ours.
2. **The App Review notes explain the feature** (§8), since a reviewer cannot
   exercise it without supplying their own paid API key.

Undisclosed third-party AI transmission is a common rejection reason even
when the developer collects nothing. Disclosure is what makes this accurate,
not the "Data Not Collected" checkbox on its own.

## 2. Export compliance → Exempt

`ios.infoPlist.ITSAppUsesNonExemptEncryption: false` in `app.config.ts`.

Basis for the exemption (developer's good-faith determination — not legal
advice): the app's only cryptography is **SQLCipher**, a *bundled third-party*
library using the **standard, published AES algorithm** to encrypt the live
local SQLite DB at rest (ADR 0001, "H4" build). It is used **solely to protect
the user's own data on their own device** — encryption is not a primary
function of the app, no proprietary/non-standard crypto is involved, and no
third-party data is protected. BYOK (§8) adds outbound HTTPS to the user's own
provider, but that is **standard TLS provided by the OS networking stack** —
the app implements no cryptography of its own for transport, which is itself a
recognised exemption category and does not disturb the determination below.
(The pre-BYOK version of this section rested partly on "nothing is
transmitted"; that clause no longer applies and has been removed rather than
quietly left standing.) That fits the EAR
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
  app-level encryption claim); on-device → yes, SQLCipher; in transit → for
  iCloud, Apple's own transport, outside the app's control surface; for BYOK
  (§8), HTTPS/TLS to `api.openai.com` / `api.anthropic.com`. **Financial data
  is never sent to any endpoint we operate — we operate none.**

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

## 8. BYOK — the only outbound network path (new since build 51)

The single material privacy change since the last submission. Everything else
in this document still describes a fully on-device app.

**What it is.** Settings → Assistant → BYOK lets a user paste their *own*
OpenAI or Anthropic API key so the assistant uses that provider instead of
Apple's on-device Foundation Models. Its purpose is answer quality; the app is
fully functional without it.

**Default state: OFF.** `getSetting('byok_enabled')` returns true only on the
literal string `'1'` (`src/features/settings/repository.ts`), so an unset value
— every fresh install — is `false`. With it off there are no outbound calls at
all beyond the connectivity probe.

**Where it calls.** Direct from device to the provider, never through anything
we run:

| Call site | Endpoint |
| --- | --- |
| `src/features/ai/engines/openai.ts` | `api.openai.com/v1/chat/completions` |
| `src/features/ai/engines/anthropic.ts` | `api.anthropic.com/v1/messages` |
| `src/features/ai/queryLoop.ts` | both of the above (Ask-Xavier tool loop) |
| `src/features/ai/listModels.ts` | `api.openai.com/v1/models`, `api.anthropic.com/v1/models` |

**What is sent.** Only the text of the request the user typed plus the
assistant's prompt scaffolding — and, for Ask-Xavier queries, aggregate figures
the tool loop computed on-device to answer the question. The database is never
uploaded; there is no bulk sync, and backups (§3) remain iCloud-only.

**The key.** Stored in the iOS Keychain via `expo-secure-store`
(`AFTER_FIRST_UNLOCK`), sent only to the provider it belongs to, never
transmitted anywhere else and never logged.

**Draft App Review notes** (paste into ASC; a reviewer cannot otherwise test
this feature):

> This app works fully offline and requires no account. Assistant features run
> on-device using Apple Foundation Models.
>
> Settings → Assistant → "Bring your own key" is an **optional** feature, off
> by default, that lets a user supply their own OpenAI or Anthropic API key.
> When enabled, the app calls that provider directly from the device using the
> user's key and the user's own billing relationship with that provider. We
> operate no server and receive no user data.
>
> Reviewing this feature requires a personal API key from OpenAI or Anthropic
> and is not necessary to evaluate the app — every other feature (adding,
> editing, categorising, budgeting, backup/restore) works with BYOK off.

## Quick-reference answers for ASC's App Privacy flow

| ASC question | Answer |
| --- | --- |
| Does this app collect data? | No — *we* collect nothing; see §1 for why BYOK doesn't change this, and §8 for what the app transmits |
| Contact Info / Financial Info / Location / Identifiers / Usage Data / Diagnostics / etc. | Not collected (skip all) |
| Does the app send data to third parties? | Only via opt-in BYOK (§8), to the user's own OpenAI/Anthropic account with the user's own key. **Must be disclosed in the privacy policy before submitting.** |
| Uses non-exempt encryption? | No — `ITSAppUsesNonExemptEncryption:false`; standard-algorithm (SQLCipher/AES), own-data-at-rest exemption. Confirm annual self-classification report applicability (see §2). |
| Uses Face ID / biometrics? | Yes — optional, user-enabled, for app unlock only |
| Minimum iOS version | 26.0 |
| Third-party analytics/ad SDKs | None |

## Follow-ups (out of scope for this ship, noted for the user)

- M5 parse edges (refund sign, amount upper bound, FM timeout) and M4
  (edit-triggers-backup) are real but not submission blockers — separate
  fast-follow per `docs/design/store-prep-spec.md`.
- M7 (single-currency-only) is an accepted design constraint, not a defect.
  **Currency-mismatch guard (added after this ship):** every balance/total/
  chart (`src/domain/balances.ts`, `src/domain/period.ts`) sums `tx.amount`
  currency-blind, so a transaction stored under a currency other than its own
  account's would silently corrupt that account's numbers. To keep that
  invariant true rather than merely assumed, `interpret()`/`interpretTransfer()`
  (`src/domain/assistant.ts`, decision in `src/domain/currencyConflict.ts`)
  never store an AI-parsed transaction under a currency that differs from its
  destination account's: when the model hears an explicit foreign currency
  (e.g. "5.45 USD" said into an SGD account), the account's own currency wins
  and the confirm card warns the user and requires them to re-enter the
  amount in that currency (via the card's existing Edit sheet) before Save is
  allowed — the same "ask, never convert" rule as M7 itself, so still no FX
  rate, rate table, or network call is ever introduced (guardrail #3). This
  does not make aggregations currency-aware or touch the separate (still
  out-of-scope) case of the *app's* currency setting itself drifting from
  already-stored rows — see `docs/design/currency-freeze-integrity-spec.md`.

# Privacy Policy

**The published policy is the authoritative one:**
<https://tssq.github.io/ProjectXavier/privacy.html>

That page is the URL given to App Store Connect and the one users read. Its
source is `privacy.html` on the **`gh-pages`** branch (under `docs/`, which is
the directory GitHub Pages is configured to build from — the files must stay
there or every Pages build errors).

## Why this file is a pointer and not a copy

A second copy of the policy in this branch would drift from the published one,
and two privacy policies with different wording raises the question of which
governs. Edit `gh-pages:docs/privacy.html` instead.

## What the policy must keep saying (verified against the code)

If you change the app's data handling, check these against the source before
updating the published page:

- **We collect nothing.** No server, no accounts, no analytics/ads/tracking SDKs.
- **Local data is encrypted at rest** (SQLCipher; key in the iOS Keychain).
- **Backups go only to the user's own iCloud container**, never through us.
- **Receipt images never leave the device.** OCR is Apple Vision via
  `modules/apple-ocr`; no image is sent to any engine.
- **BYOK is off by default** (`byok_enabled` is true only for the literal `'1'`,
  `src/features/settings/repository.ts`) and calls the provider **directly** from
  the device — `src/features/ai/engines/{openai,anthropic}.ts`,
  `src/features/ai/queryLoop.ts`, `src/features/ai/listModels.ts`.
- **BYOK requests include the user's account, payee and category names**, not
  just the typed text — see `CloudParseContext` in
  `src/features/ai/engines/shared.ts`. This is the detail most easily understated;
  the published policy names it explicitly, with an example.

See also `docs/design/app-store-submission.md` §8 for the App Review notes and
the App Privacy questionnaire answers.

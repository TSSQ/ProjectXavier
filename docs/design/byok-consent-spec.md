# BYOK consent prompt — spec

User decision 2026-10-20 ("Add consent prompt (Recommended)") for the v2.0.0 release.

## Objective
App Store guideline 5.1.2(i) requires clear disclosure and explicit permission before personal data is shared with a third-party AI. BYOK sends the user's request text (which can include transaction descriptions, payee/category names and amounts) to OpenAI or Anthropic. Today the "Use my own key" switch turns on with no prompt. Add an explicit, per-provider consent and make the parse path honour it.

## Approach
1. **Consent storage** (`src/features/settings/repository.ts`): `getByokConsent(provider): Promise<boolean>` / `setByokConsent(provider, on)`, stored as settings rows (e.g. `byok_consent_openai` = '1'), parameterised SQL via the existing `getSetting`/`setSetting`. Settings are not backed up (check how other BYOK settings behave and match them).
2. **Pure domain helper** (`src/domain/byokConsent.ts`, BDD-tested): `byokActive({ enabled, provider, consents }): boolean` — true only when enabled AND `consents[provider]` is true (indexed internally so a caller cannot pass another provider's consent). `consentCopy(provider)` returns `{ title, body, allow, cancel }`:
   - title: `Send expenses to ${ProviderName}?`
   - body: `When this is on, what you type to Xavier — plus your account, category and payee names, and for questions the matching transactions and balances — goes to ${ProviderName} using your own API key, under your account with them. Their terms and data retention apply, not ours. Xavier still works on-device if you turn this off.`
   - allow: `Allow`, cancel: `Not now`
3. **BYOK screen** (`app/settings/byok.tsx`):
   - Toggling ON: if not consented for the current provider, show `Alert.alert(title, body, [cancel (style 'cancel'), allow])`. Allow → `setByokConsent(provider, true)` then enable. Not now → the switch stays/reverts OFF. If already consented, enable directly.
   - Switching provider while enabled to a provider without consent: prompt the same way; Not now → revert to the previous provider (enabled state unchanged). Consent is per provider because the recipient company changes.
   - Toggling OFF never prompts and does NOT clear consent.
   - If enabled but the current provider has no consent (users upgrading from 1.2.1, which shipped BYOK without a prompt), show a visible notice row on the screen: "Xavier needs your permission before sending anything to {Provider}." with an "Allow…" button that opens the same alert.
   - Update the subtitle copy under "Use my own key" to say plainly that text is sent to the provider: e.g. "Off by default. When on, what you send Xavier — with your account, category and payee names — goes to {Provider} first; Xavier falls back to on-device parsing if it fails or you're offline."
4. **Parse path**: every place that decides to call a BYOK engine (`app/(tabs)/index.tsx:~1751` reads `getByokEnabled()`; find any others, e.g. query loop / `src/features/ai/*`, debug-byok excluded) must use `byokActive(...)` — no consent → behave exactly as if BYOK were off (on-device / heuristic ladder). No request may be made without consent. Model-list fetch and "Test key" send no user content and may run without consent.
5. Settings row (`app/(tabs)/settings.tsx:~498`, the BYOK entry): if enabled-but-unconsented, show "Needs permission" as its value/hint so upgraders discover it.

6. **Upgrader chat note**: when BYOK is enabled but the current provider has no consent, the empty-day hero shows the one-time note "Bring your own key is paused until you allow it in Settings → Bring your own key." (device-local seen flag `byok_paused_notice_seen`, set when the note leaves the hero).
7. **Debug screen** (`app/debug-byok.tsx`) honours `byokActive` too: no consent -> no request, and it shows why.

## Out of scope
Changing providers, models, key storage, privacy policy (already discloses BYOK), App Privacy answers.

## Acceptance criteria
- BDD feature `tests/__features__/byok-consent.feature`: byokActive truth table (enabled×consented); copy names the provider for both openai/anthropic; consent is per provider (openai consent does not activate anthropic).
- A source-level guard test: the parse-path file(s) that pick the BYOK engine reference `byokActive` (so a future refactor can't bypass consent).
- `npm run typecheck && npm run lint && npm test && npm run eval` green.
- No function-form `style`; zod at boundaries unchanged; parameterised SQL only. Remember NativeWind drops `ref` on function components (memory view-refs-null-at-onlayout) — avoid refs or use `cssInterop={false}`.

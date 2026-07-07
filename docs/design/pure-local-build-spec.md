# Build spec — Pure on-device build (no cloud parsing, no accounts)

_Branch: `claude/account-creation-spike` (worktree `.claude/worktrees/fm-spike`)._
_Decision 2026-07-07: this lineage becomes the App Store candidate. iOS 26+
(already the deployment target). Parse ladder becomes FM → heuristic. The
Supabase account is removed; the biometric unlock is the only gate. Non-FM
devices lean on /account, /transactions, quick-action chips, and manual entry._

## Objective
Make the app fully local: delete the cloud parse tier and the Supabase
sign-in, so no user data ever leaves the device ("Data Not Collected" App
Privacy posture). Preserve the biometric (Face ID) launch gate and every
existing local feature.

## Scope (in)
**Stage 1 — remove the cloud parse tier**
- `app/(tabs)/index.tsx` `runParse`: FM → heuristic only. Remove the
  `parseExpense` call block, `RateLimitedError`/`AiProxyNetworkError`
  handling, and quota-related reply strings.
- Delete `src/features/ai/client.ts`. Remove `EXPO_PUBLIC_AI_PROXY_URL` from
  `.env.example`.
- `DraftCard`'s `source` prop: drop `'cloud'` from the type (pill values left:
  On-device / heuristic). Do NOT touch `parse_metrics` row schema or
  `aggregate()` — historical `'cloud'` rows must keep aggregating.

**Stage 2 — remove the account / Supabase auth**
- `app/_layout.tsx`: drop `session`/`offlineGrace`/`authChecked` state, the
  `getSession`/`onAuthChange`/`markAuthed`/`hasAuthedBefore` wiring, and the
  `<SignIn />` branch. Gate order becomes: migrate → biometric unlock
  (`requireBiometricUnlock`, unchanged) → app. Keep the auto-backup listener,
  theme resolution, splash/error handling exactly as they are.
- Delete `src/features/auth/` (repository, SignIn), `src/lib/supabase.ts`,
  `src/domain/authGate.ts`, and the auth-gate BDD pair in `tests/`.
- `src/lib/secureStore.ts`: remove `hasAuthedBefore`/`markAuthed` (dead);
  keep `requireBiometricUnlock` and everything else.
- Settings screen: remove any account/sign-out row; keep the Face ID toggle.
- Remove `@supabase/supabase-js` from `package.json` (and lockfile via
  `npm install`). Remove Supabase URL/anon-key entries from `.env.example`.

**Store-prep ride-alongs (small)**
- `app.config.ts` `ios.infoPlist`: add `ITSAppUsesNonExemptEncryption: false`.
- Non-FM device UX: the heuristic-failure reply ("Couldn't parse that
  offline — please try again.") becomes a capability-honest nudge, e.g.
  "I couldn't parse that. Try \"/transactions lunch 12.50\", or add it
  manually below." Keep it one sentence-ish; the quick-action chips already
  surface /account.
- `CLAUDE.md` architecture guardrails: reword to match reality — #2 becomes
  "Biometric unlock (when enabled) gates the app before financial data
  renders"; #3 becomes "No online endpoints in the app; if any are ever
  added, they sit behind DDoS/WAF + rate limiting"; #5 becomes "No PII
  collected at all; all financial data stays on-device". #1, #4, #6 unchanged.

## Out of scope (do not touch/build)
- `supabase/functions/` and `backend/` — server code stays in the repo,
  unused (documents the cloud design for a future opt-in sync).
- The FM parse prompt/schema, grounding guards, transfers, OCR, heuristic
  parser logic — no behavior changes to any parse tier that remains.
- Deleting the Supabase project itself (ops, user's call).
- Onboarding/first-run redesign; app icon; store metadata/screenshots.
- The backup feature (already local/iCloud-container based).
- Renaming the branch.

## Approach notes
- `deviceParsePrompt.ts` mentions the cloud proxy only in comments — update
  the comments that claim it "mirrors the cloud proxy" to past-tense/reference
  form, don't change code.
- After deleting client.ts, grep for remaining imports (`parseExpense`,
  `RateLimitedError`, `AiProxyNetworkError`, `supabase`) — zero hits in
  `src/` and `app/` outside `supabase/functions` + `backend`.
- `runParse` after stage 1 reads: try FM (`runFmParse`) → on false, run
  heuristic (`runHeuristicParse`) → on false, the capability-honest failure
  reply. Preserve parse-metrics capture points for both remaining engines.
- First launch after this build on the user's device: they were previously
  signed in — nothing to migrate; the gate simply no longer asks. Verify no
  code path reads the session anywhere else (`rtk proxy grep -rn getSession`).

## Requirements / acceptance criteria
- [ ] `rtk proxy grep -rn "supabase\|parseExpense\|RateLimitedError\|AiProxyNetworkError" src/ app/` → no hits (comments referencing history are fine; imports/calls are not).
- [ ] `@supabase/supabase-js` gone from package.json + package-lock.
- [ ] App boots: splash → (Face ID if enabled) → assistant. No SignIn anywhere.
- [ ] `runParse` never issues a network request (verify by reading — no fetch
      remains in the parse path).
- [ ] Heuristic-failure reply mentions /transactions and manual entry.
- [ ] DraftCard still shows On-device / heuristic source pills.
- [ ] `ITSAppUsesNonExemptEncryption: false` present in app.config.ts.
- [ ] CLAUDE.md guardrails updated as specced.
- [ ] Auth-gate BDD removed; ALL remaining tests green; typecheck + lint green.
      (Test count will drop — that's expected; note the delta.)
- [ ] Simulator build compiles: `xcodebuild -workspace ios/ProjectXavier.xcworkspace -scheme ProjectXavier -configuration Debug -destination 'generic/platform=iOS Simulator' build`.
- [ ] Manual (build 17, device): fresh cold start lands in the app with no
      sign-in; FM parse works; Airplane-Mode parse works; Face ID toggle
      still gates when enabled.

## Constraints & conventions
- Framework-free domain rule unchanged. Theme tokens only. Parameterised SQL
  untouched. Guardrail #6 (zod-validate AI output) fully intact — the FM
  output validation chain must not be loosened.
- Two logical stages, but report as one diff; keep the work reviewable.
- Do NOT run `npx expo prebuild` — remove the JS dependency only; the iOS
  project needs no native changes for Supabase (it's pure JS).

## Edge cases & risks
- **Offline-grace deletion**: authGate existed to avoid locking users out
  offline. With no session gate at all, that whole failure class disappears —
  make sure no residual `hasAuthedBefore` check can block startup.
- **Backup auto-trigger** on background must survive _layout surgery.
- **First-frame flash**: keep the `authChecked`-equivalent sequencing so the
  app doesn't flash the assistant before the biometric gate resolves (the
  existing `unlocked` state already handles this — don't reorder).
- **parseMetrics `engine` values**: only 'on_device'/'heuristic' will be
  written going forward; the debug screen must not assume 'cloud' exists.
- **SignIn removal + expo-router**: SignIn was rendered from _layout (not a
  route), so no route table changes — verify nothing else imports it.

## Suggested handoff
> Use the implementer agent to build the spec at
> `docs/design/pure-local-build-spec.md` on `claude/account-creation-spike`
> (worktree `.claude/worktrees/fm-spike`). Then qa-tester on the diff, then
> reviewer. Then build 17 via the TestFlight pipeline for a 1-week soak;
> App Store submission follows if the soak is clean.

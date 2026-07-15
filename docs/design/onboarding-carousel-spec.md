# Spec: replace guided onboarding with a welcome carousel (build 39)

## Objective

The build-38 in-chat guided tutorial tested poorly: it blends into the real app
(no clear "this is a tutorial" frame → "not obvious") and it creates REAL data
mid-tutorial (a user copying the example makes a junk transaction → "misleading").
Decided with the user: **replace it with a short welcome carousel** — an
unmistakable first-run intro that explains the app and **creates zero data**,
then drops the user into the normal empty app to start for real when ready.

## Scope

**IN:**
1. **A welcome carousel** shown on first launch: 3–4 full-screen swipeable cards
   (see copy below), a page indicator, a persistent **Skip**, and **Get Started**
   on the last card. Dismissing (either button, or swiping past the end) sets the
   flag and reveals the normal app. Creates NO accounts/transactions/settings
   beyond the flag itself.
2. **Reuse the existing flag + Settings replay**: keep
   `onboarding_complete` (`src/features/settings/repository.ts`,
   already device-local in `DEVICE_LOCAL_SETTINGS_KEYS`). First-run gate:
   flag unset AND no accounts → show the carousel. Settings → "Replay tutorial"
   re-shows the carousel (explicit action, bypasses the no-accounts gate).
3. **Remove the guided flow entirely** (this is the bulk of the diff — a
   revert + delete): in `app/(tabs)/index.tsx`, remove the onboarding-aware
   branches added in build 38 to `onCreateAccount`, `onConfirm`, `onEditSave`,
   `onSend`, `onDiscardAccount`, the first-run `startOnboardingFlow` trigger in
   `loadContext`, the `onboardingActive`→`noOverlay` fold, and the
   `OnboardingProgress` component — restoring those handlers to their exact
   pre-build-38 behavior. Delete `src/domain/onboarding.ts` (the welcome→account
   →transaction state machine) and its tests
   (`tests/__features__/onboarding.feature`, `tests/__steps__/onboarding.steps.ts`).
   The `busy`-guard added to `onSend` in build 38 is a genuine improvement —
   KEEP it (it's independent of onboarding).

**OUT:**
- Any change to the real account/transaction/parse/confirm flows beyond removing
  the onboarding branches (they go back to exactly how they were).
- Creating sample/real data during onboarding (the whole point of the switch).
- M4/M5/M7, store submission.

## Approach (real paths)

### Carousel presentation
- A dedicated full-screen route/modal `app/welcome.tsx` (expo-router), shown
  ABOVE the tabs so it reads as a distinct intro, not part of the chat. It must
  appear only AFTER the existing `ready && unlocked` gate in `app/_layout.tsx`
  (same sequencing the app already enforces). Recommended: navigate to
  `/welcome` from the first-run check rather than an in-tree overlay, so the tab
  UI isn't half-visible behind it.
- First-run detection: on startup (after DB ready + unlock), if
  `!(await getOnboardingComplete())` AND `listAccounts()` is empty → present
  `/welcome`. Do this once (ref/flag guarded). Existing users (flag unset but
  accounts exist) and returning users (flag set) never see it.
- Get Started / Skip → `await setOnboardingComplete(true)` then dismiss to the
  assistant home. Swiping past the last card = Get Started.
- Settings "Replay tutorial" → `setOnboardingComplete(false)` is NOT needed;
  instead just navigate to `/welcome` directly (replay is explicit; it should
  show regardless of accounts, and re-setting the flag on finish is harmless).
  Simplest consistent rule: replay navigates to `/welcome`; finishing it sets
  the flag true again.

### Card content (pure + testable)
Put the ordered card list in a small framework-free module
`src/domain/onboardingCards.ts` (title + body + which visual), so a Node test can
assert the deck is well-formed (right count, no empty strings) — keeps
guardrail-compliant and lets copy be reviewed in one place. Cards (final copy,
tuned from `docs/design/app-store-listing.md`; adjust freely):

1. **Meet Xavier — just say it.** "Tell me what you spent — like *lunch 12.50 at
   Subway* — and I'll track it. No forms." (Xavier avatar/blob visual)
2. **Private by design.** "No account, no cloud, no tracking. Everything you
   enter stays on your iPhone, encrypted. Even backups go only to your own
   iCloud."
3. **See it at a glance.** "A Home Screen widget shows this month's income and
   expense — and hides it when your phone is locked. Add an optional Face ID lock
   anytime."
4. **You're set.** "That's it. Add your first account and start tracking — I'll
   help along the way." → **Get Started**.

### Visual
- Use the responsive scale system (`src/theme/useScaledType`, build 35) for text
  sizes; honor `useThemeColors()`; dark-first like the rest of the app.
- Reduced-motion respected for any card transition (match the app's existing
  motion handling).

## Acceptance criteria
1. **Node suite green** — `npm run typecheck && npm run lint && npm test`. Net
   test count will DROP (the onboarding state-machine tests are removed) — that's
   expected; add a small `onboardingCards` test (deck non-empty, each card has
   non-empty title+body) and keep the `backup-device-local` coverage of
   `onboarding_complete` (the flag survives). Report the new count.
2. **No data created by onboarding** — completing or skipping the carousel adds
   zero accounts/transactions; only `onboarding_complete` is written. (Verify by
   reading the carousel dismiss path.)
3. **Guided flow fully removed** — no references left to the deleted
   `src/domain/onboarding.ts`, `advanceOnboarding`, `OnboardingProgress`, or the
   onboarding branches in the five handlers; those handlers diff back to their
   pre-build-38 behavior (the `onSend` busy-guard stays).
4. **Gating** — fresh install (flag unset, no accounts) shows the carousel;
   existing users (accounts exist) and returning users (flag set) do not; Settings
   → Replay re-shows it.
5. **Device confirm (build 39):** fresh install → the carousel is obviously an
   intro, swipes through cleanly, Skip and Get Started both land in the normal
   empty app with NO junk data; Replay from Settings re-shows it; normal account/
   transaction creation afterward behaves exactly as before onboarding existed.

## Constraints
- Worktree `.claude/worktrees/fm-spike`; SSH; commit only this ship's files.
- `src/domain/**` stays framework-free (the card deck module is pure data).
- Removing the guided branches must not change ANY non-onboarding behavior —
  this is a revert-to-original for those handlers; verify against git history.

## Edge cases
- **Existing user upgrading (flag unset, has accounts):** no carousel (the
  no-accounts gate). They already know the app.
- **Face ID on first run:** carousel shows only after unlock (behind the same
  gate as everything else).
- **Kill mid-carousel:** flag only set on finish/skip; relaunch (still no
  accounts, flag unset) re-shows the carousel from card 1 — harmless, it's just
  an intro with no data at stake (this is exactly why carousel-with-no-data is
  simpler than the guided flow's kill-mid-onboarding problem).
- **Replay twice in a session:** navigating to `/welcome` each time must re-show
  it reliably (avoid the one-shot deep-link-ref idiom that made build-38 replay
  device-uncertain — a direct route push re-mounts, so it should just work; note
  for device verification).

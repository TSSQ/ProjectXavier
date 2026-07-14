# Spec: first-run guided onboarding (Xavier walks you through real setup)

## Objective

A brand-new user opens the app to an empty assistant screen and a blank
composer, and hesitates: *what do I type? what do I set up first?* Give them a
**first-run guided tutorial where Xavier walks them through the real setup
chain** — create their first account, add their first transaction, and see the
payee + category get captured — using the *actual* app flows, not a separate
demo. They finish onboarding with real data already in place and confidence in
the core loop.

Recommended style (decided with the user): **Xavier-guided, learn-by-doing**,
run inside the existing assistant chat (the home screen already IS Xavier's
conversation), not a separate slideshow — the tutorial IS the product.

## Scope

**IN:**
1. **First-run detection + gating.** A persisted `onboarding_complete` flag
   (settings table, device-local — must NOT travel in backup; add to
   `DEVICE_LOCAL_SETTINGS_KEYS` in `src/domain/backupPolicy.ts`). On first
   launch after the DB is ready and (if enabled) unlock passes, if the flag is
   unset AND there are no accounts yet, start the guided flow.
2. **The guided sequence** (Xavier-driven messages in the existing assistant
   thread, advancing as the user completes each real step):
   - **Welcome + privacy beat** — one short Xavier message: who he is, "tell me
     what you spent and I track it — everything stays on your phone, no account,
     no cloud." Sets the tone and lands the privacy hook.
   - **Step 1 — create your first account.** Xavier prompts the user to add an
     account and launches the EXISTING account Q&A flow
     (`src/domain/accountAssistant.ts` → name → subtype → opening balance →
     confirm card → `createAccount`). This is real; the account persists.
   - **Step 2 — add your first transaction.** Xavier prompts "now tell me
     something you spent — like 'lunch 12.50 at Subway'." The user types; the
     real parse pipeline runs; the confirmation card shows. Xavier points out
     what happened: the amount, the **payee** it captured (e.g. "I saved
     'Subway' as a payee"), and the **category** it proposed — teaching those
     concepts on the user's own real entry. On confirm, the transaction
     persists.
   - **Wrap** — a short Xavier message: where to find totals/accounts, the
     **widget** (month totals, hidden when locked), optional **Face ID** lock,
     and **iCloud backup** — one line each, no forced steps. Marks
     `onboarding_complete`.
3. **Always escapable.** A visible "Skip tutorial" affordance at every step;
   skipping sets `onboarding_complete` and drops the user into the normal empty
   assistant (no trapped state, nothing half-created is left broken).
4. **Replayable.** A "Replay tutorial" (or "Show intro again") row in Settings
   that clears the flag / re-triggers the guided sequence.
5. **Progress sense.** A lightweight indicator of where they are in the 2 real
   steps (e.g. "Step 1 of 2" like the existing account-flow dots), so it feels
   bounded.

**OUT (explicit):**
- Rebuilding account creation, parsing, payee/category capture, the confirm
  card, the widget, Face ID, or backup — the tutorial DRIVES these existing
  flows, it does not reimplement them.
- A sandbox/demo mode — steps create the user's REAL first account + transaction
  (that's the point: they end set up, not with throwaway data to delete). Each
  step is skippable, so nothing is forced.
- Gamification, confetti, multi-currency, per-feature deep tutorials.
- Coach-mark overlays on arbitrary screens (we stay in the assistant chat).

## Approach (real paths)

- **Pure onboarding brain** in `src/domain/` (framework-free, Node-testable) —
  e.g. `src/domain/onboarding.ts`: a small state machine
  `OnboardingStep = 'welcome' | 'account' | 'transaction' | 'done'` with a pure
  `advanceOnboarding(state, event)` (event = accountCreated | transactionSaved |
  skipped) returning `{ state, message }`, mirroring the shape of
  `accountAssistant.ts`. All the copy + step logic lives here and is BDD-tested;
  no RN. This keeps guardrail-compliant (domain stays framework-free).
- **Flag persistence** in `src/features/settings/repository.ts`:
  `getOnboardingComplete()` / `setOnboardingComplete()` (default false when
  unset), analogous to the biometric-lock accessor. Key `onboarding_complete`.
  Add the key to `DEVICE_LOCAL_SETTINGS_KEYS` (backupPolicy) so a restore never
  suppresses onboarding on a fresh device incorrectly / never carries it.
- **Wiring** in `app/(tabs)/index.tsx` (the assistant screen) + `app/_layout.tsx`
  startup: on first run (flag unset && no accounts), the assistant seeds
  Xavier's welcome message and enters onboarding; completing the real account
  flow emits `accountCreated`, a saved transaction emits `transactionSaved`,
  each advancing the pure state machine. Reuse the existing account-flow and
  parse/confirm wiring — onboarding only orchestrates + narrates.
- **Settings replay** row in `app/(tabs)/settings.tsx` calling
  `setOnboardingComplete(false)` (+ navigate to the assistant tab).

## Acceptance criteria
1. **Node suite green**, with new BDD coverage for the pure brain
   (`src/domain/onboarding.ts`): first-run starts at `welcome`; the sequence
   advances welcome→account→transaction→done on the right events; `skipped`
   from any step goes to `done`; the flag defaults false and the device-local
   exclusion lists include `onboarding_complete` (both gather-strip and
   apply-skip directions).
2. **First-run behavior (device):** a fresh install (no accounts, flag unset)
   opens into Xavier's guided welcome → account creation (real account persists)
   → first transaction (real, payee + category called out) → wrap; the app is
   then in its normal state with that account + transaction present.
3. **Skip:** skipping at any step lands in the normal empty assistant, flag set,
   nothing half-created broken.
4. **Replay:** the Settings row re-runs the guided sequence.
5. **Returning users unaffected:** anyone with the flag set (or with existing
   accounts) never sees onboarding; existing users on upgrade are treated as
   already-onboarded (flag unset BUT accounts exist → don't trigger).
6. **Backup:** `onboarding_complete` is excluded from backup create AND restore
   (device-local), so restoring on a new device doesn't wrongly skip/trigger it.

## Constraints
- `src/domain/**` stays framework-free (the onboarding brain + copy are pure,
  Node-tested); native/RN wiring lives in `app/**` and `src/features/**`.
- Do NOT alter the account Q&A, parse, confirm-card, widget, Face ID, or backup
  internals — orchestrate only.
- Respect the responsive scale system already in place (build 35) for any new
  text/controls.
- No new PII, no network — onboarding is fully local.

## Edge cases
- **Existing user, upgrade:** flag unset but accounts exist → skip onboarding
  (criterion 5) so we never re-onboard someone mid-use.
- **User skips account step but does the transaction:** transaction needs an
  account — if none exists, the transaction step must first ensure an account
  (fall back to a minimal default account, or gate the transaction step behind
  having ≥1 account). Decide in implementation; simplest: transaction step is
  only reachable after an account exists, else Xavier nudges back to step 1.
- **Face ID enabled first-run:** onboarding starts only AFTER unlock (it lives
  behind the gate, same as the rest of the app).
- **Non-Apple-Intelligence device:** the transaction step still works — the
  heuristic parser handles "lunch 12.50"; if parsing genuinely fails, the
  confirm card / manual entry path still lets them complete the step.
- **Kill mid-onboarding (graceful degrade, not mid-chat resume):** mid-chat
  resume of a conversational tutorial is fragile (re-seeding messages, restoring
  sub-flow state) and not worth it. Instead: `onboarding_complete` is set to
  `true` **as soon as the first account is created** (the `accountCreated`
  event) as well as at done/skip. So if the app is killed after step 1, relaunch
  finds the flag `true` → the user lands in the **normal app with their real
  account already there**, and can re-run the tutorial from Settings → Replay.
  No one is ever stuck with the flag `false` forever, and this stays
  distinguishable from a returning user (who has the flag set too / has
  accounts). Before any account exists (welcome step), a kill leaves the flag
  unset + no accounts → onboarding correctly restarts fresh next launch.

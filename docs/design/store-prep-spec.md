# Spec: App Store submission prep (metrics-off candidate + disclosure/config)

Closes the remaining store-blocking items from the 2026-07-12 assessment so the
build can be submitted honestly. The four Highs, M3, Face ID opt-in, and the
settings-backup fix are already shipped + on `main`; this ship produces the
**submission candidate binary (build 36, metrics OFF)** and closes the disclosure
and config gaps that would otherwise make the App Privacy answers dishonest or
trip App Review.

Two product forks decided with the user (2026-07-14):
- **Widget totals** → redact when locked via `.privacySensitive()` (visible on
  the unlocked home screen, blurred on lock screen / StandBy).
- **Export compliance** → keep `ITSAppUsesNonExemptEncryption: false` (SQLCipher
  is local-data-protection encryption → Apple export exemption).

Config/disclosure-shaped work with the only real forks already answered → spec
auto-passes; going straight to implement.

## Scope

**IN:**
1. **Metrics-off candidate** — build 36 archived WITHOUT `EXPO_PUBLIC_METRICS`.
   `METRICS_ENABLED` (`src/lib/flags.ts`) is already `__DEV__ || env==='1'`, so a
   plain Release build compiles every metrics write to a no-op and hides the
   Settings → Developer section (`app/(tabs)/settings.tsx:328`). This is the
   defining property of the build, verified at the /build step and on device.
2. **Guard debug routes against deep links** — `app/debug-fm.tsx`,
   `app/debug-ocr.tsx`, `app/debug-metrics.tsx`, `app/debug-avatar.tsx`: when
   `!METRICS_ENABLED`, short-circuit to `<Redirect href="/" />` at the top of the
   component so `projectxavier://debug-fm?autorun=1&text=…` is inert in
   production. The Settings rows are already METRICS-gated; this closes the
   deep-link surface (assessment Low: "debug routes ship deep-linkable in
   release").
3. **Widget lock-screen redaction (M6)** — add `.privacySensitive()` to the
   value `Text` in `MoneyRow` (`targets/widget/XavierWidget.swift:164`) so the
   income/expense numbers auto-blur on the lock screen / StandBy and render
   normally on the unlocked home screen. Closes the "widget shows financial data
   with no auth" disclosure gap.
4. **Honest Face ID usage string** — add `NSFaceIDUsageDescription` to
   `ios.infoPlist` in `app.config.ts` (replaces the generic
   expo-local-authentication default) with an honest purpose string.
5. **`appleTeamId`** — add `ios.appleTeamId: 'CFVNU6RD8C'` to `app.config.ts` to
   clear the expo-doctor flag (16/18 → 17/18). Verify it's the field expo-doctor
   wants; if the check is really about something else, note the true delta.
6. **Document the export-compliance call** — keep `ITSAppUsesNonExemptEncryption:
   false`, add a comment in `app.config.ts` recording the exemption rationale.
7. **Submission answers doc** — `docs/design/app-store-submission.md`: the App
   Privacy questionnaire (= **Data Not Collected**), export-compliance = exempt,
   opt-in Face ID, plaintext-SQLite-backup-in-user's-own-iCloud disclosure, iOS
   26+ / Foundation Models availability note. Supersedes the stale "plaintext
   JSON backup" line in the `pure-local-store-direction` memory.

**OUT:**
- M5 parse edges (refund sign, amount upper bound, FM timeout) and M4
  (edit-triggers-backup) — real bugs but not submission blockers; separate
  fast-follow.
- M7 currency mixing (accepted single-currency design).
- The actual App Store Connect submission (needs the user in ASC; this ship
  produces the binary + the answer sheet, not the submit click).

## Approach (concrete)

### Debug-route guard (`app/debug-*.tsx`)
At the top of each of the four debug screen components:
```tsx
import { Redirect } from 'expo-router';
import { METRICS_ENABLED } from '../src/lib/flags';
// …
if (!METRICS_ENABLED) return <Redirect href="/" />;
```
Keep the existing hidden Settings-row entry points (already METRICS-gated) as-is.

### Widget (`targets/widget/XavierWidget.swift`)
On the value `Text` inside `MoneyRow` (the `"\(sign)\(formatMinorUnits(…))"`
line, ~164):
```swift
Text("\(sign)\(formatMinorUnits(minor, currency: currency))")
  .font(.system(size: 12, weight: .semibold))
  .foregroundStyle(color)
  .privacySensitive()      // blur on lock screen / StandBy; visible unlocked
  .lineLimit(1)
  .minimumScaleFactor(0.7)
```
Labels ("Income"/"Expense"/"THIS MONTH") stay visible — only the amounts are
sensitive. Launcher side and accessories unchanged.

### `app.config.ts` (`ios.infoPlist` + `ios`)
- Add to `infoPlist`:
  `NSFaceIDUsageDescription: 'ProjectXavier uses Face ID to unlock the app so only you can see your finances.'`
- Add `appleTeamId: 'CFVNU6RD8C'` to the `ios` block.
- Add a comment next to `ITSAppUsesNonExemptEncryption: false` documenting the
  exemption (local data-protection encryption, user's own on-device data).

### Submission doc (`docs/design/app-store-submission.md`)
App Privacy → Data Not Collected, with the reasoning tied to code evidence (zero
network call sites, no analytics SDKs, metrics prod-off + content-free buckets,
backups to the user's own iCloud container only). Export compliance = exempt.
Opt-in Face ID. iOS 26+. Foundation Models availability fallback (heuristic →
manual entry). This is the sheet the user answers ASC from.

## Acceptance criteria
1. **Node suite green** — `npm run typecheck && npm run lint && npm test`. No
   domain logic changes, so 519 tests stay green. (Note: `__DEV__` is `true`
   under jest, so the guard's `!METRICS_ENABLED` branch isn't Node-reachable —
   verify by reading + device; a sanity assertion that `METRICS_ENABLED` is a
   boolean is enough at the Node layer.)
2. **Build 36 is metrics-off** — archived with NO `EXPO_PUBLIC_METRICS`; the
   /build step and device confirm that Settings shows no Developer section.
3. **Widget compiles** with `.privacySensitive()`; appex present + signed
   (verified in the IPA check).
4. **Debug deep link inert** — `projectxavier://debug-fm?autorun=1&text=x` in the
   release build redirects home, runs no parse (device confirm).
5. **Config** — `NSFaceIDUsageDescription` present + honest; `appleTeamId` set;
   export-compliance comment present; submission doc complete and accurate.

## Device confirm (build 36)
1. Settings shows **no** Developer rows.
2. Open `projectxavier://debug-fm?autorun=1&text=lunch%2012.50` — nothing runs,
   lands on home.
3. Lock the phone (or StandBy) with the medium widget on screen → income/expense
   **blurred**; unlock on the home screen → numbers **visible**.
4. Enabling Face ID in Settings shows the **honest** reason string.

## Constraints
- Worktree `.claude/worktrees/fm-spike` only; SSH remote; commit only this ship's
  named files.
- No domain-layer change (nothing to keep framework-free here).
- Do not touch the responsive-scaling / Face ID / backup code already on `main`.

## Edge cases
- **`__DEV__` under jest** → guard false-branch not Node-testable; rely on read +
  device (criterion 1 note).
- **`.privacySensitive()` scope** — only redacts in "private" contexts (lock
  screen, StandBy, Screen Time); the unlocked home-screen widget still shows
  numbers, which is intended.
- **`NSMicrophoneUsageDescription`** — the assessment (build 27) saw one injected
  by expo-image-picker, but its config plugin isn't registered here. Check the
  prebuilt `ios/…/Info.plist`: if a mic string is present, strip it (App Review
  dislikes unused purpose strings); if absent, note it and move on.
- **`appleTeamId` field** — if expo-doctor's check isn't actually this field,
  don't invent config; report the real remaining doctor items instead.

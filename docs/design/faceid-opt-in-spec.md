# Spec: make the Face ID app-lock opt-in (default OFF, enable-gated on a real auth)

Decided with the user (thinking-partner discussion, 2026-07-13). Not from the
assessment — a first-run UX/safety fix the user raised.

## Objective

Today the biometric app-lock (`biometric_lock`) **defaults ON**
([settings/repository.ts:88](src/features/settings/repository.ts#L88):
`v == null ? true`) and is the only gate. On a fresh install the app prompts
Face ID before the user has opted into anything, which creates two hazards:
1. **Lockout / dead-end** — a user who declines the iOS Face ID *permission*
   prompt gets `authenticateAsync` failure → `setUnlocked(false)` → stuck on the
   locked splash, on an app they never chose to lock.
2. **Silent bypass** — a user with no biometrics enrolled hits
   `requireBiometricUnlock`'s `!hasHardware || !enrolled → return true`
   ([secureStore.ts:30](src/lib/secureStore.ts#L30)) and the app just opens with
   no gate (assessment M1).

Fix: make the lock **opt-in** (default OFF) and only ever let it be turned ON
after a **successful biometric check**, so it can only be enabled when
biometrics actually work. The DB is already encrypted at rest (H4), so "off by
default" is not "unprotected" — it just means the app doesn't gate someone who
already has the *unlocked* phone until the user asks it to.

## Approach

### 1. Default OFF (`src/features/settings/repository.ts`)
- `getBiometricLock()`: change the unset default from `true` to **`false`**
  (`const on = v == null ? false : v === '1'`). Update the doc comment (it
  currently says "defaults ON, preserving the always-prompt behaviour").
- `getBiometricLockCached()` semantics unchanged (null until first read/write).

### 2. Enable-gate the Settings toggle (`app/(tabs)/settings.tsx`)
- Initial `useState` for the toggle → `false` (it's overwritten by the
  `getBiometricLock()` read on mount regardless, but keep the default honest).
- `onToggleBiometricLock(v)`: when turning **ON** (`v === true`), FIRST run a
  live biometric check (`requireBiometricUnlock()` from `src/lib/secureStore.ts`)
  and only `setBiometricLock(true)` + flip the UI state if it **succeeds**. On
  failure/cancel, leave the toggle OFF and do not persist (optionally show a
  brief inline note like "Couldn't verify — Face ID not enabled"). Turning
  **OFF** persists immediately (no auth required to reduce protection — matches
  iOS norms; the app is already unlocked at this point).
- Guard against the in-flight prompt racing (reuse/mirror the existing
  `promptInFlightRef` pattern in `_layout.tsx` if needed).

### 3. Startup (`app/_layout.tsx`) — verify, likely no change
- Startup already does `const bioLock = await getBiometricLock(); if (bioLock) …
  runUnlockPrompt()`. With the new default `false`, a fresh install returns
  false → **no prompt on first launch**. Confirm nothing else force-prompts.
- The AppState re-lock path (`getBiometricLockCached() ?? bioLockRef.current`)
  also correctly no-ops when off. Verify.

### 4. M1 fallback — keep as an anti-lockout safety valve (scope note)
`requireBiometricUnlock`'s `!hasHardware || !enrolled → return true` stays.
Rationale: if the lock is ON but biometrics later become unavailable (user
removed Face ID), returning `true` (open) is the only thing preventing a
permanent lockout. With enabling now gated on a working auth, this branch is
only reachable in that rare "enabled then removed biometrics" case, so the
silent-bypass surface is drastically narrowed. Fully closing M1 (disclose /
re-prompt on that transition) is a separate, later item — OUT of scope here.

### 5. Copy / privacy note
Update any copy that implies the app is locked by default; the App Privacy /
store answer should state the biometric lock is **opt-in**. (Docs/answer only —
flag it; no store submission in this ship.)

## Acceptance criteria

1. **Node suite green** (`npm run typecheck && npm run lint && npm test`).
   Unit-test the pure part: `getBiometricLock()` returns `false` when the
   setting is unset, `true`/`false` for `'1'`/`'0'`. Adjust any existing test
   that assumed the ON default.
2. **Enable-gating (verify by reading + device):** toggling the Settings lock
   ON calls `requireBiometricUnlock()` and only persists ON on success; a
   declined/failed check leaves it OFF and unpersisted. (Native auth — not
   Node-testable; verify wiring, confirm on device.)
3. **Device confirm (build 33):** a fresh install does NOT prompt Face ID on
   first launch and opens straight to the app; enabling the lock in Settings
   prompts Face ID and only sticks if it succeeds; with the lock ON, relaunch
   prompts as before; declining the enable prompt leaves it OFF (no lockout).

## Constraints
- `src/domain/**` stays framework-free; the auth call lives in the features/lib
  layer as today.
- No change to what `requireBiometricUnlock` does on a real unlock beyond the
  default; the H1/H4/M3 backup + DB paths are untouched.
- Guardrail #2 wording (CLAUDE.md: "Biometric unlock (when enabled) gates the
  app") already says "when enabled" — this change makes the default match that
  wording; keep it accurate.

## Edge cases
- **Existing users who had it ON** (setting == '1'): unaffected — they keep the
  lock (the default only changes the *unset* case).
- **Existing users who had explicitly turned it OFF** ('0'): unaffected.
- **Decline the enable prompt:** toggle returns to OFF, nothing persisted, app
  stays usable.
- **Biometrics removed after enabling:** launch hits the `!enrolled → return
  true` valve and opens (no lockout); acceptable, narrowed M1.
- **Turning OFF while the app is open:** persists immediately, no auth needed.

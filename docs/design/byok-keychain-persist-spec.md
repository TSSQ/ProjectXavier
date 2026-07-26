# BYOK key never persists on device — keychain accessibility + verify-on-save

## Objective
Make a saved BYOK API key actually persist on a real device so the cloud parse
can use it. Today the key round-trips fine in the iOS Simulator but **never
persists on a signed device build**, so every real parse falls back to
on-device/heuristic and the user sees Xavier's "confused" (clarify) face —
even though the "Test key" button reports success.

## Confirmed root cause (reproduced on-device, not hypothesised)
Diagnosed with an on-device probe (`app/debug-byok.tsx`) + the user's own device
report. The chain:

1. **"Test key" reads the *in-memory pasted* key, not the keychain.**
   `onTestKey` (app/settings/byok.tsx) uses `candidate || (await getByokKey())`
   where `candidate` is the text currently in the field. So a paste-then-test
   succeeds **without the keychain ever being involved** → "connection test
   succeeded".
2. **The real parse reads the *keychain* key.** `runParse`
   (app/(tabs)/index.tsx) → `getByokKey(provider)` → `getSecret` →
   `SecureStore.getItemAsync`. On the user's device this returns `null` because
   the save never persisted, so `resolveByokEnabled` is false and
   `routeEngines` drops the provider → on-device/heuristic → confused face.
   Every time.
3. **The keychain write silently fails for the BYOK key specifically.** The user
   confirms: after Save, the field clears (by design) but "A key is saved on
   this device" never appears, on every attempt.
4. **The differentiator is the accessibility attribute.** Same `expo-secure-store`
   native module, same device:
   - SQLCipher DB key — `src/db/encryptionKey.ts`,
     `keychainAccessible: AFTER_FIRST_UNLOCK` — **works** (the app opens the
     encrypted DB on every launch).
   - BYOK key — `src/lib/secureStore.ts`,
     `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` — **does not persist**.

   The app's *most* sensitive secret (the DB encryption key) already uses
   `AFTER_FIRST_UNLOCK` successfully on the same device; only the BYOK key uses
   `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, and only the BYOK key fails.

On-device probe evidence (Debug sim, where the keychain *does* work): with a key
present, the live Anthropic call returns http 200 and the full pipeline yields a
`confirm` — so the transport/pipeline (build 45's raw-fetch fix) are correct.
The remaining defect is purely **key persistence**. NB: this could not be
reproduced in the Simulator (its keychain is permissive and persists either
accessibility) — hence acceptance criterion #5 (verify-on-save) as a hard safety
net so a device write failure can never again be silent.

## HARD CONSTRAINT — never affect the App Store version
- ALL work on `claude/phase2-byok` in worktree `.claude/worktrees/fm-spike`.
- NEVER commit/push/merge/FF/cherry-pick to `main` (build 42, the store binary).
- Do not touch the SQLCipher DB key path (`src/db/encryptionKey.ts`) — it works;
  we're aligning BYOK *to* it, not changing it.

## Scope
IN:
- `src/lib/secureStore.ts`: change the BYOK keychain accessibility from
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` to `AFTER_FIRST_UNLOCK` — exactly matching the
  proven-working DB-key config. (These helpers are used ONLY by
  `src/features/ai/byokKey.ts` — grep-confirmed — so nothing else is affected.)
- `src/features/ai/byokKey.ts`: `setByokKey` must **verify persistence** — write,
  then read back; if the read-back doesn't match, throw a typed error
  (`ByokKeyPersistError` or similar) so the caller can surface it. Update the
  doc comment that references `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- `app/settings/byok.tsx`: `onSaveKey` must set `keySaved = true` ONLY after a
  verified save. On a persist failure, show a clear inline error (e.g. "Couldn't
  save your key to this device's keychain — please try again") and leave
  `keySaved` false. No more optimistic success.
- Tests (`tests/`): the pure/domain-testable parts — the verify-on-save contract
  (write→readback→mismatch→throws), and that a failed save does not report
  success. Use a fake secret store to simulate a write that doesn't persist.
- `app/debug-byok.tsx`: keep the on-device BYOK probe (companion to
  `app/debug-fm.tsx`, METRICS-gated, deep-link autorun) — it's how this class of
  bug is diagnosed and how the fix is verified on-device.

OUT (explicitly not this ship):
- The raw-fetch transport (build 45) — already correct (proven http 200 →
  confirm on-device).
- `parseRouter.ts` / the `isOnline()` gate — investigated and ruled out
  (`isOnline()` returns true on-device; the router logic is correct).
- `secureTextEntry` on the key field — investigated; paste works correctly in
  the sim, so it is NOT the bug. Leave it.
- Any migration of an already-stored key: the user has no persisted key (that's
  the bug), so there is nothing to migrate. A first successful save fixes them.
- `main`, build 42, the App Store submission.

## Approach (concrete)

### 1. Accessibility (the root-cause fix)
`src/lib/secureStore.ts`:
```ts
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,   // was WHEN_UNLOCKED_THIS_DEVICE_ONLY
};
```
Rationale: matches `src/db/encryptionKey.ts`, which is proven to persist on the
user's device. Update the file/`byokKey.ts` doc comments accordingly (they
currently justify `WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Security note: the DB
encryption key (more sensitive) already uses `AFTER_FIRST_UNLOCK`, so this is
consistent with the app's established model; the BYOK key remains
device-Keychain-only, never in the DB/backup/JS bundle. (`AFTER_FIRST_UNLOCK`
drops the `THIS_DEVICE_ONLY` restore-isolation that the DB key also forgoes;
acceptable for the user's own API key and required to match the known-good
config. If review prefers to keep device-only isolation, use
`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` instead — either changes the failing
`WHEN_UNLOCKED` dimension; pick one and note it.)

### 2. Verify-on-save (the safety net — makes any future failure visible)
`src/features/ai/byokKey.ts`:
```ts
export async function setByokKey(provider: ByokProvider, key: string): Promise<void> {
  await setSecret(KEYCHAIN_KEY[provider], key);
  const readBack = await getSecret(KEYCHAIN_KEY[provider]);
  if (readBack !== key) {
    throw new ByokKeyPersistError();   // never logs the key
  }
}
```
The error carries NO key material. `onSaveKey` catches it and surfaces a
non-secret message; it does not set `keySaved`.

### 3. Surface the failure in Settings
`app/settings/byok.tsx onSaveKey`: wrap in try/catch; on success set
`keySaved = true` (as today) AND it's now genuinely verified; on
`ByokKeyPersistError` set a visible error state and keep `keySaved = false`.

## Acceptance criteria
1. `src/lib/secureStore.ts` uses `AFTER_FIRST_UNLOCK` (or
   `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) for BYOK; matches/justified against the
   DB-key config.
2. `setByokKey` writes-then-reads-back and throws a typed, key-free error if the
   value didn't persist.
3. `onSaveKey` shows "A key is saved on this device" ONLY after a verified save;
   on failure it shows a clear inline error and `keySaved` stays false.
4. The key / auth header / request+response body are never logged or thrown
   (guardrail #5). `ByokKeyPersistError` contains no key material.
5. Sim verification (main agent, after the pipeline): save a real key via the
   Settings UI → "A key is saved" appears AND the on-device `debug-byok` probe
   shows `hasKey=true` + a real Anthropic parse of "40$ on lunch at starbucks"
   → `interpret.kind = confirm` (NOT just Test-key). This is the gate that was
   skipped for build 45.
6. `npm run typecheck && npm run lint && npm test` green; new Node tests cover
   the verify-on-save contract (persisted → ok; not-persisted → throws) with a
   fake store.
7. `main` untouched; diff entirely on `claude/phase2-byok`.

## Constraints
- Guardrail #5 (no key/PII logging; the key never leaves the device Keychain).
- Domain/pure logic stays Node-testable; the SecureStore call is the only native
  edge and is isolated behind `secureStore.ts`.

## Edge cases
- Read-back returns `null` (write silently no-op'd) → treated as failure → throws
  → user sees the error, not a false success.
- Read-back returns a *different* value → failure (paranoia; shouldn't happen).
- `deleteByokKey`/`getByokKey` unchanged in contract; only `setByokKey` gains
  verification.
- Empty/whitespace key already guarded upstream (`onSaveKey` early-returns).

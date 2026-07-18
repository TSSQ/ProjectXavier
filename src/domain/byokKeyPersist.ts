/**
 * Pure, framework-free verify-on-save contract for the BYOK API key
 * (docs/design/byok-keychain-persist-spec.md). Confirmed on-device: a
 * Keychain write can silently no-op depending on its accessibility attribute
 * (src/lib/secureStore.ts), so a saved key must never be reported as saved
 * without actually reading it back. `setAndVerifySecret` is store-agnostic
 * (a `SecretStore` is just get/set) so this stays testable in the plain-Node
 * BDD suite without touching expo-secure-store; src/features/ai/byokKey.ts
 * wires it to the real Keychain-backed store.
 */

/** Thrown by `setAndVerifySecret` when a write didn't actually persist.
 *  Carries NO key material — only a generic, user-facing message. */
export class ByokKeyPersistError extends Error {
  constructor() {
    super("Couldn't save your key to this device — please try again.");
    this.name = 'ByokKeyPersistError';
  }
}

/** The minimal secret-store shape `setAndVerifySecret` needs — matches
 *  src/lib/secureStore.ts's `setSecret`/`getSecret`. */
export interface SecretStore {
  setSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<string | null>;
}

/**
 * Write `value` to `store` under `key`, then read it back. Resolves only if
 * the read-back matches exactly; otherwise throws `ByokKeyPersistError`
 * (read-back `null` — the write silently no-op'd — or any other mismatch are
 * both treated as failure). ANY error thrown/rejected by the store itself
 * (e.g. a real expo-secure-store call rejecting rather than silently
 * no-op'ing — a real on-device failure mode) is also normalized to
 * `ByokKeyPersistError`, so every Keychain failure mode surfaces uniformly
 * and key-free, never as a raw/unhandled error.
 */
export async function setAndVerifySecret(
  store: SecretStore,
  key: string,
  value: string
): Promise<void> {
  try {
    await store.setSecret(key, value);
    const readBack = await store.getSecret(key);
    if (readBack !== value) {
      throw new ByokKeyPersistError();
    }
  } catch (e) {
    if (e instanceof ByokKeyPersistError) throw e;
    throw new ByokKeyPersistError();
  }
}

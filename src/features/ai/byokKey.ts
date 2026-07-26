/**
 * BYOK (bring-your-own-key) storage — the user's own OpenAI/Anthropic API
 * key, one Keychain entry per provider via src/lib/secureStore.ts
 * (`AFTER_FIRST_UNLOCK` — docs/design/byok-keychain-persist-spec.md; was
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, which was confirmed to silently fail to
 * persist on a real device). The key NEVER touches the DB, the settings
 * table, or the JS bundle — only the non-secret config (enabled, provider,
 * per-provider model) lives in settings
 * (src/features/settings/repository.ts), and that config is itself excluded
 * from backups via DEVICE_LOCAL_SETTINGS_KEYS (src/domain/backupPolicy.ts).
 * The Keychain item itself is `AFTER_FIRST_UNLOCK` (backup-eligible, same as
 * the SQLCipher DB key) — it is the user's own credential.
 * No per-read biometric prompt is added here — that would gate every single
 * parse, which the spec explicitly rules out; `AFTER_FIRST_UNLOCK` already
 * means the key is unreadable until the device has been unlocked at least
 * once since boot.
 *
 * `setByokKey` verifies persistence (write, then read back) via
 * src/domain/byokKeyPersist.ts's `setAndVerifySecret`, so a Keychain write
 * that silently no-ops can never be reported as a successful save — see
 * `ByokKeyPersistError`.
 */
import { getSecret, setSecret, deleteSecret } from '../../lib/secureStore';
import { ByokProvider } from '../../domain/parseRouter';
import { setAndVerifySecret, ByokKeyPersistError } from '../../domain/byokKeyPersist';

export { ByokKeyPersistError };

const KEYCHAIN_KEY: Record<ByokProvider, string> = {
  openai: 'byok_key_openai',
  anthropic: 'byok_key_anthropic',
};

/** The saved API key for `provider`, or null if none is stored. */
export async function getByokKey(provider: ByokProvider): Promise<string | null> {
  return getSecret(KEYCHAIN_KEY[provider]);
}

/** Save (overwrite) the API key for `provider`. Verifies the write actually
 *  persisted (reads it back); throws `ByokKeyPersistError` (no key material)
 *  if it didn't. */
export async function setByokKey(provider: ByokProvider, key: string): Promise<void> {
  await setAndVerifySecret({ setSecret, getSecret }, KEYCHAIN_KEY[provider], key);
}

/** Delete the saved API key for `provider` — used by Settings' "Remove key",
 *  which must clear the Keychain entry itself, not just flip a flag. */
export async function deleteByokKey(provider: ByokProvider): Promise<void> {
  await deleteSecret(KEYCHAIN_KEY[provider]);
}

/** Whether a (non-empty) key is currently saved for `provider` — used to
 *  resolve the effective BYOK "enabled" state (see
 *  src/domain/parseRouter.ts's resolveByokEnabled): a config saying "on"
 *  with nothing saved yet must not route to the provider. */
export async function hasByokKey(provider: ByokProvider): Promise<boolean> {
  const key = await getByokKey(provider);
  return !!key && key.trim().length > 0;
}

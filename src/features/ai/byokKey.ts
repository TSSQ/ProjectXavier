/**
 * BYOK (bring-your-own-key) storage — the user's own OpenAI/Anthropic API
 * key, one Keychain entry per provider via src/lib/secureStore.ts
 * (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). The key NEVER touches the DB, the
 * settings table, or a backup — only the non-secret config (enabled,
 * provider, per-provider model) lives in settings
 * (src/features/settings/repository.ts), and that config is itself excluded
 * from backups via DEVICE_LOCAL_SETTINGS_KEYS (src/domain/backupPolicy.ts).
 * No per-read biometric prompt is added here — that would gate every single
 * parse, which the spec explicitly rules out; WHEN_UNLOCKED_THIS_DEVICE_ONLY
 * already means the key is unreadable while the device is locked.
 */
import { getSecret, setSecret, deleteSecret } from '../../lib/secureStore';
import { ByokProvider } from '../../domain/parseRouter';

const KEYCHAIN_KEY: Record<ByokProvider, string> = {
  openai: 'byok_key_openai',
  anthropic: 'byok_key_anthropic',
};

/** The saved API key for `provider`, or null if none is stored. */
export async function getByokKey(provider: ByokProvider): Promise<string | null> {
  return getSecret(KEYCHAIN_KEY[provider]);
}

/** Save (overwrite) the API key for `provider`. */
export async function setByokKey(provider: ByokProvider, key: string): Promise<void> {
  await setSecret(KEYCHAIN_KEY[provider], key);
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

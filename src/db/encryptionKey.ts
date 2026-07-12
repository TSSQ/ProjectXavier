/**
 * SQLCipher key management (native runtime only — Keychain + CSPRNG).
 *
 * The DB key is a device-random 256-bit value, generated once and stored in
 * the iOS Keychain via expo-secure-store with `AFTER_FIRST_UNLOCK`
 * accessibility (readable once the device has been unlocked at least once
 * since boot; migrates with an encrypted device backup). It is never derived
 * from a user passphrase — that would block every query on a prompt. See
 * docs/design/at-rest-encryption-sqlcipher-spec.md.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const DB_KEY_NAME = 'db_encryption_key';

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Returns the SQLCipher key as 64 hex characters (32 raw bytes), generating
 * and persisting a new random one to the Keychain the first time it's called.
 */
export async function getOrCreateDbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DB_KEY_NAME, KEYCHAIN_OPTIONS);
  if (existing) return existing;

  const bytes = await Crypto.getRandomBytesAsync(32);
  const hex = bytesToHex(bytes);
  await SecureStore.setItemAsync(DB_KEY_NAME, hex, KEYCHAIN_OPTIONS);
  return hex;
}

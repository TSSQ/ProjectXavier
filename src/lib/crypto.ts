/**
 * Crypto provider abstraction for end-to-end encrypted backups/sync.
 *
 * The interface keeps the backup logic (src/lib/backup.ts) portable and
 * testable: tests inject a Node implementation, while the app injects an Expo
 * implementation. The plaintext (financial data) is encrypted on-device with a
 * key derived from the user's passphrase/device key, so the server only ever
 * stores opaque ciphertext — satisfying the "no PII / server can't read"
 * requirement.
 */

export interface EncryptedBlob {
  /** AES-GCM ciphertext, base64. */
  ciphertext: string;
  /** Initialisation vector, base64. */
  iv: string;
  /** Auth tag, base64 (may be appended to ciphertext in some impls). */
  tag: string;
  /** KDF salt, base64. */
  salt: string;
  /** Format version for forward compatibility. */
  v: 1;
}

export interface CryptoProvider {
  randomBytes(length: number): Uint8Array;
  /** Derive a 32-byte key from a passphrase + salt (e.g. scrypt/PBKDF2). */
  deriveKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array>;
  encrypt(plaintext: string, key: Uint8Array, salt: Uint8Array): Promise<EncryptedBlob>;
  decrypt(blob: EncryptedBlob, key: Uint8Array): Promise<string>;
}

/**
 * The Expo implementation is provided at runtime in the app using
 * `expo-crypto` for randomness/KDF and a native AES-GCM module. It is kept out
 * of this file so the pure test suite never imports React Native. See
 * docs/crypto for wiring details.
 */

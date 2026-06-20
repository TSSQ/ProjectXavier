/**
 * Node implementation of CryptoProvider, used only by the test suite to verify
 * the (portable) backup logic. The app supplies an Expo-based provider instead.
 */
import {
  randomBytes as nodeRandomBytes,
  scrypt,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { CryptoProvider, EncryptedBlob } from '../../src/lib/crypto';

const b64 = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64');
const fromB64 = (s: string) => Buffer.from(s, 'base64');

export const nodeCrypto: CryptoProvider = {
  randomBytes(length: number): Uint8Array {
    return new Uint8Array(nodeRandomBytes(length));
  },

  deriveKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      scrypt(passphrase, Buffer.from(salt), 32, (err, key) => {
        if (err) reject(err);
        else resolve(new Uint8Array(key));
      });
    });
  },

  async encrypt(
    plaintext: string,
    key: Uint8Array,
    salt: Uint8Array
  ): Promise<EncryptedBlob> {
    const iv = nodeRandomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: b64(ciphertext),
      iv: b64(iv),
      tag: b64(tag),
      salt: b64(salt),
      v: 1,
    };
  },

  async decrypt(blob: EncryptedBlob, key: Uint8Array): Promise<string> {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key),
      fromB64(blob.iv)
    );
    decipher.setAuthTag(fromB64(blob.tag));
    const plaintext = Buffer.concat([
      decipher.update(fromB64(blob.ciphertext)),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  },
};

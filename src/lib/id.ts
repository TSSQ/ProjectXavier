/**
 * Identifier generation. Uses expo-crypto's CSPRNG-backed UUIDs so ids are
 * collision-resistant and don't leak ordering or device info.
 */
import * as Crypto from 'expo-crypto';

export function newId(): string {
  return Crypto.randomUUID();
}

/**
 * Drizzle + expo-sqlite client (app runtime only).
 *
 * Kept separate from pure logic so the test suite never imports React Native.
 * The database is opened on-device; it is the source of truth, with encrypted
 * backups/sync layered on top (see src/lib/backup.ts).
 */
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

const expoDb = openDatabaseSync('projectxavier.db', {
  enableChangeListener: true,
});

export const db = drizzle(expoDb, { schema });
export { schema };

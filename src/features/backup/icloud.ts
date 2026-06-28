/**
 * iCloud storage adapter for backups.
 *
 * This is the ONLY file in the project that imports react-native-cloud-storage.
 * All other code interacts with iCloud through this interface.
 *
 * Files are stored in the app's iCloud Documents container with the naming
 * convention: projectxavier-backup-<exportedAt>.json
 * where <exportedAt> is the Unix timestamp in milliseconds.
 *
 * On non-iOS platforms (or when the user is not signed in to iCloud),
 * isAvailable() returns false and all other methods will throw — callers must
 * check isAvailable() first.
 */
import { Platform } from 'react-native';
import { CloudStorage, CloudStorageScope } from 'react-native-cloud-storage';

const PREFIX = 'projectxavier-backup-';
const SUFFIX = '.json';

/** Build the filename for a given exportedAt timestamp. */
function buildName(exportedAt: number): string {
  return `${PREFIX}${exportedAt}${SUFFIX}`;
}

/** Parse the exportedAt timestamp from a filename, or null if it doesn't match. */
function parseExportedAt(name: string): number | null {
  if (!name.startsWith(PREFIX) || !name.endsWith(SUFFIX)) return null;
  const ts = Number(name.slice(PREFIX.length, -SUFFIX.length));
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Check whether iCloud backup storage is available.
 * Returns false on non-iOS or when the user is not signed in to iCloud.
 */
export async function isAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await CloudStorage.isCloudAvailable();
  } catch {
    return false;
  }
}

/**
 * Write a backup file to iCloud. The name should come from buildName().
 */
export async function write(name: string, contents: string): Promise<void> {
  await CloudStorage.writeFile(name, contents, CloudStorageScope.Documents);
}

export interface CloudBackupMeta {
  name: string;
  size: number;
  exportedAt: number;
}

/**
 * List all backup files in iCloud, sorted newest-first.
 * Files that do not match the projectxavier-backup-<ts>.json pattern are ignored.
 */
export async function list(): Promise<CloudBackupMeta[]> {
  const names = await CloudStorage.readdir('', CloudStorageScope.Documents);
  const metas: CloudBackupMeta[] = [];

  for (const name of names) {
    const exportedAt = parseExportedAt(name);
    if (exportedAt === null) continue;

    try {
      const statResult = await CloudStorage.stat(name, CloudStorageScope.Documents);
      metas.push({ name, size: statResult.size, exportedAt });
    } catch {
      // Skip files we can't stat (e.g. not yet downloaded from iCloud)
    }
  }

  return metas.sort((a, b) => b.exportedAt - a.exportedAt);
}

/**
 * Read the contents of a backup file from iCloud.
 * Triggers download if the file has been evicted from local storage.
 */
export async function read(name: string): Promise<string> {
  return CloudStorage.readFile(name, CloudStorageScope.Documents);
}

/**
 * Delete a backup file from iCloud.
 */
export async function remove(name: string): Promise<void> {
  await CloudStorage.unlink(name, CloudStorageScope.Documents);
}

/**
 * Build the filename for a new backup with the given exportedAt timestamp.
 * Exported so the repository can construct names without re-implementing the convention.
 */
export { buildName };

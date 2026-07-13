/**
 * iCloud storage adapter for backups.
 *
 * This is the ONLY file in the project that imports react-native-cloud-storage.
 * All other code interacts with iCloud through this interface.
 *
 * Files are stored in the app's iCloud Documents container with the naming
 * convention: projectxavier-backup-<exportedAt><suffix>
 * where <exportedAt> is the Unix timestamp in milliseconds and <suffix> is
 * `.sqlite` (new backups — a whole-DB plaintext SQLite image, assessment M3)
 * or `.json` (legacy backups — plaintext JSON, restore-only). The filename
 * convention itself is pure and lives in src/domain/backupFilename.ts so it's
 * Node-testable; this file re-exports it plus the actual iCloud I/O.
 *
 * On non-iOS platforms (or when the user is not signed in to iCloud),
 * isAvailable() returns false and all other methods will throw — callers must
 * check isAvailable() first.
 */
import { Platform } from 'react-native';
import { CloudStorage, CloudStorageScope } from 'react-native-cloud-storage';
import { buildName, parseExportedAt } from '../../domain/backupFilename';

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
 * Upload a local file to iCloud as binary content, preserving bytes exactly —
 * used for the new `.sqlite` backup format (a plaintext SQLite file).
 */
export async function uploadFile(name: string, localPath: string): Promise<void> {
  await CloudStorage.uploadFile(
    name,
    localPath,
    { mimeType: 'application/x-sqlite3' },
    CloudStorageScope.Documents,
  );
}

/**
 * Download a `.sqlite` backup file from iCloud to a local path, byte-exact.
 * The destination must not already exist (the underlying native call throws
 * `fileAlreadyExists` otherwise) — callers should clear any stale scratch
 * file first.
 */
export async function downloadFile(name: string, localPath: string): Promise<void> {
  await CloudStorage.downloadFile(name, localPath, CloudStorageScope.Documents);
}

export interface CloudBackupMeta {
  name: string;
  size: number;
  exportedAt: number;
}

/**
 * List all backup files in iCloud, sorted newest-first. Recognises BOTH the
 * new `.sqlite` and legacy `.json` naming conventions; anything else in the
 * container is ignored.
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
 * Read the contents of a `.json` backup file from iCloud as a UTF-8 string.
 * Legacy path only — `.sqlite` backups go through `downloadFile`. Triggers
 * download if the file has been evicted from local storage.
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
 * Exported so the repository can construct names without re-implementing the
 * convention. Re-exported from src/domain/backupFilename.ts (Node-testable).
 */
export { buildName };

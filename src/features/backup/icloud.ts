/**
 * iCloud storage adapter for backups.
 *
 * This is the ONLY file in the project that imports react-native-cloud-storage
 * or modules/icloud-bridge. All other code interacts with iCloud through this
 * interface.
 *
 * Files are stored in the app's iCloud Documents container with the naming
 * convention: projectxavier-backup-<exportedAt>[-<iPhone|iPad>]<suffix>
 * where <exportedAt> is the Unix timestamp in milliseconds, the device
 * segment is optional (docs/design/icloud-backup-sync-spec.md, I5), and
 * <suffix> is `.sqlite` (new backups — a whole-DB plaintext SQLite image,
 * assessment M3) or `.json` (legacy backups — plaintext JSON, restore-only).
 * The filename convention itself is pure and lives in
 * src/domain/backupFilename.ts so it's Node-testable; this file re-exports it
 * plus the actual iCloud I/O.
 *
 * Since the iCloud sync spec (I1/I2), listing/download-status/download-
 * trigger/coordinated-copy go through modules/icloud-bridge (an
 * NSMetadataQuery-backed native module) when it's linked, fixing D1
 * (not-yet-downloaded backups invisible to the library's `readdir`) and D2
 * (restore never triggers a download). `react-native-cloud-storage` is kept
 * for upload/delete/legacy-read, and as the fallback listing/download path
 * when the module isn't linked (Android, Expo Go, a build without it
 * compiled in) — see `listWithStatus`/`ensureDownloaded` below and
 * src/domain/backupSync.ts, which owns the actual policy (stub-name mapping,
 * status merge, download plan/timeout) so it's covered by real BDD
 * scenarios instead of living inline here.
 *
 * On non-iOS platforms (or when the user is not signed in to iCloud),
 * isAvailable() returns false and all other methods will throw — callers must
 * check isAvailable() first.
 */
import { Platform } from 'react-native';
import { CloudStorage, CloudStorageScope } from 'react-native-cloud-storage';
import { buildName, parseBackupName, BackupDevice } from '../../domain/backupFilename';
import {
  CloudEntry,
  CloudEntrySchema,
  CloudEntryStatus,
  CloudNamesSchema,
  FALLBACK_STATUS,
  DEFAULT_WAIT_LIMITS,
  WaitLimits,
  isRestorable,
  listWithFallback,
  mergeFallbackListing,
  parseCloudEntryOrThrow,
  shouldKeepWaiting,
} from '../../domain/backupSync';
import ICloudBridge from '../../../modules/icloud-bridge';

/** The bridge once it is known to be linked. Functions that require the
 *  native module take this, so "caller checked it first" is enforced by the
 *  compiler instead of by a non-null assertion. */
type LinkedBridge = NonNullable<typeof ICloudBridge>;

// Mirrors the private `PREFIX` constant in src/domain/backupFilename.ts.
// Duplicated as a literal (not imported) so this file's changes stay inside
// the icloud-sync commit group without reopening backupFilename.ts, which
// shipped filename-only in its own commit (I5).
const BACKUP_NAME_PREFIX = 'projectxavier-backup-';

const POLL_INTERVAL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Which idiom this device is — folded into new backup filenames (I5) so a
 *  restore-target picker can tell iPhone and iPad backups apart. Two iPhones
 *  on one account produce identical labels (accepted — the timestamp still
 *  distinguishes them; spec §8). */
export function deviceKind(): BackupDevice {
  return Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone';
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
 * file first. Legacy/fallback path — see `copyToScratch` for the
 * module-backed coordinated copy `restoreFromSqlite` actually uses now.
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
 * List all backup files in iCloud, sorted newest-first, in the shape
 * `selectBackupsToPrune` (src/domain/backupPolicy.ts) needs. A thin wrapper
 * over `listWithStatus` — pruning cares about every remote backup regardless
 * of whether it's downloaded to this device, which `listWithStatus` now
 * finds correctly (D1) where the old `readdir`+`stat` implementation quietly
 * dropped anything not yet local.
 */
export async function list(): Promise<CloudBackupMeta[]> {
  const entries = await listWithStatus();
  return entries.map((e) => ({ name: e.name, size: e.size, exportedAt: e.exportedAt }));
}

export interface CloudBackupEntry {
  name: string;
  exportedAt: number;
  device: BackupDevice | null;
  /** `NaN` (not `0`, not a nullable type — QA round 3 minor 4) means
   *  genuinely unknown: the fallback listing's stub case has no local
   *  `stat` to read, and `0` used to stand in for that, rendering as
   *  "<0.1 MB" for e.g. a real 3 MB backup. Stays plain `number` — not
   *  `number | null` — deliberately: `list()`'s `CloudBackupMeta.size`
   *  and every other numeric consumer of this field keep working
   *  unchanged; only `app/backups.tsx`'s `formatSize` needs to know to
   *  check `Number.isNaN` and render "Size unknown". (A `number | null`
   *  widening was tried first and reverted — it broke `npm run typecheck`
   *  for the I1+I2+I3/I4 commit prefixes standing alone, before I6's
   *  `app/backups.tsx` rewrite lands to consume the new type; `NaN` avoids
   *  that cross-commit dependency entirely by not changing the field's
   *  type at all.)
   *
   *  REVISIT (QA round 4 minor 5): this is a cross-commit workaround, not
   *  a permanent design choice — it only exists because I6 hadn't landed
   *  yet when it was written. Now that it has, `size: number | null` is
   *  the better shape: the compiler would then force every call site to
   *  handle "unknown" explicitly, instead of relying on `formatSize`
   *  remembering to call `Number.isNaN` — the exact class of gap a
   *  sentinel value always risks (nothing stops a future arithmetic use
   *  of `size` from silently producing `NaN` results instead of a
   *  type error). A future pass should make that change now that both
   *  sides of the former commit boundary are present in the same tree. */
  size: number;
  status: CloudEntryStatus;
}

function statusFromValidated(e: CloudEntry): CloudEntryStatus {
  return {
    downloadStatus: e.downloadStatus,
    isDownloading: e.isDownloading,
    // `?? null` (QA round 3 M1): the schema is now `.nullish()`, not just
    // `.nullable()` (see CloudEntrySchema, src/domain/backupSync.ts), so
    // these can also come through as `undefined`; `CloudEntryStatus` itself
    // stays `number | null` either way.
    percentDownloaded: e.percentDownloaded ?? null,
    isUploaded: e.isUploaded,
    isUploading: e.isUploading,
    percentUploaded: e.percentUploaded ?? null,
    downloadingError: e.downloadingError ?? null,
    uploadingError: e.uploadingError ?? null,
  };
}

/** Lenient (non-throwing) recovery of a raw item's `name`/`size` when it
 *  fails full `CloudEntrySchema` validation — so one item with e.g. a
 *  malformed status field doesn't drop the whole backup from the list (only
 *  its status degrades, to `FALLBACK_STATUS` — guardrail #6, "never a throw
 *  in the list"). If even `name` isn't a recoverable string, the item is
 *  dropped — there's nothing to identify it by. */
function extractNameLeniently(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'name' in raw) {
    const name = (raw as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

/** `NaN` ("unknown"), not `0`, when `size` is absent or malformed (QA round
 *  4 minor 4 — finishing M1's job of unifying on one "unknown" idiom
 *  across the Swift payload, this lenient path, and the fallback listing's
 *  own `NaN`; see `CloudBackupEntry.size`). */
function extractSizeLeniently(raw: unknown): number {
  if (raw && typeof raw === 'object' && 'size' in raw) {
    const size = (raw as { size?: unknown }).size;
    return typeof size === 'number' && Number.isFinite(size) ? size : NaN;
  }
  return NaN;
}

/** Shared by `listWithStatus`'s module-present branch and `watch`'s event
 *  handler — both receive the same native item shape. Deduplicates by
 *  `name` (QA round 1): a transient OS race could report the same logical
 *  name twice in one snapshot mid-transition, and two rows sharing a React
 *  `key` is a real bug, not just noise — last write wins. */
function entriesFromRawItems(raw: unknown[]): CloudBackupEntry[] {
  const byName = new Map<string, CloudBackupEntry>();
  for (const item of raw) {
    const parsed = CloudEntrySchema.safeParse(item);
    const name = parsed.success ? parsed.data.name : extractNameLeniently(item);
    if (name === null) continue;
    const parsedName = parseBackupName(name);
    if (parsedName === null) continue; // not a ProjectXavier backup file
    byName.set(name, {
      name,
      exportedAt: parsedName.exportedAt,
      device: parsedName.device,
      size: parsed.success ? (parsed.data.size ?? NaN) : extractSizeLeniently(item),
      status: parsed.success ? statusFromValidated(parsed.data) : FALLBACK_STATUS,
    });
  }
  return Array.from(byName.values()).sort((a, b) => b.exportedAt - a.exportedAt);
}

/**
 * Module-present branch of `listWithStatus` — one-shot `listDocuments`,
 * validated and parsed. Throws (does not degrade) on a failure of the CALL
 * itself (e.g. `ERR_ICLOUD_GATHER_TIMEOUT`, `ERR_ICLOUD_UNAVAILABLE`) — that
 * is `listWithFallback`'s job to catch (QA round 3 B1), not this function's;
 * a malformed individual ITEM inside a successful response still degrades
 * per-item via `entriesFromRawItems`, unchanged.
 */
async function listViaModule(): Promise<CloudBackupEntry[]> {
  if (!ICloudBridge) throw new Error('ICloudBridge is not linked');
  const raw = await ICloudBridge.listDocuments(BACKUP_NAME_PREFIX);
  return entriesFromRawItems(Array.isArray(raw) ? raw : []);
}

/**
 * Fallback branch of `listWithStatus` — the library's `readdir`, mapped
 * through `mergeFallbackListing` (stub names → logical names with
 * `downloaded: false`) — `stat` only for the already-downloaded ones, and a
 * synthesised status (`current` for downloaded, `notDownloaded` for stubs).
 * `readdir`'s return is shape-guarded via `CloudNamesSchema` (QA round 3
 * minor 5) — the same trust-boundary standard the native module's payload
 * already gets, never a throw (an unexpected shape degrades to an empty
 * listing).
 *
 * `readdir` ITSELF is also guarded now (QA round 4 M4) — not just its
 * return shape: `react-native-cloud-storage`'s `FileUtils.listFiles` wraps
 * `contentsOfDirectory(atPath:)` and throws `CloudStorageError.readError`
 * when the directory can't be read, INCLUDING when it doesn't exist yet —
 * exactly acceptance criterion §6.1's opening state (a fresh install whose
 * iCloud Documents folder hasn't materialised). A missing container is a
 * normal "no backups yet" state, not an error: without this, B1's fix
 * (falling through to this function) just relocated the same unhandled
 * rejection one function deeper, on the exact device check this feature
 * exists for.
 */
async function listViaFallback(): Promise<CloudBackupEntry[]> {
  let namesRaw: unknown;
  try {
    namesRaw = await CloudStorage.readdir('', CloudStorageScope.Documents);
  } catch {
    return []; // no container yet (or unreadable) — empty, not an error
  }
  const namesParsed = CloudNamesSchema.safeParse(namesRaw);
  const names = namesParsed.success ? namesParsed.data : [];

  const merged = mergeFallbackListing(names);
  const entries: CloudBackupEntry[] = [];
  for (const { name, downloaded } of merged) {
    const parsedName = parseBackupName(name);
    if (parsedName === null) continue;

    // `NaN` (not 0) until proven otherwise — a not-yet-downloaded stub has
    // no local `stat` to read (QA round 3 minor 4; see CloudBackupEntry.size
    // above for why `NaN` rather than a nullable type).
    let size = NaN;
    if (downloaded) {
      try {
        const statResult = await CloudStorage.stat(name, CloudStorageScope.Documents);
        size = statResult.size;
      } catch {
        // Skip stat failures — same tolerance the old list() had; size
        // stays unknown (NaN), not 0.
      }
    }

    entries.push({
      name,
      exportedAt: parsedName.exportedAt,
      device: parsedName.device,
      size,
      status: downloaded ? { ...FALLBACK_STATUS, downloadStatus: 'current' } : FALLBACK_STATUS,
    });
  }
  return entries.sort((a, b) => b.exportedAt - a.exportedAt);
}

/**
 * List every backup with its live cloud status (docs/design/
 * icloud-backup-sync-spec.md, I2). Tries the native module's one-shot
 * `listDocuments` first and falls through to the library's `readdir`
 * listing (`listWithFallback`, src/domain/backupSync.ts) on ANY failure of
 * that call — not just when the module isn't linked (QA round 3 B1):
 * `listDocuments` rejects on `ERR_ICLOUD_GATHER_TIMEOUT` (an 8s gather
 * budget — a slow first sync, not a real failure) and
 * `ERR_ICLOUD_UNAVAILABLE`, and before this fix nothing caught either, so
 * the fallback below was only reachable when the module is null (never in
 * a real iOS build) — the exact opposite of spec §8/§9.
 */
export async function listWithStatus(): Promise<CloudBackupEntry[]> {
  return listWithFallback(listViaModule, listViaFallback);
}

// Module-present only. Takes the linked bridge as an argument rather than
// asserting past the nullable import: both callers are already inside
// `if (ICloudBridge)`, and passing the narrowed value makes "the caller
// checked" a property the compiler enforces — a call added outside a guard
// is `error TS2345: Argument of type 'ICloudBridgeNativeModule | null' is
// not assignable to parameter of type 'ICloudBridgeNativeModule'`.
//
// This function used to open with `if (!ICloudBridge) return FALLBACK_STATUS`,
// which was unreachable at every real call site, and was then briefly replaced
// by a non-null assertion. The assertion was wrong for the opposite reason: it
// SILENCES the compiler, so an out-of-guard caller would crash at runtime
// rather than fail to build. Same move as `ExclusiveEffect` in
// src/domain/backupGate.ts — a precondition the compiler checks beats a
// precondition a comment asserts.
async function statusFor(bridge: LinkedBridge, name: string): Promise<CloudEntryStatus> {
  const raw = await bridge.status(name);
  // Throws CloudStatusSchemaError on a malformed payload (QA round 3 M1) —
  // unlike the list's per-item degrade above, a schema failure HERE must
  // not read as legitimate: `ensureDownloaded`'s polling loop calls this,
  // and a status that quietly says "not downloaded yet" makes
  // `isRestorable` unable to ever become true, so the loop would otherwise
  // burn the full 120s budget and report a misleading timeout for a
  // problem that is really "the native contract drifted".
  return statusFromValidated(parseCloudEntryOrThrow(raw, name));
}

/**
 * Ensures `name` is fully downloaded to this device before a caller reads
 * it, waiting for the transfer rather than failing the first attempt (D2).
 * Module present: `status` → if already `current`, return; else
 * `startDownload` then poll `status` every 500ms, reporting `onProgress`
 * from the watcher-fed percentage when available (`null` = indeterminate).
 * Module absent: `triggerSync` (library) then poll `exists` with the same
 * limits — the honest degraded path (spec §9: never the primary path, but a
 * real fallback, not a silent no-op). Either way, `shouldKeepWaiting`
 * (src/domain/backupSync.ts) is the ONLY place the stall/timeout policy is
 * decided — this function just calls it.
 */
export async function ensureDownloaded(
  name: string,
  onProgress?: (percent: number | null) => void,
  limits: WaitLimits = DEFAULT_WAIT_LIMITS,
): Promise<void> {
  if (ICloudBridge) {
    const initial = await statusFor(ICloudBridge, name);
    if (isRestorable(initial)) {
      onProgress?.(100);
      return;
    }
    await ICloudBridge.startDownload(name);

    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let lastPercent: number | null = null;

    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      const status = await statusFor(ICloudBridge, name);
      if (status.downloadingError !== null) {
        throw new Error(status.downloadingError);
      }
      if (status.percentDownloaded !== null && status.percentDownloaded !== lastPercent) {
        lastPercent = status.percentDownloaded;
        lastProgressAt = Date.now();
        onProgress?.(status.percentDownloaded);
      }
      if (isRestorable(status)) {
        onProgress?.(100);
        return;
      }
      const now = Date.now();
      const decision = shouldKeepWaiting(now - startedAt, lastProgressAt, now, limits);
      if (decision === 'stalled') {
        throw new Error('ERR_ICLOUD_STALLED: Download stalled — no progress for 30 seconds.');
      }
      if (decision === 'timedOut') {
        throw new Error('ERR_ICLOUD_TIMEOUT: Download timed out after 120 seconds.');
      }
    }
  }

  // Fallback: no native module — triggerSync then poll exists() with the
  // same limits. No progress signal exists on this path, so onProgress only
  // ever reports `null` (indeterminate) — see spec §9. `lastProgressAt` is
  // `null`, NOT `startedAt` (QA round 1 Major): passing `startedAt` made
  // `now - lastProgressAt` equal `elapsedMs` on every tick, so the 30s
  // stall budget always won the race against the 120s total budget and a
  // download that would have succeeded at ~40s threw ERR_ICLOUD_STALLED at
  // 30s instead. `shouldKeepWaiting` skips the stall comparison entirely
  // when `lastProgressAt` is null, leaving only the `maxMs` budget live.
  await CloudStorage.triggerSync(name, CloudStorageScope.Documents);
  const startedAt = Date.now();
  for (;;) {
    const exists = await CloudStorage.exists(name, CloudStorageScope.Documents);
    if (exists) {
      onProgress?.(null);
      return;
    }
    onProgress?.(null);
    const now = Date.now();
    const decision = shouldKeepWaiting(now - startedAt, null, now, limits);
    if (decision === 'stalled') {
      throw new Error('ERR_ICLOUD_STALLED: Download stalled — no progress for 30 seconds.');
    }
    if (decision === 'timedOut') {
      throw new Error('ERR_ICLOUD_TIMEOUT: Download timed out after 120 seconds.');
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Copies an already-downloaded (or now-downloading-triggered) backup to a
 * local scratch path. Module present: the coordinated copy
 * (`copyDownloaded`) — the coordinator itself blocks until the item is
 * materialised, the belt to `ensureDownloaded`'s braces. Module absent:
 * the library's `downloadFile` (today's behaviour).
 */
export async function copyToScratch(name: string, localPath: string): Promise<void> {
  if (ICloudBridge) {
    await ICloudBridge.copyDownloaded(name, localPath);
    return;
  }
  await downloadFile(name, localPath);
}

let watchSubscription: { remove(): void } | null = null;

/**
 * Starts (or restarts) a live watch of the backup listing, invoking `cb`
 * with the full, freshly-merged entry list on every gather/update — the
 * screen (I6) uses this to keep the Backups list live without polling. A
 * no-op without the module (nothing to watch; the fallback listing has no
 * live signal). The screen owns the lifecycle: call `unwatch()` on blur.
 */
export function watch(cb: (entries: CloudBackupEntry[]) => void): void {
  if (!ICloudBridge) return;
  unwatch();
  watchSubscription = ICloudBridge.addListener('onDocumentsChanged', (payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    cb(entriesFromRawItems(items));
  });
  ICloudBridge.startWatching(BACKUP_NAME_PREFIX);
}

/** Stops the live watch. Safe to call even if `watch` was never called. */
export function unwatch(): void {
  watchSubscription?.remove();
  watchSubscription = null;
  ICloudBridge?.stopWatching();
}

/**
 * Read the contents of a `.json` backup file from iCloud as a UTF-8 string.
 * Legacy path only — `.sqlite` backups go through `copyToScratch`. Callers
 * should `ensureDownloaded` first (D2) — this does not trigger a download.
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
 * Build the filename for a new backup with the given exportedAt timestamp
 * (and, since I5, the device idiom that made it). Exported so the
 * repository can construct names without re-implementing the convention.
 * Re-exported from src/domain/backupFilename.ts (Node-testable).
 */
export { buildName };

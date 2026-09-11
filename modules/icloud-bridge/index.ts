import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Native → JS boundary for iCloud Documents listing/download/status
 * (docs/design/icloud-backup-sync-spec.md, I1). Every method here returns
 * `unknown`/`unknown[]` on purpose, same seam as modules/apple-ocr's
 * `recognizeObservations` — this crosses a trust boundary (guardrail #6),
 * validated downstream with `CloudEntrySchema` (src/domain/backupSync.ts)
 * by the adapter (src/features/backup/icloud.ts), never trusted here.
 *
 * `declare class ... extends NativeModule<Events>` (not an `interface
 * extends`) — the same shape expo-linking's own `ExpoLinking.ts` uses, since
 * an interface heritage clause can't satisfy `NativeModule`'s `EventsMap`
 * constraint (`Record<string, ...>`) without an index signature.
 */
type ICloudBridgeEvents = {
  onDocumentsChanged(payload: { items: unknown[] }): void;
};

declare class ICloudBridgeNativeModule extends NativeModule<ICloudBridgeEvents> {
  /** One-shot NSMetadataQuery listing every iCloud Documents item whose name
   *  begins with `prefix`. Logical names only — never `.icloud` stubs. */
  listDocuments(prefix: string): Promise<unknown[]>;
  /** `startDownloadingUbiquitousItem` on the logical name. */
  startDownload(name: string): Promise<void>;
  /** Resource-value status for the logical name — works on a placeholder
   *  that hasn't been downloaded yet. No progress percentage; that comes
   *  from `onDocumentsChanged` while watching. */
  status(name: string): Promise<unknown>;
  /** Coordinated read + copy of the logical name to a local path. The
   *  destination must not already exist. */
  copyDownloaded(name: string, localPath: string): Promise<void>;
  /** Starts (or replaces) the one live watch query for `prefix`, emitting
   *  `onDocumentsChanged` on every gather/update. */
  startWatching(prefix: string): void;
  /** Stops the live watch query. Safe to call when nothing is running. */
  stopWatching(): void;
}

// Optional so importing this file never throws where the native module isn't
// linked (Android, Expo Go) — same seam as modules/apple-ocr and
// modules/widget-bridge. The adapter (src/features/backup/icloud.ts) is the
// only caller, and degrades to the library-only fallback path when this is
// null (docs/design/icloud-backup-sync-spec.md §9).
const ICloudBridge = requireOptionalNativeModule<ICloudBridgeNativeModule>('ICloudBridge');

export default ICloudBridge;

# iCloud backup sync — placeholders, download-before-restore, upload status, device kind in the filename

Decided in discussion 2026-09-10 (no mockup — a flow fix, not a visual fork).
Handoff: `.claude/handoff.md` (2026-09-10, iCloud track). Folds in the
"iCloud status" Phase 2 that `docs/design/icloud-backup-spec.md` deferred
("NSMetadataQuery upload/download %, needs custom Swift") and supersedes the
copy-only mitigation in commit `ac74350`. Memory: `icloud-restore-placeholders`.
Branch: cut fresh from `origin/main` (v1.1.1, build 74) — the backup code is
identical on `claude/liquid-glass-ui`, but this track is independent of glass.

## 1. Objective

A backup made on one device is **listed** and **restorable on the first try**
on another device signed into the same iCloud account, and on the same device
after iOS has evicted the file. The Backups screen tells the truth about where
each file is (in iCloud, downloading with a percentage, on this device,
uploading). Every new backup's filename says whether an iPhone or an iPad made
it. Restore stays destructive-once: nothing is wiped until the file is fully
on the device and validated.

## 2. Diagnosis (traced on `react-native-cloud-storage` 3.0.1)

| Defect | Cause | Where |
|---|---|---|
| **D1** Backup missing from the list on a new device | `readdir` = `FileManager.contentsOfDirectory(atPath:)`, which lists a not-yet-downloaded item as its stub `.projectxavier-backup-<ts>.sqlite.icloud`; `parseExportedAt` rejects the dotted name and `list()` skips it | `ios/Utils/FileUtils.swift:75`, `src/features/backup/icloud.ts list()`, `src/domain/backupFilename.ts` |
| **D2** First restore fails on an evicted / in-flight file | `downloadFile` = `getFileURL(shouldExist: true)` + `stat` + `copyItem`; it never calls `startDownloadingUbiquitousItem`; failures are rewrapped as `ERR_FILE_NOT_FOUND` / `ERR_WRITE_ERROR`, indistinguishable from corruption | `ios/CloudStorageCloudKit.swift:99–127`, `ios/Utils/FileUtils.swift:102–108` |
| **D3** No upload/download status | The library exposes `triggerSync` (= `startDownloadingUbiquitousItem`, `:67`) but no status, progress or upload state; `uploadFile` is a copy into the container and returns before iCloud has uploaded anything | — |

The previous mitigation (`app/backups.tsx` ~144–166) improved the error copy
and deliberately added no retry because the *apply* is destructive. That
reasoning holds for apply; the download happens **before** apply, so waiting
for it is safe.

## 3. What is already landed (do not redo)

| Item | Where |
|---|---|
| Library confined to one adapter; scratch-file restore with unique names; H1 exclusivity gate; every row zod-validated before `applyBackupUnlocked` | `icloud.ts`, `repository.ts`, `backupGate.ts`, `sqliteBackupRows.ts` |
| Honest restore-failure copy (kept for genuine failures) | `app/backups.tsx` |
| Filename contract + tests (`buildName`, `parseExportedAt`, `restoreRouteFor`) | `backupFilename.ts`, `tests/__features__/backup-format.feature` |
| Two in-repo Expo modules autolinked by `use_expo_modules!` on `pod install` (no prebuild, `.pbxproj` untouched) | `modules/apple-ocr`, `modules/widget-bridge` |
| Device-local settings mechanism (not needed here — the device kind is derived, not stored) | `backupPolicy.ts` |

## 4. Scope — the delta

- **I1** Native module `modules/icloud-bridge` (Swift, Expo Modules): metadata
  query listing, download trigger, status, coordinated copy, live status events.
- **I2** Adapter `icloud.ts`: `listWithStatus`, `ensureDownloaded`,
  `copyToScratch`, `watch/unwatch`; keeps the library for upload and delete.
- **I3** Pure domain `src/domain/backupSync.ts`: stub-name mapping, status
  merge, download plan and timeout policy — BDD-covered.
- **I4** Repository: restore waits for the download and copies through the
  coordinator; list carries status; create names the device kind.
- **I5** Filename: `projectxavier-backup-<ts>-<iPhone|iPad>.sqlite`, parser
  accepts an optional device segment, legacy names unchanged.
- **I6** Backups screen: per-row status line, download progress, tap-to-download,
  "Uploading…" after create, distinct download-error copy.
- **I7** Tests: `backup-format.feature` extensions, new `backup-sync.feature`.

Out of scope: encryption/passphrases; CloudKit or field-level sync; a user-set
device label (decided against — Apple hides the user-assigned device name on
iOS 16+ without an entitlement, and the user chose the idiom instead);
Android iCloud; changing the backup format or the H1 gate; anything in
`ios/` beyond the pod the new module adds.

## 5. Approach

### I5 — filename (`src/domain/backupFilename.ts`) — ship first, pure

```ts
export type BackupDevice = 'iPhone' | 'iPad';
export function buildName(exportedAt: number, device: BackupDevice): string
// → `projectxavier-backup-1700000000000-iPhone.sqlite`
export interface ParsedBackupName { exportedAt: number; device: BackupDevice | null; format: 'sqlite' | 'json' }
export function parseBackupName(name: string): ParsedBackupName | null
export function parseExportedAt(name: string): number | null   // = parseBackupName(name)?.exportedAt ?? null (kept for callers)
```
Grammar: `PREFIX` + digits + (`-` + `iPhone`|`iPad`)? + (`.sqlite`|`.json`).
The device segment is an enum, not free text — nothing to sanitise, no length
cap, and an unknown segment (a future version) parses as `device: null`
rather than rejecting the file. `.json` names never carry a device (no new
`.json` is ever written). `restoreRouteFor` unchanged. In the adapter:
`export function deviceKind(): BackupDevice { return Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone'; }`
— `createBackupUnlocked` (`repository.ts:251`) calls `icloud.buildName(now, deviceKind())`.
`selectBackupsToPrune` keys on `exportedAt`, so mixed old/new names prune
together unchanged.

### I1 — `modules/icloud-bridge` (new; copy `modules/widget-bridge`'s layout)

`expo-module.config.json` `{ "platforms": ["apple"], "apple": { "modules": ["ICloudBridgeModule"] } }`,
`ios/ICloudBridge.podspec` cloned from `AppleOcr.podspec` (iOS 26.0, Swift
5.9, `ExpoModulesCore`), `index.ts` with `requireOptionalNativeModule` so
Android / Expo Go get `null` and the adapter degrades (I2). `pod install` in
`ios/` links it — the only `ios/` change is `Podfile.lock`, which is gitignored
like the rest of `ios/`.

```swift
public class ICloudBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ICloudBridge")
    Events("onDocumentsChanged")
    AsyncFunction("listDocuments") { (prefix: String) -> [[String: Any]] in … }   // one-shot NSMetadataQuery
    AsyncFunction("startDownload") { (name: String) in … }                          // startDownloadingUbiquitousItem
    AsyncFunction("status") { (name: String) -> [String: Any] in … }               // URL resource values
    AsyncFunction("copyDownloaded") { (name: String, localPath: String) in … }     // NSFileCoordinator read + copyItem
    Function("startWatching") { (prefix: String) in … }                            // live NSMetadataQuery → events
    Function("stopWatching") { … }
  }
}
```

- **Container URL**: `FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents")`
  — the same Documents scope the library writes to (`CloudKitUtils.documentsDirectory`);
  assert both resolve to the same path in a debug log once, so a scope
  mismatch can't silently list a different folder.
- **`listDocuments(prefix)`**: `NSMetadataQuery` with
  `searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]`, predicate
  `NSMetadataItemFSNameKey BEGINSWITH prefix`, wait for
  `.NSMetadataQueryDidFinishGathering` (timeout 8 s → reject
  `ERR_ICLOUD_GATHER_TIMEOUT`), snapshot, stop. Each item →
  `{ name: NSMetadataItemFSNameKey, size: NSMetadataItemFSSizeKey,
    downloadStatus: NSMetadataUbiquitousItemDownloadingStatusKey  // "current" | "downloaded" | "notDownloaded"
    isDownloading, percentDownloaded, isUploaded, isUploading, percentUploaded,
    downloadingError?: localizedDescription, uploadingError?: localizedDescription }`.
  Logical names only — the query never returns `.icloud` stubs.
- **`status(name)`**: `URL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey,
  .ubiquitousItemIsDownloadingKey, .ubiquitousItemDownloadingErrorKey,
  .ubiquitousItemIsUploadedKey, .ubiquitousItemIsUploadingKey,
  .ubiquitousItemUploadingErrorKey])` on the **logical** URL (works for
  placeholders). No percentage here — that comes from the watcher's events.
- **`startDownload(name)`**: `try FileManager.default.startDownloadingUbiquitousItem(at: logicalURL)`;
  rethrow the `NSError` with its `localizedDescription` and `code` in the
  rejection (`ERR_ICLOUD_DOWNLOAD`), never a generic wrapper.
- **`copyDownloaded(name, localPath)`**: on a background queue,
  `NSFileCoordinator().coordinate(readingItemAt: logicalURL, options: [], error: &err) { url in try FileManager.default.copyItem(at: url, to: dest) }`.
  The coordinator itself blocks until the item is materialised, so this is the
  belt to `ensureDownloaded`'s braces; reject with the coordinator's or copy's
  real `NSError`. Destination must not exist (caller guarantees, as today).
- **`startWatching(prefix)` / `stopWatching()`**: one live `NSMetadataQuery`
  (same scope/predicate) with `.NSMetadataQueryDidUpdate` and
  `.NSMetadataQueryDidFinishGathering` → `sendEvent("onDocumentsChanged", { items })`
  with the same item shape as `listDocuments`. Disable updates while reading
  results (`disableUpdates()`/`enableUpdates()`). Idempotent: a second start
  replaces the first; stop is safe when nothing is running. The screen owns the
  lifecycle (I6) — never left running in the background.

### I3 — `src/domain/backupSync.ts` (new, framework-free)

```ts
export function stubToLogicalName(name: string): string | null  // ".X.icloud" → "X"; non-stub → null
export type DownloadStatus = 'current' | 'downloaded' | 'notDownloaded';
export interface CloudEntryStatus { downloadStatus: DownloadStatus; isDownloading: boolean; percentDownloaded: number | null;
  isUploaded: boolean; isUploading: boolean; percentUploaded: number | null; downloadingError: string | null; uploadingError: string | null }
export type RowState = 'onDevice' | 'inCloud' | 'downloading' | 'uploading' | 'downloadError' | 'uploadError';
export function rowState(s: CloudEntryStatus): RowState
export function isRestorable(s: CloudEntryStatus): boolean            // downloadStatus === 'current' && !isDownloading
export function shouldKeepWaiting(elapsedMs: number, lastProgressAt: number, now: number, limits = { maxMs: 120_000, stallMs: 30_000 }): 'wait' | 'stalled' | 'timedOut'
export function mergeFallbackListing(names: string[]): { name: string; downloaded: boolean }[]  // library readdir → logical names + downloaded flag (stub mapping), for the no-module path
```
The zod schema for the native payload lives next to these (`CloudEntrySchema`)
— native → JS is a trust boundary (guardrail #6); anything malformed becomes
`downloadStatus: 'notDownloaded'` with no error, never a throw in the list.

### I2 — adapter `src/features/backup/icloud.ts`

Keep `isAvailable`, `uploadFile`, `remove`, `read` (legacy) on the library.
Add:

- `listWithStatus(): Promise<CloudBackupEntry[]>` — module present:
  `listDocuments(PREFIX)` → validate → `parseBackupName` (skip nulls) →
  `{ name, exportedAt, device, size, status }`. Module absent: library `readdir`
  → `mergeFallbackListing` (stubs become logical names with `downloaded: false`)
  → `stat` only for downloaded ones → `status` synthesised (`notDownloaded`
  for stubs). `list()` stays as a thin wrapper returning the old shape for
  `selectBackupsToPrune`.
- `ensureDownloaded(name, onProgress?: (p: number | null) => void, limits?)`:
  `status(name)`; if `current` → return. Else `startDownload(name)`, then poll
  `status(name)` every 500 ms; progress comes from the watcher when the screen
  is watching (I6 passes it through), else `null` (indeterminate). Stop on
  `current`; reject with the `downloadingError` text when it appears; apply
  `shouldKeepWaiting` — `stalled` rejects with `ERR_ICLOUD_STALLED`, `timedOut`
  with `ERR_ICLOUD_TIMEOUT`. Module absent: `triggerSync(name)` (library) then
  poll `exists(name)` with the same limits — the honest degraded path, and the
  reason `shouldKeepWaiting` is pure.
- `copyToScratch(name, localPath)`: module → `copyDownloaded`; absent →
  library `downloadFile` (today's behaviour).
- `watch(cb)` / `unwatch()`: thin wrappers over the module's events, no-ops
  without it.
- `deviceKind()` (I5).

### I4 — repository (`src/features/backup/repository.ts`)

- `restoreFromSqlite(name, onProgress?)` (`:320`): `await icloud.ensureDownloaded(name, onProgress)`
  **before** `restoreScratchFile` is even created; then `copyToScratch` instead
  of `downloadFile`; the `runExclusive` section is unchanged (validate, then
  `applyBackupUnlocked`). `restoreFromName` gains the optional `onProgress`
  and passes it to both routes; the legacy route calls `ensureDownloaded`
  before `icloud.read(name)`.
- `listBackups()` returns `CloudBackupEntry[]` (name, exportedAt, device,
  size, status), newest first. `restoreLatest` picks the newest **restorable**
  entry, else the newest and lets `ensureDownloaded` do the work.
- `createBackupUnlocked` (`:249`): `buildName(now, deviceKind())`. No wait for
  upload here — the screen shows it (I6); the auto-backup path stays
  fire-and-forget.

### I6 — Backups screen (`app/backups.tsx`)

- **Lifecycle**: on focus, `listWithStatus()` seeds the list and `watch()` keeps
  it live; on blur, `unwatch()`. Until the first gather resolves the section
  shows "Checking iCloud…" — "No backups yet" only after a completed gather.
- **Row** (`~250–270`): title stays the relative time; second line becomes
  `{device ?? 'Backup'} · {size}` (e.g. "iPhone · 3.1 MB"; `Backup · 2.9 MB`
  for pre-I5 files). Third line by `rowState`:
  `onDevice` → none; `inCloud` → "In iCloud — tap to download and restore";
  `downloading` → "Downloading… 42%" + a 4 pt progress bar (the existing
  `rounded-pill bg-surfaceAlt` track / `bg-primary` fill pattern from the
  statement queue); `uploading` → "Uploading to iCloud…"; `downloadError` /
  `uploadError` → the error text in `text-negative`. Leading icon: `archive`
  on device, `cloud` in cloud, `upload-cloud` uploading.
- **Restore tap**: `isRestorable` → today's confirm Alert → `restoreFromName`.
  Not restorable → **no Alert yet**: call `ensureDownloaded` with progress
  wired to the row; when it resolves, show the confirm Alert; if it rejects,
  show "Couldn't download this backup from iCloud" with the reason line
  (`downloadingError` / stalled / timed out) and the hint "Check your
  connection, or open the file in Files to download it." Nothing destructive
  has run. The existing "Restore failed" copy now covers only failures *after*
  the file is on the device, and its "hasn't finished downloading" sentence
  goes.
- **Create**: unchanged call; the new row appears via the watcher as
  `uploading` and settles to `onDevice` when `isUploaded` — the first-device
  confidence the user asked for. Keep the "Backup created successfully."
  status line.
- Accessibility labels: keep "Restore backup from …"; the download-first case
  uses the same label (VoiceOver users tap once, the flow does the rest).

### I7 — tests (plain Node)

`backup-format.feature`: `buildName` with `iPhone` / `iPad`; `parseBackupName`
on new, old-without-device, legacy `.json`, unknown segment (→ `device: null`),
unrelated file (→ null); `parseExportedAt` still equals the old behaviour on
all of the above. `backup-sync.feature` (new): `stubToLogicalName` (stub,
non-stub, stub of a non-backup), `rowState` for each status combination
(error beats downloading beats uploading beats inCloud), `isRestorable`,
`shouldKeepWaiting` (wait / stalled at 30 s without progress / timed out at
120 s / progress resets the stall clock), `mergeFallbackListing` mixing stubs
and real files, `CloudEntrySchema` rejecting a malformed payload without
throwing at the caller. Baseline on `origin/main`: **1135** scenarios.

## 6. Acceptance criteria

Checks: `npm run typecheck && npm run lint && npm test && npm run eval` green;
scenarios ≥ 1135 + 14. `package.json` unchanged (no new npm dependency — the
module is in-repo). `ios/` untouched except `pod install`'s `Podfile.lock`
(gitignored); `project.pbxproj` SHA unchanged.

Device (two devices on one iCloud account, or one device + Files → "Remove
Download"; the simulator has no iCloud account — see memory
`headless-simulator-driving` for what it can and can't prove):

1. **New device**: fresh install on B, same account. Backups screen lists A's
   backup within the gather window, row says "In iCloud — tap to download and
   restore" with the real size. Tap → percentage climbs → confirm → restore
   succeeds **on the first attempt**. Data present.
2. **Evicted on the source**: on A, Files → Remove Download for the newest
   backup. App row flips to "In iCloud"; restore works first try.
3. **Create on A**: row appears as "Uploading to iCloud…" and settles; on B the
   row appears without relaunching (watcher).
4. **Offline B**: airplane mode, tap a not-downloaded backup → the download
   error copy with a reason; no confirm Alert; nothing wiped; leaving airplane
   mode and tapping again succeeds.
5. **Names**: new files end `-iPhone.sqlite` on A (iPhone) and `-iPad.sqlite`
   on an iPad; rows show "iPhone ·" / "iPad ·"; a pre-I5 backup shows
   "Backup ·" and still restores; a legacy `.json` still restores; prune keeps
   the newest 3 across all three name styles.
6. **Screen lifecycle**: leave and return to Backups five times — one watcher
   at a time (log the start/stop), no duplicate events, no leaked query after
   backgrounding.
7. **Simulator**: iCloud-unavailable copy unchanged; with the module compiled
   out (Android build or `requireOptionalNativeModule` returning null in a
   test double) the adapter's fallback listing maps stubs and `ensureDownloaded`
   uses `triggerSync` + `exists` polling — unit-tested via the pure helpers,
   smoke-tested by a jest double of the adapter.

## 7. Constraints

- Working agreement: guardrail #6 — the module's payload is zod-validated in
  the adapter; parameterised SQL n/a; no PII — the filename carries only the
  idiom; never `expo prebuild` / `eas build --local`; **`pod install` is
  allowed** (it is how `apple-ocr` and `widget-bridge` are linked); do not
  edit `.pbxproj`.
- Bare `grep`/`find`/`npx jest` are hooked — `/usr/bin/grep`, `/usr/bin/find`,
  `node_modules/.bin/*`; verify via `npm run …` only.
- Keep the library for upload/delete/legacy read — replacing it is a separate
  decision; the adapter boundary (`icloud.ts` is the only importer) is what
  makes this incremental.
- The restore's destructive section, its gate, and the row validation are not
  touched; every new wait happens before `restoreScratchFile` exists.
- Never call `evictUbiquitousItem`; the app never removes local copies.

## 8. Edge cases

- **Two iPhones on one account** produce identical labels — accepted; the
  timestamp distinguishes them.
- **Gather timeout** (8 s) on a slow first sync: show "Checking iCloud…" then
  fall back to the library listing (stub-mapped) so the row still appears as
  "In iCloud"; the watcher keeps trying.
- **Download stalls on cellular** (iOS may defer large transfers): `stalled`
  after 30 s without progress → the error copy with the Files hint; the user
  can retry; nothing destructive ran.
- **Delete of a not-downloaded backup** (prune): library `unlink` on the
  logical name → `removeItem(at:)` on the placeholder, which iCloud honours.
  Verify once on device; if it throws, prune skips it (already non-fatal).
- **Partially written file**: the coordinator only hands over a materialised
  item, and the row validator still runs before apply — a truncated SQLite
  fails `missingTables`/row validation, not the wipe.
- **Theme/AX**: the row's third line uses `caption`; the progress bar is 4 pt
  and reads through `accessibilityValue` ("42 percent").
- **Background**: the watcher stops on blur; a download started from the
  screen continues in iOS's own daemon and is picked up by `status` on return.

## 9. Order and fallback

Ship I5 first (pure, one commit, its own device check #5). Then I1 + I3 + I2
together (the module is useless without the adapter), then I4, I6, I7 in the
same run. Fallback if `NSMetadataQuery` proves unreliable on device: keep the
stub-mapped listing (I3/I2 fallback path) + `status` via resource values +
the coordinated copy — that alone fixes D1 and D2 without a percentage, and
the UI degrades to an indeterminate spinner. Do not ship `exists()` polling as
the primary path.

Follow-ups (not this run): replacing the library outright once the module
covers upload; a "Download all" affordance; surfacing `isUploaded` for
auto-backups in Settings' Data row.

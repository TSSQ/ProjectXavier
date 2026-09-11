import ExpoModulesCore
import Foundation

/// NSMetadataQuery-backed iCloud Documents bridge for backup sync
/// (docs/design/icloud-backup-sync-spec.md). `react-native-cloud-storage`
/// 3.0.1 — still used for upload/delete/legacy read; `src/features/backup/
/// icloud.ts` is the only importer of either — has no metadata-query-backed
/// listing (so a not-yet-downloaded backup is invisible to its `readdir`,
/// which lists it only as a dotted `.name.icloud` stub — D1), never starts a
/// download on its restore path (D2), and exposes no upload/download status
/// (D3). This module fills exactly that gap and nothing else: uploads and
/// deletes keep going through the library.
///
/// Stateless except for the one live watch query `startWatching`/
/// `stopWatching` own — the screen (I6) starts it on focus and stops it on
/// blur, so at most one query is ever running, and never in the background.
public class ICloudBridgeModule: Module {
  private var watchQuery: NSMetadataQuery?
  private var watchObservers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("ICloudBridge")

    Events("onDocumentsChanged")

    // AsyncFunction bodies run on ExpoModulesCore's shared background queue,
    // not the main thread (same seam AppleOcrModule documents) — the
    // NSMetadataQuery calls inside still hop onto the main thread themselves
    // (queries must start/observe there); everything else runs here.
    AsyncFunction("listDocuments") { (prefix: String) async throws -> [[String: Any]] in
      try await listDocuments(prefix: prefix)
    }

    AsyncFunction("startDownload") { (name: String) throws in
      try startDownload(name: name)
    }

    AsyncFunction("status") { (name: String) throws -> [String: Any] in
      try documentStatus(name: name)
    }

    AsyncFunction("copyDownloaded") { (name: String, localPath: String) throws in
      try copyDownloaded(name: name, localPath: localPath)
    }

    // `startWatching`/`stopWatching` are synchronous `Function`s, so their
    // bodies run on the JS thread by default — dispatched to main here (QA
    // round 3 M2) because `NSMetadataQuery` requires a thread with an
    // active run loop, both its notification observers fire on `.main`
    // (see `startWatchingOnMain` below), and `watchQuery`/`watchObservers`
    // must only ever be read/written from one thread. Before this fix, a
    // blur landing mid-`emit` (which itself runs on main, between its
    // `disableUpdates()`/`enableUpdates()` pair) could run `stopWatching`'s
    // `query.stop()`/`removeObserver` off-main concurrently with that —
    // exactly the kind of race spec §6.6 ("leave and return five times, one
    // watcher at a time, no duplicate events, no leaked query") is checking
    // for, intermittently.
    Function("startWatching") { (prefix: String) in
      DispatchQueue.main.async {
        self.startWatchingOnMain(prefix: prefix)
      }
    }

    Function("stopWatching") {
      DispatchQueue.main.async {
        self.stopWatchingOnMain()
      }
    }
  }

  // MARK: - startWatching / stopWatching

  /// One live `NSMetadataQuery` (same scope/predicate as `listDocuments`)
  /// that emits `onDocumentsChanged` on both
  /// `.NSMetadataQueryDidFinishGathering` and `.NSMetadataQueryDidUpdate`.
  /// Idempotent: a second call replaces the first (`stopWatchingOnMain()`
  /// first), so there is only ever at most one query running. Must only be
  /// called on main (see the `DispatchQueue.main.async` wrapper in
  /// `definition()` above) — `documentsURL()` itself blocks
  /// (`FileManager.url(forUbiquityContainerIdentifier:)` is documented as
  /// such), on top of `NSMetadataQuery`'s own main-run-loop requirement.
  private func startWatchingOnMain(prefix: String) {
    stopWatchingOnMain()
    guard (try? documentsURL()) != nil else { return }

    let query = NSMetadataQuery()
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(format: "%K BEGINSWITH %@", NSMetadataItemFSNameKey, prefix)

    let emit: (Notification) -> Void = { [weak self] _ in
      guard let self else { return }
      query.disableUpdates()
      let items = itemsPayload(from: query)
      query.enableUpdates()
      self.sendEvent("onDocumentsChanged", ["items": items])
    }

    let finishObserver = NotificationCenter.default.addObserver(
      forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main, using: emit)
    let updateObserver = NotificationCenter.default.addObserver(
      forName: .NSMetadataQueryDidUpdate, object: query, queue: .main, using: emit)

    watchObservers = [finishObserver, updateObserver]
    watchQuery = query
    // `NSMetadataQuery` predates Sendable and never will conform (Apple's
    // own header) — capturing it here is the standard, safe way to start
    // it; the compiler's Sendable-closure warning on this line is expected
    // and non-blocking. Already on main (the caller dispatched), so this
    // starts synchronously rather than hopping again.
    query.start()
  }

  /// Safe to call when nothing is running (the screen calls this on every
  /// blur regardless of whether it ever started a watch). Must only be
  /// called on main — see `startWatchingOnMain`.
  private func stopWatchingOnMain() {
    for observer in watchObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    watchObservers = []
    watchQuery?.stop()
    watchQuery = nil
  }
}

// MARK: - Container

/// Same Documents scope the library writes to (its private
/// `CloudKitUtils.documentsDirectory`, node_modules/react-native-cloud-
/// storage/ios/Utils/CloudKitUtils.swift, is the identical expression) —
/// logged once in debug builds so a future change on either side that
/// drifts the scope is visible immediately instead of silently listing or
/// watching a different folder than backups are actually uploaded to.
private var loggedDocumentsScopeOnce = false

private func documentsURL() throws -> URL {
  guard
    let url = FileManager.default.url(forUbiquityContainerIdentifier: nil)?
      .appendingPathComponent("Documents")
  else {
    throw ICloudContainerUnavailableException()
  }
  #if DEBUG
    if !loggedDocumentsScopeOnce {
      loggedDocumentsScopeOnce = true
      print("ICloudBridge: iCloud Documents container = \(url.path)")
    }
  #endif
  return url
}

// MARK: - listDocuments

/// One-shot `NSMetadataQuery` — waits for `.NSMetadataQueryDidFinishGathering`
/// (timeout 8s), snapshots the results, stops the query. Logical names
/// only: the query never returns `.icloud` stubs (that's `readdir`'s
/// behaviour, which is exactly what this function exists to avoid for the
/// listing path — D1).
private func listDocuments(prefix: String) async throws -> [[String: Any]] {
  _ = try documentsURL()  // fail fast (and log the scope) if iCloud isn't available at all

  let query = NSMetadataQuery()
  query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
  query.predicate = NSPredicate(format: "%K BEGINSWITH %@", NSMetadataItemFSNameKey, prefix)

  return try await withCheckedThrowingContinuation { continuation in
    // @unchecked Sendable: every read/write of `finished`/`observer` below
    // happens on the main queue only (the `DispatchQueue.main.async` block
    // right below, and the two `finish` calls it schedules) — a single
    // serial queue, never accessed concurrently, so the usual Sendable
    // concern (unsynchronised cross-thread mutation) doesn't apply here.
    final class FinishState: @unchecked Sendable {
      var finished = false
      var observer: NSObjectProtocol?
    }
    let state = FinishState()

    func finish(_ result: Result<[[String: Any]], Error>) {
      guard !state.finished else { return }
      state.finished = true
      if let observer = state.observer {
        NotificationCenter.default.removeObserver(observer)
      }
      query.stop()
      continuation.resume(with: result)
    }

    DispatchQueue.main.async {
      state.observer = NotificationCenter.default.addObserver(
        forName: .NSMetadataQueryDidFinishGathering,
        object: query,
        queue: .main
      ) { _ in
        query.disableUpdates()
        let items = itemsPayload(from: query)
        query.enableUpdates()
        finish(.success(items))
      }

      query.start()

      DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
        finish(.failure(ICloudGatherTimeoutException()))
      }
    }
  }
}

/// Snapshots every result of a (gathered or live) query into the item shape
/// the JS side validates with `CloudEntrySchema` (src/domain/backupSync.ts).
/// Caller is responsible for `disableUpdates()`/`enableUpdates()` around
/// this while the query is live.
private func itemsPayload(from query: NSMetadataQuery) -> [[String: Any]] {
  query.results.compactMap { result -> [String: Any]? in
    guard let item = result as? NSMetadataItem else { return nil }
    return itemDict(item)
  }
}

private func itemDict(_ item: NSMetadataItem) -> [String: Any] {
  let name = item.value(forAttribute: NSMetadataItemFSNameKey) as? String ?? ""
  // No `?? 0` (QA round 4 minor 4 — finishing M1's job): omitted when nil,
  // same idiom as every other optional field below, rather than a size
  // that silently reads as a real, tiny "0 bytes" file.
  let size = (item.value(forAttribute: NSMetadataItemFSSizeKey) as? NSNumber)?.intValue
  let downloadStatus = mapDownloadStatus(
    item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
  )
  let isDownloading =
    (item.value(forAttribute: NSMetadataUbiquitousItemIsDownloadingKey) as? NSNumber)?
    .boolValue ?? false
  let percentDownloaded = (item.value(forAttribute: NSMetadataUbiquitousItemPercentDownloadedKey)
    as? NSNumber)?.doubleValue
  let isUploaded =
    (item.value(forAttribute: NSMetadataUbiquitousItemIsUploadedKey) as? NSNumber)?
    .boolValue ?? false
  let isUploading =
    (item.value(forAttribute: NSMetadataUbiquitousItemIsUploadingKey) as? NSNumber)?
    .boolValue ?? false
  let percentUploaded = (item.value(forAttribute: NSMetadataUbiquitousItemPercentUploadedKey)
    as? NSNumber)?.doubleValue
  let downloadingError =
    (item.value(forAttribute: NSMetadataUbiquitousItemDownloadingErrorKey) as? NSError)?
    .localizedDescription
  let uploadingError =
    (item.value(forAttribute: NSMetadataUbiquitousItemUploadingErrorKey) as? NSError)?
    .localizedDescription

  var dict: [String: Any] = [
    "name": name,
    "downloadStatus": downloadStatus,
    "isDownloading": isDownloading,
    "isUploaded": isUploaded,
    "isUploading": isUploading,
  ]
  // Omitted (not NSNull()) when nil — one idiom for every optional field
  // (QA round 3 M1, extended to `size` in round 4), matching
  // downloadingError/uploadingError below rather than requiring NSNull()
  // to survive the bridge intact for a REQUIRED key to be present;
  // CloudEntrySchema (src/domain/backupSync.ts) reads all these the same
  // way (`.nullish()`/`.optional()`), and the adapter
  // (src/features/backup/icloud.ts) maps an absent `size` to `NaN`
  // ("unknown"), never `0`.
  if let size {
    dict["size"] = size
  }
  if let percentDownloaded {
    dict["percentDownloaded"] = percentDownloaded
  }
  if let percentUploaded {
    dict["percentUploaded"] = percentUploaded
  }
  if let downloadingError {
    dict["downloadingError"] = downloadingError
  }
  if let uploadingError {
    dict["uploadingError"] = uploadingError
  }
  return dict
}

private func mapDownloadStatus(_ raw: String?) -> String {
  switch raw {
  case NSMetadataUbiquitousItemDownloadingStatusCurrent: return "current"
  case NSMetadataUbiquitousItemDownloadingStatusDownloaded: return "downloaded"
  default: return "notDownloaded"
  }
}

private func mapDownloadStatus(_ status: URLUbiquitousItemDownloadingStatus?) -> String {
  switch status {
  case .some(.current): return "current"
  case .some(.downloaded): return "downloaded"
  default: return "notDownloaded"
  }
}

// MARK: - startDownload

/// `startDownloadingUbiquitousItem` on the logical URL — the call
/// `react-native-cloud-storage`'s own restore path never makes (D2).
/// Rethrows the real `NSError` (never a generic wrapper) so the JS side can
/// surface the actual reason.
private func startDownload(name: String) throws {
  let url = try documentsURL().appendingPathComponent(name)
  do {
    try FileManager.default.startDownloadingUbiquitousItem(at: url)
  } catch {
    throw ICloudDownloadException(error as NSError)
  }
}

// MARK: - status

/// Resource values on the **logical** URL — works even for a placeholder
/// (`.icloud` stub) that hasn't been downloaded yet. No percentage here;
/// that only comes from the live watcher's events (`startWatching`) — QA
/// round 3 M1: `percentDownloaded`/`percentUploaded` are now OMITTED
/// entirely (not sent as `NSNull()`), matching `itemDict` above's idiom and
/// `CloudEntrySchema`'s `.nullish()` (src/domain/backupSync.ts), which
/// tolerates either "absent" or "null" identically.
private func documentStatus(name: String) throws -> [String: Any] {
  let url = try documentsURL().appendingPathComponent(name)
  let keys: Set<URLResourceKey> = [
    .ubiquitousItemDownloadingStatusKey,
    .ubiquitousItemIsDownloadingKey,
    .ubiquitousItemDownloadingErrorKey,
    .ubiquitousItemIsUploadedKey,
    .ubiquitousItemIsUploadingKey,
    .ubiquitousItemUploadingErrorKey,
  ]
  let values = try url.resourceValues(forKeys: keys)

  var dict: [String: Any] = [
    "name": name,
    "downloadStatus": mapDownloadStatus(values.ubiquitousItemDownloadingStatus),
    "isDownloading": values.ubiquitousItemIsDownloading ?? false,
    "isUploaded": values.ubiquitousItemIsUploaded ?? false,
    "isUploading": values.ubiquitousItemIsUploading ?? false,
  ]
  if let error = values.ubiquitousItemDownloadingError {
    dict["downloadingError"] = error.localizedDescription
  }
  if let error = values.ubiquitousItemUploadingError {
    dict["uploadingError"] = error.localizedDescription
  }
  return dict
}

// MARK: - copyDownloaded

/// `NSFileCoordinator` read-coordinates the logical URL — this itself
/// blocks until the item is materialised (the belt to `ensureDownloaded`'s
/// braces on the JS side), then copies it to `localPath`. The destination
/// must not already exist (caller guarantees, same contract the library's
/// `downloadFile` already has).
private func copyDownloaded(name: String, localPath: String) throws {
  let source = try documentsURL().appendingPathComponent(name)
  let destination = URL(fileURLWithPath: localPath)

  var coordinatorError: NSError?
  var copyError: Error?
  NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinatorError) {
    coordinatedURL in
    do {
      try FileManager.default.copyItem(at: coordinatedURL, to: destination)
    } catch {
      copyError = error
    }
  }

  if let coordinatorError {
    throw ICloudCopyException(coordinatorError)
  }
  if let copyError {
    throw ICloudCopyException(copyError as NSError)
  }
}

// MARK: - Exceptions

/// No iCloud container at all — the user isn't signed in, or the
/// entitlement/container id doesn't resolve. Distinct from `notDownloaded`
/// (a real, listed file that just isn't local yet).
internal final class ICloudContainerUnavailableException: Exception {
  override var code: String { "ERR_ICLOUD_UNAVAILABLE" }
  override var reason: String {
    "iCloud container is not available — the user may not be signed in to iCloud."
  }
}

/// `NSMetadataQuery` never finished gathering within the 8s budget — a slow
/// first sync, not a real failure; the fallback listing (I2) covers this
/// case (see the spec's §8 edge cases).
internal final class ICloudGatherTimeoutException: Exception {
  override var code: String { "ERR_ICLOUD_GATHER_TIMEOUT" }
  override var reason: String {
    "iCloud metadata query did not finish gathering within 8 seconds."
  }
}

/// Wraps the real `NSError` from `startDownloadingUbiquitousItem` — never a
/// generic wrapper (D2's whole point), so the JS side sees the actual
/// reason instead of an indistinguishable "file not found".
internal final class ICloudDownloadException: GenericException<NSError> {
  override var code: String { "ERR_ICLOUD_DOWNLOAD" }
  override var reason: String {
    "\(param.localizedDescription) (\(param.domain) \(param.code))"
  }
}

/// Wraps the real `NSError` from the coordinated read or the copy itself.
internal final class ICloudCopyException: GenericException<NSError> {
  override var code: String { "ERR_ICLOUD_COPY" }
  override var reason: String {
    "\(param.localizedDescription) (\(param.domain) \(param.code))"
  }
}

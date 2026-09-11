/**
 * Pure iCloud-sync policy for backups (docs/design/icloud-backup-sync-spec.md,
 * I3): stub-name mapping (fallback listing, no native module), the status
 * merge (many raw flags → one `RowState` the screen renders), and the
 * download plan / timeout policy (`shouldKeepWaiting`) that drives
 * `ensureDownloaded`'s polling loop.
 *
 * No React Native / Expo / DB imports — Node-testable (tests/__features__/
 * backup-sync.feature). The native module's payload
 * (modules/icloud-bridge/ios/ICloudBridgeModule.swift) crosses a trust
 * boundary (guardrail #6) — `CloudEntrySchema` validates it before the
 * adapter (src/features/backup/icloud.ts) builds a `CloudEntryStatus` from
 * it. For the LIST, a malformed item becomes `downloadStatus:
 * 'notDownloaded'` with no error, never a throw that would abort the whole
 * list — but `parseCloudEntryOrThrow` (QA round 3 M1) is the deliberate
 * exception to that rule for a SINGLE item's status, used only by
 * `ensureDownloaded`'s polling loop, where the same silent degrade would
 * read as "not downloaded yet" forever instead of surfacing the real
 * problem (a native-contract drift, not a stalled transfer).
 */
import { z } from 'zod';

// ─── Stub-name mapping (fallback listing, no native module) ────────────────

/**
 * `FileManager.contentsOfDirectory` (what `react-native-cloud-storage`'s
 * `readdir` uses) lists a not-yet-downloaded iCloud item by its dotted stub
 * name: `.<name>.icloud`. This recovers the logical name from a stub, or
 * returns null for anything that isn't one (including a stub of a file that
 * isn't a backup at all — the caller filters those out separately via
 * `parseBackupName`, this function only knows about the stub convention).
 */
export function stubToLogicalName(name: string): string | null {
  const STUB_SUFFIX = '.icloud';
  if (!name.startsWith('.') || !name.endsWith(STUB_SUFFIX)) return null;
  return name.slice(1, name.length - STUB_SUFFIX.length);
}

/**
 * Maps a raw `readdir` listing (a mix of stub names for not-yet-downloaded
 * items and plain names for items already on this device) to logical names
 * with a `downloaded` flag — the no-native-module fallback listing (spec
 * §9's fallback path, §2's D1 fix without a native module).
 *
 * Deduplicates by logical name (QA round 1): a transient OS race can report
 * BOTH the dotted stub and the materialized file for the same logical name
 * in one `readdir` — e.g. mid-download, or the moment iCloud finishes
 * writing it. Without this, two rows would share the same React `key` in
 * the Backups list. `downloaded: true` wins a collision — the materialized
 * copy is the more accurate, more useful signal (it's already restorable).
 */
export function mergeFallbackListing(names: string[]): { name: string; downloaded: boolean }[] {
  const byName = new Map<string, boolean>();
  for (const name of names) {
    const logical = stubToLogicalName(name);
    const resolvedName = logical ?? name;
    const downloaded = logical === null;
    // Map.set on an existing key updates the value in place without moving
    // it — first-seen position is preserved either way.
    byName.set(resolvedName, byName.get(resolvedName) === true ? true : downloaded);
  }
  return Array.from(byName, ([name, downloaded]) => ({ name, downloaded }));
}

// ─── Listing fallthrough (QA round 3 B1) ────────────────────────────────

/**
 * `listWithStatus` (src/features/backup/icloud.ts) tries the native
 * module's `listDocuments` first and falls back to the library's `readdir`
 * listing on failure — the fallback that spec §8/§9 describe, which was
 * unreachable on a real device before this: `listDocuments` rejects on
 * `ERR_ICLOUD_GATHER_TIMEOUT` (an 8s NSMetadataQuery gather budget — a slow
 * first sync, not a real failure) and `ERR_ICLOUD_UNAVAILABLE`, and nothing
 * caught it, so the fallback beneath it was only reachable when the module
 * is null (never in a real iOS build).
 *
 * When `fallbackListing` ALSO throws (QA round 4 M4 — the branch the
 * original scenarios missed), the decision is: let it propagate. Nothing
 * generic over `T` can synthesise a sensible empty/default result, so
 * catching it here would mean inventing a value the caller never asked
 * for; `listWithStatus`'s own caller (`app/backups.tsx`'s focus-effect
 * gather, fixed the same round) now has a real try/catch with a visible
 * error and a Retry button, so propagating is safe rather than a repeat of
 * B1's unhandled-rejection symptom.
 *
 * `console.warn`ed on the module-listing failure (QA round 4 minor 1) —
 * the degrade itself is safe, but silent: a persistently-failing
 * `listDocuments` (e.g. a missing entitlement in a beta build) would
 * otherwise degrade to a plausible-looking list with no percentages and no
 * live updates forever, and nobody doing the spec §6.1–§6.6 device checks
 * would have any signal the module isn't actually working — the same
 * argument that won `statusFor` its `CloudStatusSchemaError` in M1, one
 * function over.
 *
 * Pure control flow — generic over `T` so a smoke test can prove the
 * fallthrough itself (module listing throws → fallback listing's result is
 * returned; module listing succeeds → fallback is never called; both throw
 * → the rejection propagates) with fakes standing in for the two native
 * calls, without a simulator (spec §6.7).
 */
export async function listWithFallback<T>(
  moduleListing: () => Promise<T>,
  fallbackListing: () => Promise<T>,
): Promise<T> {
  try {
    return await moduleListing();
  } catch (e) {
    console.warn('iCloud module listing failed, using fallback listing:', e);
    return await fallbackListing();
  }
}

// ─── Status merge ────────────────────────────────────────────────────────

export type DownloadStatus = 'current' | 'downloaded' | 'notDownloaded';

export interface CloudEntryStatus {
  downloadStatus: DownloadStatus;
  isDownloading: boolean;
  percentDownloaded: number | null;
  isUploaded: boolean;
  isUploading: boolean;
  percentUploaded: number | null;
  downloadingError: string | null;
  uploadingError: string | null;
}

export type RowState =
  | 'onDevice'
  | 'inCloud'
  | 'downloading'
  | 'uploading'
  | 'downloadError'
  | 'uploadError';

/**
 * Merges every raw status flag into the single state the Backups row
 * renders (app/backups.tsx). Precedence (highest first): an error beats
 * downloading beats uploading beats inCloud — a stalled/failed transfer
 * must never be masked by a lower-priority "still in the cloud" line, and an
 * active transfer must never be masked by "in the cloud" either. `onDevice`
 * is the default: no error, nothing in flight, and the file is already
 * local (`current` or `downloaded`).
 */
export function rowState(s: CloudEntryStatus): RowState {
  if (s.downloadingError !== null) return 'downloadError';
  if (s.uploadingError !== null) return 'uploadError';
  if (s.isDownloading) return 'downloading';
  if (s.isUploading) return 'uploading';
  if (s.downloadStatus === 'notDownloaded') return 'inCloud';
  return 'onDevice';
}

/** Whether a backup can be restored right now without waiting for a
 *  download first — `current` (fully synced) and not mid-transfer. */
export function isRestorable(s: CloudEntryStatus): boolean {
  return s.downloadStatus === 'current' && !s.isDownloading;
}

// ─── Download plan / timeout policy ─────────────────────────────────────

export interface WaitLimits {
  maxMs: number;
  stallMs: number;
}

export const DEFAULT_WAIT_LIMITS: WaitLimits = { maxMs: 120_000, stallMs: 30_000 };

/**
 * The decision `ensureDownloaded`'s polling loop (src/features/backup/
 * icloud.ts) makes on every tick: keep waiting, give up because progress has
 * stalled, or give up because the whole download has taken too long.
 * `timedOut` takes precedence over `stalled` — the total-time cap is a hard
 * ceiling regardless of how recently progress was last seen.
 *
 * `lastProgressAt` is `null` when the caller has no progress signal at all
 * (QA round 1 — the module-absent fallback path only has `exists()`, never
 * a percentage): the stall comparison is meaningless against a timestamp
 * that can never move, so it's skipped entirely and only the `maxMs` budget
 * applies. Passing `startedAt` as a stand-in for "no signal" (the original,
 * buggy shape) makes `now - lastProgressAt` equal `elapsedMs` on every
 * tick, so `stallMs` (30s) — being less than `maxMs` (120s) — always fires
 * first and silently caps every fallback download at 30s instead of 120s.
 *
 * @param elapsedMs      Total time elapsed since the download started.
 * @param lastProgressAt Timestamp (ms since epoch) progress was last
 *                        observed, or `null` if this path has no progress
 *                        signal at all.
 * @param now             Current time (ms since epoch).
 * @param limits          `maxMs` (total budget) / `stallMs` (no-progress budget).
 */
export function shouldKeepWaiting(
  elapsedMs: number,
  lastProgressAt: number | null,
  now: number,
  limits: WaitLimits = DEFAULT_WAIT_LIMITS,
): 'wait' | 'stalled' | 'timedOut' {
  if (elapsedMs >= limits.maxMs) return 'timedOut';
  if (lastProgressAt !== null && now - lastProgressAt >= limits.stallMs) return 'stalled';
  return 'wait';
}

// ─── Native payload validation (guardrail #6) ───────────────────────────

/**
 * Shape-guards `CloudStorage.readdir`'s return (QA round 3 minor 5) — the
 * same trust-boundary standard `CloudEntrySchema` below already holds the
 * native module's payload to; `readdir`'s TS type says `string[]`, but it
 * crosses the identical external-library boundary, so it gets the identical
 * treatment. Never a throw: an unexpected shape degrades to an empty
 * listing (the same "no file, not an error" tolerance the rest of the
 * fallback path already has), not an unhandled rejection.
 */
export const CloudNamesSchema = z.array(z.string());

/**
 * The shape `ICloudBridge.listDocuments`/`status`
 * (modules/icloud-bridge/ios/ICloudBridgeModule.swift) return, validated
 * before the adapter (src/features/backup/icloud.ts) trusts any of it. A
 * failed parse must never throw at the caller — the adapter falls back to
 * `downloadStatus: 'notDownloaded'` with no error for that one entry (spec
 * §2 D3) rather than losing the whole list over one malformed item.
 */
export const CloudEntrySchema = z.object({
  name: z.string().min(1),
  // Optional: `listDocuments` includes it, `status` (no percentage/size —
  // see modules/icloud-bridge/ios/ICloudBridgeModule.swift) does not. One
  // schema covers both native payload shapes rather than splitting it in
  // two — callers that need it treat an absent/malformed size as `NaN`
  // ("unknown"), not `0` (QA round 3 minor 4, unified round 4 minor 4 —
  // see `CloudBackupEntry.size`, src/features/backup/icloud.ts).
  size: z.number().nonnegative().optional(),
  downloadStatus: z.enum(['current', 'downloaded', 'notDownloaded']),
  isDownloading: z.boolean(),
  // `.nullish()`, not `.nullable()` (QA round 3 M1): the Swift side omits
  // downloadingError/uploadingError entirely when nil rather than sending
  // NSNull(), and now does the same for these two — one idiom on both sides
  // instead of a required key whose presence depended on NSNull() surviving
  // the bridge intact.
  percentDownloaded: z.number().nullish(),
  isUploaded: z.boolean(),
  isUploading: z.boolean(),
  percentUploaded: z.number().nullish(),
  downloadingError: z.string().nullish(),
  uploadingError: z.string().nullish(),
});

export type CloudEntry = z.infer<typeof CloudEntrySchema>;

/**
 * Thrown by `parseCloudEntryOrThrow` when a native status payload fails
 * `CloudEntrySchema` (QA round 3 M1). Distinct from every other
 * `ensureDownloaded` failure (`ERR_ICLOUD_STALLED`/`ERR_ICLOUD_TIMEOUT`) —
 * before this, a malformed single-item payload silently became
 * `FALLBACK_STATUS` (`downloadStatus: 'notDownloaded'`), which is the right
 * degrade for the LIST (one bad item must never drop the rest — guardrail
 * #6, "never a throw in the list"), but wrong for `ensureDownloaded`'s
 * single-item polling loop: `isRestorable` can then never become true, so
 * the loop burns the full `maxMs` budget and reports "your download timed
 * out" for a problem that is really "the native contract drifted" — a
 * misleading reason with no diagnostic. `statusFor`
 * (src/features/backup/icloud.ts) uses this instead of the list's lenient
 * fallback; the list itself is untouched.
 */
export class CloudStatusSchemaError extends Error {
  constructor(name: string) {
    super(`ERR_ICLOUD_STATUS_SCHEMA: native status payload for "${name}" did not match the expected shape.`);
    this.name = 'CloudStatusSchemaError';
  }
}

/**
 * Validates a single native status payload, throwing `CloudStatusSchemaError`
 * (rather than degrading to a status that reads as legitimate) on failure —
 * see `CloudStatusSchemaError` above. Pure — Node-testable directly, unlike
 * `statusFor` itself (src/features/backup/icloud.ts), which awaits the
 * native call this validates the result of.
 */
export function parseCloudEntryOrThrow(raw: unknown, name: string): CloudEntry {
  const parsed = CloudEntrySchema.safeParse(raw);
  if (!parsed.success) throw new CloudStatusSchemaError(name);
  return parsed.data;
}

/** A safe, no-error status to fall back to when a native payload item fails
 *  `CloudEntrySchema` validation — never a throw, never a fabricated error
 *  message for a defect that's really "the payload was malformed", not the
 *  file's own transfer state. */
export const FALLBACK_STATUS: CloudEntryStatus = {
  downloadStatus: 'notDownloaded',
  isDownloading: false,
  percentDownloaded: null,
  isUploaded: false,
  isUploading: false,
  percentUploaded: null,
  downloadingError: null,
  uploadingError: null,
};

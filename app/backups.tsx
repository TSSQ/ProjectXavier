/**
 * Backups screen — manual backup creation, automatic backup toggle, and
 * restore from a previous snapshot.
 *
 * Reached from Settings → Data → Backups.
 *
 * Since docs/design/icloud-backup-sync-spec.md (I6), the list is live: on
 * focus it seeds from `listBackups()` (which now carries each entry's cloud
 * status) and stays live via `watch()`; on blur it stops
 * (`unwatch()`) — one watcher at a time, never left running in the
 * background. A row that isn't downloaded yet is downloaded first
 * (`ensureDownloaded`, with progress wired straight into that row) — nothing
 * destructive runs until the file is fully on the device and the user has
 * confirmed.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SectionLabel } from '../src/components/ui/SectionLabel';
import { useThemeColors } from '../src/theme/useThemeColors';
import { getSetting, setSetting } from '../src/features/settings/repository';
import {
  createBackup,
  listBackups,
  restoreFromName,
} from '../src/features/backup/repository';
import {
  isAvailable as isICloudAvailable,
  ensureDownloaded,
  watch,
  unwatch,
  CloudBackupEntry,
} from '../src/features/backup/icloud';
import { resolveAutoBackupEnabled } from '../src/domain/backupPolicy';
import { rowState, isRestorable, RowState, CloudEntryStatus, CloudStatusSchemaError } from '../src/domain/backupSync';
import { useAvatar } from '../src/context/AvatarContext';

/** Format a byte count as a human-readable MB string. `NaN` (QA round 3
 *  minor 4 — see `CloudBackupEntry.size`, src/features/backup/icloud.ts, for
 *  why a sentinel rather than a nullable type) means genuinely unknown — the
 *  fallback listing can't `stat` a not-yet-downloaded stub — rendered as
 *  "Size unknown" rather than the old `0` stand-in, which read as "<0.1 MB"
 *  for e.g. a real 3 MB backup. */
function formatSize(bytes: number): string {
  if (Number.isNaN(bytes)) return 'Size unknown';
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? '<0.1 MB' : `${mb.toFixed(1)} MB`;
}

/** Maps a download failure to copy the user can act on (QA round 4 minor
 *  3) — before this, `CloudStatusSchemaError`'s technical message
 *  ("ERR_ICLOUD_STATUS_SCHEMA: native status payload for … did not match
 *  the expected shape.") was shown verbatim, followed by advice to check
 *  the connection, which cannot help for a payload-shape mismatch. The
 *  technical string stays on the Error itself (and is `console.warn`ed
 *  below) for logs — only the copy shown to the user changes. */
function downloadErrorMessage(e: unknown): string {
  if (e instanceof CloudStatusSchemaError) {
    return "iCloud sent back something this version of the app doesn't recognise. Try again, or check for an app update.";
  }
  // The connection/Files hint used to be appended to EVERY download error,
  // including the schema case above where it is useless. It belongs here, with
  // the transfer failures it actually fits.
  const detail = e instanceof Error ? e.message : 'An error occurred.';
  return `${detail}\n\nCheck your connection, or open the file in Files to download it.`;
}

/** Format a timestamp as a relative time string (e.g. "2 hours ago"). */
function formatRelativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

/** Leading icon by row state — `archive` once it's actually on this device,
 *  `cloud` for anything still in iCloud (including a stalled/failed
 *  download), `upload-cloud` while this device is the one uploading it. */
function rowIcon(state: RowState): React.ComponentProps<typeof Feather>['name'] {
  switch (state) {
    case 'inCloud':
    case 'downloading':
    case 'downloadError':
      return 'cloud';
    case 'uploading':
    case 'uploadError':
      return 'upload-cloud';
    case 'onDevice':
      return 'archive';
  }
}

interface StatusLine {
  text: string;
  isError: boolean;
  showProgress: boolean;
}

/** The row's third line — `null` for `onDevice` (nothing to say). */
function statusLine(entry: CloudBackupEntry): StatusLine | null {
  switch (rowState(entry.status)) {
    case 'onDevice':
      return null;
    case 'inCloud':
      return { text: 'In iCloud — tap to download and restore', isError: false, showProgress: false };
    case 'downloading': {
      const pct = entry.status.percentDownloaded;
      const text = pct === null ? 'Downloading…' : `Downloading… ${Math.round(pct)}%`;
      return { text, isError: false, showProgress: true };
    }
    case 'uploading':
      return { text: 'Uploading to iCloud…', isError: false, showProgress: false };
    case 'downloadError':
      return {
        text: entry.status.downloadingError ?? 'Download failed.',
        isError: true,
        showProgress: false,
      };
    case 'uploadError':
      return {
        text: entry.status.uploadingError ?? 'Upload failed.',
        isError: true,
        showProgress: false,
      };
  }
}

export default function BackupsScreen() {
  const c = useThemeColors();
  const { reload: reloadAvatar } = useAvatar();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [iCloudAvailable, setICloudAvailable] = useState<boolean | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(resolveAutoBackupEnabled(null));
  const [backups, setBackups] = useState<CloudBackupEntry[]>([]);
  const [hasGathered, setHasGathered] = useState(false);
  const [creating, setCreating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  // Set only when the focus-effect gather itself failed (QA round 4 Major
  // M4) — distinct from `statusMessage` (create-backup feedback). Shown
  // with a Retry button; before this fix an uncaught rejection anywhere in
  // the gather (e.g. `listWithStatus` — B1's exact symptom, one layer up:
  // a fresh iCloud container whose Documents folder hasn't materialised
  // yet still throws from the fallback's `readdir`, even after B1's
  // module-to-fallback fallthrough) left the screen on "Checking iCloud…"
  // forever, recoverable only by leaving and re-entering the screen — a
  // property of `useFocusEffect` re-running, not anything this screen
  // guaranteed.
  const [gatherError, setGatherError] = useState<string | null>(null);
  // Bumped by the Retry button so the memoized focus-effect callback below
  // gets a new identity and useFocusEffect re-runs it without requiring a
  // blur/refocus.
  const [retryToken, setRetryToken] = useState(0);
  // Per-row in-flight guard (QA round 3 minor 2) — without this, a second
  // tap during a 120s `ensureDownloaded` started a second download and
  // could stack two confirm Alerts on top of each other. A `ref`, not
  // `useState` (QA round 4 minor 7) — synchronous and race-free against
  // two taps landing in the same tick, unlike a render-captured state read.
  const downloadingNames = useRef<Set<string>>(new Set());

  // Load iCloud availability, auto-backup toggle, and the backup list on
  // focus, then keep the list live via watch() until blur — one watcher at a
  // time, stopped on every cleanup regardless of how focus was lost. The
  // whole body is one try/catch (QA round 4 Major M4) — an uncaught
  // rejection from ANY of these awaits used to leave `hasGathered` false
  // forever with no error and no retry; now it's surfaced and recoverable
  // in place.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setHasGathered(false);
      setGatherError(null);

      void (async () => {
        try {
          const available = await isICloudAvailable();
          if (cancelled) return;
          setICloudAvailable(available);

          const setting = await getSetting('backup_auto_enabled');
          if (cancelled) return;
          setAutoEnabled(resolveAutoBackupEnabled(setting));

          if (!available) {
            setBackups([]);
            setHasGathered(true);
            return;
          }

          const entries = await listBackups();
          if (cancelled) return;
          setBackups(entries);
          setHasGathered(true);

          watch((updated) => {
            if (!cancelled) setBackups(updated);
          });
        } catch (e) {
          if (cancelled) return;
          setGatherError(e instanceof Error ? e.message : 'Could not check iCloud.');
          setHasGathered(true);
        }
      })();

      return () => {
        cancelled = true;
        unwatch();
      };
    }, [retryToken]),
  );

  const onRetryGather = () => setRetryToken((t) => t + 1);

  const onToggleAuto = async (value: boolean) => {
    setAutoEnabled(value);
    await setSetting('backup_auto_enabled', value ? '1' : '0');
  };

  const onCreateBackup = async () => {
    setCreating(true);
    setStatusMessage(null);
    try {
      await createBackup();
      // Report the outcome BEFORE refreshing. The backup is already uploaded at
      // this point; letting a failing refresh fall into the catch below would
      // tell the user their backup failed when it succeeded (review round 3
      // nit 3 — the same shape as blocker B1's flow 2, one function over).
      setStatusMessage('Backup created successfully.');
      setStatusIsError(false);
      try {
        setBackups(await listBackups());
      } catch (e) {
        console.warn('Backup created, but refreshing the list failed:', e);
        setGatherError('Backup created. The list could not be refreshed.');
      }
    } catch (e) {
      setStatusMessage(
        e instanceof Error ? e.message : 'Backup failed. Try again.',
      );
      setStatusIsError(true);
    } finally {
      setCreating(false);
    }
  };

  /** Patches one row's live status in place — the immediate feedback for
   *  the row the user just tapped, independent of the watcher's own cadence
   *  (which also updates `backups`, from the same native events, once it
   *  observes the same change). `isDownloading` is passed explicitly, not
   *  hardcoded `true` (QA round 3 minor 1) — the original always set it
   *  true and never cleared it, so with the module absent (`watch()` is a
   *  no-op) or after a failed download, the row stayed pinned to
   *  "Downloading…" forever and `isRestorable` stayed false, sending the
   *  user back through the download path for a file already on-device. */
  const patchRowProgress = (
    name: string,
    percent: number | null,
    isDownloading: boolean,
    // Only the success path passes this (QA round 4 minor 2 — the other
    // half of round 3 minor 1's fix that didn't land): without it, a row
    // read "In iCloud — tap to download and restore" even after a
    // successful download, because `isRestorable` needs `downloadStatus
    // === 'current'`, not just `!isDownloading`. With the module present
    // the watcher corrects this on its own cadence; with it absent
    // (`watch()` is a no-op) it stayed wrong until the screen refocused.
    downloadStatus?: CloudEntryStatus['downloadStatus'],
  ) => {
    setBackups((prev) =>
      prev.map((b) =>
        b.name === name
          ? {
              ...b,
              status: {
                ...b.status,
                isDownloading,
                percentDownloaded: percent,
                ...(downloadStatus !== undefined ? { downloadStatus } : {}),
              },
            }
          : b,
      ),
    );
  };

  const confirmAndRestore = (entry: CloudBackupEntry) => {
    Alert.alert(
      'Restore this backup?',
      `Created ${formatRelativeTime(entry.exportedAt)}\n\nThis replaces ALL current data. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => void onConfirmRestore(entry),
        },
      ],
    );
  };

  const onRestorePress = (entry: CloudBackupEntry) => {
    if (isRestorable(entry.status)) {
      confirmAndRestore(entry);
      return;
    }
    // Not restorable yet — no confirm Alert until the file is actually on
    // the device (D2): download first, and only THEN ask to restore.
    // Nothing destructive has run either way.
    void onDownloadThenRestore(entry);
  };

  /** Ensures `entry` is fully on the device, showing the download-specific
   *  error copy (and leaving nothing destructive touched) if it can't be.
   *  Shared by `onDownloadThenRestore` (row wasn't restorable yet) and
   *  `onConfirmRestore` (row WAS restorable when tapped, but the Alert can
   *  sit open indefinitely — long enough for iCloud to evict the file
   *  again, e.g. under storage pressure — so restore re-confirms rather
   *  than trusting the now-stale `isRestorable` snapshot; QA round 1 caught
   *  this gap: without it, a re-stall here surfaced as a generic "Restore
   *  failed" instead of the download-specific copy). Returns whether it's
   *  now safe to proceed to the destructive restore call.
   *
   *  Guards against a second concurrent download for the same row (QA
   *  round 3 minor 2) — a second tap while one is already in flight is a
   *  no-op (`false`, no Alert) rather than starting a second
   *  `ensureDownloaded` and risking two confirm Alerts stacked on top of
   *  each other. */
  const downloadToDevice = async (entry: CloudBackupEntry): Promise<boolean> => {
    if (downloadingNames.current.has(entry.name)) return false;
    downloadingNames.current.add(entry.name);
    try {
      await ensureDownloaded(entry.name, (percent) => patchRowProgress(entry.name, percent, true));
      patchRowProgress(entry.name, 100, false, 'current');
      return true;
    } catch (e) {
      patchRowProgress(entry.name, null, false);
      console.warn('iCloud download failed:', e);
      Alert.alert(
        "Couldn't download this backup from iCloud",
        // `downloadErrorMessage` owns the whole body: appending a fixed hint
        // put contradictory advice in one modal — "check for an app update"
        // followed by "check your connection" (review round 3 nit 4).
        downloadErrorMessage(e),
      );
      return false;
    } finally {
      downloadingNames.current.delete(entry.name);
    }
  };

  const onDownloadThenRestore = async (entry: CloudBackupEntry) => {
    if (await downloadToDevice(entry)) {
      confirmAndRestore(entry);
    }
  };

  const onConfirmRestore = async (entry: CloudBackupEntry) => {
    if (!(await downloadToDevice(entry))) return;
    try {
      await restoreFromName(entry.name);
      // A restore replaces the stored avatar look and kind (backupPolicy
      // deliberately keeps them, they are not device-local), and this screen
      // returns rather than relaunching — so the one cached copy has to be
      // told, or every screen keeps painting the pre-restore colour until
      // the next cold launch.
      await reloadAvatar();
      Alert.alert('Restore complete', 'Your data has been restored from the backup.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      // By this point `downloadToDevice` just succeeded — this is a genuine
      // post-download failure, not "the backup hasn't finished downloading
      // yet" (that copy is `downloadToDevice`'s own error Alert above, the
      // only place it's still true). No automatic retry: a silent retry
      // loop around a destructive whole-DB restore is the wrong shape — the
      // user retries deliberately via "Restore" above.
      const detail = e instanceof Error ? e.message : 'An error occurred while restoring.';
      Alert.alert('Restore failed', detail);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 24, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}
    >
      {/* Header */}
      <Pressable onPress={() => router.back()} className="mb-4 self-start">
        <Feather name="arrow-left" size={22} color={c.muted} />
      </Pressable>
      <Text className="text-text text-[28px] font-extrabold mb-1">Backups</Text>
      <Text className="text-muted text-sm mb-6">
        Save your full financial data to iCloud and restore it on any of your
        signed-in devices.
      </Text>

      {/* iCloud unavailable message */}
      {iCloudAvailable === false && (
        <View className="bg-surface border border-border rounded-md px-4 py-4 mb-6">
          <Text className="text-text font-semibold mb-1">iCloud not available</Text>
          <Text className="text-muted text-sm">
            Sign in to iCloud in your device Settings to use backups.
          </Text>
        </View>
      )}

      {/* Gather failure (QA round 4 Major M4) — independent of
          `iCloudAvailable`: the failure that triggers this (e.g. a fresh
          iCloud container whose Documents folder hasn't materialised yet,
          the exact device state spec §6.1 is about) can happen before
          `iCloudAvailable` itself resolves, so this doesn't nest inside
          either branch above — it's the one state that must always be
          visible when the gather failed, whatever `iCloudAvailable` ended
          up as. Replaces the indefinite "Checking iCloud…" a plain
          unhandled rejection used to leave behind. */}
      {gatherError !== null && (
        <View className="bg-surface border border-border rounded-md px-4 py-4 mb-6">
          <Text className="text-negative font-semibold mb-1">Couldn't check iCloud</Text>
          <Text className="text-muted text-sm mb-3">{gatherError}</Text>
          <Pressable
            onPress={onRetryGather}
            accessibilityRole="button"
            accessibilityLabel="Retry checking iCloud"
          >
            <Text className="text-primary text-sm font-medium">Retry</Text>
          </Pressable>
        </View>
      )}

      {/* Automatic Backup toggle */}
      <SectionLabel>Automatic Backup</SectionLabel>
      <View className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5 flex-row items-center">
        <View className="flex-1">
          <Text className="text-text text-base">Auto-backup</Text>
          <Text className="text-muted text-xs mt-0.5">
            Back up automatically when you leave the app (at most once per hour,
            only when data has changed).
          </Text>
        </View>
        <Switch
          value={autoEnabled}
          onValueChange={(v) => void onToggleAuto(v)}
          thumbColor="#fff"
          trackColor={{ false: c.grabHandle, true: c.primary }}
          accessibilityLabel="Automatic backup"
        />
      </View>

      {/* Manual create backup */}
      <SectionLabel>Create Backup</SectionLabel>
      <Pressable
        className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5 flex-row items-center gap-3"
        onPress={() => void onCreateBackup()}
        disabled={creating || iCloudAvailable === false}
        accessibilityRole="button"
        accessibilityLabel="Create backup"
      >
        {creating ? (
          <ActivityIndicator size="small" color={c.muted} />
        ) : (
          <Feather name="upload-cloud" size={18} color={c.muted} />
        )}
        <Text className="text-text text-base flex-1">
          {creating ? 'Creating backup…' : 'Create backup now'}
        </Text>
      </Pressable>

      {/* Status message after create */}
      {statusMessage !== null && (
        <Text
          className={`text-sm mb-4 mx-1 ${statusIsError ? 'text-negative' : 'text-muted'}`}
        >
          {statusMessage}
        </Text>
      )}

      {/* Recent backups list — only once iCloud availability has resolved to
          true, so we don't flash "No backups yet" during the initial check.
          "Checking iCloud…" covers the gap until the first gather resolves. */}
      {iCloudAvailable === true && (
        <>
          <SectionLabel>Recent Backups</SectionLabel>
          {!hasGathered ? (
            <Text className="text-muted text-sm mx-1 mb-4">Checking iCloud…</Text>
          ) : gatherError !== null && backups.length === 0 ? (
            /* The gather failed and we have nothing cached, so we do not know
               whether backups exist. "No backups yet" here would be a false
               statement about the user's only offsite copies, sitting directly
               under a box saying we could not check (review round 3 nit 2). */
            null
          ) : backups.length === 0 ? (
            <Text className="text-muted text-sm mx-1 mb-4">
              No backups yet. Create one above.
            </Text>
          ) : (
            backups.map((entry) => {
              const line = statusLine(entry);
              const pct = entry.status.percentDownloaded;
              return (
                <Pressable
                  key={entry.name}
                  className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5 flex-row items-center gap-3"
                  onPress={() => onRestorePress(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`Restore backup from ${formatRelativeTime(entry.exportedAt)}`}
                  // Moved here from the inner progress-bar `View` (QA round
                  // 3 nit) — a bare `View` has no accessibility role, so a
                  // screen reader never surfaced it there; the row
                  // `Pressable` is the actual accessible element.
                  accessibilityValue={
                    line?.showProgress && pct !== null ? { text: `${Math.round(pct)} percent` } : undefined
                  }
                >
                  <Feather name={rowIcon(rowState(entry.status))} size={18} color={c.muted} />
                  <View className="flex-1">
                    <Text className="text-text text-sm font-medium">
                      {formatRelativeTime(entry.exportedAt)}
                    </Text>
                    <Text className="text-muted text-xs mt-0.5">
                      {entry.device ?? 'Backup'} · {formatSize(entry.size)}
                    </Text>
                    {line !== null && (
                      <>
                        <Text
                          className={`text-xs mt-0.5 ${line.isError ? 'text-negative' : 'text-muted'}`}
                        >
                          {line.text}
                        </Text>
                        {/* 4pt track/fill (spec: "the existing rounded-pill
                            bg-surfaceAlt track / bg-primary fill pattern");
                            `surfaceAlt` itself is retired on this branch
                            (glass-standard-adoption S7 — see
                            tests/__steps__/glass-standard.steps.ts) in
                            favour of the semantic tokens it was split into —
                            `wellRecessed` ("a well things sit inside",
                            tokens.ts) is the track's actual successor.
                            `wellRecessed`, not `controlRaised`, is correct
                            HERE specifically (QA round 3 minor 12; compare
                            app/(tabs)/index.tsx's own scan-progress track,
                            which deliberately uses `controlRaised`) — this
                            track sits inside a `bg-surface` card, giving it
                            the ancestor `wellRecessed` needs to read as a
                            recessed well; that other track sits directly on
                            the hero canvas, with no such ancestor, so
                            `wellRecessed` would go invisible there. Don't
                            "consistency"-fix these to match each other. */}
                        {line.showProgress &&
                          (pct !== null ? (
                            <View className="h-1 rounded-pill bg-wellRecessed mt-1.5 overflow-hidden">
                              <View
                                className="h-1 rounded-pill bg-primary"
                                style={{ width: `${Math.round(pct)}%` }}
                              />
                            </View>
                          ) : (
                            <ActivityIndicator
                              size="small"
                              color={c.muted}
                              className="self-start mt-1.5"
                            />
                          ))}
                      </>
                    )}
                  </View>
                  <Feather name="rotate-ccw" size={16} color={c.muted} />
                </Pressable>
              );
            })
          )}
        </>
      )}

      {/* Footer disclaimer */}
      <Text className="text-muted text-xs mx-1 mt-4">
        Backups are saved unencrypted to your iCloud. They are protected by
        Apple's iCloud encryption and your device lock.
      </Text>
    </ScrollView>
  );
}

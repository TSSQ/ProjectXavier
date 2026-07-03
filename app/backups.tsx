/**
 * Backups screen — manual backup creation, automatic backup toggle, and
 * restore from a previous snapshot.
 *
 * Reached from Settings → Data → Backups.
 */
import React, { useCallback, useState } from 'react';
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
import { isAvailable as isICloudAvailable } from '../src/features/backup/icloud';

interface BackupEntry {
  name: string;
  exportedAt: number;
  size: number;
}

/** Format a byte count as a human-readable MB string. */
function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? '<0.1 MB' : `${mb.toFixed(1)} MB`;
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

export default function BackupsScreen() {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [iCloudAvailable, setICloudAvailable] = useState<boolean | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  // Load iCloud availability, auto-backup toggle, and backup list on focus.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const available = await isICloudAvailable();
        setICloudAvailable(available);

        if (available) {
          const [setting, entries] = await Promise.all([
            getSetting('backup_auto_enabled'),
            listBackups(),
          ]);
          setAutoEnabled(setting === '1');
          setBackups(entries);
        } else {
          const setting = await getSetting('backup_auto_enabled');
          setAutoEnabled(setting === '1');
          setBackups([]);
        }
      })();
    }, []),
  );

  const onToggleAuto = async (value: boolean) => {
    setAutoEnabled(value);
    await setSetting('backup_auto_enabled', value ? '1' : '0');
  };

  const onCreateBackup = async () => {
    setCreating(true);
    setStatusMessage(null);
    try {
      await createBackup();
      const entries = await listBackups();
      setBackups(entries);
      setStatusMessage('Backup created successfully.');
      setStatusIsError(false);
    } catch (e) {
      setStatusMessage(
        e instanceof Error ? e.message : 'Backup failed. Try again.',
      );
      setStatusIsError(true);
    } finally {
      setCreating(false);
    }
  };

  const onRestorePress = (entry: BackupEntry) => {
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

  const onConfirmRestore = async (entry: BackupEntry) => {
    try {
      await restoreFromName(entry.name);
      Alert.alert('Restore complete', 'Your data has been restored from the backup.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert(
        'Restore failed',
        e instanceof Error ? e.message : 'An error occurred while restoring.',
      );
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
          trackColor={{ false: '#3a4052', true: c.primary }}
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
          true, so we don't flash "No backups yet" during the initial check. */}
      {iCloudAvailable === true && (
        <>
          <SectionLabel>Recent Backups</SectionLabel>
          {backups.length === 0 ? (
            <Text className="text-muted text-sm mx-1 mb-4">
              No backups yet. Create one above.
            </Text>
          ) : (
            backups.map((entry) => (
              <Pressable
                key={entry.name}
                className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2.5 flex-row items-center gap-3"
                onPress={() => onRestorePress(entry)}
                accessibilityRole="button"
                accessibilityLabel={`Restore backup from ${formatRelativeTime(entry.exportedAt)}`}
              >
                <Feather name="archive" size={18} color={c.muted} />
                <View className="flex-1">
                  <Text className="text-text text-sm font-medium">
                    {formatRelativeTime(entry.exportedAt)}
                  </Text>
                  <Text className="text-muted text-xs mt-0.5">
                    {formatSize(entry.size)}
                  </Text>
                </View>
                <Feather name="rotate-ccw" size={16} color={c.muted} />
              </Pressable>
            ))
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

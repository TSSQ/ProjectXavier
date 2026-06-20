/**
 * Settings — backup/restore, security, and subscription entry points.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { colors, spacing, radius, typography } from '../../src/theme/tokens';

export default function SettingsScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>

      <Section title="Data">
        <Row
          label="Export encrypted backup"
          onPress={() => Alert.alert('Backup', 'Encrypted export — wired in src/lib/backup.ts')}
        />
        <Row
          label="Restore from backup"
          onPress={() => Alert.alert('Restore', 'Decrypt + import an existing backup')}
        />
      </Section>

      <Section title="Security">
        <Row label="Require Face ID on launch" onPress={() => {}} />
        <Row label="Manage sign-in (Apple / Google / email)" onPress={() => {}} />
      </Section>

      <Section title="ProjectXavier Premium">
        <Row
          label="Upgrade — unlimited AI, receipt scan, sync"
          onPress={() => Alert.alert('Premium', 'Subscriptions via RevenueCat (Phase 4)')}
        />
      </Section>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  title: { color: colors.text, fontSize: typography.title, fontWeight: '700', marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: { color: colors.textMuted, fontSize: typography.caption, marginBottom: spacing.sm, textTransform: 'uppercase' },
  row: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  rowLabel: { color: colors.text, fontSize: typography.body },
});

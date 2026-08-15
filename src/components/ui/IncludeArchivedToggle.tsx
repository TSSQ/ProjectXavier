/**
 * IncludeArchivedToggle — the "Include archived accounts" lens toggle,
 * shared by the Dashboard and the Transactions tab so archiving means the
 * same thing on both screens (docs/design/account-archive-restore-spec.md
 * §5.3/§5.3a). It reads and writes the single shared `useIncludeArchived`
 * store directly, so there is exactly one copy of this control's JSX — the
 * two screens can't render it differently and drift apart, which is the
 * exact inconsistency §5.3a exists to fix.
 *
 * Self-gates on `hasArchivedAccounts(accounts)`: renders nothing when there
 * is nothing archived to include (spec §5.3's render gate), so callers don't
 * need to repeat that check before mounting it.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Account } from '../../domain/types';
import { hasArchivedAccounts } from '../../domain/accountArchive';
import { useIncludeArchived } from '../../context/useIncludeArchived';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';

export function IncludeArchivedToggle({ accounts }: { accounts: Account[] }) {
  const c = useThemeColors();
  const s = useScaledType();
  const [includeArchived, setIncludeArchived] = useIncludeArchived();

  if (!hasArchivedAccounts(accounts)) return null;

  return (
    <Pressable
      onPress={() => setIncludeArchived(!includeArchived)}
      className="self-start flex-row items-center justify-center rounded-pill mb-3"
      style={{
        backgroundColor: includeArchived ? c.primary : c.surfaceBlue,
        // s.chipHeight (not a fixed py-*): the same 44pt touch-target fix
        // already used for the /account subtype chips, so this control
        // meets the minimum tap size while still growing with Dynamic Type
        // rather than clipping a scaled label.
        minHeight: s.chipHeight,
        paddingHorizontal: 14,
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: includeArchived }}
      accessibilityLabel="Include archived accounts"
    >
      <Feather
        name={includeArchived ? 'eye' : 'eye-off'}
        size={13}
        color={includeArchived ? c.onAccent : c.muted}
      />
      <Text
        className="font-semibold ml-2"
        style={{ fontSize: s.role.caption, color: includeArchived ? c.onAccent : c.muted }}
      >
        Include archived
      </Text>
    </Pressable>
  );
}

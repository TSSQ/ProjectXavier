/**
 * AccountFilterSheet — multi-select account filter bottom sheet.
 * Wraps the standard BottomSheet primitive with a draft Set that is committed
 * via the Apply button or reset with the Reset button.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Account } from '../../domain/types';
import {
  Selection,
  effectiveIds,
  applyLabel,
  commitDraft,
} from '../../domain/accountFilter';
import { accountIcon } from '../../lib/accountIcon';
import { useThemeColors } from '../../theme/useThemeColors';

export function AccountFilterSheet({
  visible,
  accounts,
  selection,
  onApply,
  onClose,
}: {
  visible: boolean;
  accounts: Account[];
  selection: Selection;
  onApply: (next: Selection) => void;
  onClose: () => void;
}) {
  const c = useThemeColors();
  const [draft, setDraft] = useState<Set<string>>(new Set());

  // Re-seed draft whenever the sheet opens.
  useEffect(() => {
    if (visible) {
      setDraft(new Set(effectiveIds(selection, accounts.map((a) => a.id))));
    }
  }, [visible]); // intentionally only re-seeds on open, not on every accounts/selection change

  function toggleDraft(id: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const footer = (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Pressable
        onPress={() => setDraft(new Set(accounts.map((a) => a.id)))}
        style={{
          flex: 0,
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: 999,
          backgroundColor: '#1E2740',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        accessibilityLabel="Reset to all accounts"
      >
        <Text style={{ color: '#E2E8F0', fontWeight: '700', fontSize: 15 }}>Reset</Text>
      </Pressable>
      <Button
        title={applyLabel(draft.size, accounts.length)}
        variant="primary"
        className="flex-1"
        onPress={() => {
          onApply(commitDraft(Array.from(draft), accounts.length));
          onClose();
        }}
      />
    </View>
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filter by account"
      footer={footer}
    >
      <Text
        style={{
          color: c.muted,
          fontSize: 13,
          marginBottom: 16,
          marginTop: 4,
        }}
      >
        Show figures for the accounts you pick.
      </Text>

      {accounts.map((account) => {
        const checked = draft.has(account.id);
        const { emoji, bg } = accountIcon(account);
        const meta = [account.subtype, account.tag].filter(Boolean).join(' · ');

        return (
          <Pressable
            key={account.id}
            onPress={() => toggleDraft(account.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              marginBottom: 6,
              backgroundColor: checked ? '#1E2740' : '#131926',
            }}
            accessibilityLabel={`${account.name}, ${checked ? 'selected' : 'not selected'}`}
          >
            {/* Emoji chip */}
            <View
              style={{ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
              className={bg}
            >
              <Text style={{ fontSize: 20 }}>{emoji}</Text>
            </View>

            {/* Name + meta */}
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#E2E8F0', fontWeight: '600', fontSize: 14 }}>
                {account.name}
              </Text>
              {meta ? (
                <Text style={{ color: c.muted, fontSize: 11, marginTop: 1 }}>{meta}</Text>
              ) : null}
            </View>

            {/* Check circle */}
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: checked ? c.primary : 'transparent',
                borderWidth: checked ? 0 : 2,
                borderColor: c.controlBorder,
              }}
            >
              {checked && <Feather name="check" size={14} color={c.onAccent} />}
            </View>
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

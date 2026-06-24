import React from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../theme/tokens';

export interface ContextMenuItem {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tone?: 'negative';
  onPress: () => void;
}

interface Props {
  visible: boolean;
  /** pageX from the long-press GestureResponderEvent. */
  x: number;
  /** pageY from the long-press GestureResponderEvent. */
  y: number;
  items: ContextMenuItem[];
  onDismiss: () => void;
}

const MENU_W = 196;
const ITEM_H = 46;
const PAD = 6;

export function ContextMenu({ visible, x, y, items, onDismiss }: Props) {
  const { width: sw, height: sh } = useWindowDimensions();
  if (!visible || items.length === 0) return null;

  const menuH = items.length * ITEM_H + PAD * 2;
  // Prefer above the touch; fall back to below when near top.
  const top = y - menuH - 8 > 60 ? y - menuH - 8 : y + 16;
  const left = Math.min(Math.max(x - 24, 12), sw - MENU_W - 12);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      {/* tap-outside dismiss */}
      <Pressable style={{ flex: 1 }} onPress={onDismiss}>
        <View
          style={{
            position: 'absolute',
            left,
            top: Math.min(top, sh - menuH - 40),
            width: MENU_W,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingVertical: PAD,
            shadowColor: '#000',
            shadowOpacity: 0.35,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 12,
          }}
        >
          {items.map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 && (
                <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: 12 }} />
              )}
              <Pressable
                onPress={() => {
                  onDismiss();
                  // Slight delay so dismiss animation doesn't fight the action.
                  setTimeout(item.onPress, 80);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  height: ITEM_H,
                  backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                  borderRadius: 8,
                  marginHorizontal: 4,
                })}
              >
                <Feather
                  name={item.icon}
                  size={16}
                  color={item.tone === 'negative' ? colors.negative : colors.textMuted}
                />
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '500',
                    color: item.tone === 'negative' ? colors.negative : colors.text,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

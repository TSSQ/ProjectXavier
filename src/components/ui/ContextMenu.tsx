import React, { useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import { computeMenuPlacement, estimateMenuWidth } from '../../domain/contextMenuPlacement';

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

/** Floor low enough that a single short label ("Copy") renders as a compact
 *  pill sized to its own content, with a cap so longer labels at large Dynamic
 *  Type still fit. The floor is deliberately below the natural content width —
 *  it exists to stop a pathologically short label collapsing, not to set the
 *  size. */
const MENU_MIN_W = 88;
const MENU_MAX_W = 260;
/** Vertical padding above/below the label. At default Dynamic Type this gives
 *  a 44pt row — Apple's minimum touch target (HIG). Deliberately not shrunk
 *  further when the menu holds a single item: a one-option menu that's fiddly
 *  to hit is worse than one that's slightly taller than it needs to be. It
 *  still grows with the scaled font rather than clipping it. */
const ITEM_PAD_V = 15;
const ITEM_PAD_H = 14;
const ITEM_GAP = 10;
const ICON_SIZE = 16;
const PAD = 4;

export function ContextMenu({ visible, x, y, items, onDismiss }: Props) {
  const c = useThemeColors();
  const s = useScaledType();
  const { width: sw, height: sh } = useWindowDimensions();
  if (!visible || items.length === 0) return null;

  // `caption` (base 14) — deliberately NOT `control` (16). This menu floats
  // over a transaction list whose payee titles are `text-sm` (14px), and a
  // menu label heavier than the row it acts on reads wrong. 14 is also the
  // size this menu already shipped at, so adopting the ramp buys the clamp
  // without changing its weight at default Dynamic Type.
  const fontSize = s.role.caption;
  const itemH = fontSize + ITEM_PAD_V * 2;
  // Analytical estimate (not measured) — same approach the app already uses
  // elsewhere for scaled sizing — using the real scaled font/row height
  // instead of a hard-coded constant, so it tracks what actually renders.
  const menuH = items.length * itemH + (items.length - 1) * 1 + PAD * 2;

  const { left, top } = computeMenuPlacement({
    touchX: x,
    touchY: y,
    // Estimated, not measured — see estimateMenuWidth. Passing MENU_MAX_W here
    // (as this did before) made the edge clamp treat every menu as 260pt wide
    // and shoved a compact one-item menu far left of the touch point.
    menuWidth: estimateMenuWidth({
      labels: items.map((i) => i.label),
      fontSize,
      iconSize: ICON_SIZE,
      itemPadH: ITEM_PAD_H,
      itemGap: ITEM_GAP,
      itemMarginH: 4,
      minWidth: MENU_MIN_W,
      maxWidth: MENU_MAX_W,
    }),
    menuHeight: menuH,
    screenWidth: sw,
    screenHeight: sh,
  });

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
            top,
            minWidth: MENU_MIN_W,
            maxWidth: MENU_MAX_W,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.border,
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
                <View style={{ height: 1, backgroundColor: c.border, marginHorizontal: 12 }} />
              )}
              <MenuRow item={item} itemH={itemH} fontSize={fontSize} onDismiss={onDismiss} />
            </React.Fragment>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * One menu row.
 *
 * NOTE: use a plain object `style`, not the function form
 * (`style={({ pressed }) => ...}`). This app wraps Pressable with NativeWind's
 * cssInterop (to support `className`), which swallows the function form — every
 * declaration in it is silently dropped. That is exactly what shipped in build
 * 60: flexDirection/gap/paddingHorizontal/alignItems/minHeight all vanished, so
 * the row fell back to RN's defaults (column, no padding) and rendered the icon
 * stacked above a label that escaped the panel's left edge. Drive the pressed
 * colour from local state instead — same fix as AmountKeypad, which hit this
 * first. Extracted into its own component only because that state needs a hook,
 * which can't live inside the parent's .map().
 */
function MenuRow({
  item,
  itemH,
  fontSize,
  onDismiss,
}: {
  item: ContextMenuItem;
  itemH: number;
  fontSize: number;
  onDismiss: () => void;
}) {
  const c = useThemeColors();
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      onPress={() => {
        onDismiss();
        // Slight delay so dismiss animation doesn't fight the action.
        setTimeout(item.onPress, 80);
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: ITEM_GAP,
        paddingHorizontal: ITEM_PAD_H,
        minHeight: itemH,
        backgroundColor: pressed ? c.surfaceAlt : 'transparent',
        borderRadius: 8,
        marginHorizontal: 4,
      }}
    >
      <Feather
        name={item.icon}
        size={ICON_SIZE}
        color={item.tone === 'negative' ? c.negative : c.muted}
      />
      <Text
        numberOfLines={1}
        style={{
          fontSize,
          fontWeight: '500',
          color: item.tone === 'negative' ? c.negative : c.text,
          flexShrink: 1,
        }}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

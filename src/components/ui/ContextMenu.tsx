import React from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useScaledType } from '../../theme/useScaledType';
import { computeMenuPlacement, estimateMenuWidth } from '../../domain/contextMenuPlacement';
import { MenuPanel, MenuRow, PANEL_PAD_V, MENU_ROW_PAD_H, MENU_ROW_GAP, MENU_ROW_MARGIN_H } from './MenuPanel';
import { useThemeColors } from '../../theme/useThemeColors';
import { ICON } from '../../theme/assets';

export interface ContextMenuItem {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tone?: 'negative';
  onPress: () => void;
}

/**
 * Where the menu appears.
 *
 * - `point`: the original behaviour — a `Modal` placed near an arbitrary
 *   screen point (today only the widget's scan deep link, which has no
 *   control on screen to hang off and falls back to the screen centre
 *   a trigger with no control at all, like the widget deep link). Correct
 *   ONLY when nothing under the menu is going to move — a `Modal`'s content
 *   is laid out in its own screen-absolute space and is never re-laid-out
 *   by its presenter re-rendering. This mode never carries `panel` glass
 *   (glass-standard-adoption-spec.md S6, style guide R9) — the `Modal`
 *   fades in via `animationType="fade"`, and a Glass whose first layout
 *   lands mid-animation never renders (Glass.tsx header).
 * - `bottomRight`: renders in-flow (no `Modal`) as the bottom-right-pinned
 *   child of whatever `position: 'relative'` container the caller puts it
 *   in. Use this when the opening control lives inside a container that
 *   itself moves (e.g. the composer sliding under the keyboard) — the menu
 *   then moves WITH it by ordinary layout, not by capturing a point that
 *   goes stale the instant that container moves. See Composer's camera
 *   control for the motivating case: a captured pageY/measured frame both
 *   go stale the moment the keyboard dismisses and the composer resettles
 *   above the tab bar (one earlier fix tried to re-measure
 *   after the fact and failed because presenting the `Modal` itself
 *   suppresses the keyboard event the re-measure depended on). This is an
 *   in-flow sibling with no entering animation, so it's the one mode that
 *   passes `glass` to `MenuPanel` (R9's animation-free anchor).
 */
export type ContextMenuAnchor =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'bottomRight' };

interface Props {
  visible: boolean;
  anchor: ContextMenuAnchor;
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
// MenuRow renders its leading icon at ICON.md, its horizontal padding at
// `MENU_ROW_PAD_H`, its gap at `MENU_ROW_GAP` and its outer margin at
// `MENU_ROW_MARGIN_H`, and MenuPanel its own vertical padding at
// `PANEL_PAD_V` — all imported from MenuPanel.tsx (QA round 3) rather than
// re-declared here, so the `point` mode's width/height ESTIMATE (never
// measured, see estimateMenuWidth — a Modal is placed before its content
// lays out) can't silently skew from what MenuRow/MenuPanel actually render.
const ICON_SIZE = ICON.md;

export function ContextMenu({ visible, anchor, items, onDismiss }: Props) {
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
  const menuH = items.length * itemH + (items.length - 1) * 1 + PANEL_PAD_V * 2;

  const rows = items.map((item, i) => (
    <React.Fragment key={item.label}>
      {i > 0 && <View style={{ height: 1, backgroundColor: c.border, marginHorizontal: 12 }} />}
      <MenuRow
        label={item.label}
        icon={item.icon}
        tone={item.tone}
        minHeight={itemH}
        fontSize={fontSize}
        onPress={() => {
          onDismiss();
          // Slight delay so the `point` mode's fade-out doesn't fight the
          // action; harmless in `bottomRight`, which has no animation.
          setTimeout(item.onPress, 80);
        }}
      />
    </React.Fragment>
  ));

  if (anchor.kind === 'bottomRight') {
    // In-flow, not a Modal: the caller renders this as a child of a
    // `position: 'relative'` container (the composer row) so it inherits
    // that container's position — including while it's animating under the
    // keyboard — for free. No touch point, no measurement, nothing to go
    // stale.
    return (
      <View
        style={{
          position: 'absolute',
          bottom: '100%',
          right: 0,
          // Same visual gap as the point-anchored GAP_ABOVE in
          // contextMenuPlacement.ts, and the same value SlashMenu (the "+"
          // popover next to this control) uses above the composer.
          //
          // Note what this mode does NOT do: `point` clamps to the screen
          // edges via computeMenuPlacement, because a touch can land
          // anywhere. Here the container is the composer row, which is
          // itself laid out inside the screen's padding, so the panel
          // inherits those bounds — but if this mode ever anchors to
          // something near an edge, it will need its own clamp.
          marginBottom: 8,
        }}
      >
        <MenuPanel glass style={{ minWidth: MENU_MIN_W, maxWidth: MENU_MAX_W }}>
          {rows}
        </MenuPanel>
      </View>
    );
  }

  const { left, top } = computeMenuPlacement({
    touchX: anchor.x,
    touchY: anchor.y,
    // Estimated, not measured — see estimateMenuWidth. Passing MENU_MAX_W here
    // (as this did before) made the edge clamp treat every menu as 260pt wide
    // and shoved a compact one-item menu far left of the touch point.
    menuWidth: estimateMenuWidth({
      labels: items.map((i) => i.label),
      fontSize,
      iconSize: ICON_SIZE,
      itemPadH: MENU_ROW_PAD_H,
      itemGap: MENU_ROW_GAP,
      itemMarginH: MENU_ROW_MARGIN_H,
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
        <View style={{ position: 'absolute', left, top }}>
          {/* `point` mode fades in via the Modal itself — never `glass`
              (R9): a Glass whose first layout lands mid-animation never
              renders (Glass.tsx header). */}
          <MenuPanel style={{ minWidth: MENU_MIN_W, maxWidth: MENU_MAX_W }}>{rows}</MenuPanel>
        </View>
      </Pressable>
    </Modal>
  );
}

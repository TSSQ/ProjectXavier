import React, { useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Text, View } from 'react-native';
import { RAIL_LETTERS, letterIndexAt, nearestPopulatedKey } from '../../domain/alphaIndex';
import { useThemeColors } from '../../theme/useThemeColors';

const RAIL_WIDTH = 40;
const BUBBLE_SIZE = 76;

const ACCESSIBILITY_ACTIONS = [
  { name: 'increment' as const },
  { name: 'decrement' as const },
];

/**
 * Right-edge A-Z quick-scroll rail. Tap or slide along it; `onSelect` fires
 * only when the resolved (populated) letter changes. Claims the touch
 * responder so a parent scroller does not scroll while sliding.
 *
 * Styles are static objects on purpose: NativeWind swallows function-form
 * `style` props.
 */
export function AlphaRail({
  populated,
  onSelect,
  accessibilityLabel,
}: {
  populated: Set<string>;
  onSelect: (key: string) => void;
  accessibilityLabel: string;
}) {
  const c = useThemeColors();
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>(
    () => RAIL_LETTERS.find((k) => populated.has(k)) ?? RAIL_LETTERS[0] ?? 'A'
  );
  // Last key reported to the parent during this touch (state would lag a move).
  const lastKey = useRef<string | null>(null);
  // Height from the layout event; refs can be null inside onLayout. onLayout
  // fires at first layout, before any user touch can land, so the first touch
  // after mount already sees a real height; if it is somehow still 0 the
  // touch is ignored and the next move event picks it up.
  const heightRef = useRef(0);

  // The populated set can change under us (search, rename, delete): keep the
  // announced letter pointing at one that still exists.
  useEffect(() => {
    setCurrent((prev) =>
      populated.has(prev)
        ? prev
        : nearestPopulatedKey(prev, populated) ??
          RAIL_LETTERS.find((k) => populated.has(k)) ??
          prev
    );
  }, [populated]);

  const onLayout = (e: LayoutChangeEvent) => {
    heightRef.current = e.nativeEvent.layout.height;
    setHeight(e.nativeEvent.layout.height);
  };

  const select = (key: string) => {
    lastKey.current = key;
    setCurrent(key);
    onSelect(key);
  };

  const resolve = (e: GestureResponderEvent) => {
    const index = letterIndexAt(
      e.nativeEvent.locationY,
      heightRef.current,
      RAIL_LETTERS.length
    );
    if (index === null) return;
    const key = nearestPopulatedKey(RAIL_LETTERS[index] as string, populated);
    if (!key) return;
    setActive(key);
    if (key !== lastKey.current) select(key);
  };

  const release = () => {
    lastKey.current = null;
    setActive(null);
  };

  const step = (delta: 1 | -1) => {
    const keys = RAIL_LETTERS.filter((k) => populated.has(k));
    // `current` may be stale (not populated): start from the nearest one.
    const base = nearestPopulatedKey(current, populated) ?? keys[0];
    const at = base ? keys.indexOf(base) : -1;
    if (at < 0) return;
    const next = keys[Math.min(keys.length - 1, Math.max(0, at + delta))];
    if (next && next !== current) select(next);
  };

  return (
    <View
      style={{ width: RAIL_WIDTH, height: '100%' }}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={resolve}
      onResponderMove={resolve}
      onResponderRelease={release}
      onResponderTerminate={release}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: current }}
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') step(1);
        else if (e.nativeEvent.actionName === 'decrement') step(-1);
      }}
    >
      {active && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: RAIL_WIDTH + 8,
            top: Math.max(0, height / 2 - BUBBLE_SIZE / 2),
            width: BUBBLE_SIZE,
            height: BUBBLE_SIZE,
            borderRadius: 22,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 38, fontWeight: '800' }}>{active}</Text>
        </View>
      )}
      {RAIL_LETTERS.map((k) => {
        const isPopulated = populated.has(k);
        const isActive = active === k;
        return (
          <View
            key={k}
            pointerEvents="none"
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            {/* Active letter is white, so it sits on a primary dot to stay legible. */}
            {isActive && (
              <View
                style={{
                  position: 'absolute',
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  backgroundColor: c.primary,
                }}
              />
            )}
            <Text
              allowFontScaling={false}
              style={{
                fontSize: isActive ? 13 : 11,
                fontWeight: '700',
                color: isActive ? '#FFFFFF' : isPopulated ? c.primary : c.muted,
                opacity: isPopulated ? 1 : 0.45,
              }}
            >
              {k}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

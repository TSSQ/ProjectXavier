/**
 * AmountKeypad — purely presentational 4×4 calculator keypad. No TextInput;
 * each key press calls onKey with the appropriate AmountKey.
 *
 * Layout (4 cols × 4 rows):
 *   1   2   3   ÷
 *   4   5   6   ×
 *   7   8   9   −
 *   .   0   ⌫   +
 *
 * Styling: each key surfaceAlt bg (one step lighter than the surface sheet so the
 * keys read as buttons), 1px border-border, radius 12, minHeight 52; font 22/600
 * (current sans). Operator glyphs in primary (#5B8DEF), digits / dot / backspace
 * in text (#F2F5F9). 4-col grid (explicit key widths via onLayout), gap 8.
 */
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AmountKey } from '../../domain/amountExpression';

interface AmountKeypadProps {
  onKey: (key: AmountKey) => void;
}

type KeyDef =
  | { type: 'digit'; value: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' }
  | { type: 'dot' }
  | { type: 'op'; op: '+' | '-' | '×' | '÷' }
  | { type: 'backspace' };

function toAmountKey(def: KeyDef): AmountKey {
  switch (def.type) {
    case 'digit':     return { digit: def.value };
    case 'dot':       return 'dot';
    case 'op':        return `op:${def.op}` as AmountKey;
    case 'backspace': return 'backspace';
  }
}

function accessibilityLabel(def: KeyDef): string {
  switch (def.type) {
    case 'digit':     return def.value;
    case 'op':        return def.op;
    case 'dot':       return 'decimal point';
    case 'backspace': return 'backspace';
  }
}

// Design spec bottom-row order: . 0 ⌫ +
const ROWS: [KeyDef, KeyDef, KeyDef, KeyDef][] = [
  [
    { type: 'digit', value: '1' },
    { type: 'digit', value: '2' },
    { type: 'digit', value: '3' },
    { type: 'op', op: '÷' },
  ],
  [
    { type: 'digit', value: '4' },
    { type: 'digit', value: '5' },
    { type: 'digit', value: '6' },
    { type: 'op', op: '×' },
  ],
  [
    { type: 'digit', value: '7' },
    { type: 'digit', value: '8' },
    { type: 'digit', value: '9' },
    { type: 'op', op: '-' },
  ],
  [
    { type: 'dot' },
    { type: 'digit', value: '0' },
    { type: 'backspace' },
    { type: 'op', op: '+' },
  ],
];

const GAP = 8;

// Design tokens (from tailwind.config.js)
// Keys use surfaceAlt (#1F2530) — one step lighter than the sheet surface —
// so they read as buttons against the surface (#171B22) background.
const COLOR_KEY_BG = '#1F2530';   // surfaceAlt
const COLOR_KEY_PRESSED = '#2A313C'; // border tone — slightly lighter on press
const COLOR_BORDER = '#2A313C';
const COLOR_TEXT = '#F2F5F9';
const COLOR_PRIMARY = '#5B8DEF';

function KeyButton({
  def,
  onKey,
  width,
}: {
  def: KeyDef;
  onKey: (key: AmountKey) => void;
  width: number;
}) {
  const isOp = def.type === 'op';
  const isBS = def.type === 'backspace';
  const labelColor = isOp ? COLOR_PRIMARY : COLOR_TEXT;

  return (
    <Pressable
      onPress={() => onKey(toAmountKey(def))}
      accessibilityLabel={accessibilityLabel(def)}
      style={({ pressed }) => ({
        width,
        minHeight: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? COLOR_KEY_PRESSED : COLOR_KEY_BG,
        borderWidth: 1,
        borderColor: COLOR_BORDER,
      })}
    >
      {isBS ? (
        <Feather name="delete" size={22} color={COLOR_TEXT} />
      ) : (
        <Text
          style={{
            fontSize: 22,
            fontWeight: '600',
            color: labelColor,
          }}
        >
          {def.type === 'digit' ? def.value : def.type === 'dot' ? '.' : def.op}
        </Text>
      )}
    </Pressable>
  );
}

export function AmountKeypad({ onKey }: AmountKeypadProps) {
  // Measure the available width and divide into 4 equal keys (3 gaps between).
  // Explicit widths avoid relying on flex distribution, which collapsed when the
  // keypad moved into the pinned footer.
  const [width, setWidth] = useState(0);
  const keyWidth = width > 0 ? (width - GAP * 3) / 4 : 0;

  return (
    <View
      style={{ alignSelf: 'stretch' }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {keyWidth > 0 &&
        ROWS.map((row, rowIdx) => (
        <View
          key={rowIdx}
          style={{
            flexDirection: 'row',
            gap: GAP,
            marginBottom: rowIdx < ROWS.length - 1 ? GAP : 0,
          }}
        >
          {row.map((def, colIdx) => (
            <KeyButton key={colIdx} def={def} onKey={onKey} width={keyWidth} />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * AmountKeypad — purely presentational 4×4 calculator keypad. No TextInput;
 * each key press calls onKey with the appropriate AmountKey.
 *
 * Layout (4 cols × 4 rows):
 *   1   2   3   ÷
 *   4   5   6   ×
 *   7   8   9   −
 *   0   .   ⌫   +
 *
 * The right column is the operator column (visually tinted blue). Sign is not a
 * keypad concern — Expense/Income is chosen via the SegmentedControl — so there
 * is no +/− key. The domain still supports toggleSign; it is simply not exposed.
 */
import React from 'react';
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
    { type: 'digit', value: '0' },
    { type: 'dot' },
    { type: 'backspace' },
    { type: 'op', op: '+' },
  ],
];

const KEY_HEIGHT = 56;
const GAP = 8;

function KeyButton({ def, onKey }: { def: KeyDef; onKey: (key: AmountKey) => void }) {
  const isOp = def.type === 'op';
  const isBS = def.type === 'backspace';

  return (
    <Pressable
      onPress={() => onKey(toAmountKey(def))}
      accessibilityLabel={accessibilityLabel(def)}
      style={({ pressed }) => ({
        flex: 1,
        flexBasis: 0,
        minWidth: 0,
        height: KEY_HEIGHT,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isOp
          ? pressed ? '#34457e' : '#283457'
          : pressed ? '#3a4150' : '#2c323e',
      })}
    >
      {isBS ? (
        <Feather name="delete" size={22} color="#cfd6df" />
      ) : (
        <Text
          style={{
            fontSize: 24,
            fontWeight: isOp ? '700' : '500',
            color: isOp ? '#7AA6F0' : '#E8ECF0',
          }}
        >
          {def.type === 'digit' ? def.value : def.type === 'dot' ? '.' : def.op}
        </Text>
      )}
    </Pressable>
  );
}

export function AmountKeypad({ onKey }: AmountKeypadProps) {
  return (
    <View style={{ width: '100%', paddingTop: 6 }}>
      {ROWS.map((row, rowIdx) => (
        <View
          key={rowIdx}
          style={{
            flexDirection: 'row',
            gap: GAP,
            marginBottom: rowIdx < ROWS.length - 1 ? GAP : 0,
          }}
        >
          {row.map((def, colIdx) => (
            <KeyButton key={colIdx} def={def} onKey={onKey} />
          ))}
        </View>
      ))}
    </View>
  );
}

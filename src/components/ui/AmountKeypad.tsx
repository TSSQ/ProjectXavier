/**
 * AmountKeypad — purely presentational 4-column calculator keypad.
 * No TextInput. Each key press calls onKey with the appropriate AmountKey.
 *
 * Layout (4 cols × 5 rows):
 *   1   2   3   ÷
 *   4   5   6   ×
 *   7   8   9   −
 *  +/−  0   .   +
 *  ⌫  ⌫  ⌫  ⌫   (backspace — full-width bottom row)
 *
 * Every key is reachable: digits 0–9, dot, toggleSign (+/−),
 * backspace (⌫), and all four operators ÷ × − +.
 * The operator column is visually distinct (blue tint).
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
  | { type: 'backspace' }
  | { type: 'toggleSign' };

function toAmountKey(def: KeyDef): AmountKey {
  switch (def.type) {
    case 'digit':    return { digit: def.value };
    case 'dot':      return 'dot';
    case 'op':       return `op:${def.op}` as AmountKey;
    case 'backspace': return 'backspace';
    case 'toggleSign': return 'toggleSign';
  }
}

function accessibilityLabel(def: KeyDef): string {
  switch (def.type) {
    case 'digit':     return def.value;
    case 'op':        return def.op;
    case 'dot':       return 'decimal point';
    case 'backspace': return 'backspace';
    case 'toggleSign': return 'toggle sign';
  }
}

// 4-col rows: digits + operator column
const DIGIT_ROWS: [KeyDef, KeyDef, KeyDef, KeyDef][] = [
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
    { type: 'toggleSign' },
    { type: 'digit', value: '0' },
    { type: 'dot' },
    { type: 'op', op: '+' },
  ],
];

function KeyButton({
  def,
  onKey,
  flex = 1,
}: {
  def: KeyDef;
  onKey: (key: AmountKey) => void;
  flex?: number;
}) {
  const isOp = def.type === 'op';
  const isBS = def.type === 'backspace';
  const isToggle = def.type === 'toggleSign';

  return (
    <Pressable
      onPress={() => onKey(toAmountKey(def))}
      accessibilityLabel={accessibilityLabel(def)}
      style={({ pressed }) => ({
        flex,
        height: 52,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed
          ? isOp || isBS
            ? '#3a4d8a'
            : '#2a3140'
          : isOp
            ? '#1e2d5a'
            : isBS
              ? '#1e2533'
              : '#1a2030',
      })}
    >
      {isBS ? (
        <Feather name="delete" size={20} color="#9AA4B2" />
      ) : (
        <Text
          style={{
            fontSize: isOp || isToggle ? 18 : 22,
            fontWeight: isOp ? '600' : '500',
            color: isOp ? '#5B8DEF' : isToggle ? '#9AA4B2' : '#E8ECF0',
          }}
        >
          {def.type === 'digit'
            ? def.value
            : def.type === 'dot'
              ? '.'
              : def.type === 'toggleSign'
                ? '+/−'
                : def.type === 'op'
                  ? def.op
                  : ''}
        </Text>
      )}
    </Pressable>
  );
}

export function AmountKeypad({ onKey }: AmountKeypadProps) {
  const GAP = 4;

  return (
    <View
      className="bg-surface"
      style={{ paddingHorizontal: 4, paddingVertical: 6 }}
    >
      {/* 4 digit+operator rows */}
      {DIGIT_ROWS.map((row, rowIdx) => (
        <View key={rowIdx} className="flex-row" style={{ gap: GAP, marginBottom: GAP }}>
          {row.map((def, colIdx) => (
            <KeyButton key={colIdx} def={def} onKey={onKey} />
          ))}
        </View>
      ))}

      {/* Full-width backspace row */}
      <View style={{ gap: GAP }}>
        <KeyButton def={{ type: 'backspace' }} onKey={onKey} />
      </View>
    </View>
  );
}

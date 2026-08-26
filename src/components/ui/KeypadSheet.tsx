/**
 * KeypadSheet — reusable on-demand amount entry bottom sheet.
 *
 * Wraps AmountKeypad + AmountDisplay inside a BottomSheet so any screen can
 * present a calculator-style numeric input without owning the keypad mechanics.
 * The sheet is completely self-contained: it seeds its expression from
 * `initialMinor` each time `visible` becomes true and calls `onDone` with the
 * resolved minor-unit value when the user taps Done / =.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  AmountExpr,
  AmountKey,
  applyKey,
  emptyExpr,
  fromMinorUnits,
  resolveMinorUnits,
  pendingOperator,
  isCalculation,
} from '../../domain/amountExpression';
import { currencyExponent } from '../../domain/currency';
import { BottomSheet } from './BottomSheet';
import { AmountDisplay } from './AmountDisplay';
import { AmountKeypad } from './AmountKeypad';
import { Button } from './Button';

export interface KeypadSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  currency?: string;
  /** Seed value in minor units. 0 = start empty. */
  initialMinor: number;
  /** Called with the resolved minor-unit value when the user confirms. */
  onDone: (minor: number) => void;
  /** Permit a negative result. Off by default: transaction amounts are
   *  positive magnitudes and the sign is carried by the transaction type, so
   *  clamping is correct there. An account's opening balance is a genuine
   *  signed number — a credit card starts owing — and clamping made it
   *  impossible to type one, even though the schema allows it and the
   *  assistant could already create one. */
  allowNegative?: boolean;
}

export function KeypadSheet({
  visible,
  onClose,
  title,
  currency,
  initialMinor,
  onDone,
  allowNegative = false,
}: KeypadSheetProps) {
  // The active currency's decimal places (0/2/3 — currencyExponent) drive the
  // keypad: a 0-decimal currency like JPY is integer-only.
  const exp = useMemo(() => currencyExponent(currency ?? 'USD'), [currency]);

  // Seed from any non-zero value when negatives are allowed. The old
  // `> 0` test silently dropped an existing negative balance the moment the
  // sheet opened, so editing one and pressing Done zeroed it.
  const seeds = (v: number) => (allowNegative ? v !== 0 : v > 0);
  const [expr, setExpr] = useState<AmountExpr>(() =>
    seeds(initialMinor) ? fromMinorUnits(initialMinor, exp) : emptyExpr()
  );

  // Re-seed when the sheet (re-)opens.
  useEffect(() => {
    if (visible) {
      setExpr(seeds(initialMinor) ? fromMinorUnits(initialMinor, exp) : emptyExpr());
    }
  }, [visible, initialMinor, exp]);

  const onKey = useCallback((k: AmountKey) => {
    setExpr((prev) => applyKey(prev, k, exp));
  }, [exp]);

  const handleDone = useCallback(() => {
    const minor = resolveMinorUnits(expr, exp);
    onDone(allowNegative ? (minor ?? 0) : Math.max(0, minor ?? 0));
    onClose();
  }, [expr, exp, onDone, onClose, allowNegative]);

  const activeOp = pendingOperator(expr);
  const calcMode = isCalculation(expr);

  const footerContent = (
    <View>
      <AmountKeypad
        onKey={onKey}
        activeOp={activeOp}
        exponent={exp}
        allowNegative={allowNegative}
      />
      <View style={{ paddingTop: 10 }}>
        <Button
          title={calcMode ? '=' : 'Done'}
          onPress={calcMode ? () => onKey('equals') : handleDone}
        />
      </View>
    </View>
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title ?? 'Amount'}
      fillHeight
      footer={footerContent}
    >
      {/* No `type` prop → neutral color */}
      <AmountDisplay expr={expr} currency={currency} />
    </BottomSheet>
  );
}

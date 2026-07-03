/**
 * KeypadSheet — reusable on-demand amount entry bottom sheet.
 *
 * Wraps AmountKeypad + AmountDisplay inside a BottomSheet so any screen can
 * present a calculator-style numeric input without owning the keypad mechanics.
 * The sheet is completely self-contained: it seeds its expression from
 * `initialMinor` each time `visible` becomes true and calls `onDone` with the
 * resolved minor-unit value when the user taps Done / =.
 */
import React, { useCallback, useEffect, useState } from 'react';
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
}

export function KeypadSheet({
  visible,
  onClose,
  title,
  currency,
  initialMinor,
  onDone,
}: KeypadSheetProps) {
  const [expr, setExpr] = useState<AmountExpr>(() =>
    initialMinor > 0 ? fromMinorUnits(initialMinor) : emptyExpr()
  );

  // Re-seed when the sheet (re-)opens.
  useEffect(() => {
    if (visible) {
      setExpr(initialMinor > 0 ? fromMinorUnits(initialMinor) : emptyExpr());
    }
  }, [visible, initialMinor]);

  const onKey = useCallback((k: AmountKey) => {
    setExpr((prev) => applyKey(prev, k));
  }, []);

  const handleDone = useCallback(() => {
    const minor = resolveMinorUnits(expr);
    onDone(Math.max(0, minor ?? 0));
    onClose();
  }, [expr, onDone, onClose]);

  const activeOp = pendingOperator(expr);
  const calcMode = isCalculation(expr);

  const footerContent = (
    <View>
      <AmountKeypad onKey={onKey} activeOp={activeOp} />
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

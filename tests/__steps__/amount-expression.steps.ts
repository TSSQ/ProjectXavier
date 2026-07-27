import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  AmountExpr,
  AmountKey,
  MAX_DIGITS,
  applyKey,
  currentOperandString,
  displayString,
  emptyExpr,
  fromMinorUnits,
  isCalculation,
  isComplete,
  pendingOperator,
  resolveMinorUnits,
} from '../../src/domain/amountExpression';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/amount-expression.feature')
);

type Op = '+' | '-' | '×' | '÷';

function pressOp(expr: AmountExpr, op: Op): AmountExpr {
  const key = `op:${op}` as AmountKey;
  return applyKey(expr, key);
}

function pressDigit(expr: AmountExpr, d: string): AmountExpr {
  return applyKey(expr, { digit: d as AmountKey extends { digit: infer D } ? D : never });
}

defineFeature(feature, (test) => {
  // ── Group 1: plain digits ─────────────────────────────────────────────
  test('Entering plain digits builds an operand', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 2', () => { expr = pressDigit(expr, '2'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
    and('isComplete should be true', () => {
      expect(isComplete(expr)).toBe(true);
    });
  });

  // ── Group 2: 2 dp clamp ──────────────────────────────────────────────
  test('Extra fractional digits beyond 2 dp are ignored', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press dot', () => { expr = applyKey(expr, 'dot'); });
    and('I press digit 2', () => { expr = pressDigit(expr, '2'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    and('I press digit 4', () => { expr = pressDigit(expr, '4'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 3: leading-zero replacement ────────────────────────────────
  test('A leading zero is replaced by the next digit', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
  });

  // ── Group 4: 0. is preserved ─────────────────────────────────────────
  test('A zero followed by dot starts a decimal', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press dot', () => { expr = applyKey(expr, 'dot'); });
    and('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 5: addition ─────────────────────────────────────────────────
  test('Simple addition of two operands', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op +', () => { expr = pressOp(expr, '+'); });
    and('I press digit 2', () => { expr = pressDigit(expr, '2'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
    and('isComplete should be true', () => {
      expect(isComplete(expr)).toBe(true);
    });
  });

  // ── Group 6: mixed-ops left-to-right ─────────────────────────────────
  test('Mixed operators evaluated strictly left to right', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op +', () => { expr = pressOp(expr, '+'); });
    and('I press digit 2', () => { expr = pressDigit(expr, '2'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 7: subtraction ─────────────────────────────────────────────
  test('Subtraction produces the correct result', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op -', () => { expr = pressOp(expr, '-'); });
    and('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    then(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 8: multiplication ──────────────────────────────────────────
  test('Multiplication produces the correct result', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press digit 4', () => { expr = pressDigit(expr, '4'); });
    then(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 9: division ────────────────────────────────────────────────
  test('Division produces the correct result', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ÷', () => { expr = pressOp(expr, '÷'); });
    and('I press digit 4', () => { expr = pressDigit(expr, '4'); });
    then(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 10: trailing operator ──────────────────────────────────────
  test('A trailing operator means the expression is not complete', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press op +', () => { expr = pressOp(expr, '+'); });
    then('isComplete should be false', () => {
      expect(isComplete(expr)).toBe(false);
    });
    and('resolveMinorUnits should be null', () => {
      expect(resolveMinorUnits(expr)).toBeNull();
    });
  });

  // ── Group 11: operator replaces operator ─────────────────────────────
  test('Pressing a second operator replaces the first', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press op +', () => { expr = pressOp(expr, '+'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and('isComplete should be false', () => {
      expect(isComplete(expr)).toBe(false);
    });
  });

  // ── Group 12: divide-by-zero ─────────────────────────────────────────
  test('Dividing by zero produces null', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 9', () => { expr = pressDigit(expr, '9'); });
    and('I press op ÷', () => { expr = pressOp(expr, '÷'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    then('resolveMinorUnits should be null', () => {
      expect(resolveMinorUnits(expr)).toBeNull();
    });
  });

  // ── Group 13: toggleSign both ways ───────────────────────────────────
  test('toggleSign negates a positive operand', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press toggleSign', () => { expr = applyKey(expr, 'toggleSign'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  test('toggleSign on a negative operand makes it positive', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press toggleSign', () => { expr = applyKey(expr, 'toggleSign'); });
    and('I press toggleSign', () => { expr = applyKey(expr, 'toggleSign'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 14: backspace ──────────────────────────────────────────────
  test('Backspace mid-operand removes the last digit', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 2', () => { expr = pressDigit(expr, '2'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    and('I press backspace', () => { expr = applyKey(expr, 'backspace'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
  });

  test('Backspace removes a trailing operator token', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press op +', () => { expr = pressOp(expr, '+'); });
    and('I press backspace', () => { expr = applyKey(expr, 'backspace'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and('isComplete should be true', () => {
      expect(isComplete(expr)).toBe(true);
    });
  });

  test('Backspace on a single-digit operand after an operator returns to just the operand', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press op +', () => { expr = pressOp(expr, '+'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    and('I press backspace', () => { expr = applyKey(expr, 'backspace'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and('isComplete should be false', () => {
      expect(isComplete(expr)).toBe(false);
    });
  });

  test('Backspace on the only operand returns to empty expression showing 0', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press backspace', () => { expr = applyKey(expr, 'backspace'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and('isComplete should be false', () => {
      expect(isComplete(expr)).toBe(false);
    });
    and('resolveMinorUnits should be null', () => {
      expect(resolveMinorUnits(expr)).toBeNull();
    });
  });

  // ── Group 15: max-length boundary ────────────────────────────────────
  test('Digits beyond the cap are ignored', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press 12 digits', () => {
      for (let i = 0; i < MAX_DIGITS; i++) {
        expr = pressDigit(expr, '1');
      }
    });
    and('I press digit 9', () => {
      expr = pressDigit(expr, '9');
    });
    then('the total digit count should be 12', () => {
      const display = displayString(expr);
      const digitCount = (display.match(/\d/g) ?? []).length;
      expect(digitCount).toBe(MAX_DIGITS);
    });
  });

  // ── Group 16: fromMinorUnits round-trip ──────────────────────────────
  test('fromMinorUnits 1234 round-trips correctly', ({ given, then, and }) => {
    let expr: AmountExpr;
    given('an expression seeded from minor units 1234', () => {
      expr = fromMinorUnits(1234);
    });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 17: empty expression defaults ──────────────────────────────
  test('An empty expression displays 0 and is not resolvable', ({ given, then, and }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and('isComplete should be false', () => {
      expect(isComplete(expr)).toBe(false);
    });
    and('resolveMinorUnits should be null', () => {
      expect(resolveMinorUnits(expr)).toBeNull();
    });
  });

  // ── Group 18: backspace clears dangling minus ─────────────────────────
  test('Backspace after toggleSign clears the sign and the next digit starts fresh', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press toggleSign', () => { expr = applyKey(expr, 'toggleSign'); });
    and('I press backspace', () => { expr = applyKey(expr, 'backspace'); });
    and('I press digit 7', () => { expr = pressDigit(expr, '7'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 19: MAX_DIGITS cap after operator ───────────────────────────
  test('The digit cap applies when starting a new operand after an operator', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press 12 digits', () => {
      for (let i = 0; i < MAX_DIGITS; i++) {
        expr = pressDigit(expr, '1');
      }
    });
    and('I press op +', () => { expr = pressOp(expr, '+'); });
    and('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    then('the total digit count should be 12', () => {
      const display = displayString(expr);
      const digitCount = (display.match(/\d/g) ?? []).length;
      expect(digitCount).toBe(MAX_DIGITS);
    });
  });

  // ── Group 20: isComplete with negative value ──────────────────────────
  test('A negative resolved value is still complete (sign enforced by save guard)', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    and('I press toggleSign', () => { expr = applyKey(expr, 'toggleSign'); });
    then('isComplete should be true', () => {
      expect(isComplete(expr)).toBe(true);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 21: division rounded to 2dp ────────────────────────────────
  test('10 divided by 3 rounds to 2dp at each step giving 333 minor units', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ÷', () => { expr = pressOp(expr, '÷'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    then(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 22: operator as first key ──────────────────────────────────
  test('Pressing an operator with no prior operand inserts a leading zero', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press digit 5', () => { expr = pressDigit(expr, '5'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 23: toggleSign on zero stays zero ───────────────────────────
  test('toggleSign on zero does not produce negative zero', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press toggleSign', () => { expr = applyKey(expr, 'toggleSign'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
  });

  // ── Group 24: backspace on trailing dot ──────────────────────────────
  test('Backspace removes a trailing decimal point', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press dot', () => { expr = applyKey(expr, 'dot'); });
    and('I press backspace', () => { expr = applyKey(expr, 'backspace'); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ── Group 25: currentOperandString and pendingOperator ────────────────
  test('Empty expression currentOperandString is 0', ({ given, then, and }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    and('pendingOperator should be null', () => {
      expect(pendingOperator(expr)).toBeNull();
    });
  });

  test('currentOperandString shows the current operand', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    and('pendingOperator should be null', () => {
      expect(pendingOperator(expr)).toBeNull();
    });
  });

  test('After pressing an operator currentOperandString resets to 0', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    and(/^pendingOperator should be "(.*)"$/, (expected: string) => {
      expect(pendingOperator(expr)).toBe(expected);
    });
  });

  test('After entering second operand currentOperandString shows it', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    and('pendingOperator should be null', () => {
      expect(pendingOperator(expr)).toBeNull();
    });
  });

  test('Backspace over the operator restores previousoperand and clears pending operator', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    and('I press backspace', () => { expr = applyKey(expr, 'backspace'); });
    and('I press backspace', () => { expr = applyKey(expr, 'backspace'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    and('pendingOperator should be null', () => {
      expect(pendingOperator(expr)).toBeNull();
    });
  });

  // ── Group 26: isCalculation predicate ────────────────────────────────────
  test('isCalculation is false for empty expression', ({ given, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    then(/^isCalculation should be (true|false)$/, (v: string) => {
      expect(isCalculation(expr)).toBe(v === 'true');
    });
  });

  test('isCalculation is false for a single operand', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    then(/^isCalculation should be (true|false)$/, (v: string) => {
      expect(isCalculation(expr)).toBe(v === 'true');
    });
  });

  test('isCalculation is true after an operator is pressed', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    then(/^isCalculation should be (true|false)$/, (v: string) => {
      expect(isCalculation(expr)).toBe(v === 'true');
    });
  });

  test('isCalculation is true with two operands entered', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    then(/^isCalculation should be (true|false)$/, (v: string) => {
      expect(isCalculation(expr)).toBe(v === 'true');
    });
  });

  // ── Group 27: equals key ──────────────────────────────────────────────────
  test('Equals collapses 100 × 3 to 300', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    and('I press equals', () => { expr = applyKey(expr, 'equals'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
    and(/^isCalculation should be (true|false)$/, (v: string) => {
      expect(isCalculation(expr)).toBe(v === 'true');
    });
  });

  test('Equals is a no-op when expression has a trailing operator', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press equals', () => { expr = applyKey(expr, 'equals'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    and(/^pendingOperator should be "(.*)"$/, (expected: string) => {
      expect(pendingOperator(expr)).toBe(expected);
    });
  });

  test('Equals is a no-op on an empty expression', ({ given, when, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press equals', () => { expr = applyKey(expr, 'equals'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
  });

  test('Chained equals — 100 + 20 equals then × 3 equals gives 360', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    given('an empty expression', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = pressDigit(expr, '1'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press op +', () => { expr = pressOp(expr, '+'); });
    and('I press digit 2', () => { expr = pressDigit(expr, '2'); });
    and('I press digit 0', () => { expr = pressDigit(expr, '0'); });
    and('I press equals', () => { expr = applyKey(expr, 'equals'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    when('I press op ×', () => { expr = pressOp(expr, '×'); });
    and('I press digit 3', () => { expr = pressDigit(expr, '3'); });
    and('I press equals', () => { expr = applyKey(expr, 'equals'); });
    then(/^currentOperandString should be "(.*)"$/, (expected: string) => {
      expect(currentOperandString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr)).toBe(Number(v));
    });
  });

  // ─── Group 28: currency-aware exponent (review F1 / M7) ────────────────
  test('At a 0-decimal exponent, the dot key is blocked entirely', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    const exp = 0;
    given('an empty expression at exponent 0', () => { expr = emptyExpr(); });
    when('I press digit 5', () => { expr = applyKey(expr, { digit: '5' }, exp); });
    and('I press dot', () => { expr = applyKey(expr, 'dot', exp); });
    and('I press digit 0', () => { expr = applyKey(expr, { digit: '0' }, exp); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits at that exponent should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr, exp)).toBe(Number(v));
    });
  });

  test('At a 3-decimal exponent, a third fractional digit is accepted', ({ given, when, and, then }) => {
    let expr: AmountExpr;
    const exp = 3;
    given('an empty expression at exponent 3', () => { expr = emptyExpr(); });
    when('I press digit 1', () => { expr = applyKey(expr, { digit: '1' }, exp); });
    and('I press dot', () => { expr = applyKey(expr, 'dot', exp); });
    and('I press digit 2', () => { expr = applyKey(expr, { digit: '2' }, exp); });
    and('I press digit 3', () => { expr = applyKey(expr, { digit: '3' }, exp); });
    and('I press digit 4', () => { expr = applyKey(expr, { digit: '4' }, exp); });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits at that exponent should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr, exp)).toBe(Number(v));
    });
  });

  test('fromMinorUnits at a 0-decimal exponent round-trips as a whole number', ({ given, then, and }) => {
    let expr: AmountExpr;
    const exp = 0;
    given('an expression seeded from minor units 500 at exponent 0', () => {
      expr = fromMinorUnits(500, exp);
    });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits at that exponent should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr, exp)).toBe(Number(v));
    });
  });

  test('fromMinorUnits at a 3-decimal exponent round-trips with three decimals', ({ given, then, and }) => {
    let expr: AmountExpr;
    const exp = 3;
    given('an expression seeded from minor units 1234 at exponent 3', () => {
      expr = fromMinorUnits(1234, exp);
    });
    then(/^the display should be "(.*)"$/, (expected: string) => {
      expect(displayString(expr)).toBe(expected);
    });
    and(/^resolveMinorUnits at that exponent should be (-?\d+)$/, (v: string) => {
      expect(resolveMinorUnits(expr, exp)).toBe(Number(v));
    });
  });
});

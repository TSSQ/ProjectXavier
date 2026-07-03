/**
 * amountExpression — pure domain module for the calculator-style amount entry.
 *
 * EVALUATION MODEL: left-to-right, NOT operator precedence.
 *   Example: 100 + 20 × 3 → (100 + 20) × 3 = 360
 * This matches calculator-amount UIs and keeps the evaluator a trivial fold.
 * Do NOT change this to standard precedence — it would break the UX contract.
 *
 * All minor-unit values are integers (cents). Major-unit intermediates are
 * rounded to 2 dp at each left-to-right step to avoid floating-point drift.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Token =
  | { kind: 'num'; text: string }
  | { kind: 'op'; op: '+' | '-' | '×' | '÷' };

export interface AmountExpr {
  tokens: Token[];
}

/**
 * Discriminated key type the keypad emits.
 * Digit presses carry the character; all other keys are string literals.
 */
export type AmountKey =
  | { digit: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' }
  | 'dot'
  | 'op:+'
  | 'op:-'
  | 'op:×'
  | 'op:÷'
  | 'backspace'
  | 'toggleSign'
  | 'clear'
  | 'equals';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum total digit characters allowed across all operands. */
export const MAX_DIGITS = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function numToken(text = '0'): Token & { kind: 'num' } {
  return { kind: 'num', text };
}

function opToken(op: '+' | '-' | '×' | '÷'): Token & { kind: 'op' } {
  return { kind: 'op', op };
}

/** Count digit characters across all num tokens. */
function totalDigits(tokens: Token[]): number {
  let n = 0;
  for (const t of tokens) {
    if (t.kind === 'num') {
      for (const ch of t.text) {
        if (ch >= '0' && ch <= '9') n++;
      }
    }
  }
  return n;
}

/** Parse a num token's text to a floating-point value. */
function parseNum(text: string): number {
  if (text === '' || text === '-') return 0;
  return parseFloat(text);
}

/** Round to 2 decimal places (major units). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The empty expression — equivalent to "0". */
export function emptyExpr(): AmountExpr {
  return { tokens: [] };
}

/**
 * Seed an expression from minor units (e.g. for the edit path).
 * Produces a single operand token with the major-unit representation.
 */
export function fromMinorUnits(minor: number): AmountExpr {
  const major = minor / 100;
  // Format to 2 dp, then strip unnecessary trailing zeros after the decimal.
  let text = major.toFixed(2);
  // Remove trailing zeros: "12.30" → "12.3", "12.00" → "12"
  if (text.includes('.')) {
    text = text.replace(/\.?0+$/, '');
  }
  return { tokens: [numToken(text)] };
}

/**
 * Pure reducer: apply a keypad key to produce a new expression.
 */
export function applyKey(expr: AmountExpr, key: AmountKey): AmountExpr {
  if (key === 'clear') return emptyExpr();

  if (key === 'equals') {
    // Collapse the running expression into a single operand showing the result.
    // No-op when the expression can't resolve (trailing operator, ÷0, empty).
    const minor = resolveMinorUnits(expr);
    if (minor === null) return expr;
    return fromMinorUnits(minor);
  }

  const tokens = expr.tokens;

  // --- toggleSign ---
  if (key === 'toggleSign') {
    if (tokens.length === 0) return emptyExpr();
    const last = tokens[tokens.length - 1]!;
    if (last.kind !== 'num') return expr; // trailing operator — nothing to negate
    const text = last.kind === 'num' ? last.text : '';
    let newText: string;
    if (text.startsWith('-')) {
      newText = text.slice(1);
    } else {
      newText = text === '' || text === '0' ? text : '-' + text;
    }
    return { tokens: [...tokens.slice(0, -1), numToken(newText)] };
  }

  // --- backspace ---
  if (key === 'backspace') {
    if (tokens.length === 0) return emptyExpr();
    const last = tokens[tokens.length - 1]!;
    if (last.kind === 'op') {
      // Remove the trailing operator token.
      return { tokens: tokens.slice(0, -1) };
    }
    // last is num
    const text = last.text;
    if (text.length <= 1) {
      // Removing the last digit of an operand.
      if (tokens.length === 1) {
        // Back to empty.
        return emptyExpr();
      }
      // Pop this operand; keep the operator before it.
      return { tokens: tokens.slice(0, -1) };
    }
    const newText = text.slice(0, -1);
    // If backspacing leaves a dangling '-' or empty string, treat the operand
    // as cleared: remove it and its preceding operator (if any).
    if (newText === '-' || newText === '') {
      if (tokens.length === 1) return emptyExpr();
      // Drop both this operand and the operator token before it.
      return { tokens: tokens.slice(0, -2) };
    }
    return { tokens: [...tokens.slice(0, -1), numToken(newText)] };
  }

  // --- operator ---
  if (
    key === 'op:+' ||
    key === 'op:-' ||
    key === 'op:×' ||
    key === 'op:÷'
  ) {
    const opChar = key.slice(3) as '+' | '-' | '×' | '÷';
    if (tokens.length === 0) {
      // No operand yet — start with "0 <op>"
      return { tokens: [numToken('0'), opToken(opChar)] };
    }
    const last = tokens[tokens.length - 1]!;
    if (last.kind === 'op') {
      // Replace the trailing operator.
      return { tokens: [...tokens.slice(0, -1), opToken(opChar)] };
    }
    // Append an operator.
    return { tokens: [...tokens, opToken(opChar)] };
  }

  // --- dot ---
  if (key === 'dot') {
    if (tokens.length === 0) {
      return { tokens: [numToken('0.')] };
    }
    const last = tokens[tokens.length - 1]!;
    if (last.kind === 'op') {
      // Start a new operand "0."
      return { tokens: [...tokens, numToken('0.')] };
    }
    // Only one dot per operand.
    if (last.text.includes('.')) return expr;
    return { tokens: [...tokens.slice(0, -1), numToken(last.text + '.')] };
  }

  // --- digit ---
  const { digit } = key as { digit: string };

  if (tokens.length === 0) {
    return { tokens: [numToken(digit)] };
  }

  const last = tokens[tokens.length - 1]!;

  if (last.kind === 'op') {
    // Start a fresh operand after an operator — still subject to the digit cap.
    if (totalDigits(tokens) >= MAX_DIGITS) return expr;
    return { tokens: [...tokens, numToken(digit)] };
  }

  // last is num — append the digit
  const text = last.text;

  // Enforce 2 dp clamp: if there's a decimal point, count existing dp digits.
  if (text.includes('.')) {
    const afterDot = text.split('.')[1] ?? '';
    if (afterDot.length >= 2) return expr; // clamp: ignore extra fractional digits
  }

  // Check total digit cap.
  if (totalDigits(tokens) >= MAX_DIGITS) return expr;

  // Leading-zero replacement: "0" + digit → digit (but "0." is preserved).
  let newText: string;
  if ((text === '0' || text === '-0') && digit !== '.') {
    // Replace the zero with the new digit (preserve sign).
    newText = text.startsWith('-') ? '-' + digit : digit;
  } else {
    newText = text + digit;
  }

  return { tokens: [...tokens.slice(0, -1), numToken(newText)] };
}

/** The string the big amount figure shows: the current operand, or "0" when
 *  empty or when an operator was just pressed (waiting for the next operand). */
export function currentOperandString(expr: AmountExpr): string {
  if (expr.tokens.length === 0) return '0';
  const last = expr.tokens[expr.tokens.length - 1]!;
  if (last.kind === 'op') return '0';
  return last.text === '' || last.text === '-' ? '0' : last.text;
}

/** The pending operator (last token is an operator), else null. Left-to-right
 *  means only the trailing operator can be pending. */
export function pendingOperator(expr: AmountExpr): '+' | '-' | '×' | '÷' | null {
  const last = expr.tokens[expr.tokens.length - 1];
  return last && last.kind === 'op' ? last.op : null;
}

/** True when the expression contains an operator (a multi-operand calculation
 *  in progress), so the primary button should offer "=" to collapse it. */
export function isCalculation(expr: AmountExpr): boolean {
  return expr.tokens.length > 1;
}

/**
 * Display string for the expression.
 *   - Empty → "0"
 *   - Single operand → just the text (e.g. "12.3")
 *   - Multi-token → "100 + 20 × 3"
 */
export function displayString(expr: AmountExpr): string {
  if (expr.tokens.length === 0) return '0';
  return expr.tokens
    .map((t) => {
      if (t.kind === 'op') return ` ${t.op} `;
      // Display text as-is (trailing dot included for live input feel).
      return t.text === '' || t.text === '-' ? '0' : t.text;
    })
    .join('');
}

/**
 * Whether the expression is "complete" (syntactically ready to resolve):
 *   - Non-empty
 *   - Last token is a num (not a trailing operator)
 *   - Resolves to a non-null value (not divide-by-zero)
 *
 * Note: negative results ARE considered complete — the save layer enforces the
 * "amount > 0" business rule separately. isComplete only checks parsability.
 */
export function isComplete(expr: AmountExpr): boolean {
  if (expr.tokens.length === 0) return false;
  const last = expr.tokens[expr.tokens.length - 1]!;
  if (last.kind === 'op') return false;
  const result = resolveMinorUnits(expr);
  return result !== null;
}

/**
 * Evaluate the expression left-to-right.
 * Each step is rounded to 2 dp in major units before the next operation.
 * Returns minor units (integer cents) or null if not resolvable.
 *
 * null cases: empty expression, trailing operator, divide-by-zero.
 */
export function resolveMinorUnits(expr: AmountExpr): number | null {
  if (expr.tokens.length === 0) return null;

  const last = expr.tokens[expr.tokens.length - 1]!;
  if (last.kind === 'op') return null; // trailing operator

  // Collect operands interleaved with operators via a left fold.
  // tokens pattern: num (op num)*
  let accumulator: number = parseNum(
    (expr.tokens[0] as Token & { kind: 'num' }).text
  );
  accumulator = round2(accumulator);

  for (let i = 1; i < expr.tokens.length; i += 2) {
    const opTok = expr.tokens[i] as Token & { kind: 'op' };
    const numTok = expr.tokens[i + 1] as Token & { kind: 'num' };
    const rhs = round2(parseNum(numTok.text));

    switch (opTok.op) {
      case '+':
        accumulator = round2(accumulator + rhs);
        break;
      case '-':
        accumulator = round2(accumulator - rhs);
        break;
      case '×':
        accumulator = round2(accumulator * rhs);
        break;
      case '÷':
        if (rhs === 0) return null;
        accumulator = round2(accumulator / rhs);
        break;
    }
  }

  // Convert major units to integer minor units.
  return Math.round(accumulator * 100);
}

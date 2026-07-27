Feature: Amount expression calculator
  The amount entry keypad drives a left-to-right expression evaluator.
  Evaluation is NOT standard operator precedence — it folds left-to-right.

  # ── Group 1: plain digits ────────────────────────────────────────────────
  Scenario: Entering plain digits builds an operand
    Given an empty expression
    When I press digit 1
    And I press digit 2
    And I press digit 3
    Then the display should be "123"
    And resolveMinorUnits should be 12300
    And isComplete should be true

  # ── Group 2: 2 dp clamp ──────────────────────────────────────────────────
  Scenario: Extra fractional digits beyond 2 dp are ignored
    Given an empty expression
    When I press digit 1
    And I press dot
    And I press digit 2
    And I press digit 3
    And I press digit 4
    Then the display should be "1.23"
    And resolveMinorUnits should be 123

  # ── Group 3: leading-zero replacement ────────────────────────────────────
  Scenario: A leading zero is replaced by the next digit
    Given an empty expression
    When I press digit 0
    And I press digit 5
    Then the display should be "5"

  # ── Group 4: 0. is preserved ─────────────────────────────────────────────
  Scenario: A zero followed by dot starts a decimal
    Given an empty expression
    When I press digit 0
    And I press dot
    And I press digit 5
    Then the display should be "0.5"
    And resolveMinorUnits should be 50

  # ── Group 5: addition ────────────────────────────────────────────────────
  Scenario: Simple addition of two operands
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op +
    And I press digit 2
    And I press digit 0
    Then the display should be "100 + 20"
    And resolveMinorUnits should be 12000
    And isComplete should be true

  # ── Group 6: mixed-ops left-to-right (the 360 scenario) ─────────────────
  Scenario: Mixed operators evaluated strictly left to right
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op +
    And I press digit 2
    And I press digit 0
    And I press op ×
    And I press digit 3
    Then the display should be "100 + 20 × 3"
    And resolveMinorUnits should be 36000

  # ── Group 7: subtraction happy path ─────────────────────────────────────
  Scenario: Subtraction produces the correct result
    Given an empty expression
    When I press digit 5
    And I press digit 0
    And I press op -
    And I press digit 1
    And I press digit 5
    Then resolveMinorUnits should be 3500

  # ── Group 8: multiplication happy path ──────────────────────────────────
  Scenario: Multiplication produces the correct result
    Given an empty expression
    When I press digit 3
    And I press op ×
    And I press digit 4
    Then resolveMinorUnits should be 1200

  # ── Group 9: division happy path ─────────────────────────────────────────
  Scenario: Division produces the correct result
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press op ÷
    And I press digit 4
    Then resolveMinorUnits should be 250

  # ── Group 10: trailing operator → incomplete / null ──────────────────────
  Scenario: A trailing operator means the expression is not complete
    Given an empty expression
    When I press digit 5
    And I press op +
    Then isComplete should be false
    And resolveMinorUnits should be null

  # ── Group 11: operator replaces operator ─────────────────────────────────
  Scenario: Pressing a second operator replaces the first
    Given an empty expression
    When I press digit 5
    And I press op +
    And I press op ×
    Then the display should be "5 × "
    And isComplete should be false

  # ── Group 12: divide-by-zero → null ─────────────────────────────────────
  Scenario: Dividing by zero produces null
    Given an empty expression
    When I press digit 9
    And I press op ÷
    And I press digit 0
    Then resolveMinorUnits should be null

  # ── Group 13: toggleSign both ways ──────────────────────────────────────
  Scenario: toggleSign negates a positive operand
    Given an empty expression
    When I press digit 5
    And I press toggleSign
    Then the display should be "-5"
    And resolveMinorUnits should be -500

  Scenario: toggleSign on a negative operand makes it positive
    Given an empty expression
    When I press digit 5
    And I press toggleSign
    And I press toggleSign
    Then the display should be "5"
    And resolveMinorUnits should be 500

  # ── Group 14: backspace ──────────────────────────────────────────────────
  Scenario: Backspace mid-operand removes the last digit
    Given an empty expression
    When I press digit 1
    And I press digit 2
    And I press digit 3
    And I press backspace
    Then the display should be "12"

  Scenario: Backspace removes a trailing operator token
    Given an empty expression
    When I press digit 5
    And I press op +
    And I press backspace
    Then the display should be "5"
    And isComplete should be true

  Scenario: Backspace on a single-digit operand after an operator returns to just the operand
    Given an empty expression
    When I press digit 5
    And I press op +
    And I press digit 3
    And I press backspace
    Then the display should be "5 + "
    And isComplete should be false

  Scenario: Backspace on the only operand returns to empty expression showing 0
    Given an empty expression
    When I press digit 5
    And I press backspace
    Then the display should be "0"
    And isComplete should be false
    And resolveMinorUnits should be null

  # ── Group 15: max-length boundary ────────────────────────────────────────
  Scenario: Digits beyond the cap are ignored
    Given an empty expression
    When I press 12 digits
    And I press digit 9
    Then the total digit count should be 12

  # ── Group 16: fromMinorUnits round-trip ──────────────────────────────────
  Scenario: fromMinorUnits 1234 round-trips correctly
    Given an expression seeded from minor units 1234
    Then the display should be "12.34"
    And resolveMinorUnits should be 1234

  # ── Group 17: empty expression defaults ──────────────────────────────────
  Scenario: An empty expression displays 0 and is not resolvable
    Given an empty expression
    Then the display should be "0"
    And isComplete should be false
    And resolveMinorUnits should be null

  # ── Group 18: backspace clears dangling minus ────────────────────────────
  Scenario: Backspace after toggleSign clears the sign and the next digit starts fresh
    Given an empty expression
    When I press digit 5
    And I press toggleSign
    And I press backspace
    And I press digit 7
    Then the display should be "7"
    And resolveMinorUnits should be 700

  # ── Group 19: MAX_DIGITS cap after operator ──────────────────────────────
  Scenario: The digit cap applies when starting a new operand after an operator
    Given an empty expression
    When I press 12 digits
    And I press op +
    And I press digit 1
    Then the total digit count should be 12

  # ── Group 20: isComplete with negative value ─────────────────────────────
  Scenario: A negative resolved value is still complete (sign enforced by save guard)
    Given an empty expression
    When I press digit 5
    And I press toggleSign
    Then isComplete should be true
    And resolveMinorUnits should be -500

  # ── Group 21: division rounded to 2dp ────────────────────────────────────
  Scenario: 10 divided by 3 rounds to 2dp at each step giving 333 minor units
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press op ÷
    And I press digit 3
    Then resolveMinorUnits should be 333

  # ── Group 22: operator as first key ─────────────────────────────────────
  Scenario: Pressing an operator with no prior operand inserts a leading zero
    Given an empty expression
    When I press op ×
    And I press digit 5
    Then the display should be "0 × 5"
    And resolveMinorUnits should be 0

  # ── Group 23: toggleSign on zero stays zero ──────────────────────────────
  Scenario: toggleSign on zero does not produce negative zero
    Given an empty expression
    When I press digit 0
    And I press toggleSign
    Then the display should be "0"

  # ── Group 24: backspace on trailing dot ─────────────────────────────────
  Scenario: Backspace removes a trailing decimal point
    Given an empty expression
    When I press digit 1
    And I press dot
    And I press backspace
    Then the display should be "1"
    And resolveMinorUnits should be 100

  # ── Group 25: currentOperandString and pendingOperator ───────────────────
  Scenario: Empty expression currentOperandString is 0
    Given an empty expression
    Then currentOperandString should be "0"
    And pendingOperator should be null

  Scenario: currentOperandString shows the current operand
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    Then currentOperandString should be "100"
    And pendingOperator should be null

  Scenario: After pressing an operator currentOperandString resets to 0
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op ×
    Then currentOperandString should be "0"
    And pendingOperator should be "×"

  Scenario: After entering second operand currentOperandString shows it
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op ×
    And I press digit 3
    Then currentOperandString should be "3"
    And pendingOperator should be null

  Scenario: Backspace over the operator restores previousoperand and clears pending operator
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op ×
    And I press digit 3
    And I press backspace
    And I press backspace
    Then currentOperandString should be "100"
    And pendingOperator should be null

  # ── Group 26: isCalculation predicate ────────────────────────────────────
  Scenario: isCalculation is false for empty expression
    Given an empty expression
    Then isCalculation should be false

  Scenario: isCalculation is false for a single operand
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    Then isCalculation should be false

  Scenario: isCalculation is true after an operator is pressed
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op ×
    Then isCalculation should be true

  Scenario: isCalculation is true with two operands entered
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op ×
    And I press digit 3
    Then isCalculation should be true

  # ── Group 27: equals key ──────────────────────────────────────────────────
  Scenario: Equals collapses 100 × 3 to 300
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op ×
    And I press digit 3
    And I press equals
    Then currentOperandString should be "300"
    And resolveMinorUnits should be 30000
    And isCalculation should be false

  Scenario: Equals is a no-op when expression has a trailing operator
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op ×
    And I press equals
    Then currentOperandString should be "0"
    And pendingOperator should be "×"

  Scenario: Equals is a no-op on an empty expression
    Given an empty expression
    When I press equals
    Then currentOperandString should be "0"

  Scenario: Chained equals — 100 + 20 equals then × 3 equals gives 360
    Given an empty expression
    When I press digit 1
    And I press digit 0
    And I press digit 0
    And I press op +
    And I press digit 2
    And I press digit 0
    And I press equals
    Then currentOperandString should be "120"
    When I press op ×
    And I press digit 3
    And I press equals
    Then currentOperandString should be "360"
    And resolveMinorUnits should be 36000

  # ─── Group 28: currency-aware exponent (review F1 / M7) ──────────────────
  # A 0-decimal currency (e.g. JPY) is integer-only — the dot key is blocked
  # entirely. A 3-decimal currency (e.g. BHD/KWD) allows a third fractional
  # digit instead of clamping at 2dp. All existing groups above default to
  # exp=2, unaffected by these.

  Scenario: At a 0-decimal exponent, the dot key is blocked entirely
    Given an empty expression at exponent 0
    When I press digit 5
    And I press dot
    And I press digit 0
    Then the display should be "50"
    And resolveMinorUnits at that exponent should be 50

  Scenario: At a 3-decimal exponent, a third fractional digit is accepted
    Given an empty expression at exponent 3
    When I press digit 1
    And I press dot
    And I press digit 2
    And I press digit 3
    And I press digit 4
    Then the display should be "1.234"
    And resolveMinorUnits at that exponent should be 1234

  Scenario: fromMinorUnits at a 0-decimal exponent round-trips as a whole number
    Given an expression seeded from minor units 500 at exponent 0
    Then the display should be "500"
    And resolveMinorUnits at that exponent should be 500

  Scenario: fromMinorUnits at a 3-decimal exponent round-trips with three decimals
    Given an expression seeded from minor units 1234 at exponent 3
    Then the display should be "1.234"
    And resolveMinorUnits at that exponent should be 1234

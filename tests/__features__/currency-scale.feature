Feature: Currency-aware money scale (review F1 / M7)
  The app hard-coded a ×100 (2-decimal) assumption everywhere money was
  scaled between major and minor units. `currencyExponent` is the pure ISO
  4217 fact table (0/2/3 decimal places) driving currency-aware math in
  money.ts: `toMinorUnits`, `toMajorUnits`, and `formatMoney`.

  # ─── currencyExponent ──────────────────────────────────────────────────

  Scenario Outline: A representative sample of currencies resolves to the right exponent
    Then the exponent for currency "<code>" should be <exponent>

    Examples:
      | code | exponent |
      | JPY  | 0        |
      | KRW  | 0        |
      | VND  | 0        |
      | CLP  | 0        |
      | USD  | 2        |
      | EUR  | 2        |
      | SGD  | 2        |
      | GBP  | 2        |
      | KWD  | 3        |
      | BHD  | 3        |
      | OMR  | 3        |
      | TND  | 3        |

  Scenario: An unrecognised currency code defaults to 2 and never throws
    Then the exponent for currency "ZZZ" should be 2

  Scenario: A lowercase currency code still resolves correctly
    Then the exponent for currency "jpy" should be 0

  Scenario: Every SUPPORTED_CURRENCIES code resolves to a sane 0/2/3 exponent
    Then every code in SUPPORTED_CURRENCIES should resolve to 0, 2, or 3
    And every code in SUPPORTED_CURRENCIES except JPY, KRW, VND, CLP should resolve to 2

  # ─── toMinorUnits / toMajorUnits round-trip ────────────────────────────

  Scenario: A 2-decimal currency scales ×100
    Then toMinorUnits of 12.34 in "USD" should be 1234
    And toMajorUnits of 1234 in "USD" should be 12.34

  Scenario: A 0-decimal currency scales ×1 (no fractional minor units)
    Then toMinorUnits of 1000 in "JPY" should be 1000
    And toMajorUnits of 1000 in "JPY" should be 1000

  Scenario: A 3-decimal currency scales ×1000
    Then toMinorUnits of 1.234 in "KWD" should be 1234
    And toMajorUnits of 1234 in "KWD" should be 1.234

  Scenario: toMinorUnits rounds a fractional minor unit
    Then toMinorUnits of 12.345 in "USD" should be 1235

  Scenario: toMinorUnits without a currency defaults to 2-decimal (USD)
    Then toMinorUnits of 12.34 with no currency should be 1234

  # ─── formatMoney ────────────────────────────────────────────────────────

  Scenario: A 0-decimal currency formats with no fraction digits
    Then formatMoney of 100000 in "JPY" should contain "100,000"
    And formatMoney of 100000 in "JPY" should not contain "."

  Scenario: A 2-decimal currency formats with two fraction digits
    Then formatMoney of 100000 in "USD" should contain "1,000.00"

  Scenario: A 3-decimal currency formats with three fraction digits
    Then formatMoney of 1234 in "KWD" should contain "1.234"

  Scenario: A malformed currency code degrades gracefully instead of throwing
    Then formatMoney of 1234 in "NOT-A-CODE" should not throw

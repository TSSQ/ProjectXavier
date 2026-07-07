Feature: OCR text classification
  onScan (app/(tabs)/index.tsx) uses this to decide whether recognized text is
  worth sending to the parse ladder, without ever calling runParse on empty
  text.

  Scenario: Empty string is classified as empty
    When I classify OCR text ""
    Then the classification should be "empty"

  Scenario: Whitespace-only text is classified as empty
    When I classify OCR text "   \n\t"
    Then the classification should be "empty"

  Scenario: Text with surrounding whitespace is classified as ok, trimmed
    When I classify OCR text "  total: 12.50  "
    Then the classification should be "ok"
    And the text handed to runParse should be "total: 12.50"

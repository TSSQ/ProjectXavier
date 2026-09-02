Feature: Statement-scan OCR trust boundary

  Native OCR output is untrusted (guardrail #6 — treat AI/OCR output as
  untrusted): `ocrObservationsSchema` (src/domain/ocrObservation.ts) is what
  `appleVisionRecognizer.recognizeLayout` validates the native module's
  result against before any pure domain code (statementLayout.ts) ever sees
  it (docs/design/statement-scan-spec.md §4.1). This feature covers the
  plain-Node-testable half of criterion 16 — the schema itself, and
  `TextRecognizer.recognizeLayout` failing loudly when no native module is
  configured, exactly like `recognize()` already does. The other half — a
  rejected native payload surfacing as the screen's existing "I couldn't
  read that photo" copy — is device/RN-only (appleVisionRecognizer.ts
  imports `react-native`, which this suite can't import); verified by
  construction: `recognizeLayout` throws on an invalid payload, and the
  statement-scan screen code wraps its call to it in the SAME try/catch that
  already produces that copy for `recognize()`'s own failures.

  Scenario: A box outside 0..1 is rejected
    Given an observation payload with a box outside 0..1
    When I validate it against the observations schema
    Then it should be rejected

  Scenario: A non-array payload is rejected
    Given a non-array observation payload
    When I validate it against the observations schema
    Then it should be rejected

  Scenario: A well-formed payload is accepted
    Given a well-formed observation payload
    When I validate it against the observations schema
    Then it should be accepted

  Scenario: recognizeLayout fails loudly when no native module is configured
    When I call the unconfigured recognizer's recognizeLayout
    Then it should reject

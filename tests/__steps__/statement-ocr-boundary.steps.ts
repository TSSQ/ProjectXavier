import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { ocrObservationsSchema } from '../../src/domain/ocrObservation';
import { unconfiguredRecognizer } from '../../src/features/ocr/recognizer';

const feature = loadFeature(
  path.join(__dirname, '..', '__features__', 'statement-ocr-boundary.feature')
);

defineFeature(feature, (test) => {
  let payload: unknown;
  let result: ReturnType<typeof ocrObservationsSchema.safeParse>;

  test('A box outside 0..1 is rejected', ({ given, when, then }) => {
    given('an observation payload with a box outside 0..1', () => {
      payload = [{ text: 'Total', x: 1.5, y: 0.1, w: 0.2, h: 0.02 }];
    });
    when('I validate it against the observations schema', () => {
      result = ocrObservationsSchema.safeParse(payload);
    });
    then('it should be rejected', () => {
      expect(result.success).toBe(false);
    });
  });

  test('A non-array payload is rejected', ({ given, when, then }) => {
    given('a non-array observation payload', () => {
      payload = { text: 'Total', x: 0.1, y: 0.1, w: 0.2, h: 0.02 };
    });
    when('I validate it against the observations schema', () => {
      result = ocrObservationsSchema.safeParse(payload);
    });
    then('it should be rejected', () => {
      expect(result.success).toBe(false);
    });
  });

  test('A well-formed payload is accepted', ({ given, when, then }) => {
    given('a well-formed observation payload', () => {
      payload = [{ text: '-16.74', x: 0.81, y: 0.14, w: 0.11, h: 0.03 }];
    });
    when('I validate it against the observations schema', () => {
      result = ocrObservationsSchema.safeParse(payload);
    });
    then('it should be accepted', () => {
      expect(result.success).toBe(true);
    });
  });

  test('recognizeLayout fails loudly when no native module is configured', ({ when, then }) => {
    let rejection: unknown;
    when("I call the unconfigured recognizer's recognizeLayout", async () => {
      rejection = await unconfiguredRecognizer.recognizeLayout('file:///x.jpg').catch((e) => e);
    });
    then('it should reject', () => {
      expect(rejection).toBeInstanceOf(Error);
    });
  });
});

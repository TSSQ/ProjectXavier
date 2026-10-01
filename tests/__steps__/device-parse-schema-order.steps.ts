import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { zodSchema } from 'ai';
import {
  DEVICE_PARSE_FIELD_ORDER,
  getDeviceParseOrderedJsonSchema,
} from '../../src/domain/deviceParseSchemaOrder';
import { deviceParseSchema } from '../../src/domain/deviceParsePrompt';

const feature = loadFeature(path.resolve(__dirname, '../__features__/device-parse-schema-order.feature'));

defineFeature(feature, (test) => {
  test("DEVICE_PARSE_FIELD_ORDER is an exact permutation of the zod schema's own keys", ({
    when,
    then,
  }) => {
    let schemaKeys: string[];
    let orderKeys: string[];

    when('DEVICE_PARSE_FIELD_ORDER is compared against deviceParseSchema\'s keys', () => {
      schemaKeys = Object.keys(deviceParseSchema.shape);
      orderKeys = [...DEVICE_PARSE_FIELD_ORDER];
    });
    then('it names exactly the same set of fields, once each', () => {
      // Same length (no duplicates, no missing/extra entries) AND the same
      // set — a weaker length-only or set-only check could pass on a
      // duplicate-for-missing swap.
      expect(orderKeys.length).toBe(schemaKeys.length);
      expect(new Set(orderKeys).size).toBe(orderKeys.length);
      expect([...orderKeys].sort()).toEqual([...schemaKeys].sort());
    });
  });

  test('The ordered JSON Schema carries "x-order" equal to DEVICE_PARSE_FIELD_ORDER by default', ({
    when,
    then,
  }) => {
    let json: Record<string, unknown>;

    when('the ordered JSON Schema is derived with no explicit order', () => {
      json = getDeviceParseOrderedJsonSchema();
    });
    then('its "x-order" equals DEVICE_PARSE_FIELD_ORDER', () => {
      expect(json['x-order']).toEqual(DEVICE_PARSE_FIELD_ORDER);
    });
  });

  test('The ordered JSON Schema is otherwise byte-identical to the plain AI SDK conversion', ({
    when,
    then,
  }) => {
    let json: Record<string, unknown>;

    when('the ordered JSON Schema is derived with no explicit order', () => {
      json = getDeviceParseOrderedJsonSchema();
    });
    then('every key except "x-order" matches the AI SDK\'s own zodSchema conversion of deviceParseSchema', () => {
      const base = zodSchema(deviceParseSchema).jsonSchema as Record<string, unknown>;
      const rest = Object.fromEntries(Object.entries(json).filter(([key]) => key !== 'x-order'));
      expect(rest).toEqual(base);
    });
  });

  test('An explicit order overrides "x-order" without changing anything else', ({ when, then, and }) => {
    let json: Record<string, unknown>;
    const explicitOrder = [
      'pending',
      'confidence',
      'occurredOn',
      'note',
      'account',
      'payee',
      'category',
      'currency',
      'type',
      'amount',
    ];

    when(/^the ordered JSON Schema is derived with the order: .+$/, () => {
      json = getDeviceParseOrderedJsonSchema(explicitOrder);
    });
    then(/^its "x-order" equals: .+$/, () => {
      expect(json['x-order']).toEqual(explicitOrder);
    });
    and("every key except \"x-order\" matches the AI SDK's own zodSchema conversion of deviceParseSchema", () => {
      const base = zodSchema(deviceParseSchema).jsonSchema as Record<string, unknown>;
      const rest = Object.fromEntries(Object.entries(json).filter(([key]) => key !== 'x-order'));
      expect(rest).toEqual(base);
    });
  });
});

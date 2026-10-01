import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { z } from 'zod';
import { zodSchema, Schema } from 'ai';
import { orderedJsonSchema, declarationOrder } from '../../src/domain/orderedJsonSchema';
import { accountParseSchema } from '../../src/domain/accountParseSchema';
import { accountUpdateParseSchema } from '../../src/domain/accountUpdateSchema';
import { queryToolSelectionSchema } from '../../src/domain/queryToolSelection';
import { transactionOpSelectionSchema } from '../../src/domain/transactionOpSelection';

const feature = loadFeature(path.resolve(__dirname, '../__features__/ordered-json-schema.feature'));

const SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  accountParseSchema,
  accountUpdateParseSchema,
  queryToolSelectionSchema,
  transactionOpSelectionSchema,
};

function schemaByName(name: string): z.ZodObject<z.ZodRawShape> {
  const schema = SCHEMAS[name];
  if (!schema) throw new Error(`unknown schema in feature table: "${name}"`);
  return schema;
}

defineFeature(feature, (test) => {
  test(
    "Each on-device caller's schema is pinned to its declaration order, and is otherwise unchanged",
    ({ when, then, and }) => {
      let json: Record<string, unknown>;

      when(/^orderedJsonSchema is derived for the "(.+)" schema with no explicit order$/, (name: string) => {
        json = orderedJsonSchema(schemaByName(name)).jsonSchema as Record<string, unknown>;
      });
      then(/^its "x-order" equals the "(.+)" schema's declaration order$/, (name: string) => {
        expect(json['x-order']).toEqual(declarationOrder(schemaByName(name)));
      });
      and(/^its "type" is "object"$/, () => {
        expect(json['type']).toBe('object');
      });
      and('its "properties" keys equal the "x-order" set exactly', () => {
        const order = json['x-order'] as string[];
        const propertyKeys = Object.keys(json['properties'] as Record<string, unknown>);
        expect(new Set(propertyKeys)).toEqual(new Set(order));
        expect(propertyKeys.length).toBe(order.length);
      });
      and(
        /^every key except "x-order" matches the AI SDK's own zodSchema conversion of the "(.+)" schema$/,
        (name: string) => {
          const base = zodSchema(schemaByName(name)).jsonSchema as Record<string, unknown>;
          const rest = Object.fromEntries(Object.entries(json).filter(([key]) => key !== 'x-order'));
          expect(rest).toEqual(base);
        }
      );
    }
  );

  test('An explicit order overrides "x-order" without changing anything else', ({ when, then, and }) => {
    let json: Record<string, unknown>;
    let reversed: string[];

    when(/^orderedJsonSchema is derived for the "(.+)" schema with an explicit reversed order$/, (name: string) => {
      reversed = [...declarationOrder(schemaByName(name))].reverse();
      json = orderedJsonSchema(schemaByName(name), reversed).jsonSchema as Record<string, unknown>;
    });
    then('its "x-order" equals the reversed order', () => {
      expect(json['x-order']).toEqual(reversed);
    });
    and(
      /^every key except "x-order" matches the AI SDK's own zodSchema conversion of the "(.+)" schema$/,
      (name: string) => {
        const base = zodSchema(schemaByName(name)).jsonSchema as Record<string, unknown>;
        const rest = Object.fromEntries(Object.entries(json).filter(([key]) => key !== 'x-order'));
        expect(rest).toEqual(base);
      }
    );
  });

  test("declarationOrder is an exact permutation of the schema's own keys", ({ when, then }) => {
    let schema: z.ZodObject<z.ZodRawShape>;
    let order: string[];

    when(/^declarationOrder is computed for the "(.+)" schema$/, (name: string) => {
      schema = schemaByName(name);
      order = declarationOrder(schema);
    });
    then("it names exactly the same set of fields as the schema's own keys, once each", () => {
      const schemaKeys = Object.keys(schema.shape);
      expect(order.length).toBe(schemaKeys.length);
      expect(new Set(order).size).toBe(order.length);
      expect([...order].sort()).toEqual([...schemaKeys].sort());
    });
  });

  test("A model output that violates the schema is rejected by the helper's own validate", ({
    given,
    when,
    then,
  }) => {
    let schema: Schema<unknown>;
    let result: { success: boolean };

    given(/^orderedJsonSchema derived for the "(.+)" schema$/, (name: string) => {
      schema = orderedJsonSchema(schemaByName(name));
    });
    when(/^its validate function is called with \{ "op": "(.+)" \}$/, async (op: string) => {
      if (!schema.validate) throw new Error('expected orderedJsonSchema to expose a validate function');
      result = await schema.validate({ op });
    });
    then('validation fails', () => {
      expect(result.success).toBe(false);
    });
  });

  test("A model output that satisfies the schema is accepted by the helper's own validate", ({
    given,
    when,
    then,
  }) => {
    let schema: Schema<unknown>;
    let result: { success: boolean };

    given(/^orderedJsonSchema derived for the "(.+)" schema$/, (name: string) => {
      schema = orderedJsonSchema(schemaByName(name));
    });
    when(/^its validate function is called with \{ "op": "(.+)" \}$/, async (op: string) => {
      if (!schema.validate) throw new Error('expected orderedJsonSchema to expose a validate function');
      result = await schema.validate({ op });
    });
    then('validation succeeds', () => {
      expect(result.success).toBe(true);
    });
  });
});

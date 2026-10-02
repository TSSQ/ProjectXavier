import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { zodSchema, Schema } from 'ai';
import {
  DEVICE_PARSE_FIELD_ORDER,
  getDeviceParseOrderedJsonSchema,
} from '../../src/domain/deviceParseSchemaOrder';
import { deviceParseFmSchema } from '../../src/domain/deviceParsePrompt';
import { deviceParseSchemaFor } from '../../src/domain/deviceSchemas';
import { FmAmountPlan } from '../../src/domain/fmAmountPlan';

const feature = loadFeature(path.resolve(__dirname, '../__features__/device-parse-schema-order.feature'));

/** The literal order chosen by step 1a.5's field-order experiment (see
 *  DEVICE_PARSE_FIELD_ORDER's own doc comment and evals/README.md's "Field-
 *  order experiment" section for the measurement). Deliberately NOT a
 *  reference to the imported `DEVICE_PARSE_FIELD_ORDER` constant — comparing
 *  the constant to itself would be tautological. Changing this literal
 *  requires a new `npm run eval:fm:replay` measurement and an update to
 *  evals/README.md's field-order table. */
const PINNED_LITERAL_ORDER = [
  'isTransaction',
  'amount',
  'category',
  'payee',
  'type',
  'currency',
  'account',
  'note',
  'occurredOn',
  'confidence',
  'pending',
];

/** The three amount plans (src/domain/fmAmountPlan.ts) the schema varies by. */
const PLANS: Record<string, FmAmountPlan> = {
  model: { mode: 'model' },
  single: { mode: 'single', value: 12.5 },
  choice: { mode: 'choice', values: [45, 9.6] },
};

/** A valid model output for `plan`: `single` has no amount field, `choice`
 *  carries the label of a candidate. */
function validOutputFor(plan: FmAmountPlan): Record<string, unknown> {
  const output: Record<string, unknown> = { ...VALID_MODEL_OUTPUT };
  if (plan.mode === 'single') delete output.amount;
  else if (plan.mode === 'choice') output.amount = '45';
  return output;
}

/** A model output that satisfies every field `deviceParseFmSchema` requires
 *  (`currency`/`occurredOn` are the schema's only optional fields). */
const VALID_MODEL_OUTPUT = {
  isTransaction: true,
  amount: 12.5,
  type: 'expense',
  category: 'Dining',
  payee: "Joe's",
  account: '',
  note: '',
  confidence: 0.9,
  pending: false,
};

defineFeature(feature, (test) => {
  test("DEVICE_PARSE_FIELD_ORDER is an exact permutation of the zod schema's own keys", ({
    when,
    then,
  }) => {
    let schemaKeys: string[];
    let orderKeys: string[];

    when('DEVICE_PARSE_FIELD_ORDER is compared against deviceParseSchema\'s keys', () => {
      schemaKeys = Object.keys(deviceParseFmSchema.shape);
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

  test('The ordered JSON Schema carries "x-order" equal to the pinned literal field order by default', ({
    when,
    then,
  }) => {
    let json: Record<string, unknown>;

    when('the ordered JSON Schema is derived with no explicit order', () => {
      json = getDeviceParseOrderedJsonSchema();
    });
    then(/^its "x-order" equals the literal order: .+$/, () => {
      expect(json['x-order']).toEqual(PINNED_LITERAL_ORDER);
    });
  });

  test('The ordered JSON Schema is otherwise byte-identical to the plain AI SDK conversion', ({
    when,
    then,
    and,
  }) => {
    let json: Record<string, unknown>;

    when('the ordered JSON Schema is derived with no explicit order', () => {
      json = getDeviceParseOrderedJsonSchema();
    });
    then(/^its "type" is "object"$/, () => {
      expect(json['type']).toBe('object');
    });
    and('its "properties" keys equal the "x-order" set exactly', () => {
      const order = json['x-order'] as string[];
      const propertyKeys = Object.keys(json['properties'] as Record<string, unknown>);
      expect(new Set(propertyKeys)).toEqual(new Set(order));
      expect(propertyKeys.length).toBe(order.length);
    });
    and('every key except "x-order" matches the AI SDK\'s own zodSchema conversion of deviceParseSchema', () => {
      const base = zodSchema(deviceParseFmSchema).jsonSchema as Record<string, unknown>;
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
      'isTransaction',
    ];

    when(/^the ordered JSON Schema is derived with the order: .+$/, () => {
      json = getDeviceParseOrderedJsonSchema({ mode: 'model' }, explicitOrder);
    });
    then(/^its "x-order" equals: .+$/, () => {
      expect(json['x-order']).toEqual(explicitOrder);
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
    and("every key except \"x-order\" matches the AI SDK's own zodSchema conversion of deviceParseSchema", () => {
      const base = zodSchema(deviceParseFmSchema).jsonSchema as Record<string, unknown>;
      const rest = Object.fromEntries(Object.entries(json).filter(([key]) => key !== 'x-order'));
      expect(rest).toEqual(base);
    });
  });

  test("deviceParseSchemaFor's JSON Schema is identical to getDeviceParseOrderedJsonSchema()", ({
    when,
    then,
  }) => {
    let deviceSchemasJson: unknown;
    let schemaOrderJson: unknown;

    when(
      /^the "(.*)" amount plan's deviceParseSchemaFor jsonSchema is compared against getDeviceParseOrderedJsonSchema$/,
      (name: string) => {
        // `deviceParseSchemaFor` (src/domain/deviceSchemas.ts) is what
        // `deviceParseUnsafe` (src/features/ai/deviceParse.ts) actually sends
        // to `generateObject`; `getDeviceParseOrderedJsonSchema` is what the
        // eval harness and probe build. This assertion is what keeps the two
        // in lockstep — a change to either that drifts from the other fails
        // here first.
        deviceSchemasJson = (deviceParseSchemaFor(PLANS[name]!) as Schema<unknown>).jsonSchema;
        schemaOrderJson = getDeviceParseOrderedJsonSchema(PLANS[name]!);
      }
    );
    then('they are deeply equal', () => {
      expect(deviceSchemasJson).toEqual(schemaOrderJson);
    });
  });

  test('A single-candidate plan has no amount field and an x-order to match', ({ when, then, and }) => {
    let json: Record<string, unknown>;

    when(/^the ordered JSON Schema is derived for a "single" amount plan$/, () => {
      json = getDeviceParseOrderedJsonSchema(PLANS.single!);
    });
    then('its "properties" has no "amount" key', () => {
      expect(Object.keys(json['properties'] as Record<string, unknown>)).not.toContain('amount');
    });
    and(/^its "x-order" equals the literal order without amount: .+$/, () => {
      expect(json['x-order']).toEqual(PINNED_LITERAL_ORDER.filter((k) => k !== 'amount'));
    });
    and('its "properties" keys equal the "x-order" set exactly', () => {
      const order = json['x-order'] as string[];
      const propertyKeys = Object.keys(json['properties'] as Record<string, unknown>);
      expect(new Set(propertyKeys)).toEqual(new Set(order));
      expect(propertyKeys.length).toBe(order.length);
    });
  });

  test('A several-candidate plan makes amount a closed choice of exactly those candidates', ({
    when,
    then,
    and,
  }) => {
    let json: Record<string, unknown>;

    when(/^the ordered JSON Schema is derived for a "choice" amount plan$/, () => {
      json = getDeviceParseOrderedJsonSchema(PLANS.choice!);
    });
    then('its "amount" property is an enum of "45", "9.6"', () => {
      const amount = (json['properties'] as Record<string, { enum?: string[] }>)['amount']!;
      expect(amount.enum).toEqual(['45', '9.6']);
    });
    and('its "x-order" still names amount', () => {
      expect(json['x-order']).toEqual(PINNED_LITERAL_ORDER);
    });
    and('its "properties" keys equal the "x-order" set exactly', () => {
      const order = json['x-order'] as string[];
      expect(new Set(Object.keys(json['properties'] as Record<string, unknown>))).toEqual(new Set(order));
    });
  });

  test('The choice schema rejects an amount that is not one of the candidates', ({ given, when, then }) => {
    let schema: Schema<unknown>;
    let result: { success: boolean };

    given(/^deviceParseSchemaFor a "choice" amount plan$/, () => {
      schema = deviceParseSchemaFor(PLANS.choice!) as Schema<unknown>;
    });
    when('its validate function is called with a valid output whose amount is "46"', async () => {
      result = await schema.validate!({ ...validOutputFor(PLANS.choice!), amount: '46' });
    });
    then('validation fails', () => {
      expect(result.success).toBe(false);
    });
  });

  test("A schema-violating expense output is rejected by deviceParseSchemaFor's own validate", ({
    given,
    when,
    then,
  }) => {
    let schema: Schema<unknown>;
    let result: { success: boolean };

    given(/^deviceParseSchemaFor a "(.*)" amount plan$/, (name: string) => {
      schema = deviceParseSchemaFor(PLANS[name]!) as Schema<unknown>;
    });
    when('its validate function is called with a model output missing every required field', async () => {
      if (!schema.validate) throw new Error('expected deviceParseSchemaFor to expose a validate function');
      result = await schema.validate({});
    });
    then('validation fails', () => {
      expect(result.success).toBe(false);
    });
  });

  test("A schema-satisfying expense output is accepted by deviceParseSchemaFor's own validate", ({
    given,
    when,
    then,
  }) => {
    let schema: Schema<unknown>;
    let plan: FmAmountPlan;
    let result: { success: boolean };

    given(/^deviceParseSchemaFor a "(.*)" amount plan$/, (name: string) => {
      plan = PLANS[name]!;
      schema = deviceParseSchemaFor(plan) as Schema<unknown>;
    });
    when('its validate function is called with a complete, valid model output', async () => {
      if (!schema.validate) throw new Error('expected deviceParseSchemaFor to expose a validate function');
      result = await schema.validate(validOutputFor(plan));
    });
    then('validation succeeds', () => {
      expect(result.success).toBe(true);
    });
  });

  test('A model output without the verdict is rejected', ({ given, when, then }) => {
    let schema: Schema<unknown>;
    let result: { success: boolean };

    given(/^deviceParseSchemaFor a "model" amount plan$/, () => {
      schema = deviceParseSchemaFor(PLANS.model!) as Schema<unknown>;
    });
    when('its validate function is called with a valid output that omits isTransaction', async () => {
      const withoutVerdict = validOutputFor(PLANS.model!);
      delete withoutVerdict.isTransaction;
      result = await schema.validate!(withoutVerdict);
    });
    then('validation fails', () => {
      expect(result.success).toBe(false);
    });
  });
});

import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  routeEngines,
  routeQueryEngines,
  RouteContext,
  ByokProvider,
  QueryEngineId,
} from '../../src/domain/parseRouter';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/query-router.feature')
);

defineFeature(feature, (test) => {
  let ctx: RouteContext;
  let order: QueryEngineId[];
  let allOrders: QueryEngineId[][];

  const reset = () => {
    ctx = { deviceAiCapable: false, byok: { enabled: false, provider: null }, online: true };
  };

  const parseByok = (spec: string): RouteContext['byok'] => {
    if (spec === 'off') return { enabled: false, provider: null };
    const m = /^on \((openai|anthropic)\)$/.exec(spec);
    if (!m) throw new Error(`unknown BYOK spec ${spec}`);
    return { enabled: true, provider: m[1] as ByokProvider };
  };

  test('Every combination of BYOK, connectivity and device AI', ({ given, and, when, then }) => {
    reset();
    given(/^deviceAiCapable is (true|false)$/, (v: string) => { ctx.deviceAiCapable = v === 'true'; });
    and(/^BYOK is (.*)$/, (spec: string) => { ctx.byok = parseByok(spec); });
    and(/^the device is (online|offline)$/, (v: string) => { ctx.online = v === 'online'; });
    when('I route question engines', () => { order = routeQueryEngines(ctx); });
    then(/^the question engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
    and(/^the expense engine order should still be "(.*)"$/, (expected: string) => {
      expect(routeEngines(ctx)).toEqual(expected.split(', '));
    });
  });

  test('BYOK toggled on with no provider picked is treated as off', ({ given, and, when, then }) => {
    reset();
    given(/^deviceAiCapable is (true|false)$/, (v: string) => { ctx.deviceAiCapable = v === 'true'; });
    and('BYOK is on with no provider', () => { ctx.byok = { enabled: true, provider: null }; });
    and(/^the device is (online|offline)$/, (v: string) => { ctx.online = v === 'online'; });
    when('I route question engines', () => { order = routeQueryEngines(ctx); });
    then(/^the question engine order should be "(.*)"$/, (expected: string) => {
      expect(order).toEqual(expected.split(', '));
    });
  });

  test('The floor appears exactly once, first, in every order', ({ when, then }) => {
    when('I route question engines for every context', () => {
      allOrders = [];
      for (const deviceAiCapable of [true, false])
        for (const online of [true, false])
          for (const provider of [null, 'openai', 'anthropic'] as (ByokProvider | null)[])
            for (const enabled of [true, false])
              allOrders.push(routeQueryEngines({ deviceAiCapable, online, byok: { enabled, provider } }));
    });
    then(/^each order starts with "(.*)" and contains it once$/, (first: string) => {
      for (const o of allOrders) {
        expect(o[0]).toBe(first);
        expect(o.filter((e) => e === first)).toHaveLength(1);
      }
    });
  });
});

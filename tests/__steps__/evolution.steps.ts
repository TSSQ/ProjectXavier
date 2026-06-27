import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { stageForGrowth, progressToNext } from '../../src/domain/evolution';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/evolution.feature')
);

defineFeature(feature, (test) => {
  const stageScenario = (
    title: string,
    checks: (ctx: { growth: number }) => void
  ) =>
    test(title, ({ given, then, and }) => {
      const ctx = { growth: 0 };
      given(/^a high-water growth of (-?\d+)$/, (g: string) => {
        ctx.growth = Number(g);
      });
      then(/^the evolution stage should be (\d+)$/, (s: string) => {
        expect(stageForGrowth(ctx.growth).stage).toBe(Number(s));
      });
      and(/^the stage label should be "(.*)"$/, (label: string) => {
        expect(stageForGrowth(ctx.growth).label).toBe(label);
      });
      checks(ctx);
    });

  // Scenarios that only check stage (+ optional label) reuse the generic body.
  stageScenario('No growth sits at the first stage', () => {});
  stageScenario('Crossing a threshold advances the stage', () => {});
  stageScenario('Large growth reaches the top stage', () => {});

  test('Growth between thresholds stays at the lower stage', ({ given, then }) => {
    let growth = 0;
    given(/^a high-water growth of (-?\d+)$/, (g: string) => {
      growth = Number(g);
    });
    then(/^the evolution stage should be (\d+)$/, (s: string) => {
      expect(stageForGrowth(growth).stage).toBe(Number(s));
    });
  });

  test('Negative growth stays at the first stage', ({ given, then }) => {
    let growth = 0;
    given(/^a high-water growth of (-?\d+)$/, (g: string) => {
      growth = Number(g);
    });
    then(/^the evolution stage should be (\d+)$/, (s: string) => {
      expect(stageForGrowth(growth).stage).toBe(Number(s));
    });
  });

  test('Progress halfway to the next stage', ({ given, then, and }) => {
    let growth = 0;
    given(/^a high-water growth of (-?\d+)$/, (g: string) => {
      growth = Number(g);
    });
    then(/^the progress fraction should be "(.*)"$/, (f: string) => {
      expect(progressToNext(growth).fraction.toFixed(2)).toBe(f);
    });
    and(/^the remaining growth should be (\d+)$/, (r: string) => {
      expect(progressToNext(growth).remaining).toBe(Number(r));
    });
  });

  test('The top stage reports full progress', ({ given, then, and }) => {
    let growth = 0;
    given(/^a high-water growth of (-?\d+)$/, (g: string) => {
      growth = Number(g);
    });
    then(/^the progress fraction should be "(.*)"$/, (f: string) => {
      expect(progressToNext(growth).fraction.toFixed(2)).toBe(f);
    });
    and('there should be no next stage', () => {
      expect(progressToNext(growth).next).toBeNull();
    });
  });
});

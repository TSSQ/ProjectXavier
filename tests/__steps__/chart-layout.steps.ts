import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { chartSlideLayout, ChartSlideLayout } from '../../src/domain/chartLayout';

const feature = loadFeature(
  path.join(__dirname, '..', '__features__', 'chart-layout.feature')
);

defineFeature(feature, (test) => {
  let layout: ChartSlideLayout;

  const givenScreen = (given: any) =>
    given(/^a screen (\d+) points wide$/, (w: string) => {
      layout = chartSlideLayout(Number(w));
    });
  const thenSlide = (step: any) =>
    step(/^the slide width should be (\d+)$/, (n: string) =>
      expect(layout.slideWidth).toBe(Number(n))
    );
  const thenContent = (step: any) =>
    step(/^the content width should be (\d+)$/, (n: string) =>
      expect(layout.contentWidth).toBe(Number(n))
    );

  test('Charts fill their slide on a large phone', ({ given, then, and }) => {
    givenScreen(given);
    thenSlide(then);
    thenContent(and);
  });

  test('Charts fit their slide on a small phone', ({ given, then, and }) => {
    givenScreen(given);
    thenSlide(then);
    thenContent(and);
  });

  test('A chart never gets a negative width', ({ given, then }) => {
    givenScreen(given);
    thenContent(then);
  });

  test('Every chart draws at the same height', ({ given, then }) => {
    givenScreen(given);
    then(/^the chart height should be (\d+)$/, (n: string) =>
      expect(layout.chartHeight).toBe(Number(n))
    );
  });
});

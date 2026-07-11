import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { CHART_PAGE_COUNT, titleForChartPage } from '../../src/domain/chartCarousel';

const feature = loadFeature(path.resolve(__dirname, '../__features__/chart-carousel.feature'));

defineFeature(feature, (test) => {
  test('There are four carousel pages', ({ then }) => {
    then(/^the carousel page count should be (\d+)$/, (n: string) => {
      expect(CHART_PAGE_COUNT).toBe(parseInt(n, 10));
    });
  });

  test('Each page has its own header title', ({ then }) => {
    then(/^the title for chart page (-?\d+) should be "(.*)"$/, (page: string, title: string) => {
      expect(titleForChartPage(parseInt(page, 10))).toBe(title);
    });
  });

  test("A negative page index clamps to the first page's title", ({ then }) => {
    then(/^the title for chart page (-?\d+) should be "(.*)"$/, (page: string, title: string) => {
      expect(titleForChartPage(parseInt(page, 10))).toBe(title);
    });
  });

  test("A page index past the last page clamps to the last page's title", ({ then }) => {
    then(/^the title for chart page (-?\d+) should be "(.*)"$/, (page: string, title: string) => {
      expect(titleForChartPage(parseInt(page, 10))).toBe(title);
    });
  });
});

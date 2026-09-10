import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { nextHeaderOffset, HeaderOffsetInput } from '../../src/domain/headerScrollOffset';

const feature = loadFeature(path.resolve(__dirname, '../__features__/header-scroll-offset.feature'));

defineFeature(feature, (test) => {
  let input: HeaderOffsetInput;
  let result: number;

  const givenOffset = (given: any) =>
    given(
      /^a header offset of (\d+), headerHeight (\d+), scrolled from (-?\d+) to (-?\d+)$/,
      (offset: string, headerHeight: string, previousY: string, y: string) => {
        input = {
          offset: parseInt(offset, 10),
          headerHeight: parseInt(headerHeight, 10),
          previousY: parseInt(previousY, 10),
          y: parseInt(y, 10),
        };
      }
    );

  const givenOffsetLocked = (given: any) =>
    given(
      /^a header offset of (\d+), headerHeight (\d+), scrolled from (-?\d+) to (-?\d+), with the search field open$/,
      (offset: string, headerHeight: string, previousY: string, y: string) => {
        input = {
          offset: parseInt(offset, 10),
          headerHeight: parseInt(headerHeight, 10),
          previousY: parseInt(previousY, 10),
          y: parseInt(y, 10),
          locked: true,
        };
      }
    );

  const whenComputed = (when: any) =>
    when(/^the next header offset is computed$/, () => {
      result = nextHeaderOffset(input);
    });

  const thenResult = (then: any) =>
    then(/^the resulting offset should be (\d+)$/, (expected: string) => {
      expect(result).toBe(parseInt(expected, 10));
    });

  for (const name of [
    'Scrolling down hides the header progressively',
    'Scrolling down clamps at the header height',
    'Scrolling up reveals the header progressively',
    'Scrolling up clamps at zero',
    'Anywhere near the top forces the header fully shown, even mid-hide',
    'A negative scroll position never hides the header',
  ]) {
    test(name, ({ given, when, then }) => {
      givenOffset(given);
      whenComputed(when);
      thenResult(then);
    });
  }

  for (const name of [
    'An open search field keeps the header fully shown while scrolling down',
    'An open search field reveals an already-hidden header',
  ]) {
    test(name, ({ given, when, then }) => {
      givenOffsetLocked(given);
      whenComputed(when);
      thenResult(then);
    });
  }
});

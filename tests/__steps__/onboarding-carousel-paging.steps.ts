import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { indexFromOffset, shouldFinishFromOverscroll } from '../../src/domain/onboardingCarousel';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/onboarding-carousel-paging.feature')
);

defineFeature(feature, (test) => {
  test('A resting offset maps to its page index', ({ then }) => {
    then(
      /^the page index for offset (-?\d+) width (-?\d+) count (\d+) should be (\d+)$/,
      (x: string, width: string, count: string, index: string) => {
        expect(indexFromOffset(parseInt(x, 10), parseInt(width, 10), parseInt(count, 10))).toBe(
          parseInt(index, 10)
        );
      }
    );
  });

  test('A negative offset clamps to the first page', ({ then }) => {
    then(
      /^the page index for offset (-?\d+) width (-?\d+) count (\d+) should be (\d+)$/,
      (x: string, width: string, count: string, index: string) => {
        expect(indexFromOffset(parseInt(x, 10), parseInt(width, 10), parseInt(count, 10))).toBe(
          parseInt(index, 10)
        );
      }
    );
  });

  test('An offset past the last page clamps to the last page', ({ then }) => {
    then(
      /^the page index for offset (-?\d+) width (-?\d+) count (\d+) should be (\d+)$/,
      (x: string, width: string, count: string, index: string) => {
        expect(indexFromOffset(parseInt(x, 10), parseInt(width, 10), parseInt(count, 10))).toBe(
          parseInt(index, 10)
        );
      }
    );
  });

  test('A zero width (not yet laid out) never divides by zero', ({ then }) => {
    then(
      /^the page index for offset (-?\d+) width (-?\d+) count (\d+) should be (\d+)$/,
      (x: string, width: string, count: string, index: string) => {
        expect(indexFromOffset(parseInt(x, 10), parseInt(width, 10), parseInt(count, 10))).toBe(
          parseInt(index, 10)
        );
      }
    );
  });

  test('A zero offset at zero width also stays on the first page', ({ then }) => {
    then(
      /^the page index for offset (-?\d+) width (-?\d+) count (\d+) should be (\d+)$/,
      (x: string, width: string, count: string, index: string) => {
        expect(indexFromOffset(parseInt(x, 10), parseInt(width, 10), parseInt(count, 10))).toBe(
          parseInt(index, 10)
        );
      }
    );
  });

  test('A negative width (not a real layout measurement) never divides by zero either', ({
    then,
  }) => {
    then(
      /^the page index for offset (-?\d+) width (-?\d+) count (\d+) should be (\d+)$/,
      (x: string, width: string, count: string, index: string) => {
        expect(indexFromOffset(parseInt(x, 10), parseInt(width, 10), parseInt(count, 10))).toBe(
          parseInt(index, 10)
        );
      }
    );
  });

  test('A non-positive card count has no page to land on', ({ then }) => {
    then(
      /^the page index for offset (-?\d+) width (-?\d+) count (\d+) should be (\d+)$/,
      (x: string, width: string, count: string, index: string) => {
        expect(indexFromOffset(parseInt(x, 10), parseInt(width, 10), parseInt(count, 10))).toBe(
          parseInt(index, 10)
        );
      }
    );
  });

  test('A normal arrival at the last card does not trigger finish', ({ then }) => {
    then(
      /^overscroll finish for offset (-?\d+) width (-?\d+) lastIndex (-?\d+) threshold (\d+) should be (true|false)$/,
      (x: string, width: string, lastIndex: string, threshold: string, expected: string) => {
        expect(
          shouldFinishFromOverscroll(
            parseInt(x, 10),
            parseInt(width, 10),
            parseInt(lastIndex, 10),
            parseInt(threshold, 10)
          )
        ).toBe(expected === 'true');
      }
    );
  });

  test("The bounce's own rubber-banding just past the last card does not trigger finish", ({
    then,
  }) => {
    then(
      /^overscroll finish for offset (-?\d+) width (-?\d+) lastIndex (-?\d+) threshold (\d+) should be (true|false)$/,
      (x: string, width: string, lastIndex: string, threshold: string, expected: string) => {
        expect(
          shouldFinishFromOverscroll(
            parseInt(x, 10),
            parseInt(width, 10),
            parseInt(lastIndex, 10),
            parseInt(threshold, 10)
          )
        ).toBe(expected === 'true');
      }
    );
  });

  test('A deliberate extra swipe past the last card triggers finish', ({ then }) => {
    then(
      /^overscroll finish for offset (-?\d+) width (-?\d+) lastIndex (-?\d+) threshold (\d+) should be (true|false)$/,
      (x: string, width: string, lastIndex: string, threshold: string, expected: string) => {
        expect(
          shouldFinishFromOverscroll(
            parseInt(x, 10),
            parseInt(width, 10),
            parseInt(lastIndex, 10),
            parseInt(threshold, 10)
          )
        ).toBe(expected === 'true');
      }
    );
  });

  test('Overscroll-finish never fires while width is 0 (not yet laid out)', ({ then }) => {
    then(
      /^overscroll finish for offset (-?\d+) width (-?\d+) lastIndex (-?\d+) threshold (\d+) should be (true|false)$/,
      (x: string, width: string, lastIndex: string, threshold: string, expected: string) => {
        expect(
          shouldFinishFromOverscroll(
            parseInt(x, 10),
            parseInt(width, 10),
            parseInt(lastIndex, 10),
            parseInt(threshold, 10)
          )
        ).toBe(expected === 'true');
      }
    );
  });

  test('Overscroll-finish never fires for a negative width either', ({ then }) => {
    then(
      /^overscroll finish for offset (-?\d+) width (-?\d+) lastIndex (-?\d+) threshold (\d+) should be (true|false)$/,
      (x: string, width: string, lastIndex: string, threshold: string, expected: string) => {
        expect(
          shouldFinishFromOverscroll(
            parseInt(x, 10),
            parseInt(width, 10),
            parseInt(lastIndex, 10),
            parseInt(threshold, 10)
          )
        ).toBe(expected === 'true');
      }
    );
  });

  test('Overscroll-finish never fires for a negative lastIndex (no last card to overscroll past)', ({
    then,
  }) => {
    then(
      /^overscroll finish for offset (-?\d+) width (-?\d+) lastIndex (-?\d+) threshold (\d+) should be (true|false)$/,
      (x: string, width: string, lastIndex: string, threshold: string, expected: string) => {
        expect(
          shouldFinishFromOverscroll(
            parseInt(x, 10),
            parseInt(width, 10),
            parseInt(lastIndex, 10),
            parseInt(threshold, 10)
          )
        ).toBe(expected === 'true');
      }
    );
  });
});

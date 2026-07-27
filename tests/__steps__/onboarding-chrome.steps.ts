import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  computeOnboardingTopReserve,
  computeOnboardingBottomReserve,
  computeOnboardingContentHeight,
  computeOnboardingVisualSize,
} from '../../src/domain/onboardingChrome';

const feature = loadFeature(path.resolve(__dirname, '../__features__/onboarding-chrome.feature'));

defineFeature(feature, (test) => {
  test('The top reserve clears the Skip button and grows with its scaled font size', ({
    then,
  }) => {
    then(
      /^the top reserve for insets top (\d+), skip font size (\d+) should be (\d+)$/,
      (insetsTop: string, skipFontSize: string, reserve: string) => {
        expect(
          computeOnboardingTopReserve(parseInt(insetsTop, 10), parseInt(skipFontSize, 10))
        ).toBe(parseInt(reserve, 10));
      }
    );
  });

  test('The top reserve grows with the safe-area inset', ({ then }) => {
    then(
      /^the top reserve for insets top (\d+), skip font size (\d+) should be (\d+)$/,
      (insetsTop: string, skipFontSize: string, reserve: string) => {
        expect(
          computeOnboardingTopReserve(parseInt(insetsTop, 10), parseInt(skipFontSize, 10))
        ).toBe(parseInt(reserve, 10));
      }
    );
  });

  test('The bottom reserve clears the dots row + Get Started button and grows with font scale', ({
    then,
  }) => {
    then(
      /^the bottom reserve for insets bottom (\d+), dot size (\d+), font scale ([\d.]+) should be (\d+)$/,
      (insetsBottom: string, dotSize: string, fontScale: string, reserve: string) => {
        expect(
          computeOnboardingBottomReserve(
            parseInt(insetsBottom, 10),
            parseInt(dotSize, 10),
            parseFloat(fontScale)
          )
        ).toBe(parseInt(reserve, 10));
      }
    );
  });

  test('The bottom reserve grows with the safe-area inset', ({ then }) => {
    then(
      /^the bottom reserve for insets bottom (\d+), dot size (\d+), font scale ([\d.]+) should be (\d+)$/,
      (insetsBottom: string, dotSize: string, fontScale: string, reserve: string) => {
        expect(
          computeOnboardingBottomReserve(
            parseInt(insetsBottom, 10),
            parseInt(dotSize, 10),
            parseFloat(fontScale)
          )
        ).toBe(parseInt(reserve, 10));
      }
    );
  });

  test('The bottom reserve is strictly larger than the dots row alone, because it also accounts for the Get Started button', ({
    then,
  }) => {
    then(
      /^the bottom reserve for insets bottom (\d+), dot size (\d+), font scale ([\d.]+) should exceed the dots-row-only height of (\d+) by at least the Get Started button's own height$/,
      (
        insetsBottom: string,
        dotSize: string,
        fontScale: string,
        dotsRowOnlyHeight: string
      ) => {
        const reserve = computeOnboardingBottomReserve(
          parseInt(insetsBottom, 10),
          parseInt(dotSize, 10),
          parseFloat(fontScale)
        );
        // The button's own text (16px base, 1.25 line-height factor) plus its
        // 12px top+bottom padding — the smallest a "Get Started" button can
        // ever render at, so the reserve must clear at least this much on
        // top of the dots row alone.
        const minButtonHeight = Math.round(16 * 1.25) + 12 * 2;
        expect(reserve).toBeGreaterThanOrEqual(
          parseInt(dotsRowOnlyHeight, 10) + minButtonHeight
        );
      }
    );
  });

  test('A large-scale, small-screen case still leaves a positive content area', ({ then }) => {
    then(
      /^the content height for screen height (\d+), insets top (\d+), insets bottom (\d+), skip font size (\d+), dot size (\d+), font scale ([\d.]+) should be positive$/,
      (
        screenHeight: string,
        insetsTop: string,
        insetsBottom: string,
        skipFontSize: string,
        dotSize: string,
        fontScale: string
      ) => {
        const topReserve = computeOnboardingTopReserve(
          parseInt(insetsTop, 10),
          parseInt(skipFontSize, 10)
        );
        const bottomReserve = computeOnboardingBottomReserve(
          parseInt(insetsBottom, 10),
          parseInt(dotSize, 10),
          parseFloat(fontScale)
        );
        const contentHeight = computeOnboardingContentHeight(parseInt(screenHeight, 10), {
          topReserve,
          bottomReserve,
        });
        expect(contentHeight).toBeGreaterThan(0);
      }
    );
  });

  test('The onboarding visual shrinks as font scale climbs, but never past its base or floor', ({
    then,
  }) => {
    then(
      /^the onboarding visual size for font scale ([\d.]+) should be (\d+)$/,
      (fontScale: string, size: string) => {
        expect(computeOnboardingVisualSize(parseFloat(fontScale))).toBe(parseInt(size, 10));
      }
    );
  });
});

import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  computeMenuPlacement,
  estimateMenuWidth,
  MenuPlacementInput,
  MenuPlacement,
} from '../../src/domain/contextMenuPlacement';

/** The component's own constants, mirrored so the scenarios describe what the
 *  menu actually renders at rather than arbitrary numbers. Keep in sync with
 *  src/components/ui/ContextMenu.tsx. */
const MENU_SIZING = {
  itemPadH: 14,
  itemGap: 10,
  itemMarginH: 4,
  minWidth: 88,
  maxWidth: 260,
};

const feature = loadFeature(path.resolve(__dirname, '../__features__/context-menu-placement.feature'));

defineFeature(feature, (test) => {
  let input: Partial<MenuPlacementInput>;
  let result: MenuPlacement;
  let labels: string[] = [];
  let fontSize = 14;
  let iconSize = 16;
  let width = 0;

  const givenLabels = (a: string) => {
    labels = [a];
  };
  const givenTwoLabels = (a: string, b: string) => {
    labels = [a, b];
  };
  const givenFont = (fs: string, icon: string) => {
    fontSize = Number(fs);
    iconSize = Number(icon);
  };
  const whenWidthEstimated = () => {
    width = estimateMenuWidth({ labels, fontSize, iconSize, ...MENU_SIZING });
  };
  const thenWidthAtMost = (n: string) => {
    expect(width).toBeLessThanOrEqual(Number(n));
  };
  const thenWidthExactly = (n: string) => {
    expect(width).toBe(Number(n));
  };
  const thenWiderThanAlone = (other: string) => {
    const alone = estimateMenuWidth({
      labels: [other],
      fontSize,
      iconSize,
      ...MENU_SIZING,
    });
    expect(width).toBeGreaterThan(alone);
  };

  const givenTouch = (x: string, y: string) => {
    input.touchX = parseInt(x, 10);
    input.touchY = parseInt(y, 10);
  };
  const givenMenu = (w: string, h: string) => {
    input.menuWidth = parseInt(w, 10);
    input.menuHeight = parseInt(h, 10);
  };
  const givenScreen = (w: string, h: string) => {
    input.screenWidth = parseInt(w, 10);
    input.screenHeight = parseInt(h, 10);
  };
  const whenComputed = () => {
    result = computeMenuPlacement(input as MenuPlacementInput);
  };
  const thenTop = (top: string) => {
    expect(result.top).toBe(parseInt(top, 10));
  };
  const thenLeft = (left: string) => {
    expect(result.left).toBe(parseInt(left, 10));
  };
  const thenBottomOnScreen = () => {
    expect(result.top + (input.menuHeight ?? 0)).toBeLessThanOrEqual(input.screenHeight ?? 0);
  };

  test("Prefers placing the menu above the touch point when there's room", ({ given, and, when, then }) => {
    input = {};
    given(/^a touch at x (\d+), y (\d+)$/, givenTouch);
    and(/^a menu (\d+) wide and (\d+) tall$/, givenMenu);
    and(/^a screen (\d+) wide and (\d+) tall$/, givenScreen);
    when(/^the menu placement is computed$/, whenComputed);
    then(/^the menu top should be (\d+)$/, thenTop);
    and(/^the menu left should be (\d+)$/, thenLeft);
  });

  test("Flips the menu below the touch point when it's near the top", ({ given, and, when, then }) => {
    input = {};
    given(/^a touch at x (\d+), y (\d+)$/, givenTouch);
    and(/^a menu (\d+) wide and (\d+) tall$/, givenMenu);
    and(/^a screen (\d+) wide and (\d+) tall$/, givenScreen);
    when(/^the menu placement is computed$/, whenComputed);
    then(/^the menu top should be (\d+)$/, thenTop);
  });

  test('Clamps the menu to the left screen edge', ({ given, and, when, then }) => {
    input = {};
    given(/^a touch at x (\d+), y (\d+)$/, givenTouch);
    and(/^a menu (\d+) wide and (\d+) tall$/, givenMenu);
    and(/^a screen (\d+) wide and (\d+) tall$/, givenScreen);
    when(/^the menu placement is computed$/, whenComputed);
    then(/^the menu left should be (\d+)$/, thenLeft);
  });

  test('Clamps the menu to the right screen edge', ({ given, and, when, then }) => {
    input = {};
    given(/^a touch at x (\d+), y (\d+)$/, givenTouch);
    and(/^a menu (\d+) wide and (\d+) tall$/, givenMenu);
    and(/^a screen (\d+) wide and (\d+) tall$/, givenScreen);
    when(/^the menu placement is computed$/, whenComputed);
    then(/^the menu left should be (\d+)$/, thenLeft);
  });

  test('Clamps so the bottom of the menu never runs off-screen', ({ given, and, when, then }) => {
    input = {};
    given(/^a touch at x (\d+), y (\d+)$/, givenTouch);
    and(/^a menu (\d+) wide and (\d+) tall$/, givenMenu);
    and(/^a screen (\d+) wide and (\d+) tall$/, givenScreen);
    when(/^the menu placement is computed$/, whenComputed);
    then(/^the menu top should be (\d+)$/, thenTop);
  });

  test('A taller menu (simulating large Dynamic Type) still lands fully on-screen', ({ given, and, when, then }) => {
    input = {};
    given(/^a touch at x (\d+), y (\d+)$/, givenTouch);
    and(/^a menu (\d+) wide and (\d+) tall$/, givenMenu);
    and(/^a screen (\d+) wide and (\d+) tall$/, givenScreen);
    when(/^the menu placement is computed$/, whenComputed);
    then(/^the menu top should be (\d+)$/, thenTop);
    and(/^the menu bottom should not exceed the screen height$/, thenBottomOnScreen);
  });

  test('A single short label sizes to a compact pill, not the maximum width', ({ given, and, when, then }) => {
    labels = [];
    given(/^menu labels "(.+)"$/, givenLabels);
    and(/^a font size of (\d+) with a (\d+)pt icon$/, givenFont);
    when(/^the menu width is estimated$/, whenWidthEstimated);
    then(/^the estimated width should be at most (\d+)$/, thenWidthAtMost);
  });

  test('The floor stops a pathologically short label collapsing', ({ given, and, when, then }) => {
    labels = [];
    given(/^menu labels "(.+)"$/, givenLabels);
    and(/^a font size of (\d+) with a (\d+)pt icon$/, givenFont);
    when(/^the menu width is estimated$/, whenWidthEstimated);
    then(/^the estimated width should be (\d+)$/, thenWidthExactly);
  });

  test('A long label grows the menu but never past the cap', ({ given, and, when, then }) => {
    labels = [];
    given(/^menu labels "(.+)"$/, givenLabels);
    and(/^a font size of (\d+) with a (\d+)pt icon$/, givenFont);
    when(/^the menu width is estimated$/, whenWidthEstimated);
    then(/^the estimated width should be (\d+)$/, thenWidthExactly);
  });

  test('The widest label in a multi-item menu determines the width', ({ given, and, when, then }) => {
    labels = [];
    given(/^menu labels "(.+)" and "(.+)"$/, givenTwoLabels);
    and(/^a font size of (\d+) with a (\d+)pt icon$/, givenFont);
    when(/^the menu width is estimated$/, whenWidthEstimated);
    then(/^the estimated width should be wider than for "(.+)" alone$/, thenWiderThanAlone);
  });

  test('A compact menu is no longer shoved left of the touch point', ({ given, and, when, then }) => {
    input = {};
    given(/^a touch at x (\d+), y (\d+)$/, givenTouch);
    and(/^a menu (\d+) wide and (\d+) tall$/, givenMenu);
    and(/^a screen (\d+) wide and (\d+) tall$/, givenScreen);
    when(/^the menu placement is computed$/, whenComputed);
    then(/^the menu left should be (\d+)$/, thenLeft);
  });
});

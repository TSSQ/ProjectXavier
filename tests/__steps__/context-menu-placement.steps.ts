import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  computeMenuPlacement,
  MenuPlacementInput,
  MenuPlacement,
} from '../../src/domain/contextMenuPlacement';

const feature = loadFeature(path.resolve(__dirname, '../__features__/context-menu-placement.feature'));

defineFeature(feature, (test) => {
  let input: Partial<MenuPlacementInput>;
  let result: MenuPlacement;

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
});

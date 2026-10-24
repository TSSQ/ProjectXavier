import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { edgeOffset, sideGutters, HorizontalInsets } from '../../src/domain/screenGutters';

const feature = loadFeature(path.resolve(__dirname, '../__features__/duo-side-gutters.feature'));

/** "83", "-5" or "NaN" from the feature text, as a number. */
const num = (s: string): number => (s === 'NaN' ? NaN : Number(s));

defineFeature(feature, (test) => {
  let insets: HorizontalInsets;
  let gutters: { paddingLeft: number; paddingRight: number };
  let offset: number;

  beforeEach(() => {
    insets = { left: 0, right: 0 };
  });

  const givenInsets = (given: (re: RegExp, fn: (l: string, r: string) => void) => void) =>
    given(/^horizontal insets left (-?[\d.]+|NaN) and right (-?[\d.]+|NaN)$/, (l, r) => {
      insets = { left: num(l), right: num(r) };
    });
  const whenGutters = (when: (re: RegExp, fn: (b: string) => void) => void) =>
    when(/^I compute side gutters with a base of (\d+)$/, (b) => {
      gutters = sideGutters(insets, Number(b));
    });
  const thenLeft = (then: (re: RegExp, fn: (v: string) => void) => void) =>
    then(/^the left padding should be (\d+)$/, (v) => {
      expect(gutters.paddingLeft).toBe(Number(v));
    });
  const andRight = (and: (re: RegExp, fn: (v: string) => void) => void) =>
    and(/^the right padding should be (\d+)$/, (v) => {
      expect(gutters.paddingRight).toBe(Number(v));
    });

  const gutterScenario = (title: string) =>
    test(title, ({ given, when, then, and }) => {
      givenInsets(given);
      whenGutters(when);
      thenLeft(then);
      andRight(and);
    });

  gutterScenario("A phone in portrait keeps the design's own gutter on both sides");
  gutterScenario('A rail on the right adds to the right gutter only');
  gutterScenario('Split View on the left half puts the rail on the left');
  gutterScenario('Asymmetric insets are never mirrored');
  gutterScenario('A negative or NaN inset contributes nothing');
  gutterScenario("A zero base leaves only the system's reservation");

  const offsetScenario = (title: string) =>
    test(title, ({ when, then }) => {
      when(/^I compute the edge offset for inset (-?[\d.]+) with a base of (\d+)$/, (i, b) => {
        offset = edgeOffset(Number(i), Number(b));
      });
      then(/^the edge offset should be (\d+)$/, (v) => {
        expect(offset).toBe(Number(v));
      });
    });

  offsetScenario('An edge-pinned control keeps its designed distance with no inset');
  offsetScenario('An edge-pinned control moves inward by the inset on that edge');

  test('An undefined inset is treated as zero', ({ when, then }) => {
    when(/^I compute the edge offset for an undefined inset with a base of (\d+)$/, (b) => {
      offset = edgeOffset(undefined, Number(b));
    });
    then(/^the edge offset should be (\d+)$/, (v) => {
      expect(offset).toBe(Number(v));
    });
  });
});

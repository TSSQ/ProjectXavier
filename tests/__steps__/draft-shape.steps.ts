import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { draftShape, sameDraftShape, DraftShape, EMPTY_DRAFT_SHAPE } from '../../src/domain/composerState';

const feature = loadFeature(path.resolve(__dirname, '../__features__/draft-shape.feature'));

/** What HomeScreen's onDraftChange does: publish a shape only when it differs. */
function replay(texts: string[]): DraftShape[] {
  let current = EMPTY_DRAFT_SHAPE;
  const published: DraftShape[] = [];
  for (const t of texts) {
    const next = draftShape(t);
    if (sameDraftShape(current, next)) continue;
    current = next;
    published.push(next);
  }
  return published;
}

const prefixes = (s: string) => Array.from({ length: s.length }, (_, i) => s.slice(0, i + 1));

defineFeature(feature, (test) => {
  let published: DraftShape[];

  test("Typing a sentence changes the screen's state once", ({ when, then }) => {
    when(/^"(.*)" is typed one character at a time$/, (s: string) => { published = replay(prefixes(s)); });
    then(/^the screen's state should change (\d+) times?$/, (n: string) => expect(published).toHaveLength(Number(n)));
  });

  test('Deleting it back to empty changes it once more', ({ when, then }) => {
    when(/^"(.*)" is typed one character at a time and then deleted one at a time$/, (s: string) => {
      const up = prefixes(s);
      published = replay([...up, ...up.slice(0, -1).reverse(), '']);
    });
    then(/^the screen's state should change (\d+) times?$/, (n: string) => expect(published).toHaveLength(Number(n)));
  });

  test('Whitespace alone is not typed', ({ then }) => {
    then(/^the shape of "(.*)" should be empty$/, (s: string) => expect(draftShape(s)).toEqual(EMPTY_DRAFT_SHAPE));
  });

  test('A "/" query is followed character by character, then released', ({ when, then, and }) => {
    when(/^"(.*)" is typed one character at a time$/, (s: string) => { published = replay(prefixes(s)); });
    then(/^the slash query should have been "\/", "\/a", "\/ac", "\/acc" in turn$/, () => {
      expect(published.slice(0, 4).map((p) => p.slashQuery)).toEqual(['/', '/a', '/ac', '/acc']);
    });
    and('the final shape should be typed with no slash query', () => {
      expect(published[published.length - 1]).toEqual({ hasText: true, slashQuery: null });
    });
  });
});

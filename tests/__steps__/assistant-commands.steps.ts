import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { matchCommands, isSlashQuery, AssistantCommand } from '../../src/domain/assistantCommands';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/assistant-commands.feature')
);

defineFeature(feature, (test) => {
  let matched: AssistantCommand[];

  test('A bare "/" lists every command', ({ when, then }) => {
    when(/^I match commands for "(.*)"$/, (q: string) => {
      matched = matchCommands(q);
    });
    then(/^the matched commands are "(.*)"$/, (names: string) => {
      const expected = names ? names.split(', ') : [];
      expect(matched.map((c) => c.name)).toEqual(expected);
    });
  });

  test('"/a" filters to "/account" only', ({ when, then }) => {
    when(/^I match commands for "(.*)"$/, (q: string) => {
      matched = matchCommands(q);
    });
    then(/^the matched commands are "(.*)"$/, (names: string) => {
      const expected = names ? names.split(', ') : [];
      expect(matched.map((c) => c.name)).toEqual(expected);
    });
  });

  test('"/t" filters to "/transactions" only', ({ when, then }) => {
    when(/^I match commands for "(.*)"$/, (q: string) => {
      matched = matchCommands(q);
    });
    then(/^the matched commands are "(.*)"$/, (names: string) => {
      const expected = names ? names.split(', ') : [];
      expect(matched.map((c) => c.name)).toEqual(expected);
    });
  });

  test('"/x" matches nothing', ({ when, then }) => {
    when(/^I match commands for "(.*)"$/, (q: string) => {
      matched = matchCommands(q);
    });
    then(/^the matched commands are "(.*)"$/, (names: string) => {
      const expected = names ? names.split(', ') : [];
      expect(matched.map((c) => c.name)).toEqual(expected);
    });
  });

  test('Matching is case-insensitive', ({ when, then }) => {
    when(/^I match commands for "(.*)"$/, (q: string) => {
      matched = matchCommands(q);
    });
    then(/^the matched commands are "(.*)"$/, (names: string) => {
      const expected = names ? names.split(', ') : [];
      expect(matched.map((c) => c.name)).toEqual(expected);
    });
  });

  test('A bare "/" should open the menu', ({ then, and }) => {
    then(/^"(.*)" is a slash query$/, (text: string) => {
      expect(isSlashQuery(text)).toBe(true);
    });
    and(/^"(.*)" is a slash query$/, (text: string) => {
      expect(isSlashQuery(text)).toBe(true);
    });
    and(/^"(.*)" is a slash query$/, (text: string) => {
      expect(isSlashQuery(text)).toBe(true);
    });
  });

  test('Text with no leading slash should not open the menu', ({ then, and }) => {
    then(/^"(.*)" is not a slash query$/, (text: string) => {
      expect(isSlashQuery(text)).toBe(false);
    });
    and(/^"(.*)" is not a slash query$/, (text: string) => {
      expect(isSlashQuery(text)).toBe(false);
    });
  });

  test('A completed command followed by a space should close the menu', ({ then, and }) => {
    then(/^"(.*)" is not a slash query$/, (text: string) => {
      expect(isSlashQuery(text)).toBe(false);
    });
    and(/^"(.*)" is not a slash query$/, (text: string) => {
      expect(isSlashQuery(text)).toBe(false);
    });
  });

  test('An empty query lists every command too', ({ when, then }) => {
    when(/^I match commands for "(.*)"$/, (q: string) => {
      matched = matchCommands(q);
    });
    then(/^the matched commands are "(.*)"$/, (names: string) => {
      const expected = names ? names.split(', ') : [];
      expect(matched.map((c) => c.name)).toEqual(expected);
    });
  });

  test("Leading whitespace doesn't change whether it's a slash query", ({ then, and }) => {
    then(/^"(.*)" is a slash query$/, (text: string) => {
      expect(isSlashQuery(text)).toBe(true);
    });
    and(/^matching commands for "(.*)" also finds "(.*)"$/, (q: string, name: string) => {
      expect(matchCommands(q).map((c) => c.name)).toEqual([name]);
    });
  });
});

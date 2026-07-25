import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  ASSISTANT_EXAMPLE_GROUPS,
  AssistantExampleGroup,
} from '../../src/domain/assistantExamples';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/assistant-examples.feature')
);

defineFeature(feature, (test) => {
  test('There is at least one group', ({ when, then }) => {
    let groups: AssistantExampleGroup[];

    when('I read the assistant example groups', () => {
      groups = ASSISTANT_EXAMPLE_GROUPS;
    });

    then(/^there should be at least (\d+) group$/, (min: string) => {
      expect(groups.length).toBeGreaterThanOrEqual(Number(min));
    });
  });

  test('Every group has a non-empty title and at least one example', ({ when, then }) => {
    let groups: AssistantExampleGroup[];

    when('I read the assistant example groups', () => {
      groups = ASSISTANT_EXAMPLE_GROUPS;
    });

    then('every group should have a non-empty title', () => {
      for (const group of groups) {
        expect(group.title.trim().length).toBeGreaterThan(0);
      }
    });

    then(/^every group should have at least (\d+) example$/, (min: string) => {
      for (const group of groups) {
        expect(group.examples.length).toBeGreaterThanOrEqual(Number(min));
      }
    });
  });

  test('Every example has a non-empty label and text', ({ when, then }) => {
    let groups: AssistantExampleGroup[];

    when('I read the assistant example groups', () => {
      groups = ASSISTANT_EXAMPLE_GROUPS;
    });

    then('every example should have a non-empty label', () => {
      for (const group of groups) {
        for (const example of group.examples) {
          expect(example.label.trim().length).toBeGreaterThan(0);
        }
      }
    });

    then('every example should have a non-empty text', () => {
      for (const group of groups) {
        for (const example of group.examples) {
          expect(example.text.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });
});

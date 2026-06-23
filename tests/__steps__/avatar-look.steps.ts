import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { lookById, AvatarLook } from '../../src/domain/avatar';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/avatar-look.feature')
);

defineFeature(feature, (test) => {
  let look: AvatarLook;

  const run = (when: any, then: any) => {
    when(/^I resolve the avatar look "(.*)"$/, (id: string) => {
      look = lookById(id);
    });
    then(/^the look label should be "(.*)"$/, (label: string) => {
      expect(look.label).toBe(label);
    });
  };

  test('A known look id resolves to that look', ({ when, then }) => run(when, then));
  test('An unknown look falls back to the default', ({ when, then }) => run(when, then));
});

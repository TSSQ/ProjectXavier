import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { lookById, kindById, AVATAR_KINDS, AvatarLook, AvatarKindDef } from '../../src/domain/avatar';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/avatar-look.feature')
);

defineFeature(feature, (test) => {
  let look: AvatarLook;
  let kind: AvatarKindDef;

  const looks = (when: any, then: any) => {
    when(/^I resolve the avatar look "(.*)"$/, (id: string) => {
      look = lookById(id);
    });
    then(/^the look label should be "(.*)"$/, (label: string) => {
      expect(look.label).toBe(label);
    });
  };

  const kinds = (when: any, then: any) => {
    when(/^I resolve the avatar kind "(.*)"$/, (id: string) => {
      kind = kindById(id);
    });
    then(/^the kind label should be "(.*)"$/, (label: string) => {
      expect(kind.label).toBe(label);
    });
  };

  test('A known look id resolves to that look', ({ when, then }) => looks(when, then));
  test('An unknown look falls back to the default', ({ when, then }) => looks(when, then));
  test('The default avatar kind is the blob', ({ when, then }) => kinds(when, then));
  test('A not-yet-available kind falls back to the default', ({ when, then }) => kinds(when, then));
  test('An unknown kind falls back to the default', ({ when, then }) => kinds(when, then));

  test('Blob is the only available avatar kind', ({ then }) => {
    then(/^there should be exactly (\d+) available avatar kind$/, (count: string) => {
      expect(AVATAR_KINDS.filter((k) => k.available).length).toBe(Number(count));
    });
  });
});

import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { lookById, kindById, AVATAR_LOOKS, AvatarLook, AvatarKindDef } from '../../src/domain/avatar';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/avatar-look.feature')
);

/** WCAG 2.1 relative luminance — see tests/__steps__/chart-palette.steps.ts. */
function luminance(hex: string): number {
  const parts = hex.replace('#', '').match(/../g)!.map((h) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * parts[0]! + 0.7152 * parts[1]! + 0.0722 * parts[2]!;
}

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

  test("Every look's glowLight is a valid 6-digit hex colour", ({ given, then }) => {
    given('the avatar looks', () => {
      // AVATAR_LOOKS is imported directly.
    });
    then("every look's glowLight should be a 6-digit hex colour", () => {
      for (const l of AVATAR_LOOKS) {
        expect(l.glowLight).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });
  });

  test("Every look's glowLight is darker than its from colour", ({ given, then }) => {
    given('the avatar looks', () => {
      // AVATAR_LOOKS is imported directly.
    });
    then("every look's glowLight should have lower relative luminance than its from colour", () => {
      const failures = AVATAR_LOOKS
        .map((l) => ({ id: l.id, from: luminance(l.from), glow: luminance(l.glowLight) }))
        .filter((r) => r.glow >= r.from);
      expect(failures).toEqual([]);
    });
  });
});

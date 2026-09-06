import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { takeDeepLinkToken } from '../../src/domain/deepLinkToken';

const feature = loadFeature(path.resolve(__dirname, '../__features__/deep-link-token.feature'));

defineFeature(feature, (test) => {
  let last: string | null;
  let result: ReturnType<typeof takeDeepLinkToken>;

  const givenNone = (given: any) =>
    given('no token has been handled', () => {
      last = null;
    });
  const givenLast = (given: any) =>
    given(/^the last handled token is "(.*)"$/, (t: string) => {
      last = t;
    });
  const whenToken = (when: any) =>
    when(/^the screen sees token "(.*)"$/, (t: string) => {
      result = takeDeepLinkToken(last, t);
    });
  const whenNoToken = (when: any) =>
    when('the screen sees no token', () => {
      result = takeDeepLinkToken(last, undefined);
    });
  const thenHandled = (then: any) =>
    then(/^the link should (not )?be handled$/, (not: string | undefined) => {
      expect(result.handle).toBe(!not);
    });
  const andRemembered = (and: any) =>
    and(/^the remembered token should be "(.*)"$/, (t: string) => {
      expect(result.lastHandled).toBe(t);
    });

  test('A new token is handled once and remembered', ({ given, when, then, and }) => {
    givenNone(given); whenToken(when); thenHandled(then); andRemembered(and);
  });
  test('The same token seen again is ignored', ({ given, when, then, and }) => {
    givenLast(given); whenToken(when); thenHandled(then); andRemembered(and);
  });
  test('A fresh token after a stale one is handled', ({ given, when, then, and }) => {
    givenLast(given); whenToken(when); thenHandled(then); andRemembered(and);
  });
  test('No token keeps the memory intact', ({ given, when, then, and }) => {
    givenLast(given); whenNoToken(when); thenHandled(then); andRemembered(and);
  });
});

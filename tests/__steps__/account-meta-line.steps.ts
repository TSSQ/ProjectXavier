import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { accountMetaLine } from '../../src/domain/accountSubtypeLabel';
import { ACCOUNT_SUBTYPE_CHOICES } from '../../src/domain/accountAssistant';

defineFeature(loadFeature(path.resolve(__dirname, '../__features__/account-meta-line.feature')), (test) => {
  let parts: { subtype?: string | null; tag?: string | null; archived?: boolean | null };
  let line: string;
  let lines: string[];

  test('The account meta line reads the kind as words', ({ given, when, then }) => {
    given(/^an account of kind "(.*)" tagged "(.*)"$/, (kind: string, tag: string) => {
      parts = { subtype: kind, tag };
    });
    when(/^I build its meta line$/, () => {
      line = accountMetaLine(parts);
    });
    then(/^the meta line should be "(.*)"$/, (want: string) => {
      expect(line).toBe(want);
      expect(line).not.toContain('_');
    });
  });

  test('An archived account says so, when the caller asks', ({ given, when, then }) => {
    given(/^an archived account of kind "(.*)" with no tag$/, (kind: string) => {
      parts = { subtype: kind, tag: null, archived: true };
    });
    when(/^I build its meta line including the archived marker$/, () => {
      line = accountMetaLine(parts);
    });
    then(/^the meta line should be "(.*)"$/, (want: string) => {
      expect(line).toBe(want);
    });
  });

  test('An account with nothing to say falls back', ({ given, when, then }) => {
    given(/^an account with no kind and no tag$/, () => {
      parts = { subtype: null, tag: null };
    });
    when(/^I build its meta line with the fallback "(.*)"$/, (fb: string) => {
      line = accountMetaLine(parts, fb);
    });
    then(/^the meta line should be "(.*)"$/, (want: string) => {
      expect(line).toBe(want);
    });
  });

  test('No stored subtype survives into a meta line as a raw value', ({ given, when, then }) => {
    given(/^every subtype the app offers as a choice$/, () => {
      expect(ACCOUNT_SUBTYPE_CHOICES.length).toBeGreaterThan(0);
    });
    when(/^I build a meta line for each one$/, () => {
      lines = ACCOUNT_SUBTYPE_CHOICES.map((c) => accountMetaLine({ subtype: c.value, tag: 'Personal' }));
    });
    then(/^no meta line should contain an underscore$/, () => {
      for (const l of lines) expect(l).not.toContain('_');
      expect(lines.some((l) => l.startsWith('Credit card'))).toBe(true);
    });
  });
});

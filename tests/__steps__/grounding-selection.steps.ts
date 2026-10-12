import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  selectGroundingEntities,
  GroundingEntities,
  GroundingUsage,
  EntityUsage,
} from '../../src/domain/groundingSelection';
import { buildFmParsePrompt, fmPromptText } from '../../src/domain/deviceParsePrompt';
import { EXPENSE_PARSE_CONTRACT } from '../../src/features/ai/engines/shared';
import { Account, Category, Payee } from '../../src/domain/types';

const feature = loadFeature(path.resolve(__dirname, '../__features__/grounding-selection.feature'));

const NOW = Date.UTC(2026, 9, 10, 4);
const pad = (n: number): string => String(n).padStart(2, '0');
const names = (list: Array<{ name: string }>): string => list.map((e) => e.name).join(', ');
const splitList = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);

defineFeature(feature, (test) => {
  let entities: GroundingEntities;
  let usage: GroundingUsage;
  let selected: GroundingEntities;
  let prompt: string;
  let text = '';

  const byNameId = (list: Array<{ id: string; name: string }>, name: string): string => {
    const e = list.find((x) => x.name === name);
    if (!e) throw new Error(`no entity named ${name}`);
    return e.id;
  };

  beforeEach(() => {
    entities = { categories: [], payees: [], accounts: [] };
    usage = {};
  });

  const givenPayees = (given: any) =>
    given(/^(\d+) payees named "(.*)" to "(.*)" plus (.*)$/, (count: string, _from: string, _to: string, extra: string) => {
      const payees: Payee[] = [];
      for (let i = 1; i <= Number(count); i++) payees.push({ id: `p${i}`, name: `Payee ${pad(i)}` });
      for (const name of extra.match(/"([^"]+)"/g)!.map((q) => q.slice(1, -1))) payees.push({ id: `px-${name}`, name });
      entities.payees = payees;
    });
  const background = (given: any, and: any) => {
    givenPayees(given);
    and(/^(\d+) categories named "(.*)" to "(.*)" plus (.*)$/, (count: string, _from: string, _to: string, extra: string) => {
      const categories: Category[] = [];
      for (let i = 1; i <= Number(count); i++) categories.push({ id: `c${i}`, name: `Category ${pad(i)}`, kind: 'expense' });
      for (const name of extra.match(/"([^"]+)"/g)!.map((q) => q.slice(1, -1))) categories.push({ id: `cx-${name}`, name, kind: 'expense' });
      entities.categories = categories;
    });
    and(/^accounts "(.*)"$/, (list: string) => {
      entities.accounts = splitList(list).map((name, i): Account => ({ id: `a${i}`, name, currency: 'SGD', openingBalance: 0 }));
    });
  };

  const parseUsage = (spec: string, list: Array<{ id: string; name: string }>): Record<string, EntityUsage> => {
    const out: Record<string, EntityUsage> = {};
    for (const part of spec.split(/,\s*(?=[A-Z])/)) {
      const m = /^(.+?) used (once|\d+)(?: times?)?(?: last on (\d{4}-\d{2}-\d{2}))?$/.exec(part.trim());
      if (!m) throw new Error(`bad usage spec: ${part}`);
      out[byNameId(list, m[1]!)] = {
        count: m[2] === 'once' ? 1 : Number(m[2]),
        lastUsedAt: m[3] ? Date.parse(`${m[3]}T12:00:00Z`) : null,
      };
    }
    return out;
  };
  const givenPayeeUsage = (given: any) =>
    given(/^payee usage: (.*)$/, (spec: string) => { usage = { ...usage, payees: parseUsage(spec, entities.payees) }; });
  const givenCategoryUsage = (given: any) =>
    given(/^category usage: (.*)$/, (spec: string) => { usage = { ...usage, categories: parseUsage(spec, entities.categories) }; });
  const givenOnlyCategories = (given: any) =>
    given(/^only the categories "(.*)"$/, (list: string) => {
      entities.categories = splitList(list).map((name, i): Category => ({ id: `oc${i}`, name, kind: 'expense' }));
    });
  const givenOnlyPayees = (given: any) =>
    given(/^only the payees "(.*)"$/, (list: string) => {
      entities.payees = splitList(list).map((name, i): Payee => ({ id: `op${i}`, name }));
    });
  const whenSelected = (when: any) =>
    when(/^the grounding is selected for "(.*)"$/, (t: string) => { text = t; selected = selectGroundingEntities(t, entities, usage); });
  const thenPayeesAre = (then: any) =>
    then(/^the selected payees are "(.*)"$/, (list: string) => expect(names(selected.payees)).toBe(list));
  const thenPayeesInclude = (then: any) =>
    then(/^the selected payees include "(.*)"$/, (list: string) => {
      for (const n of splitList(list)) expect(names(selected.payees)).toContain(n);
    });
  const thenPayeesNumber = (then: any) =>
    then(/^the selected payees number (\d+)$/, (n: string) => expect(selected.payees).toHaveLength(Number(n)));
  const thenCategoriesInclude = (then: any) =>
    then(/^the selected categories include "(.*)"$/, (list: string) => {
      const got = selected.categories.map((c) => c.name);
      for (const n of splitList(list)) expect(got).toContain(n);
    });

  test('Every payee the text names is offered, plus at most ten recent ones', ({ given, and, when, then }) => {
    background(given, and);
    givenPayeeUsage(given);
    whenSelected(when);
    thenPayeesAre(then);
    thenPayeesInclude(and);
    and(/^at most (\d+) selected payees are not named in the text$/, (n: string) => {
      const notNamed = selected.payees.filter((p) => !text.toLowerCase().includes(p.name.toLowerCase()));
      expect(notNamed.length).toBeLessThanOrEqual(Number(n));
    });
  });

  test('A payee named in the text is offered even when it was never used', ({ given, and, when, then }) => {
    background(given, and);
    whenSelected(when);
    thenPayeesInclude(then);
    thenPayeesNumber(and);
  });

  test("Without usage the recent payees are picked by name, then listed in the caller's order", ({ given, and, when, then }) => {
    background(given, and);
    whenSelected(when);
    thenPayeesAre(then);
  });

  test("Twenty or fewer payees are all offered, in the caller's order", ({ given, and, when, then }) => {
    background(given, and);
    givenPayees(given);
    whenSelected(when);
    thenPayeesNumber(then);
    and('the selected payees are the payees as given', () => expect(selected.payees).toEqual(entities.payees));
  });

  test('Past twenty payees the list is capped', ({ given, and, when, then }) => {
    background(given, and);
    givenPayees(given);
    whenSelected(when);
    thenPayeesNumber(then);
  });

  test('A payee sharing a word of three or more letters with the text survives the cap', ({ given, and, when, then }) => {
    background(given, and);
    givenPayees(given);
    whenSelected(when);
    thenPayeesInclude(then);
  });

  test('A connector word or a short word names no payee', ({ given, and, when, then }) => {
    background(given, and);
    givenPayees(given);
    whenSelected(when);
    then(/^the selected payees do not include "(.*)"$/, (list: string) => {
      for (const n of splitList(list)) expect(selected.payees.map((p) => p.name)).not.toContain(n);
    });
  });

  test("Thirty or fewer categories are all offered, in the caller's order", ({ given, and, when, then }) => {
    background(given, and);
    givenOnlyCategories(given);
    whenSelected(when);
    then(/^the selected categories are "(.*)"$/, (list: string) => expect(names(selected.categories)).toBe(list));
  });

  test('Past thirty categories the most used are offered, plus any the text names', ({ given, and, when, then }) => {
    background(given, and);
    givenCategoryUsage(given);
    whenSelected(when);
    then(/^the selected categories number (\d+)$/, (n: string) => expect(selected.categories).toHaveLength(Number(n)));
    thenCategoriesInclude(and);
    and(/^the selected categories do not include "(.*)"$/, (name: string) => {
      expect(selected.categories.map((c) => c.name)).not.toContain(name);
    });
  });

  test('A category the text names survives the cap even when never used', ({ given, and, when, then }) => {
    background(given, and);
    givenCategoryUsage(given);
    whenSelected(when);
    thenCategoriesInclude(then);
  });

  test('A category sharing a word with the text survives the cap', ({ given, and, when, then }) => {
    background(given, and);
    givenCategoryUsage(given);
    whenSelected(when);
    thenCategoriesInclude(then);
    and(/^the selected categories number (\d+)$/, (n: string) => expect(selected.categories).toHaveLength(Number(n)));
  });

  test('A category named in the singular survives the cap', ({ given, and, when, then }) => {
    background(given, and);
    givenCategoryUsage(given);
    whenSelected(when);
    thenCategoriesInclude(then);
    and(/^the selected categories number (\d+)$/, (n: string) => expect(selected.categories).toHaveLength(Number(n)));
  });

  test("Every account is offered, in the caller's order", ({ given, and, when, then }) => {
    background(given, and);
    whenSelected(when);
    then(/^the selected accounts are "(.*)"$/, (list: string) => expect(names(selected.accounts)).toBe(list));
  });

  test("Which entities are kept does not depend on the caller's order", ({ given, and, when, then }) => {
    background(given, and);
    givenPayeeUsage(given);
    let a: GroundingEntities;
    let b: GroundingEntities;
    let shuffled: GroundingEntities;
    const ids = (sel: GroundingEntities) =>
      (['payees', 'categories', 'accounts'] as const).map((k) => sel[k].map((e) => e.id).sort());
    when(/^the grounding is selected for "(.*)" twice with the payees shuffled$/, (t: string) => {
      a = selectGroundingEntities(t, entities, usage);
      shuffled = {
        payees: [...entities.payees].reverse(),
        categories: [...entities.categories].reverse(),
        accounts: [...entities.accounts].reverse(),
      };
      b = selectGroundingEntities(t, shuffled, usage);
    });
    then('both selections keep the same entities', () => expect(ids(b)).toEqual(ids(a)));
    and("each selection lists them in its caller's order", () => {
      for (const [sel, given] of [[a, entities], [b, shuffled]] as const) {
        for (const k of ['payees', 'categories', 'accounts'] as const) {
          const kept = new Set(sel[k].map((e) => e.id));
          expect(sel[k]).toEqual(given[k].filter((e) => kept.has(e.id)));
        }
      }
    });
  });

  const buildFm = (when: any) =>
    when(/^I build the FM parse prompt for "(.*)"$/, (t: string) => {
      prompt = buildFmParsePrompt(t, { ...entities, now: NOW, usage });
    });
  // The real BYOK expense contract's prompt, built from the CloudParseContext
  // shape the chat screen's runCloudParse passes (usage included).
  const buildByok = (when: any) =>
    when(/^I build the BYOK cloud expense prompt for "(.*)"$/, (t: string) => {
      prompt = EXPENSE_PARSE_CONTRACT.buildPrompt(t, { ...entities, now: NOW, currency: 'SGD', usage });
    });
  const promptMentions = (step: any) =>
    step(/^the prompt mentions "(.*)"$/, (s: string) => expect(prompt).toContain(s));
  const promptOmits = (step: any) =>
    step(/^the prompt does not mention "(.*)"$/, (s: string) => expect(prompt).not.toContain(s));
  const promptCategoryCount = (step: any) =>
    step(/^the prompt lists (\d+) known categories$/, (n: string) => {
      const m = /Known categories: ([^.]*)\./.exec(prompt);
      expect(m).not.toBeNull();
      expect(splitList(m![1]!)).toHaveLength(Number(n));
    });

  test('The on-device prompt lists only the selected entities', ({ given, and, when, then }) => {
    background(given, and);
    givenPayeeUsage(given);
    buildFm(when);
    promptMentions(then);
    promptOmits(and);
    promptCategoryCount(and);
    promptMentions(and);
  });

  test('The BYOK prompt lists the same selected entities', ({ given, and, when, then }) => {
    background(given, and);
    givenPayeeUsage(given);
    buildByok(when);
    promptMentions(then);
    promptOmits(and);
    promptCategoryCount(and);
  });

  test('Past thirty categories the BYOK prompt keeps the most used, even those that sort late', ({
    given,
    and,
    when,
    then,
  }) => {
    background(given, and);
    givenCategoryUsage(given);
    buildByok(when);
    promptCategoryCount(then);
    promptMentions(and);
    promptMentions(and);
    promptOmits(and);
  });

  test('Small lists are sent exactly as given', ({ given, and, when, then }) => {
    background(given, and);
    givenOnlyCategories(given);
    givenOnlyPayees(and);
    buildFm(when);
    promptMentions(then);
    promptMentions(and);
  });

  // The guard for the first B2 FM dev run's regression: sorting the lists by
  // name changed every small-context dev prompt and lost six cases. The hashes
  // were recorded from main's builder by evals/fm/prompt-hashes.mjs; the
  // contexts are built as evals/fm/pipeline.mjs's buildFixtures builds them.
  test('Every pre-existing dev case gets the same FM prompt as main before the caps', ({ given, and, when, then }) => {
    let recorded: Record<string, string> = {};
    let current: Record<string, string> = {};
    background(given, and);
    given(/^the FM prompt hashes recorded from main in "(.*)"$/, (file: string) => {
      recorded = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')).hashes;
    });
    when('the FM prompt is built for every dev case without usage data, as the eval builds it', () => {
      const lines = fs.readFileSync(path.resolve(__dirname, '../../evals/dataset.jsonl'), 'utf8').split('\n');
      current = {};
      for (const line of lines.filter((l) => l.trim())) {
        const c = JSON.parse(line);
        if (c.split !== 'dev' || c.context.payeeUsage || c.context.categoryUsage) continue;
        const now = Date.parse(c.context.nowISO);
        const ctx = {
          categories: c.context.categories.map((x: { name: string; kind: Category['kind'] }, i: number) => ({ id: `cat-${i}`, name: x.name, kind: x.kind })),
          payees: c.context.payees.map((name: string, i: number) => ({ id: `payee-${i}`, name })),
          accounts: c.context.accounts.map((name: string, i: number) => ({ id: `acct-${i}`, name, currency: 'USD', openingBalance: 0 })),
          now,
        };
        current[c.id] = createHash('sha256').update(buildFmParsePrompt(fmPromptText(c.text, now), ctx)).digest('hex').slice(0, 16);
      }
    });
    then("every prompt hashes the same as main's", () => {
      const changed = Object.keys(recorded).filter((id) => id in current && current[id] !== recorded[id]);
      expect(changed).toEqual([]);
    });
    and('no dev case without usage data is missing from the recording', () => {
      expect(Object.keys(current).filter((id) => !(id in recorded))).toEqual([]);
      expect(Object.keys(recorded).filter((id) => !(id in current))).toEqual([]);
    });
  });
});

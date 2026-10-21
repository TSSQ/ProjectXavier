/**
 * Per-request tool parameter choices for the BYOK query loop (question eval
 * D4, docs/design/ask-xavier-queries-spec.md §5.3). The static tool
 * definitions (`QUERY_TOOL_DEFS`, src/domain/queryTools.ts) give
 * `category` / `payee` / `account` as free text, so the model copies the
 * user's word ("eating out", "grab") and the resolver has to guess what it
 * meant. Here, for one question, those parameters become a CLOSED choice of
 * the user's own names — capped by `selectGroundingEntities` exactly as the
 * parse prompt is (src/domain/groundingSelection.ts) — plus `"unspecified"`,
 * so the model picks a real entity instead.
 *
 * Only the model-facing JSON Schema changes. Validation and execution keep
 * the free-text zod params: whatever the model sends (a listed name,
 * "unspecified", or anything else a lax provider lets through) still goes
 * through `src/domain/queryFilterResolution.ts`, which treats "unspecified"
 * as no filter. The floor and the on-device selection keep free text.
 *
 * Pure and framework-free; built per request because the cap depends on the
 * question's words (a payee the question names is always kept).
 */
import { Account, Category, Payee } from './types';
import { GroundingUsage, selectGroundingEntities } from './groundingSelection';

/** The sentinel a closed choice offers for "the question names none". */
export const UNSPECIFIED_CHOICE = 'unspecified';

/** What the loop needs to build the choices: the user's lists (and how
 *  often each entity is used, for the payee/category caps). */
export interface QueryToolGrounding {
  categories: Category[];
  payees: Payee[];
  accounts: Account[];
  usage?: GroundingUsage;
}

export interface QueryToolChoices {
  expenseCategories: string[];
  incomeCategories: string[];
  anyCategories: string[];
  payees: string[];
  accounts: string[];
}

/** Trimmed, de-duplicated case-insensitively (an enum's items must be
 *  unique), and never the sentinel itself — a user category literally named
 *  "unspecified" would otherwise appear twice. */
const uniqueNames = (names: string[]): string[] => {
  const seen = new Set<string>([UNSPECIFIED_CHOICE]);
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    const k = n.toLowerCase();
    if (!n || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
};

/** The capped name lists for one question. Archived accounts and transfer
 *  categories are never offered (no spend/income filter can use them). */
export function queryToolChoicesFor(text: string, grounding: QueryToolGrounding): QueryToolChoices {
  const picked = selectGroundingEntities(
    text,
    {
      categories: grounding.categories,
      payees: grounding.payees,
      accounts: grounding.accounts.filter((a) => !a.archived),
    },
    grounding.usage
  );
  const ofKind = (kind: Category['kind']) => uniqueNames(picked.categories.filter((c) => c.kind === kind).map((c) => c.name));
  const expenseCategories = ofKind('expense');
  const incomeCategories = ofKind('income');
  return {
    expenseCategories,
    incomeCategories,
    anyCategories: uniqueNames([...expenseCategories, ...incomeCategories]),
    payees: uniqueNames(picked.payees.map((p) => p.name)),
    accounts: uniqueNames(picked.accounts.map((a) => a.name)),
  };
}

type JsonSchema = Record<string, unknown>;

/** Which name list each filterable parameter of each tool closes over. */
const PARAM_LISTS: Record<string, Partial<Record<'category' | 'payee' | 'account', keyof QueryToolChoices>>> = {
  total_spent: { category: 'expenseCategories', payee: 'payees', account: 'accounts' },
  total_income: { category: 'incomeCategories' },
  spending_over_time: { category: 'expenseCategories' },
  search_transactions: { category: 'anyCategories', payee: 'payees', account: 'accounts' },
};

const NOUN = { category: 'category', payee: 'payee/merchant', account: 'account' } as const;

/**
 * `jsonSchema` (one tool's static parameter schema) with its category /
 * payee / account properties narrowed to `choices` + `"unspecified"`. A list
 * the user has no entries in is left free text (an enum of only the sentinel
 * would forbid naming anything). Never mutates the input.
 */
export function closeToolSchema(toolName: string, jsonSchema: JsonSchema, choices: QueryToolChoices): JsonSchema {
  const lists = PARAM_LISTS[toolName];
  const properties = jsonSchema.properties as Record<string, JsonSchema> | undefined;
  if (!lists || !properties) return jsonSchema;
  const next: Record<string, JsonSchema> = { ...properties };
  for (const [param, listKey] of Object.entries(lists) as Array<['category' | 'payee' | 'account', keyof QueryToolChoices]>) {
    const names = choices[listKey];
    if (!next[param] || names.length === 0) continue;
    next[param] = {
      type: 'string',
      enum: [...names, UNSPECIFIED_CHOICE],
      description:
        `One of the user's own ${NOUN[param]} names — pick the one the question means, even when the ` +
        `question words it differently. "${UNSPECIFIED_CHOICE}" (or omit it) when the question names none.`,
    };
  }
  return { ...jsonSchema, properties: next };
}

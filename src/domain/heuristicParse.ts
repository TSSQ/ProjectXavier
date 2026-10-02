/**
 * The heuristic parse of a text, schema-validated (guardrail #6). Used by the
 * heuristic tier and the "Log anyway" action. Framework-free.
 */
import { localParse, LocalParseContext } from './localParse';
import { aiParsedExpenseSchema, AiParsedExpense } from '../lib/validation';

/** `null` when the output fails validation. A result may still carry a null
 *  amount — the caller's `interpret()` turns that into the normal "how much?"
 *  clarification, never a $0 entry. */
export function heuristicExpense(text: string, ctx: LocalParseContext): AiParsedExpense | null {
  const validated = aiParsedExpenseSchema.safeParse(localParse(text, ctx));
  return validated.success ? validated.data : null;
}

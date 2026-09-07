/**
 * The single source of truth for Xavier's slash commands — so the quick-action
 * chips and the "/" popover on the assistant home screen can't drift out of
 * sync. Pure, framework-free, BDD-testable (see accountAssistant.ts for the
 * flow logic these commands dispatch to).
 */

export interface AssistantCommand {
  name: '/account' | '/transactions';
  title: string; // "Set up a new account"
  keyword: string; // "account" — for filtering
}

export const ASSISTANT_COMMANDS: AssistantCommand[] = [
  {
    name: '/account',
    title: 'Set up a new account',
    keyword: 'account',
  },
  {
    name: '/transactions',
    title: 'Log an expense or income',
    keyword: 'transactions',
  },
];

/** Filter for the slash menu. `q` is the raw field text starting with "/". */
export function matchCommands(q: string): AssistantCommand[] {
  const needle = q.trim().toLowerCase().replace(/^\//, '');
  if (!needle) return ASSISTANT_COMMANDS;
  return ASSISTANT_COMMANDS.filter((cmd) => cmd.keyword.startsWith(needle));
}

/** A row in the "+" menu (composer-seated-with-xavier-spec.md §4.4): every
 *  slash command, plus one action row that used to be a quick-action chip.
 *  Kept as a union rather than folding 'addManually' into AssistantCommand
 *  so this module still owns exactly one command catalogue — that row is a
 *  UI affordance, not a command the typed "/" path can ever match.
 *
 *  There is deliberately no 'scan' row: the composer's own camera glyph sits
 *  in the field a few points away and does the same thing, so a menu entry
 *  for it was a second door to one room — and the menu's version anchored
 *  its photo sheet up by the "+", over Xavier and the greeting. */
export type PlusMenuRow = AssistantCommand | 'addManually';

/** Row order for the "+" menu — every command (unfiltered, "+" always means
 *  "everything") followed by "Add manually". Pure so the BDD suite pins the
 *  order; index.tsx passes `matchCommands('')` in. */
export function plusMenuRows(commands: AssistantCommand[]): PlusMenuRow[] {
  return [...commands, 'addManually'];
}

/** True when the field text should open the slash menu (starts with "/" and
 *  is not yet a completed command+space). Strips leading whitespace first so
 *  it agrees with matchCommands() on leading whitespace (" /account" behaves
 *  like "/account" in both) — trailing whitespace is left alone, since a
 *  trailing space after the command name is exactly what marks it "completed"
 *  (see the regex below). */
export function isSlashQuery(text: string): boolean {
  const t = text.replace(/^\s+/, '');
  if (!t.startsWith('/')) return false;
  // Once the user has typed a full command name followed by a space, they're
  // past picking a command (e.g. "/transactions lunch") — close the menu.
  return !/^\/\S+\s/.test(t);
}

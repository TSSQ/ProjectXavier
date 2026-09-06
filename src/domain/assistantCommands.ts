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
 *  slash command, plus two action rows that used to be quick-action chips.
 *  Kept as a union rather than folding 'scan'/'addManually' into
 *  AssistantCommand so this module still owns exactly one command catalogue
 *  — the two action rows are UI affordances, not commands the typed "/"
 *  path can ever match. */
export type PlusMenuRow = AssistantCommand | 'scan' | 'addManually';

/** Row order for the "+" menu — every command (unfiltered, "+" always means
 *  "everything") followed by the two rows QuickActionChips used to render as
 *  "Scan photo" and "Add manually". Pure so the BDD suite pins the order;
 *  index.tsx passes `matchCommands('')` in. */
export function plusMenuRows(commands: AssistantCommand[]): PlusMenuRow[] {
  return [...commands, 'scan', 'addManually'];
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

/**
 * The Transactions tab's `?edit=<txId>@<token>` deep link (from budget
 * category detail). The tab may already be mounted with an OLDER ledger than
 * the row being opened (a transaction logged a moment ago), so "the row is
 * not in the list" is not yet "the row is gone". It is only gone once a load
 * that STARTED after the link arrived (and so could see the row) has completed
 * and still lacks it: a refresh already in flight when the link arrived does
 * not count. Pure, so the rule is tested in Node; the screen stamps each load
 * with a start sequence number.
 */
export type EditLinkDecision = 'open' | 'wait' | 'drop';

export function decideEditLink(args: {
  /** The row is in the currently loaded ledger. */
  rowFound: boolean;
  /** The start sequence number of the newest completed load. */
  loadedSeq: number;
  /** The newest start sequence number handed out when the link was first seen
   *  (loads started up to then do not count toward it). */
  genAtToken: number;
}): EditLinkDecision {
  if (args.rowFound) return 'open';
  return args.loadedSeq > args.genAtToken ? 'drop' : 'wait';
}

/** The tx id inside an edit token ("<id>@<timestamp>"). */
export function editLinkTxId(token: string): string {
  return token.split('@')[0] ?? '';
}

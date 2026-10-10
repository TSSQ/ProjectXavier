/**
 * What the on-device debug screen (app/debug-fm.tsx) shows for one run, as pure
 * data: the model's own verdict, how the app CLASSIFIES that result
 * (`classifyDeviceParse`), and whether the deterministic cue check
 * (./notTransactionCues) would have refused the text before the model ran.
 *
 * The screen runs the model even when a cue fires, so a developer can compare
 * what the model WOULD have said (on the iPhone it answers `isTransaction: true`
 * for questions the Mac refuses) with what the app does.
 *
 * Framework-free so the plain-node BDD suite covers it.
 */
import { AffirmationReason, classifyDeviceParse } from './fmRefusal';
import { FmDeviceParse } from './fmParse';
import { cueRefusal, detectNotTransactionCue, NotTransactionCue } from './notTransactionCues';

export type DebugOutcome = 'parsed' | 'refused' | 'failed';

export interface FmDebugView {
  /** The model's `isTransaction` answer, or why there is none. */
  verdict: 'transaction' | 'not a transaction' | 'no answer';
  /** `classifyDeviceParse` on the model's result alone (cue check ignored). */
  modelOutcome: DebugOutcome;
  /** The cue that refuses this text before the model in the app, else null. */
  cue: NotTransactionCue | null;
  /** A cue is present but the text names no amount, so the app still calls the
   *  model (then the heuristic's "how much?"). */
  cueWithoutAmount: NotTransactionCue | null;
  /** What the app does: a firing cue wins, otherwise the model's outcome. */
  appOutcome: DebugOutcome;
  /** Set when the model said "not a transaction" and code kept the parse as a
   *  cold-start miss (`affirmsTransaction`, ./fmRefusal): the verdict shown is
   *  the model's own `false`. */
  affirmed: AffirmationReason | null;
}

export function describeFmDebugRun(
  text: string,
  run: { fm: FmDeviceParse | null; error: string | null }
): FmDebugView {
  const modelOutcome = classifyDeviceParse(run.fm, text, { threw: run.error ? 1 : 0 }).kind;
  const cue = cueRefusal(text)?.cue ?? null;
  const rawCue = detectNotTransactionCue(text)?.cue ?? null;
  return {
    verdict:
      run.fm == null ? 'no answer' : run.fm.isTransaction && !run.fm.affirmed ? 'transaction' : 'not a transaction',
    modelOutcome,
    cue,
    cueWithoutAmount: cue == null ? rawCue : null,
    appOutcome: cue ? 'refused' : modelOutcome,
    affirmed: run.fm?.affirmed ?? null,
  };
}

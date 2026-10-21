/**
 * On-device prompt arms for `npm run eval:questions:fm` (dev tooling — never
 * ships). `baseline` is the shipping prompt (`buildQueryToolSelectionPrompt`,
 * passed through untouched); an experimental arm returns the user turn it
 * wants the probe to send instead. Instructions and schema never vary by arm.
 */
export const FM_ARMS = ['baseline'];

/** The user turn for `arm`, or `undefined` for the shipping prompt. */
export function fmPromptForArm(arm) {
  if (arm === 'baseline') return undefined;
  throw new Error(`unknown fm arm "${arm}"`);
}

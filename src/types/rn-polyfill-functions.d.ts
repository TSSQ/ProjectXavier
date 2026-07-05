/** react-native ships no types for this deep internal import; it is the
 *  documented way to install globals (used by src/lib/aiPolyfills.ts). */
declare module 'react-native/Libraries/Utilities/PolyfillFunctions' {
  export function polyfillGlobal(name: string, getValue: () => unknown): void;
}

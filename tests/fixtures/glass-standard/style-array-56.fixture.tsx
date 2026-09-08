/**
 * Known-limit fixture for glass-standard.feature's 56pt-box guard (QA round
 * 2 MINOR 5). `width: 56` and `height: 56` here sit in two SEPARATE object
 * literals combined via a style array — they never share an enclosing `{ … }`
 * object, so `enclosingBraceRange` in glass-standard.steps.ts cannot pair
 * them without risking a false pair across unrelated sibling objects
 * elsewhere in a file. This fixture pins TODAY'S actual (undetected)
 * behaviour — see the steps file header — rather than letting the guard
 * silently claim coverage it doesn't have.
 *
 * Lives under tests/fixtures/, not app/ or src/, so it is never picked up by
 * the real source-scan scenarios (those only walk app/ and src/) — the
 * dedicated regression scenario reads this file directly instead.
 */
import { Pressable } from 'react-native';

export function StyleArray56Fixture({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        { width: 56 },
        { height: 56, shadowColor: '#000', shadowOpacity: 0.3 },
      ]}
    />
  );
}

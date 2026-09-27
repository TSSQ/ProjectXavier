import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { lockView } from '../../src/domain/biometricLock';

const feature = loadFeature(path.resolve(__dirname, '../__features__/lock-view.feature'));
const yes = (v: string) => v === 'yes';

defineFeature(feature, (test) => {
  test('What the root layout renders', ({ then }) => {
    then(
      /^ready (yes|no), unlocked (yes|no), unlocked once (yes|no) should render "(splash|app|covered)"$/,
      (ready: string, unlocked: string, once: string, view: string) => {
        expect(lockView(yes(ready), yes(unlocked), yes(once))).toBe(view);
      }
    );
  });
});

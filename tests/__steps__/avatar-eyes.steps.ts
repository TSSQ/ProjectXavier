import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { eyeGeometry, EyeGeometry, EyeSide } from '../../src/domain/avatarEyes';
import { AvatarState } from '../../src/domain/avatar';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/avatar-eyes.feature')
);

defineFeature(feature, (test) => {
  let result: EyeGeometry;

  const computeGeometry = (when: any) => {
    when(
      /^I compute eye geometry for state "(.*)" and side "(.*)"$/,
      (state: string, side: string) => {
        result = eyeGeometry(state as AvatarState, side as EyeSide);
      }
    );
  };

  test('Idle eyes are tall pills', ({ when, then }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    then(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
  });

  test('Listening eyes are the same as idle', ({ when, then }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    then(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
  });

  test('Thinking eyes are narrow slits', ({ when, then }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    then(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
  });

  test('Happy eyes are flat-bottomed domes', ({ when, then }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    then(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
  });

  test('Confused left eye is full height with no offset', ({ when, then }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    then(/^the offsetYRatio should be (.*)$/, (val: string) => {
      expect(result.offsetYRatio).toBe(parseFloat(val));
    });
  });

  test('Confused right eye is smaller and raised', ({ when, then }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    then(/^the offsetYRatio should be (.*)$/, (val: string) => {
      expect(result.offsetYRatio).toBe(parseFloat(val));
    });
  });

  test('Angry left eye tilts inward at +16 degrees', ({ when, then }) => {
    computeGeometry(when);
    then(/^the tiltDeg should be (.*)$/, (val: string) => {
      expect(result.tiltDeg).toBe(parseFloat(val));
    });
  });

  test('Angry right eye tilts inward at -16 degrees', ({ when, then }) => {
    computeGeometry(when);
    then(/^the tiltDeg should be (.*)$/, (val: string) => {
      expect(result.tiltDeg).toBe(parseFloat(val));
    });
  });

  test('Right idle eye matches left (symmetry)', ({ when, then, and }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    and(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
    and(/^the tiltDeg should be (.*)$/, (val: string) => {
      expect(result.tiltDeg).toBe(parseFloat(val));
    });
  });

  test('Right listening eye matches left (symmetry)', ({ when, then, and }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    and(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
    and(/^the tiltDeg should be (.*)$/, (val: string) => {
      expect(result.tiltDeg).toBe(parseFloat(val));
    });
  });

  test('Right thinking eye matches left (symmetry)', ({ when, then, and }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    and(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
    and(/^the tiltDeg should be (.*)$/, (val: string) => {
      expect(result.tiltDeg).toBe(parseFloat(val));
    });
  });

  test('Right happy eye matches left (symmetry)', ({ when, then, and }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    and(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
    and(/^the tiltDeg should be (.*)$/, (val: string) => {
      expect(result.tiltDeg).toBe(parseFloat(val));
    });
  });

  test('Angry left eye has correct heightRatio and flatBottom', ({ when, then, and }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    and(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
  });

  test('Angry right eye has correct heightRatio and flatBottom', ({ when, then, and }) => {
    computeGeometry(when);
    then(/^the heightRatio should be (.*)$/, (val: string) => {
      expect(result.heightRatio).toBe(parseFloat(val));
    });
    and(/^flatBottom should be (.*)$/, (val: string) => {
      expect(result.flatBottom).toBe(val === 'true');
    });
  });

  test('Confused left eye has zero tilt and zero offsetY', ({ when, then, and }) => {
    computeGeometry(when);
    then(/^the tiltDeg should be (.*)$/, (val: string) => {
      expect(result.tiltDeg).toBe(parseFloat(val));
    });
    and(/^the offsetYRatio should be (.*)$/, (val: string) => {
      expect(result.offsetYRatio).toBe(parseFloat(val));
    });
  });
});

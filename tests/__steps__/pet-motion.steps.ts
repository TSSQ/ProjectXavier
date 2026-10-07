import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { PET_BREATHE, PetHalo, petHalo, petLift } from '../../src/domain/petMotion';

const feature = loadFeature(path.resolve(__dirname, '../__features__/pet-motion.feature'));

defineFeature(feature, (test) => {
  let halo: PetHalo;
  let size = 180;
  const compute = (s: string, theme: string) => {
    size = Number(s);
    halo = petHalo(size, theme === 'light');
  };

  test("At 180 the dark halo and breathing are exactly today's", ({ when, then, and }) => {
    when(/^the motion is computed for size (\d+) in the (dark|light) theme$/, compute);
    then('the opacity should run 0.40 to 0.75 and the radius 16 to 28', () => {
      // Today's constants in XavierPet: base .4, idle add .35; radius 16, add 12.
      expect(halo.baseOpacity).toBe(0.4);
      expect(halo.idleOpacity).toBe(0.35);
      expect(halo.baseRadius).toBe(16);
      expect(halo.baseRadius + halo.idleRadius).toBe(28);
      expect(halo.idleRadius).toBe(12);
    });
    and(
      'the breathing should be a scale of 1.045, a lift of -8 and 1.9 seconds, with a halo of 2.2 seconds',
      () => {
        expect(PET_BREATHE.scale).toBe(1.045);
        expect(petLift(180)).toBe(-8);
        expect(PET_BREATHE.ms).toBe(1900);
        expect(PET_BREATHE.haloMs).toBe(2200);
      }
    );
  });

  test("At 180 the light halo is exactly today's", ({ when, then }) => {
    when(/^the motion is computed for size (\d+) in the (dark|light) theme$/, compute);
    then('the opacity should run 0.25 to 0.47 and the radius 14 to 25', () => {
      expect(halo.baseOpacity).toBe(0.25);
      expect(halo.idleOpacity).toBe(0.22);
      expect(halo.baseRadius).toBe(14);
      expect(halo.idleRadius).toBe(11);
      expect(halo.baseRadius + halo.idleRadius).toBe(25);
      expect(halo.baseOpacity + halo.idleOpacity).toBeCloseTo(0.47, 10);
    });
  });

  test("At 180 the listening lift is exactly today's", ({ then }) => {
    then('the listening lift at size 180 should be -6 and the resting lift -8', () => {
      expect(petLift(180, true)).toBe(-6);
      expect(petLift(180)).toBe(-8);
      expect(PET_BREATHE.listeningScale).toBe(1.05);
      expect(PET_BREATHE.listeningMs).toBe(1500);
    });
  });

  test('At the header size the lift is small and the halo uses its floor', ({ when, then, and }) => {
    when(/^the motion is computed for size (\d+) in the (dark|light) theme$/, compute);
    then('the lift should be about -2.3', () => expect(petLift(size)).toBeCloseTo(-2.31, 2));
    and('the halo rest radius should be the 6 point floor and the peak should be its scaled value', () => {
      expect(halo.baseRadius).toBe(6);
      expect(halo.baseRadius + halo.idleRadius).toBeCloseTo((28 * 52) / 180, 10);
    });
    and('the opacities should be unchanged', () => {
      expect(halo.baseOpacity).toBe(0.4);
      expect(halo.idleOpacity).toBe(0.35);
    });
  });

  test('The halo never goes below the floor, and grows with size', ({ then }) => {
    then(
      'the halo radius at size 20 should be 6 at rest and at peak, and at size 360 should be double',
      () => {
        const tiny = petHalo(20, false);
        expect(tiny.baseRadius).toBe(6);
        expect(tiny.baseRadius + tiny.idleRadius).toBe(6);
        const big = petHalo(360, false);
        expect(big.baseRadius).toBe(32);
        expect(big.baseRadius + big.idleRadius).toBe(56);
      }
    );
  });

  test("The Assistant's hero looks exactly as today at every hero size", ({ when, then }) => {
    when(/^the hero is drawn at (\d+) with its own size as the reference$/, (n: string) => {
      size = Number(n);
      halo = petHalo(size, false, size);
    });
    then("the halo and lift should equal today's constants", () => {
      expect(halo.baseRadius).toBe(16);
      expect(halo.idleRadius).toBe(12);
      expect(halo.baseOpacity).toBe(0.4);
      expect(halo.idleOpacity).toBe(0.35);
      expect(petHalo(size, true, size)).toEqual({
        baseOpacity: 0.25,
        idleOpacity: 0.22,
        baseRadius: 14,
        idleRadius: 11,
      });
      expect(petLift(size, false, size)).toBe(-8);
      expect(petLift(size, true, size)).toBe(-6);
    });
  });

  test("The header avatar's halo is floored at 6 on screen", ({ when, then, and }) => {
    let visualScale = 1;
    when(
      /^the avatar is drawn at (\d+) and shown at (\d+) with a reference of (\d+)$/,
      (drawn: string, shown: string) => {
        size = Number(drawn);
        visualScale = Number(shown) / size;
      }
    );
    then('the rest radius on screen should be 6 in the dark and light themes', () => {
      // What XavierPet does: motion for the size it APPEARS at, divided back by the
      // visual scale; the parent transform then multiplies it by that scale again.
      for (const light of [false, true]) {
        const h = petHalo(size * visualScale, light, 180);
        expect((h.baseRadius / visualScale) * visualScale).toBeCloseTo(6, 10);
      }
    });
    and(/^the lift on screen should be about (-[\d.]+)$/, (lift: string) => {
      const inAvatarSpace = petLift(size * visualScale, false, 180) / visualScale;
      expect(inAvatarSpace * visualScale).toBeCloseTo(Number(lift), 2);
    });
  });

  test("The header at 160 is scaled from the hero's own reference", ({ then }) => {
    then(
      'the 46 header drawn from a 160 hero has a rest radius of 6 on screen and a lift of -8 times 46 over 160',
      () => {
        const vs = 46 / 160;
        const h = petHalo(160 * vs, false, 160);
        expect((h.baseRadius / vs) * vs).toBeCloseTo(6, 10);
        expect((petLift(160 * vs, false, 160) / vs) * vs).toBeCloseTo((-8 * 46) / 160, 10);
      }
    );
  });

  test('The lift does not depend on the visual scale', ({ then }) => {
    then('the lift in avatar space is the same at visual scales 1 and 0.29', () => {
      const at = (vs: number) => petLift(180 * vs, false, 180) / vs;
      expect(at(0.29)).toBeCloseTo(at(1), 10);
    });
  });

  test('The header at 46 on a 160 hero, end to end, on screen', ({ then }) => {
    then(
      'the rest halo is 6 and the peak is 28 times 46 over 160 on screen, and the opacities are unchanged',
      () => {
        // XavierPet: drawn at 160, shown at 46 (visual scale 46/160), reference 160.
        const vs = 46 / 160;
        const h = petHalo(160 * vs, false, 160);
        const restOnScreen = (h.baseRadius / vs) * vs;
        const peakOnScreen = ((h.baseRadius + h.idleRadius) / vs) * vs;
        expect(restOnScreen).toBeCloseTo(6, 10);
        expect(peakOnScreen).toBeCloseTo(8.05, 2);
        expect(peakOnScreen).toBeCloseTo((28 * 46) / 160, 10);
        expect(h.baseOpacity).toBe(0.4);
        expect(h.idleOpacity).toBe(0.35);
      }
    );
  });
});

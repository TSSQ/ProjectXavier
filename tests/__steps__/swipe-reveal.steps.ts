import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  shouldClaimHorizontal,
  clampTranslate,
  resolveSnap,
  actionsWidth,
  HorizontalDragInput,
  SnapInput,
  ActionsWidthInput,
} from '../../src/domain/swipeReveal';

const feature = loadFeature(path.resolve(__dirname, '../__features__/swipe-reveal.feature'));

defineFeature(feature, (test) => {
  // ── shouldClaimHorizontal ──────────────────────────────────────────────
  let drag: HorizontalDragInput;
  let claimed: boolean;

  const givenDrag = (dx: string, dy: string) => {
    drag = { dx: parseInt(dx, 10), dy: parseInt(dy, 10) };
  };
  const whenClaimEvaluated = () => {
    claimed = shouldClaimHorizontal(drag);
  };
  const thenClaimed = () => {
    expect(claimed).toBe(true);
  };
  const thenNotClaimed = () => {
    expect(claimed).toBe(false);
  };

  test("An unambiguous horizontal drag claims the gesture", ({ given, when, then }) => {
    given(/^a drag of dx (-?\d+) and dy (-?\d+)$/, givenDrag);
    when(/^horizontal claim is evaluated$/, whenClaimEvaluated);
    then(/^the gesture should be claimed$/, thenClaimed);
  });

  test('A drag below the 8pt floor does not claim the gesture', ({ given, when, then }) => {
    given(/^a drag of dx (-?\d+) and dy (-?\d+)$/, givenDrag);
    when(/^horizontal claim is evaluated$/, whenClaimEvaluated);
    then(/^the gesture should not be claimed$/, thenNotClaimed);
  });

  test("A drag that isn't at least 2:1 horizontal does not claim the gesture", ({ given, when, then }) => {
    given(/^a drag of dx (-?\d+) and dy (-?\d+)$/, givenDrag);
    when(/^horizontal claim is evaluated$/, whenClaimEvaluated);
    then(/^the gesture should not be claimed$/, thenNotClaimed);
  });

  test('A vertical drag does not claim the gesture', ({ given, when, then }) => {
    given(/^a drag of dx (-?\d+) and dy (-?\d+)$/, givenDrag);
    when(/^horizontal claim is evaluated$/, whenClaimEvaluated);
    then(/^the gesture should not be claimed$/, thenNotClaimed);
  });

  // ── clampTranslate ─────────────────────────────────────────────────────
  let rawDx = 0;
  let actionsW = 0;
  let clamped = 0;

  const givenRawTranslate = (dx: string) => {
    rawDx = parseInt(dx, 10);
  };
  const givenActionsWidth = (w: string) => {
    actionsW = parseInt(w, 10);
  };
  const whenClamped = () => {
    clamped = clampTranslate(rawDx, actionsW);
  };
  const thenClampedIs = (n: string) => {
    expect(clamped).toBe(parseInt(n, 10));
  };

  test('A right-swipe on a closed row is rejected', ({ given, and, when, then }) => {
    given(/^a raw translate of (-?\d+)$/, givenRawTranslate);
    and(/^an actions width of (\d+)$/, givenActionsWidth);
    when(/^the translate is clamped$/, whenClamped);
    then(/^the clamped translate should be (-?\d+)$/, thenClampedIs);
  });

  test('A drag within range passes through unchanged', ({ given, and, when, then }) => {
    given(/^a raw translate of (-?\d+)$/, givenRawTranslate);
    and(/^an actions width of (\d+)$/, givenActionsWidth);
    when(/^the translate is clamped$/, whenClamped);
    then(/^the clamped translate should be (-?\d+)$/, thenClampedIs);
  });

  test('Overshoot rubber-bands to 1.15x the actions width and no further', ({ given, and, when, then }) => {
    given(/^a raw translate of (-?\d+)$/, givenRawTranslate);
    and(/^an actions width of (\d+)$/, givenActionsWidth);
    when(/^the translate is clamped$/, whenClamped);
    then(/^the clamped translate should be (-?\d+)$/, thenClampedIs);
  });

  // ── resolveSnap ─────────────────────────────────────────────────────────
  let snapInput: Partial<SnapInput>;
  let snap: 'open' | 'closed';

  const givenSnapInputs = (t: string, v: string, w: string) => {
    snapInput = {
      translateX: parseInt(t, 10),
      velocityX: parseInt(v, 10),
      actionsWidth: parseInt(w, 10),
    };
  };
  const whenSnapResolved = () => {
    snap = resolveSnap(snapInput as SnapInput);
  };
  const thenOpen = () => {
    expect(snap).toBe('open');
  };
  const thenClosed = () => {
    expect(snap).toBe('closed');
  };

  test('Snaps open when released past the halfway point at rest', ({ given, when, then }) => {
    given(/^a translate of (-?\d+), a velocity of (-?\d+), and an actions width of (\d+)$/, givenSnapInputs);
    when(/^the snap is resolved$/, whenSnapResolved);
    then(/^the row should end up open$/, thenOpen);
  });

  test('Snaps closed when released short of the halfway point at rest', ({ given, when, then }) => {
    given(/^a translate of (-?\d+), a velocity of (-?\d+), and an actions width of (\d+)$/, givenSnapInputs);
    when(/^the snap is resolved$/, whenSnapResolved);
    then(/^the row should end up closed$/, thenClosed);
  });

  test('A fast flick opens the row even short of the halfway point', ({ given, when, then }) => {
    given(/^a translate of (-?\d+), a velocity of (-?\d+), and an actions width of (\d+)$/, givenSnapInputs);
    when(/^the snap is resolved$/, whenSnapResolved);
    then(/^the row should end up open$/, thenOpen);
  });

  test('A fast reverse flick closes an already-open row', ({ given, when, then }) => {
    given(/^a translate of (-?\d+), a velocity of (-?\d+), and an actions width of (\d+)$/, givenSnapInputs);
    when(/^the snap is resolved$/, whenSnapResolved);
    then(/^the row should end up closed$/, thenClosed);
  });

  // ── actionsWidth ────────────────────────────────────────────────────────
  let widthBase: Omit<ActionsWidthInput, 'fontSize'>;
  let recordedWidths: number[] = [];

  const givenStrip = (count: string, icon: string, padH: string, gap: string, minW: string) => {
    widthBase = {
      count: parseInt(count, 10),
      iconSize: parseInt(icon, 10),
      padH: parseInt(padH, 10),
      gap: parseInt(gap, 10),
      minButtonWidth: parseInt(minW, 10),
    };
    recordedWidths = [];
  };
  const whenWidthComputedAt = (fontSize: string) => {
    recordedWidths.push(actionsWidth({ ...widthBase, fontSize: parseFloat(fontSize) }));
  };
  const thenStrictlyIncreasing = () => {
    for (let i = 1; i < recordedWidths.length; i++) {
      expect(recordedWidths[i]!).toBeGreaterThan(recordedWidths[i - 1]!);
    }
  };
  const thenAtLeast = (n: string) => {
    expect(recordedWidths[recordedWidths.length - 1]!).toBeGreaterThanOrEqual(Number(n));
  };

  test('The actions strip widens monotonically as Dynamic Type scales up', ({ given, when, and, then }) => {
    given(
      /^an actions strip of (\d+) buttons, icon size (\d+), padding (\d+), gap (\d+), and a minimum button width of (\d+)$/,
      givenStrip
    );
    when(/^the strip width is computed at font size ([\d.]+)$/, whenWidthComputedAt);
    and(/^the strip width is computed at font size ([\d.]+)$/, whenWidthComputedAt);
    and(/^the strip width is computed at font size ([\d.]+)$/, whenWidthComputedAt);
    then(/^each recorded strip width should be strictly wider than the last$/, thenStrictlyIncreasing);
  });

  test('The strip width never falls below the minimum button width', ({ given, when, then }) => {
    given(
      /^an actions strip of (\d+) button, icon size (\d+), padding (\d+), gap (\d+), and a minimum button width of (\d+)$/,
      givenStrip
    );
    when(/^the strip width is computed at font size ([\d.]+)$/, whenWidthComputedAt);
    then(/^the strip width should be at least (\d+)$/, thenAtLeast);
  });
});

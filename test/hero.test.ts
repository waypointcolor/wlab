// The landing page's opening animation: the fit of cone fundamentals and a camera's sensors to XYZ and the samples' places in CIELAB and WLab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { illuminants, observers, responses, whiteOf } from '../src/index.ts';
import { cmfFit, conditionOrder, place, REFERENCE, samples, toXyzFor, viewers, xyzCurves } from '../web/hero-data.ts';

test('the 99 samples, and the viewers: 4 standard observers, 10 categorical observers and one camera', () => {
  const s = samples();
  assert.equal(s.reflectances.length, 99);
  assert.ok(s.reflectances.every((r) => r.length === 81 && r.every((v) => v >= 0 && v <= 1.2)));
  const vs = viewers();
  assert.deepEqual([vs.filter((v) => v.kind === 'standard').length, vs.filter((v) => v.kind === 'categorical').length], [4, 10]);
  assert.equal(vs.filter((v) => v.kind === 'camera').length, 1);
  assert.equal(vs.length, 15);
});

test('the fit to the CIE 1931 color-matching functions: exact for the CIE 1931 observer, white kept exactly for cones and the camera', () => {
  const m = cmfFit(observers.cie1931);
  m.forEach((row, i) => row.forEach((v, j) => assert.ok(Math.abs(v - (i === j ? 1 : 0)) < 1e-9)));
  const white = whiteOf(observers.cie1931, illuminants.A);
  for (const v of viewers().filter((x) => x.kind !== 'standard')) {
    toXyzFor(v.observer, illuminants.A)(new Array(81).fill(1)).forEach((x, i) => assert.ok(Math.abs(x - white[i]) < 1e-9, v.name));
  }
  const cam = viewers().find((v) => v.kind === 'camera')!;
  // the curves shown for it: through the same matrix, so white under the light is in the CIE 1931 white's proportions
  const curves = xyzCurves(cam, illuminants.A);
  const w = curves.map((c) => c.reduce((s, x, i) => s + x * illuminants.A[i], 0)), k = w[1] / white[1];
  w.forEach((v, i) => assert.ok(Math.abs(v / k - white[i]) < 1e-6, `${i}: ${v / k} against ${white[i]}`));
  assert.deepEqual(xyzCurves(viewers()[0], illuminants.A), observers.cie1931.curves.map((c) => [...c]));
  void responses;
});

test('the reference is where the open circles are, and CIELAB moves more than WLab elsewhere', () => {
  const { reflectances } = samples(), vs = viewers();
  const refV = vs.find((v) => v.name === REFERENCE.viewer)!, ref = place(refV, REFERENCE.light, reflectances);
  const again = place(refV, REFERENCE.light, reflectances, ref);
  assert.ok(again.moveLab < 1e-9 && again.moveWlab < 1e-9);
  const moves = conditionOrder(vs, ['D65', 'A', 'F11', 'LED-B3'], 1).slice(0, 20).map(([i, l]) => place(vs[i], l, reflectances, ref));
  const mean = (k: 'moveLab' | 'moveWlab') => moves.reduce((s, p) => s + p[k], 0) / moves.length;
  assert.ok(mean('moveLab') > mean('moveWlab'), `CIELAB ${mean('moveLab')}, WLab ${mean('moveWlab')}`);
  assert.equal(new Set(conditionOrder(vs, ['D65', 'A'], 5).map(([i, l]) => `${i}${l}`)).size, vs.length * 2);
});

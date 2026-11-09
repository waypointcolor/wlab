// LSWLab (src/wlab.ts) and Lab J's computations (web/labs/scales.ts): large and small color differences.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { illuminants, LS_D0, LS_D1, LS_SCALE, lswlabToWlab, observers, toPolar, wlabToLswlab, wptNormalization, type Vec3 } from '../src/index.ts';
import { differencesOf, munsellPairs, placeAll, stress } from '../web/labs/scales.ts';

test('LSWLab: the thesis formula, scaled; lightness and hue kept; the inverse exact', () => {
  // WLab chroma LS_D0·ln 2 is Wpt-side chroma 80·LS_D1 in the thesis's form
  const wl: Vec3 = [50, LS_D0 * Math.log(2), 0];
  assert.ok(Math.abs(wlabToLswlab(wl, 1)[1] - 80 * LS_D1) < 1e-12);
  assert.ok(Math.abs(wlabToLswlab(wl)[1] - LS_SCALE * 80 * LS_D1) < 1e-12);
  for (const x of [[60, 12, -30], [20, -40, 5], [90, 0.3, 0.2], [50, 0, 0]] as Vec3[]) {
    const ls = wlabToLswlab(x), [l, , h] = toPolar(x), [l2, , h2] = toPolar(ls);
    assert.equal(l2, l);
    if (Math.hypot(x[1], x[2]) > 0) assert.ok(Math.abs(h2 - h) < 1e-9);
    lswlabToWlab(ls).forEach((v, i) => assert.ok(Math.abs(v - x[i]) < 1e-10));
  }
});

test('STRESS: 0 for proportional differences, with their scale', () => {
  const s = stress([2, 4, 6], [1, 2, 3]);
  assert.ok(s.stress < 1e-12);
  assert.ok(Math.abs(s.scale - 2) < 1e-12);
  assert.ok(stress([1, 2, 3], [1, 3, 2]).stress > 10);
});

// The scale 2.2 was chosen so that ΔE_LSWLab reads like ΔE*ab over the corrected Munsell colors (CIE 1931 under C)
test('ΔE_LSWLab against ΔE*ab, the thesis form and the scaled one', () => {
  const chips = placeAll(wptNormalization(observers.cie1931, illuminants.C)), { near, far } = munsellPairs(chips);
  for (const pairs of [near, far]) {
    const d = differencesOf(pairs), s = stress(d.lswlab, d.ab);
    assert.ok(s.scale > 0.95 && s.scale < 1.05, `scale ${s.scale}`);
    const thesis = differencesOf(pairs.map(([a, b]) => [{ ...a, ls: wlabToLswlab(a.wl, 1) }, { ...b, ls: wlabToLswlab(b.wl, 1) }]));
    assert.ok(stress(thesis.lswlab, d.ab).stress > s.stress + 10);
  }
  const d = differencesOf(far);
  assert.ok(stress(d.lswlab, d.ab).stress < 12);
  assert.ok(stress(d.wlab, d.e00).stress < 12);
});

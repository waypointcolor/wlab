// Lab F's computations (web/labs/hue.ts): CIELAB of a WLab color in a condition, the Munsell loci and their hue spread,
// and the object-color solid with its cross-sections.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { illuminants, observers, responses, wptNormalization, xyzToLab } from '../src/index.ts';
import {
  areaOf, crossSection, fromSpace, hueOf, hueSpread, inSpace, labInCondition, MUNSELL_HUES, munsellChips, optimalWpts, sliceWpts,
} from '../web/labs/hue.ts';

test('hue spread: none for one angle, measured across 0°', () => {
  const none = hueSpread([42, 42, 42]);
  assert.ok(none.range < 1e-9 && none.rms < 1e-9);
  const s = hueSpread([350, 10]);
  assert.ok(Math.abs(s.range - 20) < 1e-9 && Math.abs(s.rms - 10) < 1e-9);
  assert.ok(Math.abs(hueOf(0, -1) - 270) < 1e-12);
});

test('the CIELAB of a material\'s WLab in its own condition is its CIELAB there', () => {
  const C = wptNormalization(observers.cie1931, illuminants.C);
  for (const c of munsellChips().filter((_, j) => j % 97 === 0)) {
    const want = xyzToLab(responses(c.reflectance, observers.cie1931, illuminants.C), C.white);
    labInCondition(C.wlabOf(c.reflectance), C).forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9));
    inSpace('cielab', C.wlabOf(c.reflectance), C).forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9));
  }
});

test('from CIELAB and from CAM16-UCS back to WLab, in a condition', () => {
  const F11 = wptNormalization(observers.cie1931, illuminants.F11);
  for (const c of munsellChips().filter((_, j) => j % 131 === 0)) {
    const wl = F11.wlabOf(c.reflectance);
    for (const space of ['cielab', 'cam16'] as const) fromSpace(space, inSpace(space, wl, F11), F11).forEach((v, i) => assert.ok(Math.abs(v - wl[i]) < 1e-8, `${space}`));
  }
});

test('the Munsell chips: the 40 Hues at Values 2 to 9, even Chromas', () => {
  const chips = munsellChips();
  assert.equal(MUNSELL_HUES.length, 40);
  assert.deepEqual([...new Set(chips.map((c) => c.hue))].sort(), [...MUNSELL_HUES].sort());
  assert.deepEqual([...new Set(chips.map((c) => c.value))].sort(), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(chips.every((c) => c.chroma >= 2 && c.chroma % 2 === 0));
});

// Every material lies inside the object-color solid: at its own WLab lightness, each Munsell chip is inside the
// cross-section of its condition's solid.
test('the object-color solid holds every Munsell chip, under C and under F11', () => {
  const inside = (p: [number, number], poly: [number, number][]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (const light of [illuminants.C, illuminants.F11]) {
    const norm = wptNormalization(observers.cie1931, light), slices = sliceWpts(observers.cie1931, light);
    assert.equal(optimalWpts(slices).length, 81 * 80);
    for (const c of munsellChips()) {
      const [lw, a, b] = norm.wlabOf(c.reflectance);
      assert.ok(inside([a, b], crossSection(slices, lw)), `${c.hue} ${c.value}/${c.chroma}`);
    }
    // the cross-sections close around neutral and shrink toward black and white
    const areas = [10, 50, 95].map((l) => areaOf(crossSection(slices, l)));
    assert.ok(areas[1] > areas[0] && areas[1] > areas[2]);
    assert.equal(crossSection(slices, 50).length, 2 * 81 * 8);
  }
});

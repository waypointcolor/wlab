// The color rendering of lights: CCT and Duv (src/cct.ts), CIECAM02 and CAM16 (src/cam02.ts), and the color rendering
// indices of web/labs/rendering.ts (CIE 13.3 Ra, CIE 224 Rf, TM-30 Rf and Rg).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cam02, cam02ucs, cam02ucsToXyz, cam16, cam16ucs, cam16ucsToXyz, cct, daylight, fluorescents, illuminants, planckian, type Vec3,
} from '../src/index.ts';

// colour-science 0.4.7 (XYZ_to_CAM16, with the illuminant discounted where D = 1, and JMh_CAM16_to_CAM16UCS), white
// 95.05, 100, 108.88, average surround (2026-10-29)
test('CAM16 and CAM16-UCS as colour-science computes them, and the way back', () => {
  const white: Vec3 = [95.05, 100, 108.88];
  const cases: [Vec3, number, number, number | undefined, number, number, number, Vec3][] = [
    [[19.01, 20, 21.78], 318.31, 20, undefined, 41.73120790512664, 0.10335573870906986, 217.067959767393, [54.90445024274004, -0.08562124562629803, -0.06467960477996716]],
    [[19.01, 20, 21.78], 100, 20, 1, 41.5794545052853, 0.020158784749587478, 263.57353692876376, [54.74980381940833, -0.002129230708754262, -0.018903697309393497]],
    [[45, 30, 8], 100, 20, 1, 54.450075100263604, 72.78418711965361, 32.73014737311396, [67.02030368732638, 34.77367176296596, 22.350147190193447]],
    [[10, 20, 40], 100, 20, 1, 39.16480608143743, 68.5039148497988, 204.4761000705666, [52.254428440942576, -36.16298724450485, -16.462208572492226]],
    [[60, 70, 20], 64, 18, undefined, 81.80933475885593, 52.14888904615394, 108.87481227499246, [88.4332255946869, -10.400120764074462, 30.419897905079214]],
  ];
  for (const [xyz, la, yb, d, J, C, h, ucs] of cases) {
    const v = { la, yb, d }, r = cam16(xyz, white, v);
    assert.ok(Math.abs(r.j - J) < 1e-6 && Math.abs(r.c - C) < 1e-6 && Math.abs(r.h - h) < 1e-5, `${xyz}: ${r.j} ${r.c} ${r.h}`);
    cam16ucs(xyz, white, v).forEach((x, i) => assert.ok(Math.abs(x - ucs[i]) < 1e-6));
    // back to XYZ, by CAM16-UCS and by CAM02-UCS
    cam16ucsToXyz(cam16ucs(xyz, white, v), white, v).forEach((x, i) => assert.ok(Math.abs(x - xyz[i]) < 1e-8, `CAM16 back: ${x}`));
    cam02ucsToXyz(cam02ucs(xyz, white, v), white, v).forEach((x, i) => assert.ok(Math.abs(x - xyz[i]) < 1e-8, `CAM02 back: ${x}`));
  }
});
import { objectsOf } from '../web/labs/library.ts';
import { cri, fidelity, fidelityReference } from '../web/labs/rendering.ts';

const all: Record<string, readonly number[]> = { ...fluorescents, ...illuminants };

test('CCT and Duv: a Planckian light is on the locus at its own temperature', () => {
  for (const t of [1000, 1850, 2856, 4000, 6500, 12000, 50000]) {
    const r = cct(planckian(t));
    assert.ok(Math.abs(r.cct - t) < 0.01 * Math.max(1, t / 10000), `${t} K: ${r.cct}`);
    assert.ok(Math.abs(r.duv) < 1e-9);
  }
  // daylight lies above the locus (toward green), as CIE daylight does
  assert.ok(cct(daylight(6500)).duv > 0.002);
});

// CIE 015:2018 tabulates the CCT of its LED illuminants to 1 K, and CIE 15 those of the fluorescent illuminants to 10 K
// (F10's 12 K away); A is 2856 K and D65 6504 K.
test('CCT of the CIE illuminants as the CIE tabulates them', () => {
  const led: Record<string, number> = { 'LED-B1': 2733, 'LED-B2': 2998, 'LED-B3': 4103, 'LED-B4': 5109, 'LED-B5': 6598, 'LED-BH1': 2851, 'LED-RGB1': 2840, 'LED-V1': 2724, 'LED-V2': 4070, A: 2856, D65: 6504 };
  for (const [k, t] of Object.entries(led)) assert.ok(Math.abs(cct(all[k]).cct - t) < 1.5, `${k}: ${cct(all[k]).cct}`);
  const fl = [6430, 4230, 3450, 2940, 6350, 4150, 6500, 5000, 4150, 5000, 4000, 3000];
  fl.forEach((t, i) => assert.ok(Math.abs(cct(fluorescents[`F${i + 1}` as keyof typeof fluorescents]).cct - t) < 15, `F${i + 1}`));
});

// The worked example of CIECAM02 (as in colour-science's documentation of its implementation).
test('CIECAM02 gives the worked example, and CAM02-UCS its J′ a′ b′', () => {
  const r = cam02([19.01, 20.0, 21.78], [95.05, 100.0, 108.88], { la: 318.31, yb: 20 });
  assert.ok(Math.abs(r.j - 41.731091132513917) < 1e-9);
  assert.ok(Math.abs(r.c - 0.104707757171031) < 1e-9);
  assert.ok(Math.abs(r.h - 219.04843265831178) < 1e-6);
  assert.ok(Math.abs(r.m - 0.108842175669226) < 1e-9);
  const [j, a, b] = cam02ucs([95.05, 100, 108.88], [95.05, 100, 108.88], { la: 100, yb: 20, d: 1 });
  assert.ok(Math.abs(j - 100 * 1.7 / 1.7) < 1e-6 && Math.hypot(a, b) < 0.5);
});

// CIE 15 tabulates the general color rendering index Ra of the fluorescent illuminants as whole numbers (F8 comes out
// at 95.5 here, against its 95).
test('the color rendering index Ra of F1 to F12 is CIE 15\'s', async () => {
  const tcs = await objectsOf(['cie-tcs14']);
  assert.equal(tcs.reflectances.length, 14);
  const RA = [76, 64, 57, 51, 72, 59, 90, 95, 90, 81, 83, 83];
  RA.forEach((ra, i) => {
    const r = cri(fluorescents[`F${i + 1}` as keyof typeof fluorescents], tcs);
    assert.ok(Math.abs(r.ra - ra) < 0.6, `F${i + 1}: Ra ${r.ra}`);
    assert.equal(r.r.length, 14);
  });
  // a light rendered against itself: every index 100 (A, a tabulated Planckian light, to rounding)
  assert.ok(cri(planckian(3000), tcs).r.every((v) => Math.abs(v - 100) < 1e-6));
  assert.ok(cri(illuminants.A, tcs).r.every((v) => Math.abs(v - 100) < 0.05), cri(illuminants.A, tcs).r.join(' '));
  assert.match(cri(planckian(3000), tcs).reference, /^Planckian 3000 K$/);
  assert.match(cri(illuminants.D65, tcs).reference, /^daylight 6504 K$/);
});

test('CIE 224 and TM-30: 100 for a light against itself, lower for fluorescent lights, 16 full hue bins', async () => {
  const ces = await objectsOf(['cie-ces99']);
  for (const l of [planckian(3000), daylight(6500)]) {
    const f = fidelity(l, ces);
    assert.ok(Math.abs(f.rf - 100) < 0.01, `Rf ${f.rf}`);
    assert.ok(Math.abs(f.rg - 100) < 0.01, `Rg ${f.rg}`);
  }
  // between 4000 and 5000 K the reference mixes Planckian and daylight (CIE 224, TM-30-18), so a Planckian light there
  // is not its own reference
  assert.match(fidelityReference(4500).name, /mix/);
  assert.ok(fidelity(planckian(4500), ces).rf < 99.9);
  assert.match(fidelityReference(3900).name, /^Planckian/);
  assert.match(fidelityReference(5100).name, /^daylight/);
  const f2 = fidelity(fluorescents.F2, ces);
  assert.equal(f2.bins.length, 16);
  assert.ok(f2.bins.every((b) => b.count > 0));
  assert.equal(f2.bins.reduce((s, b) => s + b.count, 0), 99);
});

// colour-science 0.4.7 (colour_fidelity_index_CIE2017 and colour_fidelity_index_ANSIIESTM3018) on the same spectra
// (2026-10-28): Rf and Rg to 0.002 for all of F1 to F12 and the CIE LEDs, its 16 bins' chroma and hue shifts to 0.0001;
// here a few, from both sides of the 4000 to 5000 K mix, with its values as it printed them (two decimals).
test('Rf and Rg as colour-science computes them', async () => {
  const ces = await objectsOf(['cie-ces99']);
  const all: Record<string, readonly number[]> = { ...fluorescents, ...illuminants };
  const want: [string, number, number][] = [['F2', 70.12, 86.42], ['F4', 56.70, 83.49], ['F8', 95.46, 101.67], ['F10', 79.50, 99.33],
    ['F11', 80.04, 101.06], ['LED-B4', 76.91, 95.51], ['LED-RGB1', 71.00, 107.01], ['LED-V1', 87.34, 101.93]];
  for (const [k, rf, rg] of want) {
    const f = fidelity(all[k], ces);
    assert.ok(Math.abs(f.rf - rf) < 0.01, `${k}: Rf ${f.rf}, colour-science ${rf}`);
    assert.ok(Math.abs(f.rg - rg) < 0.01, `${k}: Rg ${f.rg}, colour-science ${rg}`);
  }
});

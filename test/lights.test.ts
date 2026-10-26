// Lights computed for any temperature, and the steps of a Wpt normalization.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  categoricalObserver, cie2006, cie2006Tables, daylight, illuminants, mulMM, mulMV, observers, planckian, wptNormalization,
  type Cie2006Tables, type Mat3,
} from '../src/index.ts';

const maxRel = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]) / Math.max(1, Math.abs(b[i]))));

test('daylight at 5000 K is the package D50', () => {
  assert.ok(maxRel(daylight(5000), illuminants.D50) < 1e-9);
  assert.ok(Math.abs(daylight(6500)[36] - 100) < 0.5, 'about 100 at 560 nm');
  assert.throws(() => daylight(3000), RangeError);
});

test('a Planckian radiator at the temperature of illuminant A is illuminant A', () => {
  // CIE illuminant A is defined with c2 = 1.435e-2 m K at 2848 K (about 2856 K with today's c2); with c2 = 1.4388e-2
  // the same curve is at 2848 * 1.4388 / 1.435 K
  assert.ok(maxRel(planckian((2848 * 1.4388) / 1.435), illuminants.A) < 1e-4);
  assert.equal(Math.round(planckian(3000)[36] * 1e9) / 1e9, 100);
});

test('the four steps rebuild the normalization matrix', () => {
  for (const [o, l] of [['cie1931', 'D65'], ['cie2015_10', 'A'], ['cie1964', 'F11']] as const) {
    const n = wptNormalization(o, l);
    const { rotation, scale, level, fit } = n.steps;
    let am = rotation.map((r) => [...r]) as Mat3;
    am[0] = am[0].map((v) => v * scale) as Mat3[0];
    am = mulMM([[1, -level[0], -level[1]], [0, 1, 0], [0, 0, 1]], am);
    const rebuilt = [am[0], ...[0, 1].map((k) => [0, 1, 2].map((c) => fit[k][0] * am[1][c] + fit[k][1] * am[2][c]))];
    assert.ok(maxRel(rebuilt.flat(), n.toWpt.flat()) < 1e-12, `${o}/${l}`);
    assert.ok(Math.abs(mulMV(n.toWpt, n.white)[0] - 100) < 1e-9);
  }
});

// The tables of the CIE 2006 model are built in. The Wpt toolbox's own copies, in the build repository of the companion
// package (toolbox/cie2006, next to this repository), check them when present.
const TOOLBOX_TABLES = await (async () => {
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../../wpt-onramp-build/toolbox/cie2006/', import.meta.url);
  const read = (f: string) => readFileSync(new URL(f, dir), 'utf8').trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number));
  try {
    const m = read('RelativeMacularDensity.txt'), a = read('Alms.txt'), d = read('docul.txt');
    return { macular: m.map((r) => r[0]), absorbance: [0, 1, 2].map((k) => a.map((r) => r[k])), ocular: [0, 1].map((k) => d.map((r) => r[k])) } as unknown as Cie2006Tables;
  } catch {
    return undefined;
  }
})();

test("the built-in CIE 2006 tables are the Wpt toolbox's", { skip: TOOLBOX_TABLES ? false : 'needs wpt-onramp-build/toolbox/cie2006' }, () => {
  close2([cie2006Tables.macular], [TOOLBOX_TABLES!.macular as number[]], 1e-15, 'macular');
  close2(cie2006Tables.absorbance, TOOLBOX_TABLES!.absorbance as unknown as number[][], 1e-15, 'absorbance');
  close2(cie2006Tables.ocular, TOOLBOX_TABLES!.ocular as unknown as number[][], 1e-12, 'ocular');
});

test("the built-in CIE 2006 observers (2° and 10°) are the CIE's published functions", () => {
  close2(observers.cie2006_2.curves, V2.cieLms['2'], 1e-15, 'CIE 2006 2°');
  close2(observers.cie2006_10.curves, V2.cieLms['10'], 1e-15, 'CIE 2006 10°');
});

test("the CIE 2006 model at 32 years has the shape of the CIE's functions (from 400 nm; 390 and 395 nm differ)", () => {
  for (const fs of [2, 10] as const) {
    const model = cie2006(fs, 32).curves, cie = fs === 2 ? observers.cie2006_2.curves : observers.cie2006_10.curves;
    model.forEach((m, c) => {
      // the toolbox scales each curve to a peak of 1 at its 5 nm samples, the CIE at a finer step: fit the scale
      const k = m.reduce((s, v, i) => s + v * cie[c][i], 0) / m.reduce((s, v) => s + v * v, 0);
      for (let i = 4; i < 81; i++) assert.ok(Math.abs(k * m[i] - cie[c][i]) < 2e-3, `${fs}° ${'LMS'[c]} at ${380 + 5 * i} nm`);
    });
  }
});

test('CIE 2006 cone fundamentals for any field size and age match the Wpt toolbox (Octave)', () => {
  for (const [key, expected] of Object.entries(V2.cie2006) as [string, number[][]][]) {
    const [fs, age] = key.split('/').map(Number);
    const o = cie2006(fs, age);
    close2(o.curves, expected, 1e-12, key);
    o.curves.forEach((c) => assert.ok(Math.abs(Math.max(...c) - 1) < 1e-12, 'peak 1'));
  }
  assert.throws(() => cie2006(12, 32), RangeError);
  assert.throws(() => cie2006(2, 90), RangeError);
  assert.throws(() => cie2006(2, 32, { ...cie2006Tables, macular: [1, 2] }), /79 values/);
});

test("the 10 categorical observers at any field size match the individual observer toolbox (Octave), and at 2° Asano's published ten", () => {
  let n = 0;
  for (const [key, expected] of Object.entries(V2.categorical) as [string, number[][]][]) {
    const [fs, cat] = key.split('/').map(Number);
    const o = categoricalObserver(cat, fs);
    o.curves.forEach((c) => assert.deepEqual([c[0], c[1]], [0, 0]));
    close2(o.curves.map((c) => c.slice(2)), expected, 1e-9, key);
    n++;
  }
  assert.equal(n, 30);
  assert.throws(() => categoricalObserver(11), RangeError);
});

const V2 = JSON.parse((await import('node:fs')).readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
function close2(actual: readonly (readonly number[])[], expected: readonly number[][], tol: number, what: string): void {
  actual.forEach((c, k) => assert.ok(maxRel(c, expected[k]) < tol, `${what} ${'LMS'[k]}: ${maxRel(c, expected[k])}`));
}

test('Wpt normalization for more than three sensors: a 3 × N matrix, equal to a second way of computing it', async () => {
  const { wptNormalizationN, wptNormalization, observers, illuminants, munsellBase } = await import('../src/index.ts');
  const V3 = JSON.parse((await import('node:fs')).readFileSync(new URL('./vectors.json', import.meta.url), 'utf8')).nSensors;
  const c = observers.cie1931.curves;
  const four = { name: 'four', curves: [...c, V3.s4] }, five = { name: 'five', curves: [...c, V3.s4, V3.s5] };
  for (const [o, l, key] of [[four, 'D65', 'four/D65'], [four, 'A', 'four/A'], [five, 'F11', 'five/F11']] as const) {
    const n = wptNormalizationN(o, l);
    assert.equal(n.toWpt.length, 3);
    assert.equal(n.toWpt[0].length, o.curves.length);
    assert.ok(maxRel(n.toWpt.flat(), V3[key].flat()) < 1e-9, key);
    const w = n.toWpt.map((r) => r.reduce((s, v, i) => s + v * n.white[i], 0));
    assert.ok(Math.abs(w[0] - 100) < 1e-9 && Math.abs(w[1]) < 1e-9 && Math.abs(w[2]) < 1e-9, 'white is (100, 0, 0)');
    assert.equal(n.wlabOf(new Array(81).fill(1))[0], n.wlabOf(new Array(81).fill(1))[0]);
  }
  // three sensors: the general computation is the 3 × 3 one
  assert.ok(maxRel(wptNormalizationN('cie1931', 'D65').toWpt.flat(), wptNormalization('cie1931', 'D65').toWpt.flat()) < 1e-12);
  assert.ok(maxRel(wptNormalization('cie1931', 'D65').toWpt.flat(), V3['three/D65'].flat()) < 1e-9);
  assert.throws(() => wptNormalization(four, 'D65'), /three sensors/);
  void illuminants; void munsellBase;
});

test("the built-in cones-plus-rods observer (CIE 2006 10° and V'(λ)): four sensors, equal to a second way of computing it", async () => {
  const { observersN, wptNormalizationN, scotopic } = await import('../src/index.ts');
  const V4 = JSON.parse((await import('node:fs')).readFileSync(new URL('./vectors.json', import.meta.url), 'utf8')).nSensors;
  const o = observersN.cie2006_10_rods;
  assert.equal(o.curves.length, 4);
  assert.ok(Math.max(...scotopic) > 0.99, 'peak near 1 (506 nm is between the 5 nm samples)');
  for (const l of ['D65', 'LED-B3'] as const) {
    assert.ok(maxRel(wptNormalizationN(o, l).toWpt.flat(), V4[`rods/${l}`].flat()) < 1e-9, l);
  }
});

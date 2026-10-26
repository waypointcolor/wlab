// Every result is checked against values computed by the Python implementation (wpt-onramp), written to
// vectors.json by wpt-onramp-build/python/export_wlab_ts.py.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  cat, deltaE00, deltaEWlab, illuminants, labToXyz, mat, munsellBase, mulMM, mulMV, observers, resample, responses,
  wavelengths, whiteOf, wlabToWpt, wptNormalization, wptToWlab, xyzToLab,
  type Mat3, type ObserverName, type IlluminantName, type Vec3,
} from '../src/index.ts';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

function close(actual: number[], expected: number[], tol: number, what: string): void {
  assert.equal(actual.length, expected.length, what);
  actual.forEach((a, i) => {
    const e = expected[i];
    assert.ok(Math.abs(a - e) <= tol * Math.max(1, Math.abs(e)), `${what}[${i}]: ${a} against ${e}`);
  });
}
const flat = (m: Mat3 | number[][]): number[] => m.flat();

test('the grid and the data', () => {
  assert.equal(wavelengths.length, 81);
  assert.equal(wavelengths[0], 380);
  assert.equal(wavelengths[80], 780);
  assert.equal(munsellBase.reflectances.length, 40);
});

test('Wpt matrices and whites for every observer and light match Python', () => {
  assert.equal(Object.keys(V.matrices).length, Object.keys(observers).length * Object.keys(illuminants).length);
  for (const [key, m] of Object.entries(V.matrices) as [string, number[][]][]) {
    const [o, ill] = key.split('/') as [ObserverName, IlluminantName];
    const n = wptNormalization(o, ill);
    close(flat(n.toWpt), flat(m), 1e-9, `matrix ${key}`);
    close(n.white, V.whites[key], 1e-12, `white ${key}`);
    close(mulMV(n.toWpt, n.white), [100, 0, 0], 1e-9, `white in Wpt ${key}`);
  }
});

test('Wpt and WLab of 200 Munsell samples (CIE 1931, D65 and A) match Python', () => {
  const S = V.samples;
  const d65 = wptNormalization('cie1931', 'D65'), a = wptNormalization('cie1931', 'A');
  S.reflectances.forEach((r: number[], j: number) => {
    close(responses(r, observers.cie1931, illuminants.D65), S.xyzD65[j], 1e-11, `xyz ${j}`);
    close(d65.wptOf(r), S.wptD65[j], 1e-9, `wpt ${j}`);
    close(d65.wlabOf(r), S.wlabD65[j], 1e-9, `wlab D65 ${j}`);
    close(a.wlabOf(r), S.wlabA[j], 1e-9, `wlab A ${j}`);
    const labD = xyzToLab(S.xyzD65[j], d65.white);
    close(labD, S.labD65[j], 1e-11, `lab ${j}`);
    close(labToXyz(labD, d65.white), S.xyzD65[j], 1e-11, `lab back ${j}`);
    close([deltaE00(S.labD65[j], S.labA[j])], [S.deltaE00_D65_A[j]], 1e-10, `dE00 ${j}`);
    close([deltaEWlab(S.wlabD65[j], S.wlabA[j])], [S.deltaEWlab_D65_A[j]], 1e-10, `dEWLab ${j}`);
  });
});

test('WLab converts back to Wpt exactly', () => {
  for (const w of V.samples.wptD65 as Vec3[]) close(wlabToWpt(wptToWlab(w)), w, 1e-11, 'round trip');
});

test('MATs and CATs match Python', () => {
  const nA = wptNormalization('cie1931', 'A'), nD = wptNormalization('cie1931', 'D65');
  close(flat(mat(nA, nD)), flat(V.mat['cie1931/A->cie1931/D65']), 1e-9, 'MAT A to D65');
  close(flat(mat(wptNormalization('cie2015', 'D65'), nD)), flat(V.mat['cie2015/D65->cie1931/D65']), 1e-9, 'MAT 2015 to 1931');
  close(flat(mat(wptNormalization('cie2015_10', 'D65'), nD)), flat(V.mat['cie2015_10/D65->cie1931/D65']), 1e-9, 'MAT 2015 10° to 1931');
  close(mulMV(mat(nA, nD), nA.white), nD.white, 1e-9, 'MAT maps white exactly');
  for (const m of ['bradford', 'cat02', 'xyz'] as const) close(flat(cat(nA.white, nD.white, m)), flat(V.cat[m]), 1e-10, `CAT ${m}`);
});

test('resampling holds the ends and interpolates linearly', () => {
  close([...resample(V.resample.nm, V.resample.values)], V.resample.expected, 1e-12, 'resample');
});

test('sanity checks from the guide', () => {
  const d65 = wptNormalization('cie1931', 'D65');
  const gray = new Array(81).fill(0.5);
  close(d65.wlabOf(gray), V.sanity.gray50WlabD65, 1e-9, '50% gray');
  close([d65.wlabOf(gray)[0]], [76.07], 0.005 / 76.07, '50% gray is WLab 76.1');
  const pb = munsellBase.reflectances[munsellBase.names.indexOf('5PB 5/6')];
  close(d65.wptOf(pb), V.sanity['5PB 5/6 wptD65'], 1e-9, '5PB 5/6 Wpt');
  close(d65.wlabOf(pb), V.sanity['5PB 5/6 wlabD65'], 1e-9, '5PB 5/6 WLab');
  close(whiteOf(observers.cie1931, illuminants.D65), V.whites['cie1931/D65'], 1e-12, 'white D65');
});

test('the 1,600 Munsell colors decode to the toolbox values (to 1/32000), and the test set leaves out the 40 base colors', async () => {
  const { munsell1600 } = await import('../src/index.ts');
  const all = munsell1600();
  assert.equal(all.names.length, 1600);
  V.samples.reflectances.forEach((r: number[], k: number) => close(all.reflectances[k * 8], r, 1 / 64000 + 1e-12, `Munsell ${k * 8}`));
  const test = munsell1600(true);
  assert.equal(test.names.length, 1560);
  for (const n of munsellBase.names) assert.ok(!test.names.includes(n), n);
  const i = all.names.indexOf('5PB 5/6');
  close(all.reflectances[i], munsellBase.reflectances[munsellBase.names.indexOf('5PB 5/6')], 1 / 64000 + 1e-12, '5PB 5/6');
});

test('the CIE LED illuminants give the Wpt matrices of the wpt-wlab-guide, computed by its own tools', () => {
  // the wpt-wlab-guide fits to the reference of the 2015 Wpt paper: p2015 = 1.01125 p, t2015 = t - 0.01331 p (Technical
  // annex A.4), so its matrices are R A, to the rounding of those two constants
  const R: Mat3 = [[1, 0, 0], [0, 1.01125, 0], [0, -0.01331, 1]];
  assert.equal(Object.keys(V.guideMatrices).length, 8);
  for (const [key, m] of Object.entries(V.guideMatrices) as [string, number[][]][]) {
    const [o, ill] = key.split('/') as [ObserverName, IlluminantName];
    const ours = mulMM(R, wptNormalization(o, ill).toWpt).flat(), scale = Math.max(...m.flat().map(Math.abs));
    ours.forEach((x, i) => assert.ok(Math.abs(x - m.flat()[i]) < 5e-6 * scale, `guide matrix ${key}[${i}]`));
  }
});

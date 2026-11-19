// Lab I's displays and profiles (web/labs/display.ts), checked with iccDEV's own tools: the WebAssembly build the page
// runs (vendor/iccdev), loaded here in Node.js. The page's numbers and iccDEV's must agree.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { categoricalObserver, deltaEWlab, observers, xyzToLab, type Vec3 } from '../src/index.ts';
import {
  curveAt, displayFromSpectra, displayFromXml, displayProfileXml, observerProfileXml, pcsXyzOf, readMatrixTrc, viewOn,
  whiteOf, type Display,
} from '../web/labs/display.ts';
import { BUILT_IN_DISPLAYS } from '../web/labs/displays-builtin.ts';
import { convertObserver, STANDARD } from '../web/labs/encoding.ts';
import { encodingProfileIcc } from '../web/labs/iccbinary.ts';
import { run } from '../web/labs/iccdev.ts';
import { nodeLoader } from './iccdev-node.ts';

const close = (a: readonly number[], b: readonly number[], tol: number, what = '') =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${what} ${v} and ${b[i]} differ by more than ${tol}`));
const [lcd, laser] = BUILT_IN_DISPLAYS;
const build = async (xml: string) => {
  const r = await run(nodeLoader, 'iccFromXml', ['p.xml', 'p.icc'], { 'p.xml': xml }, ['p.icc']);
  assert.equal(r.code, 0, r.output);
  return r.files['p.icc']!;
};
const D50: Vec3 = [0.9642, 1, 0.8249];
const rows = (out: string) => out.split('\n').filter((l) => l.includes(';') && !l.startsWith(';') && /^\s*-?\d/.test(l))
  .map((l) => l.split(';')[0].trim().split(/\s+/).map(Number));
const data = (rgbs: number[][]) => `'RGB '\t; Data Format\nicEncodeFloat\t; Encoding\n\n${rgbs.map((r) => r.join(' ')).join('\n')}\n`;

test('the built-in displays: an LCD every nanometre, and the Rec. 2020 laser display as three single lines', () => {
  assert.equal(BUILT_IN_DISPLAYS.length, 2);
  for (const d of BUILT_IN_DISPLAYS) {
    assert.deepEqual([d.nm[0], d.nm[d.nm.length - 1], d.nm.length], [380, 780, 401]);
    assert.ok(Math.abs(Math.max(...whiteOf(d)) - 1) < 1e-6);
    assert.equal(d.curves[0].length, 1024);
  }
  const peaks = laser.primaries.map((p) => d0(p));
  function d0(p: number[]) { return laser.nm[p.indexOf(Math.max(...p))]; }
  assert.deepEqual(peaks, [630, 532, 467]);
  assert.ok(laser.primaries.every((p) => p.filter((v) => v > 0).length === 1));
  // the Rec. 2020 tone curve: V / 4.5 below the break, ((V + 0.0993) / 1.0993)^(1/0.45) above
  close([laser.curves[0][50], laser.curves[0][700]], [(50 / 1023) / 4.5, ((700 / 1023 + 0.0992968) / 1.0992968) ** (1 / 0.45)], 2e-5);
});

test('a display written as a version 5 profile reads back the same, and iccFromXml builds it', async () => {
  for (const d of BUILT_IN_DISPLAYS) {
    const xml = displayProfileXml(d);
    const back = displayFromXml(xml);
    d.primaries.forEach((p, k) => close(back.primaries[k], p, 1e-8, `${d.name} primary ${k}`));
    d.curves.forEach((c, k) => close(back.curves[k], c, 1e-8, `${d.name} curve ${k}`));
    const icc = await build(xml);
    assert.equal(String.fromCharCode(...icc.slice(12, 16)), 'mntr');
    assert.equal(icc[8], 5);
  }
});

test('iccV5DspObsToV4Dsp gives the colorants the page computes, white D50, for any observer', async () => {
  for (const d of BUILT_IN_DISPLAYS) {
    const dsp = await build(displayProfileXml(d));
    for (const o of [observers.cie1931, observers.cie1964, categoricalObserver(3)]) {
      const v = viewOn(d, o);
      const obs = await build(observerProfileXml(d, v, o.name));
      const r = await run(nodeLoader, 'iccV5DspObsToV4Dsp', ['d.icc', 'o.icc', 'v4.icc'], { 'd.icc': dsp, 'o.icc': obs }, ['v4.icc']);
      assert.equal(r.code, 0, r.output);
      const m = readMatrixTrc(r.files['v4.icc']!);
      assert.equal(m.version, '4.3');
      // s15Fixed16 holds 1/65536
      close(m.red, pcsXyzOf(d, v, [1, 0, 0]), 4e-5, `${d.name}, ${o.name}, red`);
      close(m.green, pcsXyzOf(d, v, [0, 1, 0]), 4e-5, `${d.name}, ${o.name}, green`);
      close(m.blue, pcsXyzOf(d, v, [0, 0, 1]), 4e-5, `${d.name}, ${o.name}, blue`);
      // white: the MAT's, wlab's CIE 1931 white under D50 (the ICC's PCS illuminant rounds it to 0.9642, 1, 0.8249)
      close(m.white, [0.96425, 1, 0.82468], 3e-5, `${d.name}, ${o.name}, white`);
      // the TRC: the display's tone curve
      assert.equal(m.trc[1].length, 2048);
      close([0, 512, 1024, 1800].map((i) => m.trc[1][i]), [0, 512, 1024, 1800].map((i) => curveAt(d.curves[1], i / 2047)), 2e-5, 'trc');
    }
  }
});

test('on the laser display every observer gives the same Wpt; on the LCD they part', () => {
  const rgb = [0.2, 0.6, 0.3];
  const a = pcsXyzOf(laser, viewOn(laser, observers.cie1931), rgb), b = pcsXyzOf(laser, viewOn(laser, categoricalObserver(10)), rgb);
  close(a, b, 1e-9, 'laser');
  const c = pcsXyzOf(lcd, viewOn(lcd, observers.cie1931), rgb), e = pcsXyzOf(lcd, viewOn(lcd, categoricalObserver(10)), rgb);
  assert.ok(Math.max(...c.map((v, i) => Math.abs(v - e[i]))) > 1e-3);
});

test('iccApplyNamedCmm with an observer profile as connection conditions gives the page\'s CIELAB, and the round trip holds', async () => {
  const lab = encodingProfileIcc(convertObserver(STANDARD.observer, STANDARD.observer, STANDARD.light), STANDARD.light,
    { encoding: 'Lab', numbers: 'float', description: 'CIELAB (D50)', luminance: 160 });
  const rgbs = [[1, 1, 1], [1, 0, 0], [0.5, 0.5, 0.5], [0.2, 0.6, 0.3], [0.02, 0.01, 0.03]];
  for (const d of BUILT_IN_DISPLAYS) {
    const dsp = await build(displayProfileXml(d));
    const v = viewOn(d, observers.cie1964);
    const obs = await build(observerProfileXml(d, v, 'CIE 1964'));
    const a = await run(nodeLoader, 'iccApplyNamedCmm', ['in.txt', '3', '0', 'd.icc', '1', '-pcc', 'o.icc', 'lab.icc', '1'],
      { 'in.txt': data(rgbs), 'd.icc': dsp, 'o.icc': obs, 'lab.icc': lab });
    assert.equal(a.code, 0, a.output);
    rows(a.output).forEach((got, i) => close(got, xyzToLab(pcsXyzOf(d, v, rgbs[i]), D50), 0.03, `${d.name} ${rgbs[i]}`));
    const back = await run(nodeLoader, 'iccApplyNamedCmm', ['in.txt', '3', '0', 'd.icc', '1', '-pcc', 'o.icc', 'd.icc', '1', '-pcc', 'o.icc'],
      { 'in.txt': data(rgbs), 'd.icc': dsp, 'o.icc': obs });
    assert.equal(back.code, 0, back.output);
    rows(back.output).forEach((got, i) => close(got, rgbs[i], 2e-4, `${d.name} round trip ${rgbs[i]}`));
  }
});

test('a color matched on a second display through the standard PCS: the same WLab for the CIE 1931 observer, or out of reach (not clipped)', async () => {
  const lab = encodingProfileIcc(convertObserver(STANDARD.observer, STANDARD.observer, STANDARD.light), STANDARD.light,
    { encoding: 'Lab', numbers: 'float', description: 'CIELAB (D50)', luminance: 160 });
  const va = viewOn(lcd, observers.cie1931), vb = viewOn(laser, observers.cie1931);
  const [da, db, oa, ob] = [await build(displayProfileXml(lcd)), await build(displayProfileXml(laser)), await build(observerProfileXml(lcd, va, 'a')), await build(observerProfileXml(laser, vb, 'b'))];
  const rgbs = [[1, 1, 1], [0.5, 0.5, 0.5], [0.5, 1, 0.5], [0, 0, 1], [1, 0, 0]];
  const toLab = await run(nodeLoader, 'iccApplyNamedCmm', ['in.txt', '3', '0', 'a.icc', '1', '-pcc', 'oa.icc', 'lab.icc', '1'], { 'in.txt': data(rgbs), 'a.icc': da, 'oa.icc': oa, 'lab.icc': lab });
  const labs = rows(toLab.output);
  const r = await run(nodeLoader, 'iccApplyNamedCmm', ['in.txt', '3', '0', 'lab.icc', '1', 'b.icc', '1', '-pcc', 'ob.icc'],
    { 'in.txt': `'Lab '\t; Data Format\nicEncodeFloat\t; Encoding\n\n${labs.map((x) => x.map((v) => v.toFixed(6)).join(' ')).join('\n')}\n`, 'lab.icc': lab, 'b.icc': db, 'ob.icc': ob });
  const matched = rows(r.output);
  close(matched[0], [1, 1, 1], 2e-4, 'white to white');
  for (let i = 0; i < 4; i++) assert.ok(deltaEWlab(va.wlabOf(rgbs[i]), vb.wlabOf(matched[i])) < 0.02, `${rgbs[i]}`);
  // the LCD's red, with the LCD's white as white, lies beyond the laser display's reach: below 0 in green and blue
  assert.ok(matched[4][1] < -0.01 && matched[4][2] < -0.01, `${matched[4]}`);
});

test('a display from pasted spectra: an uneven grid goes to 1 nm, white peaks at 1, and iccFromXml builds it', async () => {
  const nm = [380, 400, 450, 451, 452, 500, 540, 541, 600, 610, 611, 700, 780];
  const line = (at: number) => nm.map((x) => (x === at ? 1 : 0));
  const d: Display = displayFromSpectra('Three lines', nm, [line(610), line(540), line(451)], undefined, { kind: 'srgb' });
  assert.equal(d.nm.length, 401);
  assert.ok(Math.abs(Math.max(...whiteOf(d)) - 1) < 1e-12);
  const icc = await build(displayProfileXml(d));
  assert.ok(icc.length > 1000);
});

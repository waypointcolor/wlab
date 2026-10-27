// Lab C's computations (web/labs/shifts.ts): materials across observing conditions, their shifts from a reference
// condition, and pairs compared condition by condition.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  categoricalObserver, deltaEWlab, illuminants, munsell1600, observers, observersN, sensorResponses, wptNormalizationN,
} from '../src/index.ts';
import { responder } from '../src/spectra.ts';
import {
  adjust, cloudsOf, copyEntry, grayMetamers, graysWithBlack, materialsOf, metamericBlack, NormalizationCache, pairIndices, pairsOf, readMaterials, summary, syncEntries, writeMaterials, type ObservingCondition,
} from '../web/labs/shifts.ts';

const close = (a: readonly number[], b: readonly number[], tol: number) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${v} and ${b[i]} differ by more than ${tol}`));

const { names, reflectances } = munsell1600(false);
const material = (name: string) => ({ name, reflectance: reflectances[names.indexOf(name)] });
const cond = (obs: keyof typeof observers, light: keyof typeof illuminants): ObservingCondition =>
  ({ key: `${obs}|${light}`, observerLabel: obs, lightLabel: light, observer: observers[obs], light: illuminants[light] });

test('the responses with the light weighted in once are the responses', () => {
  const respond = responder(observers.cie1964, illuminants.F11);
  for (const r of reflectances.slice(0, 50)) close(respond(r), sensorResponses(r, observers.cie1964, illuminants.F11), 1e-12);
});

test('the reference condition itself gives no shift; every condition gives the WLab of its own normalization', () => {
  const ref = wptNormalizationN('cie1931', 'C');
  const conds = [cond('cie1931', 'C'), cond('cie1964', 'A'), cond('cie2015', 'F11')];
  const cache = new NormalizationCache();
  const [cloud] = cloudsOf([material('5R 5/6')], conds.map((c) => cache.get(c)), ref);
  close(cloud.points[0].dWpt, [0, 0, 0], 1e-12);
  assert.equal(cloud.points[0].dE, 0);
  close(cloud.points[1].wlab, wptNormalizationN('cie1964', 'A').wlabOf(material('5R 5/6').reflectance), 1e-12);
  assert.ok(cloud.points[2].dE > 0);
});

test('a normalization is built once per condition', () => {
  const cache = new NormalizationCache();
  const a = cache.get(cond('cie1931', 'D65')), b = cache.get(cond('cie1931', 'D65'));
  assert.equal(a, b);
  assert.equal(cache.size, 1);
});

test('scaling a reflectance scales its Wpt shifts; shifting it leaves them as they are', () => {
  // white is W = 100, p = t = 0 in every condition, so adding a constant to a reflectance adds the same Wpt everywhere
  const ref = wptNormalizationN('cie1931', 'C');
  const conds = [cond('cie1964', 'A'), cond('cie1931', 'F11'), cond('cie2015_10', 'LED-B3')];
  const cache = new NormalizationCache();
  const norms = conds.map((c) => cache.get(c));
  const m = material('5PB 4/8');
  const [base, scaled, shifted] = cloudsOf([m, { name: 'scaled', reflectance: adjust(m.reflectance, 0.7, 0) },
    { name: 'shifted', reflectance: adjust(m.reflectance, 1, 0.05) }], norms, ref);
  base.points.forEach((p, k) => {
    close(scaled.points[k].dWpt, p.dWpt.map((v) => 0.7 * v), 1e-9);
    close(shifted.points[k].dWpt, p.dWpt, 1e-9);
  });
});

test('pairs: ΔE_WLab between the two materials in each condition', () => {
  const ref = wptNormalizationN('cie1931', 'C');
  const conds = [cond('cie1931', 'D65'), cond('cie1964', 'A')];
  const cache = new NormalizationCache();
  const ms = [material('5R 5/6'), material('7.5R 5/6'), material('5R 6/6')];
  const clouds = cloudsOf(ms, conds.map((c) => cache.get(c)), ref);
  const [p] = pairsOf(clouds, [[0, 1]]);
  const n = wptNormalizationN('cie1964', 'A');
  assert.equal(p.dE[1], deltaEWlab(n.wlabOf(ms[0].reflectance), n.wlabOf(ms[1].reflectance)));
  assert.equal(p.refDE, deltaEWlab(ref.wlabOf(ms[0].reflectance), ref.wlabOf(ms[1].reflectance)));
  assert.deepEqual(pairIndices(4, 'first'), [[0, 1], [0, 2], [0, 3]]);
  assert.deepEqual(pairIndices(5, 'consecutive'), [[0, 1], [2, 3]]);
  assert.deepEqual(pairIndices(5, 'halves'), [[0, 2], [1, 3]]);
  assert.deepEqual(pairIndices(3, 'all'), [[0, 1], [0, 2], [1, 2]]);
});

test('N sensors and model observers give clouds too', () => {
  const ref = wptNormalizationN('cie1931', 'C');
  const c: ObservingCondition = { key: 'rods|A', observerLabel: 'rods', lightLabel: 'A', observer: observersN.cie2006_10_rods, light: illuminants.A };
  const [cloud] = cloudsOf([material('5G 5/6')], [new NormalizationCache().get(c)], ref);
  assert.ok(Number.isFinite(cloud.points[0].dE));
  const cat: ObservingCondition = { key: 'cat3|D65', observerLabel: 'c3', lightLabel: 'D65', observer: categoricalObserver(3, 2), light: illuminants.D65 };
  assert.ok(Number.isFinite(cloudsOf([material('5G 5/6')], [new NormalizationCache().get(cat)], ref)[0].points[0].dE));
});

test('materials from a table: names from the header, percent read as such, any grid resampled', () => {
  const ms = readMaterials('nm,Red,Blue\n400,10,60\n550,12,30\n700,70,8');
  assert.deepEqual(ms.map((m) => m.name), ['Red', 'Blue']);
  assert.equal(ms[0].reflectance.length, 81);
  assert.equal(ms[0].reflectance[0], 0.1);                                  // held constant below 400 nm
  close([ms[1].reflectance[34]], [0.3], 1e-12);                              // 550 nm
  assert.equal(readMaterials('400,0.1\n700,0.5')[0].name, 'Column 1');
  assert.throws(() => readMaterials('500,0.1\n600,0.2'), /cover at least 420 to 680 nm/);
});

test('summary: mean, median, smallest and largest, and where; a shifted reflectance never goes below 0', () => {
  const s = summary([3, 1, 4, 1.5]);
  assert.equal(s.mean, 2.375);
  assert.equal(s.median, 2.25);
  assert.equal(s.argmax, 2);
  assert.equal(s.argmin, 1);
  close(adjust([0.2, 0.5], 1, -0.3), [0, 0.2], 1e-15);
});

test('materials in use: each given reflectance, and copies of them scaled and shifted on their own', () => {
  let entries = syncEntries([], 2);
  assert.deepEqual(entries.map((e) => [e.source, e.copy]), [[0, false], [1, false]]);
  entries = copyEntry(entries, 0);                                            // a copy of the first, after it
  entries = copyEntry(entries, 0);
  entries[1] = { ...entries[1], scale: 0.5 };
  entries[2] = { ...entries[2], scale: 0.5, shift: 0.25 };
  assert.deepEqual(entries.map((e) => [e.source, e.copy]), [[0, false], [0, true], [0, true], [1, false]]);
  const base = [material('5PB 4/8'), material('5R 5/6')];
  const ms = materialsOf(base, entries);
  assert.deepEqual(ms.map((m) => m.name), ['5PB 4/8', '5PB 4/8 #2 × 0.50', '5PB 4/8 #3 × 0.50 + 0.25', '5R 5/6']);
  close(ms[2].reflectance, base[0].reflectance.map((v) => 0.5 * v + 0.25), 1e-15);
  assert.equal(ms[0].reflectance, base[0].reflectance);                     // unchanged, not copied
  // fewer reflectances given: the entries of the others go; adjustments stay
  const kept = syncEntries(entries, 1);
  assert.deepEqual(kept.map((e) => [e.copy, e.scale, e.shift]), [[false, 1, 0], [true, 0.5, 0], [true, 0.5, 0.25]]);
});

test('reflectances one material per row: names first, a header row of wavelengths; written back either way', () => {
  const rows = readMaterials('name,400,550,700\nRed,0.10,0.12,0.70\nBlue,0.60,0.30,0.08', 'rows');
  const cols = readMaterials('nm,Red,Blue\n400,0.10,0.60\n550,0.12,0.30\n700,0.70,0.08', 'columns');
  assert.deepEqual(rows.map((m) => m.name), ['Red', 'Blue']);
  rows.forEach((m, k) => close(m.reflectance, cols[k].reflectance, 1e-15));
  // no names, with or without a label over them; tabs; percent
  assert.deepEqual(readMaterials('380\t550\t780\n10\t20\t30', 'rows').map((m) => m.name), ['Material 1']);
  const unlabeled = readMaterials('nm,400,550,700\n0.1,0.2,0.3\n0.4,0.5,0.6', 'rows');
  assert.deepEqual(unlabeled.map((m) => m.name), ['Material 1', 'Material 2']);
  close([unlabeled[1].reflectance[34]], [0.5], 1e-15);                      // 550 nm
  assert.deepEqual(readMaterials(',400,550,700\nA,0.1,0.2,0.3', 'rows').map((m) => m.name), ['A']);
  // written by rows or by columns, read back the same
  const ms = [material('5R 5/6'), { ...material('5PB 4/8'), name: 'Blue, a copy' }];
  for (const layout of ['rows', 'columns'] as const) {
    const back = readMaterials(writeMaterials(ms, layout), layout);
    assert.deepEqual(back.map((m) => m.name), ['5R 5/6', 'Blue  a copy']);
    back.forEach((m, k) => close(m.reflectance, ms[k].reflectance, 5.0001e-6));   // written to 5 decimals
  }
});

test('metameric blacks: no response in their condition; gray plus a black matches the gray there and not elsewhere', () => {
  const black = metamericBlack(reflectances[names.indexOf('5R 5/6')], observers.cie1931, illuminants.C);
  close(sensorResponses(black, observers.cie1931, illuminants.C), [0, 0, 0], 1e-9);
  const grays = grayMetamers(0.5, observers.cie1931, illuminants.C);
  assert.equal(grays.length, 5);
  const ref = wptNormalizationN('cie1931', 'C'), other = wptNormalizationN('cie1964', 'A');
  const clouds = cloudsOf(grays, [other], ref);
  for (const g of grays.slice(1)) {
    assert.ok(g.reflectance.every((v) => v >= 0.1 - 1e-12 && v <= 0.9 + 1e-12), `${g.name} stays within 0.1 to 0.9`);
    close(sensorResponses(g.reflectance, observers.cie1931, illuminants.C), sensorResponses(grays[0].reflectance, observers.cie1931, illuminants.C), 1e-9);
  }
  pairsOf(clouds, pairIndices(5, 'first')).forEach((r) => {
    assert.ok(r.refDE < 1e-9, 'a metamer in the reference');
    assert.ok(r.dE[0] > 0.05, 'not a metamer for the 10° observer under A');
  });
});

test('grays light to dark: alone they do not shift; with a black in proportion, one Wpt shift manifold, scaled', () => {
  const levels = [0.8, 0.65, 0.5, 0.35, 0.2];
  const ms = graysWithBlack(levels, observers.cie1931, illuminants.C);
  assert.equal(ms.length, 10);
  ms.forEach((m) => assert.ok(m.reflectance.every((v) => v >= 0 && v <= 0.96 + 1e-12), `${m.name} stays within 0 to 0.96`));
  ms.slice(5).forEach((m, k) => close(m.reflectance.map((v) => v / levels[k]), ms[5].reflectance.map((v) => v / levels[0]), 1e-12));
  const clouds = cloudsOf(ms, [wptNormalizationN('cie1964', 'A'), wptNormalizationN('cie1931', 'F11')], wptNormalizationN('cie1931', 'C'));
  const plain = clouds.slice(0, 5), black = clouds.slice(5);
  assert.deepEqual(pairIndices(10, 'halves').map(([a, b]) => [ms[a].name, ms[b].name.slice(0, 8)]).slice(0, 1), [['Gray 80%', 'Gray 80%']]);
  plain.forEach((cl) => cl.points.forEach((p) => close(p.dWpt, [0, 0, 0], 1e-9)));
  black.forEach((cl) => cl.points.forEach((p, k) => {
    const j = black.indexOf(cl);
    close(p.dWpt, black[0].points[k].dWpt.map((d) => (d * levels[j]) / levels[0]), 1e-9);
    assert.ok(Math.hypot(...p.dWpt) > 0.05, `${cl.material.name} shifts`);
  }));
});

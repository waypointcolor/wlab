// The thesis's observer metrics (src/metrics.ts) and the object library the labs compute them over
// (web/labs/library.ts).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  cie2006, deltaEsOf, fluorescents, illuminants, munsell1600, observers, observersN, oce, ome, wavelengths, wlabsOf,
  wptNormalizationN, type Observer,
} from '../src/index.ts';
import { pairs as demoPairs } from '../web/demo-data.ts';
import { CAMERA_CREDIT, CAMERAS, cameraObservers, camerasNow } from '../web/labs/cameras.ts';
import { conversions, curveRms, deltaEsAsTarget } from '../web/labs/conversions.ts';
import { setFetcher } from '../web/labs/fetchdata.ts';
import { OBJECT_SETS, objectsOf } from '../web/labs/library.ts';
import { readObjectFile } from '../web/labs/objectfile.ts';

const objects = munsell1600();
const few = { names: objects.names.slice(0, 200), reflectances: objects.reflectances.slice(0, 200) };
const THESIS_LIGHTS = [illuminants.D65, illuminants.D50, illuminants.A, illuminants.E, ...Object.values(fluorescents)];

test('wlabsOf gives each object the WLab of its condition\'s own normalization', () => {
  for (const [o, l] of [[observers.cie1931, illuminants.D65], [cie2006(4, 65), illuminants.F11], [observersN.cie2006_10_rods, illuminants.A]] as const) {
    const n = wptNormalizationN(o, l), w = wlabsOf(o, l, few);
    [0, 57, 199].forEach((j) => n.wlabOf(few.reflectances[j]).forEach((v, c) => assert.ok(Math.abs(v - w[3 * j + c]) < 1e-9)));
  }
});

test('the fluorescent illuminants are the CIE\'s twelve, with F2 and F11 as in illuminants', () => {
  assert.deepEqual(Object.keys(fluorescents), Array.from({ length: 12 }, (_, i) => `F${i + 1}`));
  assert.deepEqual(fluorescents.F2, illuminants.F2);
  assert.deepEqual(fluorescents.F11, illuminants.F11);
});

test('OME is 0 for an observer and itself, and for any linear transform of it (the Luther-Ives condition)', () => {
  assert.equal(ome(observers.cie1931, observers.cie1931, [illuminants.D65], few), 0);
  const m = [[0.9, 0.3, -0.1], [0.2, 1.1, 0.05], [-0.05, 0.1, 0.8]];
  const c = observers.cie2006_10.curves;
  const mixed: Observer = { name: 'mixed', curves: m.map((row) => wavelengths.map((_, i) => row[0] * c[0][i] + row[1] * c[1][i] + row[2] * c[2][i])) };
  assert.ok(ome(observers.cie2006_10, mixed, [illuminants.D65, illuminants.F11], few) < 1e-9);
  const a = ome(observers.cie1931, observers.cie1964, [illuminants.D65, illuminants.A], few);
  assert.ok(a > 0.1);
  assert.ok(Math.abs(a - ome(observers.cie1964, observers.cie1931, [illuminants.D65, illuminants.A], few)) < 1e-12);
});

test('OCE of a condition with itself is 0, and with one light it is the OME', () => {
  assert.equal(oce(observers.cie1931, illuminants.D65, observers.cie1931, illuminants.D65, few), 0);
  assert.ok(Math.abs(oce(observers.cie1931, illuminants.D65, observers.cie1964, illuminants.D65, few)
    - ome(observers.cie1931, observers.cie1964, [illuminants.D65], few)) < 1e-12);
  assert.ok(oce(observers.cie1931, illuminants.D65, observers.cie1931, illuminants.A, few) > 0);
});

// The thesis's OME tables: the CIE 1964 10° observer is closest to the CIE 2006 observer of 10° and 40 years, the
// CIE 1931 2° observer to that of 4° and 65 years, over the corrected Munsell colors and the lights D65, D50, A, E and
// F1 to F12. Its script worked from 400 to 700 nm in 10 nm steps; on that grid the same cells come out smallest among
// their neighbours (field sizes ± 0.5°, ages ± 5 years).
test('the closest CIE 2006 observers are the thesis\'s', () => {
  const keep = wavelengths.map((nm) => (nm >= 400 && nm <= 700 && nm % 10 === 0 ? 1 : 0));
  const grid = (o: Observer): Observer => ({ name: o.name, curves: o.curves.map((c) => c.map((v, i) => v * keep[i])) });
  for (const [ref, field, age, top] of [[observers.cie1964, 10, 40, 10], [observers.cie1931, 4, 65, 10]] as const) {
    const refW = THESIS_LIGHTS.map((l) => wlabsOf(grid(ref), l, objects));
    const at = (f: number, a: number) => THESIS_LIGHTS.reduce((s, l, k) => {
      const d = deltaEsOf(wlabsOf(grid(cie2006(f, a)), l, objects), refW[k]);
      return s + d.reduce((x, y) => x + y, 0) / d.length;
    }, 0) / THESIS_LIGHTS.length;
    const centre = at(field, age);
    assert.ok(centre < 0.06, `OME ${centre}`);
    for (const f of [field - 0.5, field, field + 0.5]) for (const a of [age - 5, age, age + 5]) {
      if ((f !== field || a !== age) && f >= 1 && f <= top) assert.ok(at(f, a) > centre, `${f}°, ${a} years is closer`);
    }
  }
});

// The labs fetch the data files beside the page; here they are read from the repository's data/ folder.
setFetcher(async (path) => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), 'utf8')));

test('the object library: every set decodes to its count of reflectances on the grid, with its credit', async () => {
  for (const s of OBJECT_SETS) {
    const d = await s.load();
    assert.equal(d.reflectances.length, s.count, s.id);
    assert.equal(d.names.length, s.count);
    assert.ok(d.reflectances.every((r) => r.length === 81 && r.every((v) => v > -0.05 && v < 1.5)), s.id);
    assert.ok(s.credit.length > 20 && s.license && s.description);
  }
  // built in: the Munsell colors (the 271 of the 2014 animations and all 1,600), the CIE's 99 (TM-30-18), the PMCC
  // and the natural objects; the others are loaded
  assert.deepEqual(OBJECT_SETS.filter((s) => s.builtIn).map((s) => s.id),
    ['munsell271', 'munsell1600', 'cie-ces99', 'pmcc', 'morimoto-natural-objects']);
  // the 271: ten hues (the 10 of each family) at Chroma 4 to 16, every Value, and the 19 neutrals
  const reduced = await objectsOf(['munsell271']);
  assert.equal(reduced.reflectances.length, 271);
  assert.equal(reduced.names.filter((n) => n.startsWith('N ')).length, 19);
  assert.deepEqual([...new Set(reduced.names.filter((n) => !n.startsWith('N ')).map((n) => n.split(' ')[0]))].sort(),
    ['10B', '10BG', '10G', '10GY', '10P', '10PB', '10R', '10RP', '10Y', '10YR']);
  // the PMCC set is the landing page's measurements: its Smurf patch, every 10 nm, is the demo's
  const pmcc = await objectsOf(['pmcc']), smurf = pmcc.reflectances[pmcc.names.indexOf('Smurf')];
  const demo = demoPairs.find((p) => p.key === 'smurf')!.a;
  demo.nm.forEach((nm, i) => assert.ok(Math.abs(smurf[(nm - 380) / 5] - demo.values[i]) < 6e-5, `${nm} nm`));
  const both = await objectsOf(['cie-ces99', 'nist-skin']);
  assert.equal(both.reflectances.length, 199);
  assert.match(both.names[0], /\(The CIE 99 color evaluation samples\)$/);
  await assert.rejects(objectsOf([]), /at least one/);
});

test('the bundled indexes match the data files they describe', () => {
  const sets = JSON.parse(readFileSync(new URL('../data/objects/sets.json', import.meta.url), 'utf8')) as { id: string; file: string; count: number; title: string }[];
  for (const m of sets) {
    const f = JSON.parse(readFileSync(new URL(`../data/objects/${m.file}`, import.meta.url), 'utf8'));
    assert.deepEqual([f.id, f.count, f.title], [m.id, m.count, m.title], m.file);
  }
  const cams = JSON.parse(readFileSync(new URL('../data/observers/cameras.json', import.meta.url), 'utf8')) as { cameras: { name: string }[] };
  assert.deepEqual(cams.cameras.map((c) => c.name), CAMERAS.map((c) => c.name));
});

// The cameras of rawtoaces-data (web/labs/cameras.ts): each one a usable set of sensors, its OME against CIE 1931
// over the thesis's objects and lights in the range of the thesis's camera table (0.60 to 1.41 for most cameras).
test('the open cameras: loaded when asked for, normalizable, and as close to CIE 1931 as cameras are', async () => {
  assert.equal(CAMERAS.length, 52);
  let told = 0;
  assert.throws(() => camerasNow(() => told++), /loading/);
  const cams = await cameraObservers();
  assert.equal(told, 1);
  assert.equal(camerasNow(() => told++), cams);
  const some = { names: objects.names.filter((_, j) => j % 8 === 0), reflectances: objects.reflectances.filter((_, j) => j % 8 === 0) };
  for (const o of cams) {
    assert.match(o.name, /\(camera\)$/);
    assert.ok(o.curves.length === 3 && o.curves.every((k) => k.length === 81 && k.every((v) => v >= 0)), o.name);
    const v = ome(o, observers.cie1931, THESIS_LIGHTS, some);
    assert.ok(v > 0.3 && v < 1.5, `${o.name}: OME ${v}`);
  }
  assert.match(CAMERA_CREDIT, /Apache License 2\.0/);
});

// A reader's own file (web/labs/objectfile.ts): CGATS with spectral fields, or a table by columns or by rows.
test('your own objects: CGATS and tables, in fractions or percent, onto the grid', () => {
  const nm = Array.from({ length: 36 }, (_, i) => 380 + 10 * i);
  const r1 = nm.map((x) => 0.2 + 0.5 * (x - 380) / 350), r2 = nm.map(() => 0.5);
  const cgats = ['CGATS.17', 'ORIGINATOR "test"', 'NUMBER_OF_FIELDS 38', 'BEGIN_DATA_FORMAT',
    `SAMPLE_ID SAMPLE_NAME ${nm.map((x) => `SPECTRAL_NM${x}`).join(' ')}`, 'END_DATA_FORMAT', 'NUMBER_OF_SETS 2', 'BEGIN_DATA',
    `1 "Patch one" ${r1.map((v) => (100 * v).toFixed(3)).join(' ')}`, `2 Gray ${r2.map((v) => (100 * v).toFixed(3)).join(' ')}`, 'END_DATA'].join('\n');
  const a = readObjectFile(cgats);
  assert.deepEqual(a.objects.names, ['Patch one', 'Gray']);
  assert.match(a.note, /2 reflectances read as CGATS, in percent/);
  assert.ok(Math.abs(a.objects.reflectances[0][4] - 0.2 - 0.5 * 20 / 350) < 1e-4);        // 400 nm (written to 1/1000 of a percent)
  assert.ok(Math.abs(a.objects.reflectances[0][80] - 0.7) < 1e-4);                       // 780 nm holds the 730 nm value
  const byColumns = ['nm,one,gray', ...nm.map((x, i) => `${x},${r1[i]},${r2[i]}`)].join('\n');
  const byRows = [['name', ...nm].join(','), ['one', ...r1].join(','), ['gray', ...r2].join(',')].join('\n');
  for (const text of [byColumns, byRows]) {
    const t = readObjectFile(text);
    assert.deepEqual(t.objects.names, ['one', 'gray']);
    assert.ok(Math.abs(t.objects.reflectances[1][40] - 0.5) < 1e-9);
  }
  assert.throws(() => readObjectFile(cgats.replace(/SPECTRAL_NM/g, 'LAB_')), /no spectral fields/);
});

// Lab D's ways of converting an observer (web/labs/conversions.ts).
test('the ways of converting an observer: one answer under the Luther-Ives condition, five otherwise', () => {
  const T = observers.cie1931, L = illuminants.D50, R = few.reflectances;
  // a source that is a linear mix of the target: every method recovers the target, and every object matches
  const q = [[0.6, 0.3, 0.1], [0.2, 0.7, 0.1], [0.05, 0.1, 0.9]];
  const mixed: Observer = { name: 'mixed', curves: q.map((row) => wavelengths.map((_, i) => row[0] * T.curves[0][i] + row[1] * T.curves[1][i] + row[2] * T.curves[2][i])) };
  for (const c of conversions(mixed, T, L)) {
    assert.ok(curveRms(c.observer, T, L) < 1e-9, c.id);
    assert.ok(Math.max(...deltaEsAsTarget(c.observer, T, L, R)) < 1e-9, c.id);
  }
  // CIE 2006 cone fundamentals to CIE 1931: five different observers; the Wpt MAT's, read as the target's under the
  // target light, gives each object the WLab difference that the OME takes under that light
  const list = conversions(observers.cie2006_2, T, L);
  assert.deepEqual(list.map((c) => c.id), ['wpt', 'xyz', 'xyzWhite', 'primaries', 'primariesWhite']);
  const wpt = deltaEsAsTarget(list[0].observer, T, L, R), ome1 = deltaEsOf(wlabsOf(observers.cie2006_2, L, few), wlabsOf(T, L, few));
  wpt.forEach((v, j) => assert.ok(Math.abs(v - ome1[j]) < 1e-9));
  const means = list.map((c) => deltaEsAsTarget(c.observer, T, L, R).reduce((s, v) => s + v, 0) / R.length);
  assert.equal(new Set(means.map((m) => m.toFixed(4))).size, 5);
  // the white-balanced methods give the target light the target observer's responses
  for (const c of list.filter((c) => c.id.endsWith('White'))) {
    const w = c.observer.curves.map((k) => k.reduce((s, v, i) => s + v * L[i], 0)), t = T.curves.map((k) => k.reduce((s, v, i) => s + v * L[i], 0));
    w.forEach((v, i) => assert.ok(Math.abs(v / t[i] - 1) < 1e-12, c.id));
  }
});

test('which primaries each conversion matches: the target observer\'s, or the same chromaticities rescaled', () => {
  const T = observers.cie1931.curves, L = illuminants.D50;
  // the target observer's implied primaries, P = Tᵀ (T Tᵀ)⁻¹: curves C match them when C·P is the identity
  const Tt = T[0].map((_, j) => T.map((row) => row[j]));
  const TTt = T.map((a) => T.map((b) => a.reduce((s, v, k) => s + v * b[k], 0)));
  const inv = (m: number[][]) => {
    const [[a, b, c], [d, e, f], [g, h, i]] = m, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    return [[e * i - f * h, c * h - b * i, b * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]].map((r) => r.map((v) => v / det));
  };
  const P = Tt.map((row) => inv(TTt).map((_, j) => row.reduce((s, v, k) => s + v * inv(TTt)[k][j], 0)));
  const CP = (C: readonly (readonly number[])[]) => C.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * P[k][j], 0)));
  const list = conversions(observers.cie2006_2, observers.cie1931, L);
  const plain = CP(list.find((c) => c.id === 'primaries')!.observer.curves), balanced = CP(list.find((c) => c.id === 'primariesWhite')!.observer.curves);
  plain.forEach((row, i) => row.forEach((v, j) => assert.ok(Math.abs(v - (i === j ? 1 : 0)) < 1e-9)));        // the same primaries
  balanced.forEach((row, i) => row.forEach((v, j) => { if (i !== j) assert.ok(Math.abs(v) < 1e-9); }));      // still diagonal: same chromaticities
  assert.ok(balanced.some((row, i) => Math.abs(row[i] - 1) > 1e-3));                                          // but other intensities
});

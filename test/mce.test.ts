// Lab H's computations: metameric blacks from real materials, metamers for one or several conditions, and the estimate
// of a reflectance from a Wpt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaEWlab, illuminants, munsell1600, observers, wptNormalization } from '../src/index.ts';
import { munsellChips } from '../web/labs/hue.ts';
import {
  blackBasis, conditionRows, estimateReflectance, estimationCharacteristic, hueFamily, metamersOf, room, spreadIn, symmetricEigen,
} from '../web/labs/mce.ts';

const R = munsell1600().reflectances, names = munsell1600().names;
const chip = R[names.indexOf('10GY 5/10')];
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

test('symmetric eigenvectors: A v = λ v, largest first', () => {
  const A = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 1]];
  const { values, vectors } = symmetricEigen(A);
  assert.ok(values[0] >= values[1] && values[1] >= values[2]);
  vectors.forEach((v, k) => A.forEach((row, i) => assert.ok(Math.abs(row.reduce((s, x, j) => s + x * v[j], 0) - values[k] * v[i]) < 1e-10)));
});

test('metamers for one condition: the same WLab there, apart elsewhere, every value within 0 to 1', () => {
  const rows = conditionRows(observers.cie1931, illuminants.D65), basis = blackBasis(R, rows, 8);
  // the blacks are black: no response from any sensor, and of unit length
  for (const b of basis.blacks) {
    rows.forEach((r) => assert.ok(Math.abs(r.reduce((s, x, i) => s + x * b[i], 0)) < 1e-9));
    assert.ok(Math.abs(Math.hypot(...b) - 1) < 1e-12);
  }
  assert.ok(basis.weights.every((w, i) => i === 0 || w <= basis.weights[i - 1]));
  const family = metamersOf(chip, basis, 30, 1);
  assert.ok(family.every((r) => r.every((v) => v >= 0 && v <= 1)));
  assert.ok(Math.max(...spreadIn(wptNormalization('cie1931', 'D65'), chip, family, deltaEWlab)) < 1e-9);
  const underA = spreadIn(wptNormalization('cie1931', 'A'), chip, family, deltaEWlab);
  assert.ok(mean(underA) > 0.2 && Math.max(...underA) > 1, `under A ${mean(underA)}`);
  // the same seed makes the same family
  assert.deepEqual(metamersOf(chip, basis, 5, 7), metamersOf(chip, basis, 5, 7));
  assert.equal(room([0.5, 0.5], [1, -1]), 0.5);
});

test('metamers for three conditions at once match in all three and part less elsewhere', () => {
  const one = conditionRows(observers.cie1931, illuminants.D65);
  const three = [...one, ...conditionRows(observers.cie1931, illuminants.A), ...conditionRows(observers.cie1964, illuminants.D65)];
  const f1 = metamersOf(chip, blackBasis(R, one, 8), 30, 1), f3 = metamersOf(chip, blackBasis(R, three, 8), 30, 1);
  for (const [o, l] of [['cie1931', 'D65'], ['cie1931', 'A'], ['cie1964', 'D65']] as const) {
    assert.ok(Math.max(...spreadIn(wptNormalization(o, l), chip, f3, deltaEWlab)) < 1e-9, `${o} ${l}`);
  }
  const f11 = wptNormalization('cie1931', 'F11');
  assert.ok(mean(spreadIn(f11, chip, f3, deltaEWlab)) < mean(spreadIn(f11, chip, f1, deltaEWlab)));
});

test("the estimate from a Wpt: exactly that Wpt, from the hue family's characteristic reflectances", () => {
  const norm = wptNormalization('cie1931', 'D65');
  const top = new Map<string, ReturnType<typeof munsellChips>[number]>();
  for (const c of munsellChips()) { const b = top.get(c.hue); if (!b || c.chroma > b.chroma) top.set(c.hue, c); }
  const chips = [...top.values()];
  assert.equal(chips.length, 40);
  const family = hueFamily(chips.map((c) => c.hue), chips.map((c) => c.reflectance), norm);
  assert.ok(family.hues.every((h, i) => i === 0 || h >= family.hues[i - 1]));
  const c = estimationCharacteristic(chip);
  assert.ok(Math.min(...c) >= 0 && Math.max(...c) <= 1);
  for (const n of ['10GY 5/10', '5PB 6/8', '7.5Y 8/4', '5RP 4/12']) {
    const w = norm.wptOf(R[names.indexOf(n)]), e = estimateReflectance(w, family, norm)!;
    norm.wptOf(e.reflectance).forEach((v, i) => assert.ok(Math.abs(v - w[i]) < 1e-9, n));
    assert.ok(e.mix >= 0 && e.mix <= 1 && e.s > 0, n);
  }
  assert.equal(estimateReflectance([50, 0, 0], family, norm), undefined);
});

// Lab G's computations (web/labs/predictions.ts): the Wpt MAT against the chromatic adaptation transforms between two
// lights, and against the other ways of converting an observer between two observers.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cat, categoricalObserver, illuminants, mat, mulMV, munsell1600, observers, responses, wptNormalization, type Vec3 } from '../src/index.ts';
import { carry, LIGHT_TRANSFORMS, OBSERVER_TRANSFORMS, predictPair, rgbLed, summarize, transformStages } from '../web/labs/predictions.ts';

// The guide's companion package (ex05): 1,600 Munsell colors, CIE 1931, A to D65, mean ΔE00 1.09 for the Wpt MAT and
// 2.26 for CAT02 (the guide's larger set of 5,162 reflectances, not all open, gave 1.24 and 2.35 for CIE 1964).
test('the companion\'s MAT test: A to D65 over the Munsell colors', () => {
  const munsell = munsell1600();
  const pair = (o: typeof observers.cie1931) => ({ label: '', group: '', source: { observer: o, light: illuminants.A }, destination: { observer: o, light: illuminants.D65 } });
  const e = predictPair(pair(observers.cie1931), munsell, true);
  assert.deepEqual(e.map((x) => x.transform), [...LIGHT_TRANSFORMS]);
  const mean = (i: number) => summarize(e[i].de00!).mean;
  assert.equal(mean(0).toFixed(2), '1.09');
  assert.equal(mean(2).toFixed(2), '2.26');
  assert.ok(mean(0) < mean(1) && mean(1) < mean(2) && mean(2) < mean(3), 'MAT < Bradford < CAT02 < von Kries');
  const ten = predictPair(pair(observers.cie1964), munsell, true);
  assert.ok(summarize(ten[0].de00!).mean < 1.2 && summarize(ten[2].de00!).mean > 2.5);
});

test('a light against itself is predicted exactly by every transform', () => {
  const p = { label: '', group: '', source: { observer: observers.cie1931, light: illuminants.D65 }, destination: { observer: observers.cie1931, light: illuminants.D65 } };
  for (const e of predictPair(p, { names: ['a'], reflectances: munsell1600().reflectances.slice(0, 50) }, true)) {
    assert.ok(summarize(e.dewlab).max < 1e-9 && summarize(e.de00!).max < 1e-9, e.transform);
  }
});

test('between two observers: the five ways of converting an observer, the MAT exact on white', () => {
  const objs = { names: [], reflectances: munsell1600().reflectances.filter((_, j) => j % 10 === 0) };
  const p = { label: '', group: '', source: { observer: categoricalObserver(3, 2), light: illuminants.D65 }, destination: { observer: observers.cie1931, light: illuminants.D65 } };
  const e = predictPair(p, objs, true);
  assert.deepEqual(e.map((x) => x.transform), [...OBSERVER_TRANSFORMS]);
  assert.ok(e.every((x) => summarize(x.de00!).mean > 0 && summarize(x.dewlab).mean > 0));
  // a white is carried exactly by the MAT
  const white = predictPair(p, { names: ['white'], reflectances: [new Array(81).fill(1)] }, true);
  assert.ok(white[0].de00![0] < 1e-9);
  assert.throws(() => predictPair({ ...p, source: { observer: categoricalObserver(3, 2), light: illuminants.A } }, objs, true), /either the light or the observer/);
});

// An RGB LED mixed to D65's white: the same responses as D65 for the observer it was mixed for, from three peaks.
test('the RGB LED has exactly D65\'s white for its observer', () => {
  for (const o of [observers.cie1931, observers.cie1964]) {
    const led = rgbLed(o, illuminants.D65);
    assert.ok(led.every((v) => v >= 0));
    const raw = (s: readonly number[]) => o.curves.map((c) => c.reduce((a, v, i) => a + v * s[i], 0));
    raw(led).forEach((v, i) => assert.ok(Math.abs(v / raw(illuminants.D65)[i] - 1) < 1e-12));
  }
});

// The animation's steps end at the normalization or the CAT, so a material carried by them is what the page's tables predict.
test('a measurement carried through the steps is what the transform predicts', () => {
  const o = observers.cie1931, A = { observer: o, light: illuminants.A }, D65 = { observer: o, light: illuminants.D65 };
  const ns = wptNormalization(o, A.light), nd = wptNormalization(o, D65.light), r = munsell1600().reflectances[700];
  const x = responses(r, o, A.light);
  const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
  close(carry('wpt', A, D65, x), mulMV(mat(ns, nd), x));
  close(carry('cat02', A, D65, x), mulMV(cat(ns.white, nd.white, 'cat02'), x));
  close(carry('vk', A, D65, x), mulMV(cat(ns.white, nd.white, 'xyz'), x));
  const close3 = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) => a.forEach((row, i) => row.forEach((v, j) => assert.ok(Math.abs(v - b[i][j]) < 1e-9)));
  close3(transformStages('wpt', o, A.light).at(-1)!.m, ns.toWpt);
  assert.equal(transformStages('wpt', o, A.light).length, 5);
});

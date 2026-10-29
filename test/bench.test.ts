// Lab G's computations (web/labs/predictions.ts): the Wpt MAT against the chromatic adaptation transforms between two
// lights, and against the other ways of converting an observer between two observers.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { categoricalObserver, illuminants, munsell1600, observers } from '../src/index.ts';
import { LIGHT_TRANSFORMS, OBSERVER_TRANSFORMS, predictPair, summarize } from '../web/labs/predictions.ts';

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

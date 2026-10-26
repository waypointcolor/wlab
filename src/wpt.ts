/**
 * Wpt normalization: one matrix per observing condition (observer + light), built from 40 Munsell samples: 3 × 3 for
 * three sensors, 3 × N for N sensors (the last step, the fit of p and t, is then a non-square regression).
 */

import { baseNames, baseReferencePT, baseReflectances } from './data.ts';
import { inv3, solve, type Mat3, type Vec3 } from './linalg.ts';
import {
  lightOf, observerOf, ones, responder,
  type IlluminantName, type Observer, type ObserverName, type Spectrum,
} from './spectra.ts';
import { wptToWlab } from './wlab.ts';

/** The base samples that carry a Wpt normalization: reflectances and their reference p, t. */
export interface Base {
  readonly names: readonly string[];
  readonly reflectances: readonly Spectrum[];
  readonly referencePT: readonly (readonly [number, number])[];
}

/** The 40 Munsell colors of Value 5 and Chroma 6 and their reference p, t (CIE 1931 observer, illuminant C). */
export const munsellBase: Base = { names: baseNames, reflectances: baseReflectances, referencePT: baseReferencePT };

/** A Wpt normalization for one observing condition with N sensors (N = 3 for colorimetry; see `WptNormalization`). */
export interface WptNormalizationN {
  readonly observer: Observer;
  readonly light: Spectrum;
  /** The number of sensors, N. */
  readonly sensors: number;
  /** Responses of a perfect white (the second is 100). */
  readonly white: readonly number[];
  /** From the condition's N responses to Wpt: 3 rows of N. */
  readonly toWpt: readonly (readonly number[])[];
  /** Wpt of a material with this reflectance. */
  wptOf(reflectance: Spectrum): Vec3;
  /** WLab of a material with this reflectance. */
  wlabOf(reflectance: Spectrum): Vec3;
  /**
   * The four steps (Technical annex A.3): the N × N rotation of white onto the first axis, the scale that puts white
   * at W = 100, the leveling of the base samples (the first channel regressed on the other N − 1 with an intercept:
   * level = [a1 … a(N−1), a0]), and the 2 × (N − 1) fit of the other channels to the reference p, t.
   */
  readonly steps: { readonly rotation: readonly (readonly number[])[]; readonly scale: number; readonly level: readonly number[]; readonly fit: readonly (readonly number[])[] };
}

/** A Wpt normalization for one observing condition with three sensors. */
export interface WptNormalization extends WptNormalizationN {
  /** Responses of a perfect white (Y = 100). */
  readonly white: Vec3;
  /** From the condition's responses (XYZ for the CIE observers, white Y = 100) to Wpt. */
  readonly toWpt: Mat3;
  /** From Wpt back to the condition's responses. */
  readonly fromWpt: Mat3;
  readonly steps: { readonly rotation: Mat3; readonly scale: number; readonly level: Vec3; readonly fit: readonly [readonly [number, number], readonly [number, number]] };
}

// plain loops: these run for every one of the N observers × M lights a set of conditions can hold
function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function times(m: readonly (readonly number[])[], v: readonly number[]): number[] {
  const out = new Array<number>(m.length);
  for (let r = 0; r < m.length; r++) out[r] = dot(m[r], v);
  return out;
}

/**
 * Build the Wpt normalization of an observing condition with any number of sensors N ≥ 3 (Technical annex A.3, and
 * Derhak's thesis for more than three channels): rotate white onto the first axis, scale it to W = 100, level the 40
 * samples of equal Munsell Value against the other N − 1 channels, and fit those channels to the reference p, t.
 */
export function wptNormalizationN(
  observer: Observer | ObserverName,
  light: Spectrum | IlluminantName,
  base: Base = munsellBase,
): WptNormalizationN {
  const obs = observerOf(observer);
  const ill = lightOf(light);
  const n = obs.curves.length;
  // every response of this condition (white, the base samples, each material) is one sum per sensor over the curves
  // weighted by the light, computed once here: a normalization is built for each of N observers × M lights
  const respond = responder(obs, ill);
  const white = respond(ones);
  const resp = base.reflectances.map(respond);

  // 1. rotate white onto the first axis, one plane at a time (axes n−2 and n−1, …, then 0 and 1)
  let am: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let lw = [...white];
  for (let d = n - 1; d >= 1; d--) {
    const phi = -Math.atan2(lw[d], lw[d - 1]), c = Math.cos(phi), s = Math.sin(phi);
    const turn = (v: number[]) => { const a = v[d - 1], b = v[d]; v[d - 1] = c * a - s * b; v[d] = s * a + c * b; };
    turn(lw);
    // the same plane rotation applied to the rows d − 1 and d of the matrix
    const rd1 = am[d - 1], rd = am[d];
    am[d - 1] = rd1.map((v, j) => c * v - s * rd[j]);
    am[d] = rd1.map((v, j) => s * v + c * rd[j]);
  }
  const rotation = am.map((r) => [...r]);
  // 2. white at W = 100
  const scale = 100 / dot(am[0], white);
  am[0] = am[0].map((v) => v * scale);

  // 3. level the samples of equal Munsell Value: least squares u ≈ a1 v1 + … + a(n−1) v(n−1) + a0, then shear
  const rows = resp.map((x) => times(am, x));
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const atb = new Array<number>(n).fill(0);
  for (const r of rows) {
    const x = [...r.slice(1), 1];
    for (let i = 0; i < n; i++) {
      atb[i] += x[i] * r[0];
      for (let j = 0; j < n; j++) ata[i][j] += x[i] * x[j];
    }
  }
  const level = solve(ata, atb);
  am[0] = am[0].map((v, j) => v - level.slice(0, n - 1).reduce((s, a, k) => s + a * am[k + 1][j], 0));

  // 4. fit p and t from the other n − 1 channels: F = P Qᵀ (Q Qᵀ)⁻¹, a 2 × (n − 1) regression (square for n = 3)
  const others = am.slice(1);
  const q = resp.map((x) => times(others, x));
  const qqt = Array.from({ length: n - 1 }, (_, i) => Array.from({ length: n - 1 }, (_, j) => q.reduce((s, v) => s + v[i] * v[j], 0)));
  const fit = [0, 1].map((k) => solve(qqt.map((r) => [...r]), Array.from({ length: n - 1 }, (_, i) => q.reduce((s, v, j) => s + base.referencePT[j][k] * v[i], 0))));
  const toWpt = [am[0], ...fit.map((f) => Array.from({ length: n }, (_, c) => f.reduce((s, a, k) => s + a * am[k + 1][c], 0)))];

  const wptOf = (reflectance: Spectrum): Vec3 => times(toWpt, respond(reflectance)) as Vec3;
  return {
    observer: obs, light: ill, sensors: n, white, toWpt, wptOf, wlabOf: (r) => wptToWlab(wptOf(r)),
    steps: { rotation, scale, level, fit },
  };
}

/**
 * Build the Wpt normalization of an observing condition with three sensors (Technical annex A.3): rotate white onto
 * the first axis, scale it to W = 100, level the 40 samples of equal Munsell Value, and fit their p, t to the
 * reference. For more sensors, `wptNormalizationN`.
 */
export function wptNormalization(
  observer: Observer | ObserverName,
  light: Spectrum | IlluminantName,
  base: Base = munsellBase,
): WptNormalization {
  const n = wptNormalizationN(observer, light, base);
  if (n.sensors !== 3) throw new Error(`wlab: wptNormalization() is for three sensors, not ${n.sensors}; use wptNormalizationN()`);
  const toWpt = n.toWpt as unknown as Mat3;
  return { ...n, white: n.white as Vec3, toWpt, fromWpt: inv3(toWpt), steps: n.steps as unknown as WptNormalization['steps'] };
}

/** Wpt normalization: one 3 × 3 matrix per observing condition (observer + light), built from 40 Munsell samples. */

import { baseNames, baseReferencePT, baseReflectances } from './data.ts';
import { identity3, inv3, mulMM, mulMV, type Mat3, type Vec3 } from './linalg.ts';
import {
  lightOf, observerOf, responses, whiteOf,
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

/** A Wpt normalization for one observing condition. */
export interface WptNormalization {
  readonly observer: Observer;
  readonly light: Spectrum;
  /** Responses of a perfect white (Y = 100). */
  readonly white: Vec3;
  /** From the condition's responses (XYZ for the CIE observers, white Y = 100) to Wpt. */
  readonly toWpt: Mat3;
  /** From Wpt back to the condition's responses. */
  readonly fromWpt: Mat3;
  /** Wpt of a material with this reflectance. */
  wptOf(reflectance: Spectrum): Vec3;
  /** WLab of a material with this reflectance. */
  wlabOf(reflectance: Spectrum): Vec3;
  /**
   * The four steps of the normalization (Technical annex A.3): the rotation of white onto the first axis, the scale
   * that puts white at W = 100, the leveling plane u = a1 v + a2 z + a0 of the base samples (level = [a1, a2, a0]),
   * and the 2 x 2 fit of their second and third components to the reference p, t.
   */
  readonly steps: { readonly rotation: Mat3; readonly scale: number; readonly level: Vec3; readonly fit: readonly [readonly [number, number], readonly [number, number]] };
}

/**
 * Build the Wpt normalization of an observing condition (Technical annex A.3): rotate white onto the first axis,
 * scale it to W = 100, level the 40 samples of equal Munsell Value, and fit their p, t to the reference.
 */
export function wptNormalization(
  observer: Observer | ObserverName,
  light: Spectrum | IlluminantName,
  base: Base = munsellBase,
): WptNormalization {
  const obs = observerOf(observer);
  const ill = lightOf(light);
  const white = whiteOf(obs, ill);
  const xyz = base.reflectances.map((r) => responses(r, obs, ill));

  // 1. rotate white onto the first axis (first in the plane of axes 2 and 3, then of axes 1 and 2)
  let am = identity3();
  let lw: Vec3 = [...white];
  for (const d of [2, 1]) {
    const phi = -Math.atan2(lw[d], lw[d - 1]);
    const r = identity3();
    r[d - 1][d - 1] = Math.cos(phi);
    r[d - 1][d] = -Math.sin(phi);
    r[d][d - 1] = Math.sin(phi);
    r[d][d] = Math.cos(phi);
    lw = mulMV(r, lw);
    am = mulMM(r, am);
  }
  const rotation = am.map((r) => [...r]) as Mat3;
  // 2. white at W = 100
  const s = 100 / mulMV(am, white)[0];
  am[0] = [am[0][0] * s, am[0][1] * s, am[0][2] * s];

  // 3. level the samples of equal Munsell Value: least squares u ≈ a1 v + a2 z + a0, then shear
  const uvz = xyz.map((c) => mulMV(am, c));
  const ata: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb: Vec3 = [0, 0, 0];
  for (const [u, v, z] of uvz) {
    const row = [v, z, 1];
    for (let i = 0; i < 3; i++) {
      atb[i] += row[i] * u;
      for (let j = 0; j < 3; j++) ata[i][j] += row[i] * row[j];
    }
  }
  const alpha = mulMV(inv3(ata), atb);
  const shear = identity3();
  shear[0][1] = -alpha[0];
  shear[0][2] = -alpha[1];
  am = mulMM(shear, am);

  // 4. fit the hue and chroma plane to the reference: F = P Q^T (Q Q^T)^-1, Q the samples' second and third components
  const q = xyz.map((c) => mulMV(am, c));
  let q11 = 0, q12 = 0, q22 = 0, p11 = 0, p12 = 0, p21 = 0, p22 = 0;
  q.forEach(([, a, b], j) => {
    const [P, T] = base.referencePT[j];
    q11 += a * a; q12 += a * b; q22 += b * b;
    p11 += P * a; p12 += P * b; p21 += T * a; p22 += T * b;
  });
  const det = q11 * q22 - q12 * q12;
  const i11 = q22 / det, i12 = -q12 / det, i22 = q11 / det;
  const F = [[p11 * i11 + p12 * i12, p11 * i12 + p12 * i22], [p21 * i11 + p22 * i12, p21 * i12 + p22 * i22]];
  const row = (k: number): Vec3 => [0, 1, 2].map((c) => F[k][0] * am[1][c] + F[k][1] * am[2][c]) as Vec3;
  const toWpt: Mat3 = [am[0], row(0), row(1)];
  const fromWpt = inv3(toWpt);

  const wptOf = (reflectance: Spectrum): Vec3 => mulMV(toWpt, responses(reflectance, obs, ill));
  const fit = [[F[0][0], F[0][1]], [F[1][0], F[1][1]]] as const;
  return {
    observer: obs, light: ill, white, toWpt, fromWpt, wptOf, wlabOf: (r) => wptToWlab(wptOf(r)),
    steps: { rotation, scale: s, level: alpha, fit },
  };
}

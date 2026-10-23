/** Material adjustment transforms (MATs) through Wpt, and von Kries-type CATs for comparison (annex A.7). */

import { diag3, inv3, mulMM, mulMV, type Mat3, type Vec3 } from './linalg.ts';
import type { WptNormalization } from './wpt.ts';

/**
 * Wpt MAT from a source to a destination observing condition: M = A_dst⁻¹ A_src. Applied to the source's responses
 * it predicts the destination's; applied to an observer's sensitivity curves, wavelength by wavelength, it converts
 * the observer. White maps exactly.
 */
export function mat(source: WptNormalization, destination: WptNormalization): Mat3 {
  return mulMM(destination.fromWpt, source.toWpt);
}

export const BRADFORD: Mat3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
export const CAT02: Mat3 = [[0.7328, 0.4296, -0.1624], [-0.7036, 1.6975, 0.0061], [0.003, 0.0136, 0.9834]];
const XYZ_SCALING: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/**
 * A von Kries-type chromatic adaptation transform with full adaptation: S⁻¹ diag(S w_dst / S w_src) S, with S the
 * Bradford or CAT02 matrix (or plain scaling in XYZ). It models one viewer adapting; it is not designed to bridge
 * two observers.
 */
export function cat(sourceWhite: Vec3, destinationWhite: Vec3, method: 'bradford' | 'cat02' | 'xyz' | Mat3 = 'cat02'): Mat3 {
  const S = method === 'bradford' ? BRADFORD : method === 'cat02' ? CAT02 : method === 'xyz' ? XYZ_SCALING : method;
  const s = mulMV(S, sourceWhite), d = mulMV(S, destinationWhite);
  return mulMM(inv3(S), mulMM(diag3([d[0] / s[0], d[1] / s[1], d[2] / s[2]]), S));
}

/** Apply a 3 × 3 matrix (a MAT, a CAT or a Wpt normalization) to a three-component value. */
export const apply = (m: Mat3, v: Vec3): Vec3 => mulMV(m, v);

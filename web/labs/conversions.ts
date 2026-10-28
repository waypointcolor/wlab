// Ways of converting an observer (a source observer's sensor curves) to a target observer's, after Derhak's thesis
// (chapter "Manipulating color matching functions"). Each is a 3 × 3 matrix M applied to the source's curves, M·S;
// they differ in what they match:
//   Wpt based          predicts material color in the target condition (the Wpt MAT, as Lab D uses): M = A_T⁻¹ A_S
//   XYZ based          a spectral match, the curves regressed onto the target observer's:          M = T Sᵀ (S Sᵀ)⁻¹
//   primary based      a match with the same primaries, the target observer's:                     M = (S P)⁻¹, P = Tᵀ (T Tᵀ)⁻¹
// and the last two each with a white balance for the target condition's light (a von Kries scaling V that gives the
// light the target observer's responses). A white balance rescales the curves one by one, so the primaries they
// match are rescaled too: V·C matches P·V⁻¹, primaries of the same chromaticities (the same spectral shapes) at other
// intensities, no longer the target observer's own. When the source's curves are a linear mix of the target's (the
// Luther-Ives condition) every method gives the same M and the same observer; otherwise each gives its own.

import {
  inv3, mat, mulMM, mulMV, responses, wptNormalization, wptToWlab, type Mat3, type Observer, type Spectrum,
} from '../../src/index.ts';

export type MethodId = 'wpt' | 'xyz' | 'xyzWhite' | 'primaries' | 'primariesWhite';

export interface Conversion {
  id: MethodId;
  title: string;
  /** what the method matches */
  keeps: string;
  mat: Mat3;
  observer: Observer;
}

type Curves = readonly (readonly number[])[];
const times = (a: Curves, b: Curves): number[][] => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const transpose = (a: Curves): number[][] => a[0].map((_, j) => a.map((row) => row[j]));
const apply = (m: Mat3, curves: Curves) => times(m, curves);
const weighted = (curves: Curves, light: Spectrum) => curves.map((c) => c.reduce((s, v, i) => s + v * light[i], 0));

/** The matrix that gives `light` the target observer's responses after M: a von Kries white balance. */
function whiteBalance(m: Mat3, source: Curves, target: Curves, light: Spectrum): Mat3 {
  const t = weighted(target, light), c = weighted(apply(m, source), light);
  return mulMM([[t[0] / c[0], 0, 0], [0, t[1] / c[1], 0], [0, 0, t[2] / c[2]]], m);
}

/** The five conversions of `source` to `target`, for the target condition's `light` (used by the Wpt MAT and the white balances). */
export function conversions(source: Observer, target: Observer, light: Spectrum): Conversion[] {
  if (source.curves.length !== 3 || target.curves.length !== 3) throw new Error('the ways of converting an observer need three sensors on each side');
  const S = source.curves, T = target.curves;
  const wpt = mat(wptNormalization(source, light), wptNormalization(target, light));
  const xyz = times(times(T, transpose(S)), inv3(times(S, transpose(S)) as Mat3)) as Mat3;
  const P = times(transpose(T), inv3(times(T, transpose(T)) as Mat3));
  const primaries = inv3(times(S, P) as Mat3);
  const make = (id: MethodId, title: string, keeps: string, m: Mat3): Conversion => ({
    id, title, keeps, mat: m, observer: { name: `${source.name}, ${title}`, curves: apply(m, S) as unknown as Observer['curves'] },
  });
  return [
    make('wpt', 'Wpt based (the MAT)', 'predicts material color: the colors of materials in the target condition', wpt),
    make('xyz', 'XYZ based', 'a spectral match: the curves as near the target observer\'s as a regression gets', xyz),
    make('xyzWhite', 'XYZ based, white balanced', 'a spectral match, each curve then rescaled so that the target light\'s white matches', whiteBalance(xyz, S, T, light)),
    make('primaries', 'Primary based', 'a match with the same primaries: the target observer\'s, as the source observer matches them', primaries),
    make('primariesWhite', 'Primary based, white balanced', 'the target light\'s white: a match with primaries of the same chromaticities as the target observer\'s, each at another intensity', whiteBalance(primaries, S, T, light)),
  ];
}

/**
 * How far a converted observer's curves are from the target observer's: the RMS difference of each curve over 380 to
 * 780 nm as a share of the target curve's peak, the three averaged, with the target's curves scaled so that the two
 * see `light` with the same second response.
 */
export function curveRms(converted: Observer, target: Observer, light: Spectrum): number {
  const k = weighted(converted.curves, light)[1] / weighted(target.curves, light)[1];
  return converted.curves.reduce((sum, c, i) => {
    const t = target.curves[i].map((v) => v * k), peak = Math.max(...t.map(Math.abs));
    return sum + Math.sqrt(c.reduce((s, v, j) => s + (v - t[j]) ** 2, 0) / c.length) / peak;
  }, 0) / converted.curves.length;
}

/**
 * The WLab difference of each object when a converted observer's responses are read as the target observer's (through
 * the target observer's Wpt normalization under `light`), against the target observer's own: what using the converted
 * observer in the target observer's place gives.
 */
export function deltaEsAsTarget(converted: Observer, target: Observer, light: Spectrum, reflectances: readonly (readonly number[])[]): Float64Array {
  const n = wptNormalization(target, light), toWpt = n.toWpt as Mat3;
  const out = new Float64Array(reflectances.length);
  reflectances.forEach((r, j) => {
    const a = wptToWlab(mulMV(toWpt, responses(r, converted, light))), b = n.wlabOf(r);
    out[j] = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  });
  return out;
}

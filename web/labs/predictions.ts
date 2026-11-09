// Lab G's computations: how well each transform predicts the colors of objects in a destination observing condition
// from their colors in a source condition. Between two lights seen by one observer, the Wpt MAT against the chromatic
// adaptation transforms (Bradford, CAT02, von Kries scaling of XYZ); between two observers under one light, the Wpt MAT
// against the other ways of converting an observer (Lab D's conversions). Each error is the difference between the
// predicted and the true destination color: ΔE00 in the destination's CIELAB (for an observer whose responses are XYZ),
// and ΔE_WLab through the destination's Wpt normalization.

import {
  cat, CAT02, deltaE00, deltaEWlab, inv3, mat, mulMM, mulMV, responses, sensorResponses, wavelengths, wptNormalization, wptToWlab,
  xyzToLab, type Mat3, type Observer, type SampleSet, type Spectrum, type Vec3,
} from '../../src/index.ts';
import { conversions } from './conversions.ts';

export interface Side { observer: Observer; light: Spectrum }
export interface Pair { label: string; group: string; source: Side; destination: Side }

/** A transform's errors over the objects: ΔE00 (when the destination's responses are XYZ) and ΔE_WLab, object by object. */
export interface Errors { transform: string; de00?: Float64Array; dewlab: Float64Array }

/** The transforms between two lights seen by one observer: the MAT and the chromatic adaptation transforms. */
export const LIGHT_TRANSFORMS = ['Wpt MAT', 'Bradford', 'CAT02', 'von Kries (XYZ)'] as const;
/** The transforms between two observers under one light: Lab D's ways of converting an observer. */
export const OBSERVER_TRANSFORMS = ['Wpt MAT', 'XYZ based', 'XYZ based, white balanced', 'Primary based', 'Primary based, white balanced'] as const;

/** One step of a transform: what it is called, and the matrix from the measurements to that step. */
export interface Stage { label: string; m: Mat3 }

/**
 * The steps of a transform for one condition, from its measurements (stage 0) to the common representation (the last):
 * 'wpt' the four of the Wpt normalization, 'cat02' CAT02's two, 'vk' von Kries's one.
 */
export function transformStages(kind: string, observer: Observer, light: Spectrum): Stage[] {
  const I: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const white = sensorResponses(new Array(81).fill(1), observer, light) as Vec3;
  if (kind === 'wpt') {
    const n = wptNormalization(observer, light), R = n.steps.rotation as Mat3;
    const S = mulMM([[n.steps.scale, 0, 0], [0, 1, 0], [0, 0, 1]], R);
    const a = n.steps.level, L: Mat3 = [S[0].map((v, j) => v - a[0] * S[1][j] - a[1] * S[2][j]) as unknown as Vec3, S[1], S[2]];
    return [{ label: 'measured', m: I }, { label: '1. white turned onto the first axis', m: R }, { label: '2. white scaled to W = 100', m: S },
      { label: '3. the base colors leveled to one W', m: L }, { label: '4. fitted to the reference: Wpt, the common representation', m: n.toWpt }];
  }
  if (kind === 'cat02') {
    const sharp = CAT02, w = mulMV(sharp, white);
    return [{ label: 'measured (XYZ)', m: I }, { label: '1. sharpened into cone-like channels', m: sharp },
      { label: '2. each channel scaled so that white is 100, 100, 100: the common representation', m: mulMM([[100 / w[0], 0, 0], [0, 100 / w[1], 0], [0, 0, 100 / w[2]]], sharp) }];
  }
  return [{ label: 'measured', m: I }, { label: '1. each channel scaled so that white is 100, 100, 100: the common representation', m: [[100 / white[0], 0, 0], [0, 100 / white[1], 0], [0, 0, 100 / white[2]]] }];
}

/** A measurement in one condition carried to another: into the common representation by the first's steps, out by the second's. */
export function carry(kind: string, from: Side, to: Side, measured: Vec3): Vec3 {
  const inward = transformStages(kind, from.observer, from.light).at(-1)!.m, outward = transformStages(kind, to.observer, to.light).at(-1)!.m;
  return mulMV(inv3(outward), mulMV(inward, measured));
}

export { ledPeak, RGB_LED_PEAKS, rgbLed } from './lights.ts';

const sameObserver =(a: Observer, b: Observer) => a === b || (a.curves.length === b.curves.length && a.curves.every((c, i) => c.every((v, j) => v === b.curves[i][j])));

/**
 * The errors of each transform for a pair. A pair of lights needs one observer (whose responses are XYZ, for the
 * CATs); a pair of observers, one light.
 */
export function predictPair(p: Pair, objects: SampleSet, xyzDestination: boolean): Errors[] {
  const { source: s, destination: d } = p, R = objects.reflectances;
  const nd = wptNormalization(d.observer, d.light);
  const actual = R.map((r) => responses(r, d.observer, d.light));
  const actualLab = xyzDestination ? actual.map((x) => xyzToLab(x, nd.white)) : undefined;
  const actualWlab = R.map((r) => nd.wlabOf(r));
  const errorsOf = (transform: string, predicted: (r: readonly number[], k: number) => readonly number[]): Errors => {
    const de00 = xyzDestination ? new Float64Array(R.length) : undefined, dewlab = new Float64Array(R.length);
    R.forEach((r, k) => {
      const x = predicted(r, k) as [number, number, number];
      if (de00) de00[k] = deltaE00(xyzToLab(x, nd.white), actualLab![k]);
      dewlab[k] = deltaEWlab(wptToWlab(mulMV(nd.toWpt, x)), actualWlab[k]);
    });
    return { transform, de00, dewlab };
  };
  if (sameObserver(s.observer, d.observer)) {
    const ns = wptNormalization(s.observer, s.light), src = R.map((r) => responses(r, s.observer, s.light));
    const T: Mat3[] = [mat(ns, nd), cat(ns.white, nd.white, 'bradford'), cat(ns.white, nd.white, 'cat02'), cat(ns.white, nd.white, 'xyz')];
    return LIGHT_TRANSFORMS.map((name, i) => errorsOf(name, (_, k) => mulMV(T[i], src[k])));
  }
  if (s.light !== d.light) throw new Error('a pair changes either the light or the observer, not both');
  // each conversion as an observer: its responses, read as the destination observer's, are the prediction
  return conversions(s.observer, d.observer, d.light).map((c, i) => errorsOf(OBSERVER_TRANSFORMS[i], (r) => responses(r, c.observer, d.light)));
}

/** The mean, 90th percentile and largest of a set of errors. */
export function summarize(v: ArrayLike<number>): { mean: number; p90: number; max: number } {
  const s = Array.from(v).sort((a, b) => a - b);
  return { mean: s.reduce((a, x) => a + x, 0) / s.length, p90: s[Math.min(s.length - 1, Math.round(0.9 * (s.length - 1)))], max: s[s.length - 1] };
}

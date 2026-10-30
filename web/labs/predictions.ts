// Lab G's computations: how well each transform predicts the colors of objects in a destination observing condition
// from their colors in a source condition. Between two lights seen by one observer, the Wpt MAT against the chromatic
// adaptation transforms (Bradford, CAT02, von Kries scaling of XYZ); between two observers under one light, the Wpt MAT
// against the other ways of converting an observer (Lab D's conversions). Each error is the difference between the
// predicted and the true destination color: ΔE00 in the destination's CIELAB (for an observer whose responses are XYZ),
// and ΔE_WLab through the destination's Wpt normalization.

import {
  cat, deltaE00, deltaEWlab, inv3, mat, mulMV, responses, wavelengths, wptNormalization, wptToWlab, xyzToLab, type Mat3,
  type Observer, type SampleSet, type Spectrum, type Vec3,
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

/** The RGB LED's three peaks: blue, green and red, each with its full width at half its height, in nm. */
export const RGB_LED_PEAKS = [{ peak: 455, width: 20 }, { peak: 530, width: 35 }, { peak: 630, width: 18 }] as const;

/**
 * One LED peak, in a common model of an LED's spectrum: a Gaussian sharpened at its top, (g + 2g⁵) / 3, with g a
 * Gaussian; it falls to half its height 0.92182 of g's width parameter from side to side.
 */
export function ledPeak(peak: number, width: number): Spectrum {
  const w = width / 0.92182;
  return wavelengths.map((l) => { const g = Math.exp(-(((l - peak) / w) ** 2)); return (g + 2 * g ** 5) / 3; });
}

/**
 * An RGB LED whose three peaks are mixed so that `observer`'s responses to it are exactly its responses to `white`:
 * the same white point (and luminance) for that observer, from a very different spectrum.
 */
export function rgbLed(observer: Observer, white: Spectrum): Spectrum {
  const peaks = RGB_LED_PEAKS.map((p) => ledPeak(p.peak, p.width));
  const raw = (s: Spectrum) => observer.curves.slice(0, 3).map((c) => c.reduce((a, v, i) => a + v * s[i], 0)) as unknown as Vec3;
  const cols = peaks.map(raw), M = [0, 1, 2].map((r) => cols.map((c) => c[r])) as unknown as Mat3;
  const w = mulMV(inv3(M), raw(white));
  return wavelengths.map((_, i) => w[0] * peaks[0][i] + w[1] * peaks[1][i] + w[2] * peaks[2][i]);
}

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

/** Spectra on the package's grid (380 to 780 nm, 5 nm), the CIE observers and illuminants, and sensor responses. */

import { illuminantData, observerData, scotopicData, wavelengths } from './data.ts';
import type { Vec3 } from './linalg.ts';

export { wavelengths };

/** A spectrum on the package grid: 81 values at 380, 385, … 780 nm. */
export type Spectrum = readonly number[];

/**
 * An observer: its sensitivity curves (color-matching functions, cone fundamentals or camera sensors): three for
 * colorimetry, or more (a multispectral camera, say), which `wptNormalizationN` takes.
 */
export interface Observer {
  readonly name: string;
  readonly curves: readonly Spectrum[];
}

export const observers = {
  cie1931: { name: 'CIE 1931 (2°)', curves: observerData.cie1931 },
  cie1964: { name: 'CIE 1964 (10°)', curves: observerData.cie1964 },
  cie2015: { name: 'CIE 2015 (2°)', curves: observerData.cie2015 },
  cie2015_10: { name: 'CIE 2015 (10°)', curves: observerData.cie2015_10 },
  cie2006_2: { name: 'CIE 2006 (2°)', curves: observerData.cie2006_2 },
  cie2006_10: { name: 'CIE 2006 (10°)', curves: observerData.cie2006_10 },
} as const satisfies Record<string, Observer>;

export type ObserverName = keyof typeof observers;

/** The CIE scotopic luminous efficiency function V'(λ), the rods' sensitivity (CIE 018:2019; peak 1 at 506 nm). */
export const scotopic: Spectrum = scotopicData;

/**
 * Observers with more than three sensors, for `wptNormalizationN`: the CIE 2006 10° cones plus the rods (V'(λ)),
 * an observer for mesopic vision, where rods add to what the cones see.
 */
export const observersN = {
  cie2006_10_rods: { name: 'CIE 2006 (10°) cones plus rods', curves: [...observerData.cie2006_10, scotopicData] },
} as const satisfies Record<string, Observer>;

/** CIE illuminants (relative spectral power). */
export const illuminants = illuminantData satisfies Record<string, Spectrum>;

export type IlluminantName = keyof typeof illuminants;

const N = wavelengths.length;

function check(s: Spectrum, what: string): void {
  if (s.length !== N) throw new Error(`wlab: ${what} must have ${N} values (380 to 780 nm in 5 nm steps); use resample()`);
}

/**
 * Resample a spectrum given at any wavelengths (ascending) onto the package grid: linear between the given points,
 * held constant beyond the first and last (as numpy.interp does).
 */
export function resample(nm: readonly number[], values: readonly number[]): Spectrum {
  if (nm.length !== values.length || nm.length === 0) throw new Error('wlab: resample needs as many values as wavelengths');
  return wavelengths.map((x) => {
    if (x <= nm[0]) return values[0];
    if (x >= nm[nm.length - 1]) return values[values.length - 1];
    let j = 1;
    while (nm[j] < x) j++;
    const t = (x - nm[j - 1]) / (nm[j] - nm[j - 1]);
    return values[j - 1] + t * (values[j] - values[j - 1]);
  });
}

/**
 * The responses of every sensor of `observer` to a material with spectral reflectance `reflectance` (0 to 1) under
 * `light`, scaled so that a perfect white has a second response of 100 (Y = 100 for the CIE observers).
 */
export function sensorResponses(reflectance: Spectrum, observer: Observer, light: Spectrum): number[] {
  check(reflectance, 'a reflectance');
  check(light, 'a light');
  const curves = observer.curves;
  if (curves.length < 3) throw new Error('wlab: an observer needs at least three sensors');
  let k = 0;
  const out = new Array<number>(curves.length).fill(0);
  for (let i = 0; i < N; i++) {
    const e = light[i];
    k += curves[1][i] * e;
    const s = reflectance[i] * e;
    for (let c = 0; c < curves.length; c++) out[c] += curves[c][i] * s;
  }
  k = 100 / k;
  return out.map((v) => v * k);
}

/** The three responses (XYZ for a CIE observer) of a three-sensor observer; see `sensorResponses` for more sensors. */
export function responses(reflectance: Spectrum, observer: Observer, light: Spectrum): Vec3 {
  if (observer.curves.length !== 3) throw new Error(`wlab: responses() is for three sensors, not ${observer.curves.length}; use sensorResponses()`);
  return sensorResponses(reflectance, observer, light) as Vec3;
}

/** A perfect white: reflectance 1 everywhere. */
export const ones: Spectrum = new Array(N).fill(1);

/**
 * The sensor responses of one observing condition as a function of reflectance, the same as `sensorResponses` but
 * with the curves weighted by the light (and scaled so that white's second response is 100) once, not on every call:
 * for building many normalizations and evaluating many materials.
 */
export function responder(observer: Observer, light: Spectrum): (reflectance: Spectrum) => number[] {
  check(light, 'a light');
  const curves = observer.curves;
  if (curves.length < 3) throw new Error('wlab: an observer needs at least three sensors');
  let k = 0;
  for (let i = 0; i < N; i++) k += curves[1][i] * light[i];
  k = 100 / k;
  const weights = curves.map((c) => {
    const w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = c[i] * light[i] * k;
    return w;
  });
  return (reflectance) => {
    check(reflectance, 'a reflectance');
    const out = new Array<number>(weights.length);
    for (let c = 0; c < weights.length; c++) {
      const w = weights[c];
      let s = 0;
      for (let i = 0; i < N; i++) s += w[i] * reflectance[i];
      out[c] = s;
    }
    return out;
  };
}

/** Responses of a perfect white (reflectance 1 everywhere): the condition's white, Y = 100 (three sensors). */
export const whiteOf = (observer: Observer, light: Spectrum): Vec3 => responses(ones, observer, light);

/** Responses of a perfect white for any number of sensors. */
export const sensorWhiteOf = (observer: Observer, light: Spectrum): number[] => sensorResponses(ones, observer, light);

export function observerOf(o: Observer | ObserverName): Observer {
  return typeof o === 'string' ? observers[o] : o;
}

export function lightOf(l: Spectrum | IlluminantName): Spectrum {
  return typeof l === 'string' ? illuminants[l] : l;
}

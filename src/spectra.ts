/** Spectra on the package's grid (380 to 780 nm, 5 nm), the CIE observers and illuminants, and sensor responses. */

import { illuminantData, observerData, wavelengths } from './data.ts';
import type { Vec3 } from './linalg.ts';

export { wavelengths };

/** A spectrum on the package grid: 81 values at 380, 385, … 780 nm. */
export type Spectrum = readonly number[];

/** An observer: three sensitivity curves (color-matching functions, cone fundamentals or camera sensors). */
export interface Observer {
  readonly name: string;
  readonly curves: readonly [Spectrum, Spectrum, Spectrum];
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
 * Sensor responses of a material with spectral reflectance `reflectance` (0 to 1) under `light`, for `observer`,
 * scaled so that a perfect white has a second response of 100 (Y = 100 for the CIE observers).
 */
export function responses(reflectance: Spectrum, observer: Observer, light: Spectrum): Vec3 {
  check(reflectance, 'a reflectance');
  check(light, 'a light');
  const [c1, c2, c3] = observer.curves;
  let k = 0;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const e = light[i];
    k += c2[i] * e;
    const s = reflectance[i] * e;
    out[0] += c1[i] * s;
    out[1] += c2[i] * s;
    out[2] += c3[i] * s;
  }
  k = 100 / k;
  return [out[0] * k, out[1] * k, out[2] * k];
}

const ones: Spectrum = new Array(N).fill(1);

/** Responses of a perfect white (reflectance 1 everywhere): the condition's white, Y = 100. */
export const whiteOf = (observer: Observer, light: Spectrum): Vec3 => responses(ones, observer, light);

export function observerOf(o: Observer | ObserverName): Observer {
  return typeof o === 'string' ? observers[o] : o;
}

export function lightOf(l: Spectrum | IlluminantName): Spectrum {
  return typeof l === 'string' ? illuminants[l] : l;
}

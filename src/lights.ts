/** Lights computed for any temperature: CIE daylight (the D series) and Planckian (blackbody) radiators. */

import { daylightComponents, wavelengths } from './data.ts';
import type { Spectrum } from './spectra.ts';

/**
 * CIE daylight of correlated color temperature `cct` (4000 to 25000 K), relative power 100 at 560 nm, from the
 * daylight components as in the Wpt toolbox's cieIllD.m (M1 and M2 not rounded): daylight(5000) is the package's D50.
 */
export function daylight(cct: number): Spectrum {
  if (!(cct >= 4000 && cct <= 25000)) throw new RangeError(`daylight is defined from 4000 to 25000 K, not ${cct} K`);
  const t = cct;
  const xD = t <= 7000
    ? -4.607e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
    : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.23704;
  const yD = -3.0 * xD ** 2 + 2.87 * xD - 0.275;
  const d = 0.0241 + 0.2562 * xD - 0.7341 * yD;
  const m1 = (-1.3515 - 1.7703 * xD + 5.9114 * yD) / d;
  const m2 = (0.03 - 31.4424 * xD + 30.0717 * yD) / d;
  const [s0, s1, s2] = daylightComponents;
  return s0.map((v, i) => v + m1 * s1[i] + m2 * s2[i]);
}

/** Second radiation constant (m K), as in CIE 15:2018. */
const C2 = 1.4388e-2;

/** A Planckian (blackbody) radiator at temperature `kelvin`, relative power 100 at 560 nm. */
export function planckian(kelvin: number): Spectrum {
  if (!(kelvin > 0)) throw new RangeError(`the temperature must be positive, not ${kelvin} K`);
  const m = (nm: number) => { const l = nm * 1e-9; return l ** -5 / Math.expm1(C2 / (l * kelvin)); };
  const k = 100 / m(560);
  return wavelengths.map((nm) => m(nm) * k);
}

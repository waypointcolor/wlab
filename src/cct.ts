/**
 * Correlated color temperature (CCT) and Duv of a light, from its chromaticity alone (CIE 015:2018): the temperature
 * of the point of the Planckian locus closest to the light in the CIE 1960 (u, v) diagram, for the CIE 1931 observer,
 * and the signed distance to it (Duv, positive above the locus, toward green; negative below, toward magenta). The
 * locus is computed on the package's grid, as every light here is.
 */

import type { Vec3 } from './linalg.ts';
import { planckian } from './lights.ts';
import { observers, whiteOf, type Spectrum } from './spectra.ts';

/** CIE 1960 (u, v) of XYZ. */
export function uv1960([x, y, z]: Vec3): [number, number] {
  const d = x + 15 * y + 3 * z;
  return [(4 * x) / d, (6 * y) / d];
}

const locus = (kelvin: number) => uv1960(whiteOf(observers.cie1931, planckian(kelvin)));

/**
 * The CCT (K) and Duv of a light, searched from 1000 to 100000 K: on a grid of reciprocal temperature, then by golden
 * section to well under 0.1 K.
 */
export function cct(light: Spectrum): { cct: number; duv: number } {
  const [u, v] = uv1960(whiteOf(observers.cie1931, light));
  // distances along the locus, by mired (10^6 / K), where the locus is close to evenly spaced
  const d2 = (mired: number) => { const [a, b] = locus(1e6 / mired); return (a - u) ** 2 + (b - v) ** 2; };
  const LO = 10, HI = 1000, STEPS = 400, step = (HI - LO) / STEPS;
  let best = LO, bestD = Infinity;
  for (let i = 0; i <= STEPS; i++) { const m = LO + step * i, d = d2(m); if (d < bestD) { bestD = d; best = m; } }
  let a = Math.max(LO, best - step), b = Math.min(HI, best + step);
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), e = a + g * (b - a), dc = d2(c), de = d2(e);
  while (b - a > 1e-7) {
    if (dc < de) { b = e; e = c; de = dc; c = b - g * (b - a); dc = d2(c); } else { a = c; c = e; dc = de; e = a + g * (b - a); de = d2(e); }
  }
  const m = (a + b) / 2, t = 1e6 / m, [, vp] = locus(t);
  return { cct: t, duv: Math.sign(v - vp) * Math.sqrt(d2(m)) };
}

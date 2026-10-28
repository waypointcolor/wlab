/**
 * The Wpt shift manifold difference metrics of Derhak's thesis ("Spectrally Based Material Color Equivalency",
 * RIT 2015, chapter on Wpt shift manifolds): mean WLab differences between corresponding points of the manifolds
 * that objects, observers and lights span. For observers, the Observer Matching Equivalency (OME) compares two
 * observers over the same objects and lights; for observing conditions, the Observing Conditions Equivalency (OCE)
 * compares two observer + light pairs over the same objects; for lights, the Illuminant Rendering Equivalency (IRE)
 * compares two lights over the same objects and observers. Lower is closer; 0 is the same in every case.
 */

import type { SampleSet } from './munsell1600.ts';
import type { Observer, Spectrum } from './spectra.ts';
import { wavelengths } from './data.ts';
import { wptToWlab } from './wlab.ts';
import { munsellBase, wptNormalizationN, type Base } from './wpt.ts';

const N = wavelengths.length;

/**
 * The WLab of every object in one observing condition (observer + light), packed three numbers per object
 * (Lw, aw, bw), each through the condition's own Wpt normalization. The same as `wptNormalizationN(observer,
 * light).wlabOf(r)` for each reflectance r, with the normalization folded into the curves once: for the many
 * objects × conditions a metric needs.
 */
export function wlabsOf(observer: Observer, light: Spectrum, objects: SampleSet, base: Base = munsellBase): Float64Array {
  const norm = wptNormalizationN(observer, light, base);
  const curves = observer.curves;
  let k = 0;
  for (let i = 0; i < N; i++) k += curves[1][i] * light[i];
  k = 100 / k;
  // g[c][i]: Wpt row c of the normalization times the curves, weighted by the light (white's second response 100)
  const g = norm.toWpt.map((row) => {
    const out = new Float64Array(N);
    for (let s = 0; s < row.length; s++) {
      const w = row[s] * k, c = curves[s];
      for (let i = 0; i < N; i++) out[i] += w * c[i] * light[i];
    }
    return out;
  });
  const out = new Float64Array(3 * objects.reflectances.length);
  objects.reflectances.forEach((r, j) => {
    let w = 0, p = 0, t = 0;
    for (let i = 0; i < N; i++) { w += g[0][i] * r[i]; p += g[1][i] * r[i]; t += g[2][i] * r[i]; }
    const lab = wptToWlab([w, p, t]);
    out[3 * j] = lab[0]; out[3 * j + 1] = lab[1]; out[3 * j + 2] = lab[2];
  });
  return out;
}

/** ΔE_WLab object by object between two packed WLab sets of the same objects (from `wlabsOf`). */
export function deltaEsOf(a: Float64Array, b: Float64Array): Float64Array {
  if (a.length !== b.length) throw new Error('wlab: the two sets of WLab values are for different numbers of objects');
  const out = new Float64Array(a.length / 3);
  for (let j = 0; j < out.length; j++) out[j] = Math.hypot(a[3 * j] - b[3 * j], a[3 * j + 1] - b[3 * j + 1], a[3 * j + 2] - b[3 * j + 2]);
  return out;
}

const meanOf = (v: ArrayLike<number>) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s / v.length; };

/**
 * Observer Matching Equivalency (thesis eq. "OME"): the mean ΔE_WLab between the Wpt of each object seen by the
 * test observer and by the alternate one, each through its own Wpt normalization under the same light, over every
 * object and light. Wpt equal for every object means the Luther-Ives condition holds between the two (a Wpt MAT maps
 * one onto the other exactly); the OME says on average how far from it they are.
 */
export function ome(test: Observer, alternate: Observer, lights: readonly Spectrum[], objects: SampleSet, base: Base = munsellBase): number {
  if (!lights.length) throw new Error('wlab: the OME needs at least one light');
  let s = 0;
  for (const l of lights) s += meanOf(deltaEsOf(wlabsOf(test, l, objects, base), wlabsOf(alternate, l, objects, base)));
  return s / lights.length;
}

/**
 * Illuminant Rendering Equivalency (thesis eq. "IRE"): the mean ΔE_WLab between the Wpt of each object under the
 * test light and under the alternate one, each observer through its own Wpt normalization under each light, over
 * every object and observer. It is 0 when the two lights render every object alike for every observer (the lights'
 * whites do not count: each normalization puts its light's white at the same Wpt).
 */
export function ire(test: Spectrum, alternate: Spectrum, observers: readonly Observer[], objects: SampleSet, base: Base = munsellBase): number {
  if (!observers.length) throw new Error('wlab: the IRE needs at least one observer');
  let s = 0;
  for (const o of observers) s += meanOf(deltaEsOf(wlabsOf(o, test, objects, base), wlabsOf(o, alternate, objects, base)));
  return s / observers.length;
}

/**
 * Observing Conditions Equivalency (thesis eq. "OCE"): the mean ΔE_WLab between the Wpt of each object in the test
 * observing condition and in the alternate one, over the objects. Unlike the OME, the two conditions may differ in
 * light as well as observer.
 */
export function oce(
  testObserver: Observer, testLight: Spectrum, alternateObserver: Observer, alternateLight: Spectrum, objects: SampleSet,
  base: Base = munsellBase,
): number {
  return meanOf(deltaEsOf(wlabsOf(testObserver, testLight, objects, base), wlabsOf(alternateObserver, alternateLight, objects, base)));
}

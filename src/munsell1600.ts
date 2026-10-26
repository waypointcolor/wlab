/** The 1,600 Munsell glossy colors (corrected), a test set: every hue, value and chroma of a Munsell book. */

import { MUNSELL_SCALE, munsellBaseIndex, munsellData, munsellNames } from './munsell1600data.ts';
import type { Spectrum } from './spectra.ts';

export interface SampleSet {
  readonly names: readonly string[];
  readonly reflectances: readonly Spectrum[];
}

let cache: SampleSet | undefined;

/**
 * The 1,600 Munsell glossy colors measured by the University of Eastern Finland and corrected to the Munsell
 * renotation by Derhak and Berns (2012), in Munsell notation, on the package's grid (stored to 1/32000). With
 * `withoutBase`, the 40 base colors of the Wpt normalization are left out: a test set the normalization never saw.
 */
export function munsell1600(withoutBase = false): SampleSet {
  if (!cache) {
    const bin = atob(munsellData);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const reflectances = munsellNames.map((_, j) => Array.from({ length: 81 }, (_, i) => view.getInt16((j * 81 + i) * 2, true) / MUNSELL_SCALE));
    cache = { names: munsellNames, reflectances };
  }
  if (!withoutBase) return cache;
  const base = new Set(munsellBaseIndex);
  const keep = cache.names.map((_, i) => !base.has(i));
  return { names: cache.names.filter((_, i) => keep[i]), reflectances: cache.reflectances.filter((_, i) => keep[i]) };
}

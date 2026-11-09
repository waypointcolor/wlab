// Lab J's computations: large and small color differences. The corrected Munsell colors placed in WLab, LSWLab and
// CIELAB for one observing condition, pairs of them from neighbors to far apart, and how closely one set of
// differences follows another (STRESS).

import { deltaE00, wlabToLswlab, type Vec3, type WptNormalization } from '../../src/index.ts';
import { inSpace, MUNSELL_HUES, munsellChips, type MunsellChip } from './hue.ts';

/** A Munsell chip placed in the three spaces of the lab, in one condition. */
export interface Placed { chip: MunsellChip; wl: Vec3; ls: Vec3; lab: Vec3 }

/** Every corrected Munsell chip in WLab, LSWLab and CIELAB (the condition's own white) for one condition. */
export function placeAll(norm: WptNormalization): Placed[] {
  return munsellChips().map((chip) => { const wl = norm.wlabOf(chip.reflectance); return { chip, wl, ls: wlabToLswlab(wl), lab: inSpace('cielab', wl, norm) }; });
}

/**
 * Pairs of chips: neighbors, one Munsell step apart (2 in Chroma, one Hue of the 40, or 1 in Value), and random pairs,
 * the same every time (a fixed seed), with no chip paired with itself.
 */
export function munsellPairs(chips: readonly Placed[], randomCount = 3000): { near: [Placed, Placed][]; far: [Placed, Placed][] } {
  const key = (h: string, v: number, c: number) => `${h} ${v}/${c}`;
  const at = new Map(chips.map((x) => [key(x.chip.hue, x.chip.value, x.chip.chroma), x]));
  const near: [Placed, Placed][] = [];
  for (const x of chips) {
    const { hue, value, chroma } = x.chip, next = MUNSELL_HUES[(MUNSELL_HUES.indexOf(hue) + 1) % MUNSELL_HUES.length];
    for (const k of [key(hue, value, chroma + 2), key(next, value, chroma), key(hue, value + 1, chroma)]) {
      const y = at.get(k);
      if (y) near.push([x, y]);
    }
  }
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const far: [Placed, Placed][] = [];
  while (far.length < randomCount) {
    const a = chips[Math.floor(rnd() * chips.length)], b = chips[Math.floor(rnd() * chips.length)];
    if (a !== b) far.push([a, b]);
  }
  return { near, far };
}

/** The differences of pairs in each measure of the lab. */
export interface Differences { wlab: number[]; lswlab: number[]; ab: number[]; e00: number[] }
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function differencesOf(pairs: readonly [Placed, Placed][]): Differences {
  return {
    wlab: pairs.map(([a, b]) => dist(a.wl, b.wl)), lswlab: pairs.map(([a, b]) => dist(a.ls, b.ls)),
    ab: pairs.map(([a, b]) => dist(a.lab, b.lab)), e00: pairs.map(([a, b]) => deltaE00(a.lab, b.lab)),
  };
}

/**
 * STRESS between differences `de` and reference differences `ref`: 0 when the two are proportional, larger the more
 * they disagree; `scale` is the factor between them that STRESS allows for (1 when they are the same size), and
 * `meanError` the mean of |de − ref| / ref, in percent, with no factor.
 */
export function stress(de: readonly number[], ref: readonly number[]): { stress: number; scale: number; meanError: number } {
  const F = de.reduce((s, v) => s + v * v, 0) / de.reduce((s, v, i) => s + v * ref[i], 0);
  const s = 100 * Math.sqrt(de.reduce((t, v, i) => t + (v - F * ref[i]) ** 2, 0) / ref.reduce((t, v) => t + (F * v) ** 2, 0));
  const meanError = (100 * de.reduce((t, v, i) => t + Math.abs(v - ref[i]) / ref[i], 0)) / de.length;
  return { stress: s, scale: F, meanError };
}

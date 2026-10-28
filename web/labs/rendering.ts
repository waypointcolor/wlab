// The color rendering indices of a light, for Lab E beside the IRE: the CIE color rendering index (CIE 13.3-1995: Ra
// and R1 to R14), the CIE 2017 color fidelity index (CIE 224:2017: Rf) and ANSI/IES TM-30-18 (Rf, Rg and the 16 hue
// bins). Each compares the light with a reference made from its CCT, over a set of samples; the CCT comes from the
// light's chromaticity alone (src/cct.ts).

import {
  cam02ucs, cct, daylight, observers, planckian, responses, uv1960, whiteOf, type SampleSet, type Spectrum, type Vec3,
} from '../../src/index.ts';

const meanOf = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;

// ---------------------------------------------------------------------------------------------------------------
// CIE 13.3: the color rendering index

export interface Cri {
  cct: number; duv: number;
  /** the chromaticity distance DC between the light and its reference (CIE 13.3 asks for under 5.4 × 10⁻³) */
  dc: number;
  reference: string; ra: number;
  /** the special indices R1 to R14 (as many as there are samples) */
  r: number[];
}

/**
 * The CIE color rendering index of a light over the test color samples `tcs` (the first 8 give Ra): the reference a
 * Planckian light at the light's CCT below 5000 K and CIE daylight at and above it; the samples' colors under the light
 * adapted to the reference by the von Kries transform of CIE 13.3 in the CIE 1960 UCS, and compared in U*V*W*.
 */
export function cri(light: Spectrum, tcs: SampleSet): Cri {
  const { cct: t, duv } = cct(light);
  const isDay = t >= 5000, ref = isDay ? daylight(t) : planckian(t), o = observers.cie1931;
  const cd = (u: number, v: number) => [(4 - u - 10 * v) / v, (1.708 * v + 0.404 - 1.481 * u) / v];
  const [uk0, vk0] = uv1960(whiteOf(o, light)), [ur0, vr0] = uv1960(whiteOf(o, ref));
  const [ck, dk] = cd(uk0, vk0), [cr, dr] = cd(ur0, vr0);
  const adapt = (u: number, v: number) => {
    const [c, d] = cd(u, v), den = 16.518 + 1.481 * (cr / ck) * c - (dr / dk) * d;
    return [(10.872 + 0.404 * (cr / ck) * c - 4 * (dr / dk) * d) / den, 5.52 / den];
  };
  const uvw = (y: number, u: number, v: number) => { const w = 25 * Math.cbrt(y) - 17; return [13 * w * (u - ur0), 13 * w * (v - vr0), w]; };
  const r = tcs.reflectances.map((s) => {
    const xt = responses(s, o, light), xr = responses(s, o, ref);
    const [ut, vt] = uv1960(xt), [ua, va] = adapt(ut, vt), [ur, vr] = uv1960(xr);
    const a = uvw(xt[1], ua, va), b = uvw(xr[1], ur, vr);
    return 100 - 4.6 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  });
  return {
    cct: t, duv, dc: Math.hypot(uk0 - ur0, vk0 - vr0), r, ra: meanOf(r.slice(0, 8)),
    reference: `${isDay ? 'daylight' : 'Planckian'} ${Math.round(t)} K`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// CIE 224 and TM-30: the color fidelity index and the gamut index

/**
 * The reference of CIE 224 and TM-30 (since TM-30-18) for a CCT: Planckian below 4000 K, CIE daylight above 5000 K,
 * and between them a mix of the two, each first scaled to the same Y (CIE 1964), in proportion to where the CCT lies.
 * (TM-30-15 mixed from 4500 to 5500 K.)
 */
export function fidelityReference(t: number): { spd: Spectrum; name: string } {
  if (t < 4000) return { spd: planckian(t), name: `Planckian ${Math.round(t)} K` };
  if (t > 5000) return { spd: daylight(t), name: `daylight ${Math.round(t)} K` };
  const y = (s: Spectrum) => s.reduce((a, v, i) => a + v * observers.cie1964.curves[1][i], 0);
  const p = planckian(t), d = daylight(t), kp = 1 / y(p), kd = 1 / y(d), w = (t - 4000) / 1000;
  return { spd: p.map((v, i) => (1 - w) * kp * v + w * kd * d[i]), name: `a mix of Planckian and daylight at ${Math.round(t)} K` };
}

/** CIE 224 and TM-30 turn a mean CAM02-UCS difference into a score from 0 to 100. */
const score = (de: number) => 10 * Math.log(Math.exp((100 - 6.73 * de) / 10) + 1);

export interface HueBin {
  /** samples in the bin (by their hue under the reference) */
  count: number;
  /**
   * the local fidelity, chroma shift and hue shift (radians) of TM-30: the shifts are the bin's mean shift along and
   * across the angle bisecting the bin, over the distance of the reference's mean from neutral (as TM-30-18)
   */
  rf: number; rcs: number; rhs: number;
  /** the mean a′, b′ of the bin's samples under the reference and under the light */
  ref: [number, number]; test: [number, number];
}

export interface Fidelity {
  cct: number; duv: number; reference: string;
  /** the color fidelity index (CIE 224 Rf; TM-30 Rf, the same since TM-30-18) */
  rf: number;
  /** each sample's fidelity, Rf,i */
  rfi: number[];
  /** the gamut index of TM-30, from the 16 hue bins */
  rg: number;
  bins: HueBin[];
}

// CIE 224's viewing conditions: an adapting luminance of 100 cd/m², a background of 20, average surround, full adaptation
const VIEW = { la: 100, yb: 20, d: 1 } as const;

/**
 * The CIE 2017 color fidelity index (CIE 224) and the TM-30 gamut index of a light over the color evaluation samples
 * `ces` (the CIE's 99): each sample's CAM02-UCS color under the light and under the reference (CIE 1964 observer, each
 * against its own white), their mean difference as Rf, and the 16 hue bins of TM-30, by each sample's hue under the
 * reference, for Rg (the area of the light's bin means over the reference's) and the local shifts.
 */
export function fidelity(light: Spectrum, ces: SampleSet): Fidelity {
  const { cct: t, duv } = cct(light);
  const ref = fidelityReference(t), o = observers.cie1964;
  const wt = whiteOf(o, light), wr = whiteOf(o, ref.spd);
  const jab = (s: Spectrum, l: Spectrum, w: Vec3) => cam02ucs(responses(s, o, l), w, VIEW);
  const test = ces.reflectances.map((s) => jab(s, light, wt)), refs = ces.reflectances.map((s) => jab(s, ref.spd, wr));
  const de = test.map((a, i) => Math.hypot(a[0] - refs[i][0], a[1] - refs[i][1], a[2] - refs[i][2]));
  const bins: HueBin[] = Array.from({ length: 16 }, (_, j) => {
    const at = refs.map((r, i) => i).filter((i) => Math.floor((((Math.atan2(refs[i][2], refs[i][1]) * 180) / Math.PI + 360) % 360) / 22.5) === j);
    if (!at.length) return { count: 0, rf: NaN, rcs: NaN, rhs: NaN, ref: [NaN, NaN], test: [NaN, NaN] };
    const m = (v: Vec3[], k: number) => meanOf(at.map((i) => v[i][k]));
    const r: [number, number] = [m(refs, 1), m(refs, 2)], q: [number, number] = [m(test, 1), m(test, 2)];
    const th = ((22.5 * j + 11.25) * Math.PI) / 180, c = Math.hypot(r[0], r[1]), da = q[0] - r[0], db = q[1] - r[1];
    return {
      count: at.length, rf: score(meanOf(at.map((i) => de[i]))), ref: r, test: q,
      rcs: (da * Math.cos(th) + db * Math.sin(th)) / c, rhs: (db * Math.cos(th) - da * Math.sin(th)) / c,
    };
  });
  const area = (pts: [number, number][]) => Math.abs(pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const full = bins.filter((b) => b.count);
  return {
    cct: t, duv, reference: ref.name, rf: score(meanOf(de)), rfi: de.map(score), bins,
    rg: (100 * area(full.map((b) => b.test))) / area(full.map((b) => b.ref)),
  };
}

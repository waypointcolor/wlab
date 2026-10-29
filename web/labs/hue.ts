// Lab F's computations: CIELAB of a WLab color in an observing condition, the Munsell loci of constant Hue and Chroma
// in WLab and CIELAB with how far each Hue strays in hue angle, and the object-color solid of a condition (the colors
// of the reflectances that are 0 or 1, with one or two jumps) with its cross-sections at a WLab lightness.

import {
  cam16ucs, cam16ucsToXyz, labToXyz, munsell1600, wavelengths, wlabToWpt, wptNormalizationN, wptToWlab, xyzToLab, mulMV,
  type Observer, type Spectrum, type Vec3, type WptNormalization,
} from '../../src/index.ts';

const N = wavelengths.length;
const DEG = 180 / Math.PI;

/** The hue angle of an a, b pair, 0 to 360°. */
export const hueOf = (a: number, b: number) => ((Math.atan2(b, a) * DEG) + 360) % 360;

/**
 * The CIELAB, in an observing condition, of the material a WLab color stands for: its Wpt carried to the condition's
 * responses by the condition's normalization (the MAT's prediction), against the condition's white. For observers whose
 * responses are XYZ (the CIE color-matching functions).
 */
export function labInCondition(wlab: Vec3, norm: WptNormalization): Vec3 {
  return xyzToLab(mulMV(norm.fromWpt, wlabToWpt(wlab)), norm.white);
}

/** The spaces WLab is compared with: CIELAB, and CAM16-UCS. */
export type Compared = 'cielab' | 'cam16';
export const COMPARED_LABEL: Record<Compared, string> = { cielab: 'CIELAB', cam16: 'CAM16-UCS' };

/**
 * The viewing conditions CAM16 is computed for: an adapting luminance of 100 cd/m², a background of Yb 20, an average
 * surround, and full adaptation to the condition's white (as CIE 224 takes them for CAM02-UCS, and as WLab takes each
 * condition's white for its own).
 */
export const CAM16_VIEW = { la: 100, yb: 20, d: 1 } as const;

/**
 * The lightness, a and b, in a compared space, of the material a WLab color stands for in an observing condition (its
 * Wpt carried to the condition's responses by the condition's normalization): CIELAB L*, a*, b*, or CAM16-UCS J′, a′,
 * b′. For observers whose responses are XYZ (the CIE color-matching functions).
 */
export function inSpace(space: Compared, wlab: Vec3, norm: WptNormalization): Vec3 {
  const xyz = mulMV(norm.fromWpt, wlabToWpt(wlab));
  return space === 'cielab' ? xyzToLab(xyz, norm.white) : cam16ucs(xyz, norm.white, CAM16_VIEW);
}

/** The way back: the WLab of the material that has these coordinates in a compared space, in an observing condition. */
export function fromSpace(space: Compared, v: Vec3, norm: WptNormalization): Vec3 {
  const xyz = space === 'cielab' ? labToXyz(v, norm.white) : cam16ucsToXyz(v, norm.white, CAM16_VIEW);
  return wptToWlab(mulMV(norm.toWpt, xyz));
}

// ---------------------------------------------------------------------------------------------------------------
// Munsell loci

/** The 40 Hues of a Munsell Book of Color: 2.5, 5, 7.5 and 10 of each of the ten families, around the hue circle. */
export const MUNSELL_HUES: readonly string[] = ['R', 'YR', 'Y', 'GY', 'G', 'BG', 'B', 'PB', 'P', 'RP'].flatMap((f) => ['2.5', '5', '7.5', '10'].map((s) => `${s}${f}`));

export interface MunsellChip { hue: string; value: number; chroma: number; reflectance: Spectrum }

let chips: MunsellChip[] | undefined;
/**
 * The corrected Munsell colors of the 40 Hues at whole Values (2 to 9) and even Chromas (2, 4, 6 …, as the Book's
 * pages hold them; the set's few Chroma 1 chips are left out), by Hue, Value and Chroma.
 */
export function munsellChips(): readonly MunsellChip[] {
  if (!chips) {
    const s = munsell1600();
    chips = [];
    s.names.forEach((n, j) => {
      const m = /^(\S+) (\d+)\/(\d+)$/.exec(n);
      if (m && MUNSELL_HUES.includes(m[1]) && Number(m[3]) % 2 === 0) chips!.push({ hue: m[1], value: Number(m[2]), chroma: Number(m[3]), reflectance: s.reflectances[j] });
    });
  }
  return chips;
}

/** How far a set of hue angles (degrees) strays: the spread from the smallest to the largest, and the RMS about their mean. */
export function hueSpread(angles: readonly number[]): { range: number; rms: number } {
  if (angles.length < 2) return { range: 0, rms: 0 };
  const r = angles.map((h) => h / DEG);
  const mean = Math.atan2(r.reduce((s, x) => s + Math.sin(x), 0), r.reduce((s, x) => s + Math.cos(x), 0));
  const d = r.map((x) => (Math.atan2(Math.sin(x - mean), Math.cos(x - mean))) * DEG);
  return { range: Math.max(...d) - Math.min(...d), rms: Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length) };
}

// ---------------------------------------------------------------------------------------------------------------
// The object-color solid

/**
 * The Wpt of each one-wavelength slice of the spectrum (a reflectance of 1 at that wavelength and 0 elsewhere): the
 * Wpt of any reflectance is their sum weighted by it, so the solid is built from these.
 */
export function sliceWpts(observer: Observer, light: Spectrum): Vec3[] {
  const norm = wptNormalizationN(observer, light);
  return wavelengths.map((_, k) => norm.wptOf(wavelengths.map((__, i) => (i === k ? 1 : 0))));
}

/**
 * The colors on the surface of the object-color solid: the reflectances that are 1 over a band of the spectrum and 0
 * elsewhere, or 0 over a band and 1 elsewhere (every start and every width on the grid; about 6,500), as Wpt.
 */
export function optimalWpts(slices: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    const w: Vec3 = [0, 0, 0];
    for (let len = 1; len < N; len++) {
      const s = slices[(i + len - 1) % N];
      w[0] += s[0]; w[1] += s[1]; w[2] += s[2];
      out.push([w[0], w[1], w[2]]);
    }
  }
  return out;
}

/**
 * The cross-section of the object-color solid at WLab lightness `lw`, as an outline in the aw, bw plane. Lw depends on
 * W alone, so the cut is the plane of one W in Wpt. The solid's surface is made of flat faces whose edges each add one
 * wavelength to a band, at its long end or at its short end; the cut's corners are where those edges cross the plane.
 * For each band's fixed start the band is widened at its long end until its W crosses that of the cut, and for each
 * fixed end it is widened at its short end, each crossing found between the two widths on either side. The cut is
 * convex in Wpt, around neutral, so its corners are taken in order of angle; between them the outline is straight in
 * Wpt and curved in WLab, and is followed in `steps` steps.
 */
export function crossSection(slices: readonly Vec3[], lw: number, steps = 8): [number, number][] {
  const w0 = wlabToWpt([lw, 0, 0])[0];
  const cut: [number, number][] = [];
  for (const dir of [1, -1]) {
    for (let i = 0; i < N; i++) {
      let prev: Vec3 = [0, 0, 0];
      for (let len = 1; len < N; len++) {
        const s = slices[(((i + dir * (len - 1)) % N) + N) % N], cur: Vec3 = [prev[0] + s[0], prev[1] + s[1], prev[2] + s[2]];
        if (prev[0] < w0 && cur[0] >= w0) {
          const f = (w0 - prev[0]) / (cur[0] - prev[0]);
          cut.push([prev[1] + f * (cur[1] - prev[1]), prev[2] + f * (cur[2] - prev[2])]);
          break;
        }
        prev = cur;
      }
    }
  }
  cut.sort((p, q) => Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]));
  const out: [number, number][] = [];
  cut.forEach((p, k) => {
    const q = cut[(k + 1) % cut.length];
    for (let s = 0; s < steps; s++) {
      const f = s / steps, [, a, b] = wptToWlab([w0, p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])]);
      out.push([a, b]);
    }
  });
  return out;
}

/** The area inside an outline of points around the origin, in order. */
export function areaOf(pts: readonly [number, number][]): number {
  let s = 0;
  for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(s) / 2;
}

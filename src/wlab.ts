/** WLab (Waypoint Lab): Wpt reshaped so that a straight-line distance works as a color difference (annex A.5). */

import type { Vec3 } from './linalg.ts';

/** The full-precision constants; the WLab paper prints them rounded (0.0267, 51.5762, 0.4589). */
export const G0 = 0.026742553710937;
export const G1 = 51.576165618406904;
export const G2 = 0.45888671875;

const rad = Math.PI / 180;
const mod360 = (h: number): number => ((h % 360) + 360) % 360;

/** Polar form of a three-coordinate value: [lightness, chroma, hue angle in degrees, 0 to 360]. */
export function toPolar([l, a, b]: Vec3): Vec3 {
  return [l, Math.hypot(a, b), mod360(Math.atan2(b, a) / rad)];
}

/** Cartesian form of a polar value [lightness, chroma, hue angle in degrees]. */
export function fromPolar([l, c, h]: Vec3): Vec3 {
  return [l, c * Math.cos(h * rad), c * Math.sin(h * rad)];
}

function hueTerms(h: number): [number, number] {
  let r = 0;
  if (h > 1 && h < 181) r += Math.sin((h - 1) * rad) ** 3;
  if (h > 104 && h < 284) r += 0.39 * Math.cos((h - 14) * rad) ** 2;
  return [62 * (r + 0.31), 0.36 * (r + 0.19)];
}

const scale = (lw: number): number => Math.exp(G0 * (lw - G1)) / G2;

/** Wpt [W, p, t] to WLab [Lw, aw, bw]. The hue angle is kept: hw = hpt. */
export function wptToWlab(wpt: Vec3): Vec3 {
  const [w, cpt, h] = toPolar(wpt);
  const y = w / 100;
  const lw = 116 * (y > (6 / 29) ** 3 ? Math.cbrt(y) : (1 / 3) * (29 / 6) ** 2 * y + 16 / 116) - 16;
  const [d0, d1] = hueTerms(h);
  const cw = d0 * (Math.log(cpt / scale(lw) / 80 + d1) - Math.log(d1));
  return fromPolar([lw, cw, h]);
}

/** WLab [Lw, aw, bw] back to Wpt [W, p, t]; the exact inverse of wptToWlab. */
export function wlabToWpt(wlab: Vec3): Vec3 {
  const [lw, cw, h] = toPolar(wlab);
  const [d0, d1] = hueTerms(h);
  const cpt = 80 * (Math.exp(cw / d0 + Math.log(d1)) - d1) * scale(lw);
  const v = (lw + 16) / 116;
  const w = 100 * (v > 6 / 29 ? v ** 3 : 3 * (6 / 29) ** 2 * (v - 4 / 29));
  return fromPolar([w, cpt, h]);
}

/** ΔE_WLab: the straight-line distance between two WLab values (written ΔE_w in the WLab paper). */
export function deltaEWlab(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

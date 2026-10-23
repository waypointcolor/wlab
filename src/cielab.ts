/** CIELAB, ΔE*ab and CIEDE2000, for comparison with WLab (annex A.2). */

import type { Vec3 } from './linalg.ts';

const rad = Math.PI / 180;

/** CIELAB of tristimulus values `xyz` relative to the white `white` of the same light (classic CIE constants). */
export function xyzToLab(xyz: Vec3, white: Vec3): Vec3 {
  const f = xyz.map((v, i) => {
    const q = v / white[i];
    return q > 0.008856 ? Math.cbrt(q) : 7.787 * q + 16 / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

/** XYZ of a CIELAB value; the inverse of xyzToLab. */
export function labToXyz([l, a, b]: Vec3, white: Vec3): Vec3 {
  const fy = (l + 16) / 116;
  const f = [fy + a / 500, fy, fy - b / 200];
  const lim = Math.cbrt(0.008856);
  return f.map((v, i) => (v > lim ? v ** 3 : (v - 16 / 116) / 7.787) * white[i]) as Vec3;
}

/** ΔE*ab: the straight-line distance in CIELAB. */
export function deltaEab(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** CIEDE2000 (ΔE00), as written out by Sharma, Wu and Dalal (2005). */
export function deltaE00([L1, a1, b1]: Vec3, [L2, a2, b2]: Vec3): number {
  const cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1, ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1), cp2 = Math.hypot(ap2, b2);
  const hue = (b: number, a: number) => (((Math.atan2(b, a) / rad) % 360) + 360) % 360;
  const hp1 = cp1 === 0 ? 0 : hue(b1, ap1), hp2 = cp2 === 0 ? 0 : hue(b2, ap2);
  const zero = cp1 * cp2 === 0;
  let dh = hp2 - hp1;
  dh = dh > 180 ? dh - 360 : dh < -180 ? dh + 360 : dh;
  if (zero) dh = 0;
  const dhp = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad);
  const lpm = (L1 + L2) / 2, cpm = (cp1 + cp2) / 2, hs = hp1 + hp2;
  const far = Math.abs(hp1 - hp2) > 180;
  const hpm = zero ? hs : far ? (hs < 360 ? (hs + 360) / 2 : (hs - 360) / 2) : hs / 2;
  const t = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad)
    + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
  const rc = 2 * Math.sqrt(cpm ** 7 / (cpm ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lpm - 50) ** 2) / Math.sqrt(20 + (lpm - 50) ** 2);
  const sc = 1 + 0.045 * cpm, sh = 1 + 0.015 * cpm * t;
  const rt = -Math.sin(2 * 30 * Math.exp(-(((hpm - 275) / 25) ** 2)) * rad) * rc;
  const dl = (L2 - L1) / sl, dc = (cp2 - cp1) / sc, dhh = dhp / sh;
  return Math.sqrt(dl ** 2 + dc ** 2 + dhh ** 2 + rt * dc * dhh);
}

/**
 * CIECAM02 (CIE 159:2004) and its uniform color space CAM02-UCS (Luo, Cui and Li, 2006), as the CIE 2017 color
 * fidelity index (CIE 224) and ANSI/IES TM-30 use them: the lightness J, colorfulness M and hue angle h of a color seen
 * against a white, and J′, a′, b′ for color differences.
 */

import { inv3, mulMM, mulMV, type Mat3, type Vec3 } from './linalg.ts';

const M_CAT02: Mat3 = [[0.7328, 0.4296, -0.1624], [-0.7036, 1.6975, 0.0061], [0.0030, 0.0136, 0.9834]];
const M_HPE: Mat3 = [[0.38971, 0.68898, -0.07868], [-0.22981, 1.18340, 0.04641], [0, 0, 1]];
const HPE_FROM_CAT02 = mulMM(M_HPE, inv3(M_CAT02));

/** Viewing conditions: the adapting luminance La (cd/m²), the background's Yb, the surround, and the degree of adaptation D (computed when not given). */
export interface Cam02Viewing { la: number; yb: number; surround?: 'average' | 'dim' | 'dark'; d?: number }

const SURROUNDS = { average: [1, 0.69, 1], dim: [0.9, 0.59, 0.9], dark: [0.8, 0.525, 0.8] } as const;

/** The CIECAM02 lightness J, chroma C, colorfulness M and hue angle h (degrees) of XYZ against the white `white`. */
export function cam02(xyz: Vec3, white: Vec3, v: Cam02Viewing): { j: number; c: number; m: number; h: number } {
  const [f, c, nc] = SURROUNDS[v.surround ?? 'average'];
  const d = v.d ?? Math.min(1, Math.max(0, f * (1 - (1 / 3.6) * Math.exp((-v.la - 42) / 92))));
  const k = 1 / (5 * v.la + 1), k4 = k ** 4;
  const fl = 0.2 * k4 * (5 * v.la) + 0.1 * (1 - k4) ** 2 * Math.cbrt(5 * v.la);
  const yw = white[1], n = v.yb / yw, nbb = 0.725 * (1 / n) ** 0.2, z = 1.48 + Math.sqrt(n);
  const rgbW = mulMV(M_CAT02, white);
  const adapted = (x: Vec3): Vec3 => {
    const rgb = mulMV(M_CAT02, x);
    const rgbC = rgb.map((u, i) => ((yw * d) / rgbW[i] + 1 - d) * u) as unknown as Vec3;
    return mulMV(HPE_FROM_CAT02, rgbC).map((u) => {
      const p = (fl * Math.abs(u) / 100) ** 0.42;
      return (Math.sign(u) * 400 * p) / (27.13 + p) + 0.1;
    }) as unknown as Vec3;
  };
  const [ra, ga, ba] = adapted(xyz), [rw, gw, bw] = adapted(white);
  const achromatic = (r: number, g: number, b: number) => (2 * r + g + b / 20 - 0.305) * nbb;
  const a = ra - (12 * ga) / 11 + ba / 11, b = (ra + ga - 2 * ba) / 9;
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const et = 0.25 * (Math.cos((h * Math.PI) / 180 + 2) + 3.8);
  const j = 100 * (achromatic(ra, ga, ba) / achromatic(rw, gw, bw)) ** (c * z);
  const t = ((50000 / 13) * nc * nbb * et * Math.hypot(a, b)) / (ra + ga + (21 / 20) * ba);
  const chroma = t ** 0.9 * Math.sqrt(j / 100) * (1.64 - 0.29 ** n) ** 0.73;
  return { j, c: chroma, m: chroma * fl ** 0.25, h };
}

/** CAM02-UCS J′, a′, b′ of XYZ against `white`. */
export function cam02ucs(xyz: Vec3, white: Vec3, v: Cam02Viewing): Vec3 {
  const { j, m, h } = cam02(xyz, white, v);
  const mp = Math.log(1 + 0.0228 * m) / 0.0228, hr = (h * Math.PI) / 180;
  return [(1.7 * j) / (1 + 0.007 * j), mp * Math.cos(hr), mp * Math.sin(hr)];
}

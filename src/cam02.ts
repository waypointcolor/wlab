/**
 * CIECAM02 (CIE 159:2004) and CAM16 (Li et al., 2017, the CIE's CAM16 of CIE 248:2022), with their uniform color
 * spaces CAM02-UCS (Luo, Cui and Li, 2006) and CAM16-UCS: the lightness J, colorfulness M and hue angle h of a color
 * seen against a white, and J′, a′, b′ for color differences; for both spaces, the way back from J′, a′, b′ to XYZ.
 * CAM16 is CIECAM02 with one matrix (M16) for adaptation and for the cone responses, where CIECAM02 uses CAT02 and then
 * the Hunt-Pointer-Estévez matrix.
 */

import { inv3, mulMM, mulMV, type Mat3, type Vec3 } from './linalg.ts';

const M_CAT02: Mat3 = [[0.7328, 0.4296, -0.1624], [-0.7036, 1.6975, 0.0061], [0.0030, 0.0136, 0.9834]];
const M_HPE: Mat3 = [[0.38971, 0.68898, -0.07868], [-0.22981, 1.18340, 0.04641], [0, 0, 1]];
const M_16: Mat3 = [[0.401288, 0.650173, -0.051461], [-0.250268, 1.204414, 0.045854], [-0.002079, 0.048952, 0.953127]];

/** A model: the matrix into the space where adaptation is done, and the one from there to the cone responses. */
interface Model { adapt: Mat3; toCones: Mat3 }
const MODELS: Record<'cam02' | 'cam16', Model> = {
  cam02: { adapt: M_CAT02, toCones: mulMM(M_HPE, inv3(M_CAT02)) },
  cam16: { adapt: M_16, toCones: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
};

/** Viewing conditions: the adapting luminance La (cd/m²), the background's Yb, the surround, and the degree of adaptation D (computed when not given). */
export interface Cam02Viewing { la: number; yb: number; surround?: 'average' | 'dim' | 'dark'; d?: number }

const SURROUNDS = { average: [1, 0.69, 1], dim: [0.9, 0.59, 0.9], dark: [0.8, 0.525, 0.8] } as const;

/** What a model needs of the viewing conditions and the white, worked out once. */
function setup(model: Model, white: Vec3, v: Cam02Viewing) {
  const [f, c, nc] = SURROUNDS[v.surround ?? 'average'];
  const d = v.d ?? Math.min(1, Math.max(0, f * (1 - (1 / 3.6) * Math.exp((-v.la - 42) / 92))));
  const k = 1 / (5 * v.la + 1), k4 = k ** 4;
  const fl = 0.2 * k4 * (5 * v.la) + 0.1 * (1 - k4) ** 2 * Math.cbrt(5 * v.la);
  const yw = white[1], n = v.yb / yw, nbb = 0.725 * (1 / n) ** 0.2, z = 1.48 + Math.sqrt(n);
  const rgbW = mulMV(model.adapt, white), dr = rgbW.map((w) => (yw * d) / w + 1 - d);
  const compress = (u: number) => { const p = (fl * Math.abs(u) / 100) ** 0.42; return (Math.sign(u) * 400 * p) / (27.13 + p) + 0.1; };
  const adapted = (x: Vec3): Vec3 => mulMV(model.toCones, mulMV(model.adapt, x).map((u, i) => dr[i] * u) as unknown as Vec3).map(compress) as unknown as Vec3;
  const achromatic = (r: number, g: number, b: number) => (2 * r + g + b / 20 - 0.305) * nbb;
  const [rw, gw, bw] = adapted(white);
  return { c, nc, fl, n, nbb, z, dr, adapted, achromatic, aw: achromatic(rw, gw, bw) };
}

function appearance(model: Model, xyz: Vec3, white: Vec3, v: Cam02Viewing): { j: number; c: number; m: number; h: number } {
  const s = setup(model, white, v);
  const [ra, ga, ba] = s.adapted(xyz);
  const a = ra - (12 * ga) / 11 + ba / 11, b = (ra + ga - 2 * ba) / 9;
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const et = 0.25 * (Math.cos((h * Math.PI) / 180 + 2) + 3.8);
  const j = 100 * (s.achromatic(ra, ga, ba) / s.aw) ** (s.c * s.z);
  const t = ((50000 / 13) * s.nc * s.nbb * et * Math.hypot(a, b)) / (ra + ga + (21 / 20) * ba);
  const chroma = t ** 0.9 * Math.sqrt(j / 100) * (1.64 - 0.29 ** s.n) ** 0.73;
  return { j, c: chroma, m: chroma * s.fl ** 0.25, h };
}

function toUcs(model: Model, xyz: Vec3, white: Vec3, v: Cam02Viewing): Vec3 {
  const { j, m, h } = appearance(model, xyz, white, v);
  const mp = Math.log(1 + 0.0228 * m) / 0.0228, hr = (h * Math.PI) / 180;
  return [(1.7 * j) / (1 + 0.007 * j), mp * Math.cos(hr), mp * Math.sin(hr)];
}

/** The way back: from a model's uniform color space J′, a′, b′ to XYZ (the inverse model of CIE 159 and CIE 248). */
function fromUcs(model: Model, [jp, ap, bp]: Vec3, white: Vec3, v: Cam02Viewing): Vec3 {
  const s = setup(model, white, v);
  const j = jp / (1.7 - 0.007 * jp), m = (Math.exp(0.0228 * Math.hypot(ap, bp)) - 1) / 0.0228;
  const hr = Math.atan2(bp, ap), chroma = m / s.fl ** 0.25;
  const t = (chroma / (Math.sqrt(j / 100) * (1.64 - 0.29 ** s.n) ** 0.73)) ** (1 / 0.9);
  const et = 0.25 * (Math.cos(hr + 2) + 3.8);
  const A = s.aw * (j / 100) ** (1 / (s.c * s.z));
  const p2 = A / s.nbb + 0.305, p3 = 21 / 20;
  let a = 0, b = 0;
  if (t > 0) {
    const p1 = ((50000 / 13) * s.nc * s.nbb * et) / t, sin = Math.sin(hr), cos = Math.cos(hr);
    if (Math.abs(sin) >= Math.abs(cos)) {
      const p4 = p1 / sin;
      b = (p2 * (2 + p3) * (460 / 1403)) / (p4 + (2 + p3) * (220 / 1403) * (cos / sin) - 27 / 1403 + p3 * (6300 / 1403));
      a = (b * cos) / sin;
    } else {
      const p5 = p1 / cos;
      a = (p2 * (2 + p3) * (460 / 1403)) / (p5 + (2 + p3) * (220 / 1403) - (27 / 1403 - p3 * (6300 / 1403)) * (sin / cos));
      b = (a * sin) / cos;
    }
  }
  const cones: Vec3 = [(460 * p2 + 451 * a + 288 * b) / 1403, (460 * p2 - 891 * a - 261 * b) / 1403, (460 * p2 - 220 * a - 6300 * b) / 1403];
  const uncompress = (u: number) => { const q = Math.abs(u - 0.1); return (Math.sign(u - 0.1) * (100 / s.fl) * ((27.13 * q) / (400 - q)) ** (1 / 0.42)); };
  const rgbC = mulMV(inv3(model.toCones), cones.map(uncompress) as unknown as Vec3);
  return mulMV(inv3(model.adapt), rgbC.map((u, i) => u / s.dr[i]) as unknown as Vec3);
}

/** The CIECAM02 lightness J, chroma C, colorfulness M and hue angle h (degrees) of XYZ against the white `white`. */
export const cam02 = (xyz: Vec3, white: Vec3, v: Cam02Viewing) => appearance(MODELS.cam02, xyz, white, v);
/** CAM02-UCS J′, a′, b′ of XYZ against `white`. */
export const cam02ucs = (xyz: Vec3, white: Vec3, v: Cam02Viewing) => toUcs(MODELS.cam02, xyz, white, v);
/** XYZ of CAM02-UCS J′, a′, b′ against `white`. */
export const cam02ucsToXyz = (jab: Vec3, white: Vec3, v: Cam02Viewing) => fromUcs(MODELS.cam02, jab, white, v);
/** The CAM16 lightness J, chroma C, colorfulness M and hue angle h (degrees) of XYZ against the white `white`. */
export const cam16 = (xyz: Vec3, white: Vec3, v: Cam02Viewing) => appearance(MODELS.cam16, xyz, white, v);
/** CAM16-UCS J′, a′, b′ of XYZ against `white`. */
export const cam16ucs = (xyz: Vec3, white: Vec3, v: Cam02Viewing) => toUcs(MODELS.cam16, xyz, white, v);
/** XYZ of CAM16-UCS J′, a′, b′ against `white`. */
export const cam16ucsToXyz = (jab: Vec3, white: Vec3, v: Cam02Viewing) => fromUcs(MODELS.cam16, jab, white, v);

/**
 * Display colors (sRGB, Display P3, Adobe RGB, Rec. 2020) as colorimetry for the CIE 1931 observer under D65, and
 * through the D65 Wpt normalization into WLab.
 *
 * A display color is not a material: in WLab it stands for the material that would give the same XYZ under D65 for
 * the CIE 1931 observer. The matrices and transfer functions are those of CSS Color 4 (with the space names CSS uses).
 */

import { inv3, mulMV, type Mat3, type Vec3 } from './linalg.ts';
import { illuminants, observers, whiteOf } from './spectra.ts';
import { wptToWlab, wlabToWpt } from './wlab.ts';
import { wptNormalization, type WptNormalization } from './wpt.ts';

export type RgbSpace = 'srgb' | 'display-p3' | 'a98-rgb' | 'rec2020';

interface SpaceDef { toXyz: Mat3; decode: (v: number) => number; encode: (v: number) => number }

const sign = (f: (x: number) => number) => (v: number) => Math.sign(v) * f(Math.abs(v));
const srgbDecode = sign((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const srgbEncode = sign((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const A98 = 563 / 256;
const R2020_A = 1.09929682680944, R2020_B = 0.018053968510807;

const SPACES: Record<RgbSpace, SpaceDef> = {
  'srgb': {
    toXyz: [[0.41239079926595934, 0.357584339383878, 0.1804807884018343],
            [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
            [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]],
    decode: srgbDecode, encode: srgbEncode,
  },
  'display-p3': {
    toXyz: [[0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
            [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
            [0, 0.04511338185890264, 1.043944368900976]],
    decode: srgbDecode, encode: srgbEncode,
  },
  'a98-rgb': {
    toXyz: [[0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
            [0.29734497525053605, 0.6273635662554661, 0.0752914584939978],
            [0.02703136138641234, 0.07068885253582723, 0.9913375368376388]],
    decode: sign((v) => v ** A98), encode: sign((v) => v ** (1 / A98)),
  },
  'rec2020': {
    toXyz: [[0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
            [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
            [0, 0.028072693049087428, 1.060985057710791]],
    decode: sign((v) => (v < R2020_B * 4.5 ? v / 4.5 : ((v + R2020_A - 1) / R2020_A) ** (1 / 0.45))),
    encode: sign((v) => (v < R2020_B ? 4.5 * v : R2020_A * v ** 0.45 - (R2020_A - 1))),
  },
};

// The RGB spaces' D65 white is the CIE's rounded chromaticity (0.3127, 0.3290); the package's D65 white comes from the
// tabulated spectrum. A small scaling in XYZ makes RGB white land exactly on the package's D65 white, so that display
// white and grays map onto the WLab neutral axis.
let cache: { d65: WptNormalization; white: Vec3 } | undefined;
function d65(): { d65: WptNormalization; white: Vec3 } {
  return (cache ??= { d65: wptNormalization('cie1931', 'D65'), white: whiteOf(observers.cie1931, illuminants.D65) });
}

/** The XYZ (CIE 1931 observer, D65, white Y = 100) of an encoded RGB value (components 0 to 1). */
export function rgbToXyz(rgb: Vec3, space: RgbSpace = 'srgb'): Vec3 {
  const s = SPACES[space];
  const xyz = mulMV(s.toXyz, rgb.map(s.decode) as Vec3);
  const w = mulMV(s.toXyz, [1, 1, 1]), t = d65().white;
  return [xyz[0] * t[0] / w[0], xyz[1] * t[1] / w[1], xyz[2] * t[2] / w[2]];
}

/** The encoded RGB value (components 0 to 1, not clipped) of XYZ for the CIE 1931 observer under D65. */
export function xyzToRgb(xyz: Vec3, space: RgbSpace = 'srgb'): Vec3 {
  const s = SPACES[space];
  const w = mulMV(s.toXyz, [1, 1, 1]), t = d65().white;
  const lin = mulMV(inv3(s.toXyz), [xyz[0] * w[0] / t[0], xyz[1] * w[1] / t[1], xyz[2] * w[2] / t[2]]);
  return lin.map(s.encode) as Vec3;
}

/** WLab of a display color, through the D65 Wpt normalization (CIE 1931 observer). */
export function rgbToWlab(rgb: Vec3, space: RgbSpace = 'srgb'): Vec3 {
  return wptToWlab(mulMV(d65().d65.toWpt, rgbToXyz(rgb, space)));
}

/** The encoded RGB value (not clipped) of a WLab value, through the D65 Wpt normalization (CIE 1931 observer). */
export function wlabToRgb(wlab: Vec3, space: RgbSpace = 'srgb'): Vec3 {
  return xyzToRgb(mulMV(d65().d65.fromWpt, wlabToWpt(wlab)), space);
}

/** Whether an encoded RGB value is inside its gamut (every component from 0 to 1, within a small tolerance). */
export const inGamut = (rgb: Vec3, eps = 1e-6): boolean => rgb.every((v) => v >= -eps && v <= 1 + eps);

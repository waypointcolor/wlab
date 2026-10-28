/**
 * wlab: Wpt (Waypoint), WLab (Waypoint Lab) and material adjustment transforms (MATs).
 *
 *   import { wptNormalization, wptToWlab, deltaEWlab, mat } from 'wlab';
 *   const d65 = wptNormalization('cie1931', 'D65');
 *   const wlab = d65.wlabOf(reflectance);          // reflectance: 81 values, 380 to 780 nm in 5 nm steps
 *
 * The method is described in "WLab and Wpt: Color Without the Fine Print" and its Technical annex.
 */

export type { Mat3, Vec3 } from './linalg.ts';
export { inv3, mulMM, mulMV, solve } from './linalg.ts';
export {
  fluorescents, illuminants, observers, observersN, resample, responses, scotopic, sensorResponses, sensorWhiteOf, wavelengths, whiteOf,
  type IlluminantName, type Observer, type ObserverName, type Spectrum,
} from './spectra.ts';
export { daylight, planckian } from './lights.ts';
export {
  categoricalObserver, categoricalObserverAges, checkCie2006Tables, cie2006, cie2006Tables, type Cie2006Tables,
} from './cie2006.ts';
export { munsell1600, type SampleSet } from './munsell1600.ts';
export { munsellBase, wptNormalization, wptNormalizationN, type Base, type WptNormalization, type WptNormalizationN } from './wpt.ts';
export { deltaEWlab, fromPolar, G0, G1, G2, toPolar, wlabToWpt, wptToWlab } from './wlab.ts';
export { deltaEsOf, ire, oce, ome, wlabsOf } from './metrics.ts';
export { deltaE00, deltaEab, labToXyz, xyzToLab } from './cielab.ts';
export { apply, BRADFORD, cat, CAT02, mat } from './transforms.ts';
export { inGamut, rgbToWlab, rgbToXyz, wlabToRgb, xyzToRgb, type RgbSpace } from './rgb.ts';

// The site's lights: the CIE illuminants and LED lights of `wlab`, and one light that is not a standard, RGB-D65, an
// RGB LED mixed to D65's white, for comparison: to the CIE 1931 observer it has the same white point as D65 (and the
// same luminance), from three narrow peaks in place of daylight's smooth spectrum. And two measured booth lights by
// Thouslite, simulating D65 and D50: real lights made to stand in for the CIE's daylight illuminants.

import { illuminants, inv3, mulMV, observers, wavelengths, type IlluminantName, type Mat3, type Observer, type Spectrum, type Vec3 } from '../../src/index.ts';
import { THOUSLITE_D50, THOUSLITE_D65 } from './thouslite-data.ts';

/** The RGB LED's three peaks: blue, green and red, each with its full width at half its height, in nm. */
export const RGB_LED_PEAKS = [{ peak: 455, width: 20 }, { peak: 530, width: 35 }, { peak: 630, width: 18 }] as const;

/**
 * One LED peak, in a common model of an LED's spectrum: a Gaussian sharpened at its top, (g + 2g⁵) / 3, with g a
 * Gaussian; it falls to half its height 0.92182 of g's width parameter from side to side.
 */
export function ledPeak(peak: number, width: number): Spectrum {
  const w = width / 0.92182;
  return wavelengths.map((l) => { const g = Math.exp(-(((l - peak) / w) ** 2)); return (g + 2 * g ** 5) / 3; });
}

/**
 * An RGB LED whose three peaks are mixed so that `observer`'s responses to it are exactly its responses to `white`:
 * the same white point (and luminance) for that observer, from a very different spectrum.
 */
export function rgbLed(observer: Observer, white: Spectrum): Spectrum {
  const peaks = RGB_LED_PEAKS.map((p) => ledPeak(p.peak, p.width));
  const raw = (s: Spectrum) => observer.curves.slice(0, 3).map((c) => c.reduce((a, v, i) => a + v * s[i], 0)) as unknown as Vec3;
  const cols = peaks.map(raw), M = [0, 1, 2].map((r) => cols.map((c) => c[r])) as unknown as Mat3;
  const w = mulMV(inv3(M), raw(white));
  return wavelengths.map((_, i) => w[0] * peaks[0][i] + w[1] * peaks[1][i] + w[2] * peaks[2][i]);
}

/** The name of the RGB LED mixed to D65's white. */
export const RGB_D65 = 'RGB-D65';
/** Two measured booth lights by Thouslite, made to simulate D65 and D50 (see DATA.md). */
export const BOOTH_LIGHTS = { 'Thouslite-D65': THOUSLITE_D65, 'Thouslite-D50': THOUSLITE_D50 } as const satisfies Record<string, Spectrum>;
export type BoothLightName = keyof typeof BOOTH_LIGHTS;
/** A light the site offers: a CIE illuminant or LED light, RGB-D65, or a measured booth light. */
export type LightName = IlluminantName | typeof RGB_D65 | BoothLightName;
/** Lights that are not CIE illuminants, which pages leave unchecked by default. */
export const EXTRA_LIGHTS: readonly LightName[] = [RGB_D65, ...(Object.keys(BOOTH_LIGHTS) as BoothLightName[])];
/** Every light the site offers, by name; RGB-D65 is mixed for the CIE 1931 observer. */
export const LIGHTS: Record<LightName, Spectrum> = { ...illuminants, [RGB_D65]: rgbLed(observers.cie1931, illuminants.D65), ...BOOTH_LIGHTS };

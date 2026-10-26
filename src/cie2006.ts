/**
 * CIE 2006 (CIE 170-1) cone fundamentals for any field size and observer age, and the categorical observers of
 * Asano and Fairchild. The model's tables are built in (`cie2006Tables`, prepared from Psychtoolbox-3's copies of the
 * CIE 170-1 and CVRL tables; see DATA.md); other tables can be passed instead. The CIE's own 2006 functions for 2° and
 * 10° are among the built-in `observers`.
 */

import { categoricalObserverData, cie2006TableData, wavelengths } from './data.ts';
import { solve } from './linalg.ts';
import type { Observer, Spectrum } from './spectra.ts';

/**
 * The three tables of the CIE 2006 model, 390 to 780 nm in 5 nm steps (79 values each): the relative macular
 * density, the log low-density absorbances of the L, M and S photopigments, and the two components of the ocular media
 * density (as in the Wpt toolbox's RelativeMacularDensity.txt, Alms.txt and docul.txt).
 */
export interface Cie2006Tables {
  readonly macular: readonly number[];
  readonly absorbance: readonly [readonly number[], readonly number[], readonly number[]];
  readonly ocular: readonly [readonly number[], readonly number[]];
}

/** Checks that the tables have 79 values each; throws otherwise. */
export function checkCie2006Tables(t: Cie2006Tables): Cie2006Tables {
  const all = [t.macular, ...t.absorbance, ...t.ocular];
  if (all.length !== 6 || all.some((c) => c.length !== 79 || c.some((v) => !Number.isFinite(v)))) {
    throw new Error('the CIE 2006 tables need 79 values each (390 to 780 nm at 5 nm): 1 macular, 3 absorbance and 2 ocular columns');
  }
  return t;
}

/** The built-in tables of the CIE 2006 model, the ones the Wpt toolbox uses. */
export const cie2006Tables: Cie2006Tables = cie2006TableData;

/**
 * The L, M and S cone fundamentals of the CIE 2006 observer model for a field size of `fieldSize` degrees (1 to 10)
 * and an observer `age` in years (20 to 80), each with its peak at 1, in energy terms, on the package's grid. As the
 * Wpt toolbox's cie2006cmfs.m: the model is evaluated from 390 to 780 nm and extended to 380 nm linearly, with
 * negative values set to 0.
 */
export function cie2006(fieldSize = 2, age = 32, tables: Cie2006Tables = cie2006Tables): Observer {
  if (!(fieldSize >= 1 && fieldSize <= 10)) throw new RangeError(`the field size must be from 1 to 10 degrees, not ${fieldSize}`);
  if (!(age >= 20 && age <= 80)) throw new RangeError(`the age must be from 20 to 80 years, not ${age}`);
  const { macular, absorbance, ocular } = checkCie2006Tables(tables);
  const macularPeak = 0.485 * Math.exp(-fieldSize / 6.132);                       // macular density for the field size
  const lens = age <= 60 ? 1 + 0.02 * (age - 32) : 1.56 + 0.0667 * (age - 60);     // ocular media density for the age
  const peakDensity = [0.38 + 0.54 * Math.exp(-fieldSize / 1.333), 0.38 + 0.54 * Math.exp(-fieldSize / 1.333),
    0.3 + 0.45 * Math.exp(-fieldSize / 1.333)];                                    // photopigment peak optical density
  const curves = [0, 1, 2].map((c) => {
    const model = macular.map((m, i) => {
      const nm = 390 + 5 * i;
      // absorptance; the S cones absorb nothing from 620 nm on (where the formula fails)
      const alpha = c === 2 && nm >= 620 ? 0 : 1 - 10 ** (-peakDensity[c] * 10 ** absorbance[c][i]);
      // corrected to corneal incidence, then to energy terms
      return alpha * 10 ** (-m * macularPeak - (ocular[0][i] * lens + ocular[1][i])) * nm;
    });
    const peak = Math.max(...model);
    const y = model.map((v) => v / peak);
    return wavelengths.map((nm) => {
      const i = Math.max(0, Math.min(y.length - 2, Math.floor((nm - 390) / 5)));
      return Math.max(0, y[i] + ((nm - (390 + 5 * i)) / 5) * (y[i + 1] - y[i]));
    }) as Spectrum;
  });
  return { name: `CIE 2006 (${fieldSize}°, ${age} years)`, curves: curves as unknown as Observer['curves'] };
}

/** The ages of the 10 categorical observers. */
export const categoricalObserverAges: readonly number[] = categoricalObserverData.ages;

/**
 * Categorical observer `category` (1 to 10) of Asano and Fairchild for a field size of `fieldSize` degrees (1 to
 * 10): the CIE 2006 model at the category's age with its eight deviations (lens and macular density, peak optical
 * densities and peak wavelengths of the L, M and S photopigments), as the individual observer toolbox's
 * cie2006cmfsEx.m and fnc_getCatObs.m. Each cone fundamental is scaled to an area of 100 (the toolbox's choice), and
 * 380 and 385 nm are 0.
 */
export function categoricalObserver(category: number, fieldSize = 2, tables: Cie2006Tables = cie2006Tables): Observer {
  if (!(Number.isInteger(category) && category >= 1 && category <= 10)) throw new RangeError(`the category must be 1 to 10, not ${category}`);
  if (!(fieldSize >= 1 && fieldSize <= 10)) throw new RangeError(`the field size must be from 1 to 10 degrees, not ${fieldSize}`);
  const age = categoricalObserverData.ages[category - 1];
  const { macular, absorbance, ocular } = checkCie2006Tables(tables);
  const [lensDev, macularDev, odL, odM, odS, shiftL, shiftM, shiftS] = categoricalObserverData.deviations[category - 1];
  const macularPeak = 0.485 * Math.exp(-fieldSize / 6.132) * (1 + macularDev / 100);
  const lens = age <= 60 ? 1 + 0.02 * (age - 32) : 1.56 + 0.0667 * (age - 60);
  const fsLM = 0.38 + 0.54 * Math.exp(-fieldSize / 1.333), fsS = 0.3 + 0.45 * Math.exp(-fieldSize / 1.333);
  const peakDensity = [fsLM * (1 + odL / 100), fsLM * (1 + odM / 100), fsS * (1 + odS / 100)];
  const shift = [shiftL, shiftM, shiftS];
  const nm = macular.map((_, i) => 390 + 5 * i);
  const curves = [0, 1, 2].map((c) => {
    // the absorbance moved by the peak shift (a not-a-knot spline, as Octave's interp1 'spline'); the S cones' table
    // stops at 620 nm, where they absorb nothing
    const keep = nm.map((w) => c !== 2 || w < 620);
    const shifted = notAKnotSpline(nm.filter((_, i) => keep[i]).map((w) => w + shift[c]), absorbance[c].filter((_, i) => keep[i]));
    const model = nm.map((w, i) => {
      const alpha = c === 2 && w >= 620 ? 0 : 1 - 10 ** (-peakDensity[c] * 10 ** shifted(w));
      // the lens deviation scales the whole ocular media density
      const media = (ocular[0][i] * lens + ocular[1][i]) * (1 + lensDev / 100);
      return alpha * 10 ** (-macular[i] * macularPeak - media) * w;
    });
    const area = model.reduce((s, v) => s + v, 0);
    return [0, 0, ...model.map((v) => Math.max(0, (v / area) * 100))] as Spectrum;
  });
  return {
    name: `Categorical observer ${category} (${fieldSize}°, ${age} years)`,
    curves: curves as unknown as Observer['curves'],
  };
}

/** The cubic spline through (x, y) with not-a-knot ends (Octave's and MATLAB's spline), extended by its end pieces. */
function notAKnotSpline(x: readonly number[], y: readonly number[]): (t: number) => number {
  const n = x.length;
  const h = x.slice(1).map((v, i) => v - x[i]);
  // second derivatives m: the continuity equations inside, and a continuous third derivative at x[1] and x[n-2]
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  A[0][0] = h[1]; A[0][1] = -(h[0] + h[1]); A[0][2] = h[0];
  for (let i = 1; i < n - 1; i++) {
    A[i][i - 1] = h[i - 1]; A[i][i] = 2 * (h[i - 1] + h[i]); A[i][i + 1] = h[i];
    b[i] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
  }
  A[n - 1][n - 3] = h[n - 2]; A[n - 1][n - 2] = -(h[n - 3] + h[n - 2]); A[n - 1][n - 1] = h[n - 3];
  const m = solve(A, b);
  return (t: number) => {
    let i = 0;
    while (i < n - 2 && t > x[i + 1]) i++;
    const hi = h[i], a = x[i + 1] - t, d = t - x[i];
    return (m[i] * a ** 3 + m[i + 1] * d ** 3) / (6 * hi) + (y[i] / hi - (m[i] * hi) / 6) * a + (y[i + 1] / hi - (m[i + 1] * hi) / 6) * d;
  };
}

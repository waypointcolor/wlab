// Reading a reader's own reflectances from a file, as a set of objects for the metrics: a CGATS measurement file (as
// spectrophotometers and chart-reading software write them, with spectral fields such as SPECTRAL_NM380) or a table
// of numbers (one object per column, wavelength in the first column; or one per row, wavelengths across the header).
// The file is read in the page and goes nowhere.

import { resample } from '../../src/index.ts';
import type { Objects } from './library.ts';
import { readReflectances } from './shifts.ts';

/** A CGATS field holding a reflectance at one wavelength: SPECTRAL_NM380, SPECTRAL_380, SPEC_380, NM380, R380, … */
const SPECTRAL = /^(?:SPECTRAL_NM_?|SPECTRAL_|SPEC_|NM_?|R_?)(\d{3,4})$/i;

/** Split a CGATS line into tokens, keeping quoted text (a sample name with spaces) whole. */
const tokens = (line: string) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);

/** The objects of a CGATS file: one per data row, named by SAMPLE_NAME or SAMPLE_ID, resampled to 380 to 780 nm. */
export function readCgats(text: string): Objects & { percent: boolean } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const at = (k: string, from = 0) => lines.findIndex((l, i) => i >= from && l.split(/\s/)[0] === k);
  const f0 = at('BEGIN_DATA_FORMAT'), f1 = at('END_DATA_FORMAT', f0 + 1), d0 = at('BEGIN_DATA', f1 + 1), d1 = at('END_DATA', d0 + 1);
  if (f0 < 0 || f1 < 0 || d0 < 0 || d1 < 0) throw new Error('a CGATS file needs BEGIN_DATA_FORMAT … END_DATA_FORMAT and BEGIN_DATA … END_DATA');
  const fields = lines.slice(f0 + 1, f1).flatMap(tokens);
  const spectral = fields.map((f, i) => ({ i, nm: Number(SPECTRAL.exec(f)?.[1]) })).filter((x) => x.nm > 0).sort((a, b) => a.nm - b.nm);
  if (spectral.length < 5) throw new Error('the CGATS file has no spectral fields (such as SPECTRAL_NM380 … SPECTRAL_NM730)');
  const nm = spectral.map((x) => x.nm);
  if (nm[0] > 420 || nm[nm.length - 1] < 680) throw new Error(`its spectra run from ${nm[0]} to ${nm[nm.length - 1]} nm; they need to cover at least 420 to 680 nm`);
  const nameAt = ['SAMPLE_NAME', 'SAMPLE_ID'].map((k) => fields.indexOf(k)).find((i) => i >= 0);
  const rows = lines.slice(d0 + 1, d1).filter((l) => l && !l.startsWith('#')).map(tokens);
  if (!rows.length) throw new Error('the CGATS file has no data rows');
  const raw = rows.map((r, j) => {
    if (r.length < fields.length) throw new Error(`data row ${j + 1} has ${r.length} values for ${fields.length} fields`);
    return spectral.map((x) => {
      const v = Number(r[x.i].replace(',', '.'));
      if (!Number.isFinite(v)) throw new Error(`data row ${j + 1}: "${r[x.i]}" is not a number`);
      return v;
    });
  });
  const percent = raw.some((r) => r.some((v) => v > 1.5));
  return {
    names: rows.map((r, j) => (nameAt !== undefined ? r[nameAt] : `Sample ${j + 1}`)),
    categories: rows.map(() => 'your file'),
    reflectances: raw.map((r) => resample(nm, percent ? r.map((v) => v / 100) : r)),
    percent,
  };
}

/** The objects of a table: by columns (wavelength first) or, failing that, by rows (wavelengths across the header). */
export function readTable(text: string): Objects & { percent: boolean } {
  let first: unknown;
  for (const layout of ['columns', 'rows'] as const) {
    try {
      const { materials, percent } = readReflectances(text, layout);
      return { names: materials.map((m) => m.name), categories: materials.map(() => 'your file'), reflectances: materials.map((m) => m.reflectance), percent };
    } catch (e) { first ??= e; }
  }
  throw first;
}

/** A reader's file of reflectances, CGATS or a table, and a note on how it was read. */
export function readObjectFile(text: string): { objects: Objects; note: string } {
  const cgats = /^\s*BEGIN_DATA_FORMAT\b/m.test(text);
  const o = cgats ? readCgats(text) : readTable(text);
  if (!o.reflectances.length) throw new Error('the file holds no reflectances');
  const note = `${o.reflectances.length} reflectance${o.reflectances.length > 1 ? 's' : ''} read as ${cgats ? 'CGATS' : 'a table'}`
    + `${o.percent ? ', in percent' : ''}, resampled to 380 to 780 nm (each held at its last value beyond the file's range).`;
  return { objects: { names: o.names, categories: o.categories, reflectances: o.reflectances }, note };
}

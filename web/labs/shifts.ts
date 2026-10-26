// The computations of Lab C: materials (reflectances) in WLab and Wpt across many observing conditions, their shifts
// from a reference condition (the raw Wpt shift manifold of each material), and pairs compared condition by condition.
// No browser code, so that the tests can use it directly.

import { deltaEWlab, resample, wavelengths, wptNormalizationN, wptToWlab, type Observer, type Spectrum, type Vec3, type WptNormalizationN } from '../../src/index.ts';
import { parseTable } from './kit.ts';

/** A material: a name and its spectral reflectance (0 to 1) on the package grid. */
export interface Material { name: string; reflectance: Spectrum }

/** An observing condition: an observer and a light, with a key that names it (for keeping its normalization). */
export interface ObservingCondition { key: string; observerLabel: string; lightLabel: string; observer: Observer; light: Spectrum }

/**
 * The normalizations of the conditions computed so far, by condition. A normalization depends only on its observer
 * and light, so it is built once: N observers × M lights need N·M of them, and changing the materials needs none.
 */
export class NormalizationCache {
  private readonly map = new Map<string, WptNormalizationN>();
  private readonly limit: number;
  constructor(limit = 50000) { this.limit = limit; }
  has(key: string): boolean { return this.map.has(key); }
  get size(): number { return this.map.size; }
  get(c: ObservingCondition): WptNormalizationN {
    let n = this.map.get(c.key);
    if (!n) {
      if (this.map.size >= this.limit) this.map.clear();             // a bound on memory; a cleared one is rebuilt
      n = wptNormalizationN(c.observer, c.light);
      this.map.set(c.key, n);
    }
    return n;
  }
}

/**
 * How a table of reflectances is laid out: one material per row (a header row of wavelengths, then a row per
 * material, its name first) or one per column (a column of wavelengths, then a column per material, names in a header
 * row).
 */
export type Layout = 'rows' | 'columns';

/** The cells of a table, split as parseTable splits them (tabs, semicolons, commas or spaces). */
function cellsOf(text: string): string[][] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : lines[0].includes(',') ? ',' : /\s+/;
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
}

/** A table with one material per row turned into one with a material per column. */
function rowsToColumns(text: string): string {
  const cells = cellsOf(text);
  if (cells.length < 2) throw new Error('give a row of wavelengths and at least one row of values');
  const isNum = (c: string) => c !== '' && !Number.isNaN(Number(c));
  const [head, ...rows] = cells;
  // the header's first cell names the column of names ("name", or empty); rows without names get a placeholder
  const named = rows.some((r) => !isNum(r[0])) || (!isNum(head[0]) && head.length === rows[0].length);
  const wl = named || !isNum(head[0]) ? head.slice(1) : head;
  const table = [['nm', ...rows.map((r, k) => (named ? r[0] || `Material ${k + 1}` : `Material ${k + 1}`))]];
  wl.forEach((w, i) => table.push([w, ...rows.map((r) => (named ? r[i + 1] : r[i]) ?? '')]));
  return table.map((r) => r.join('\t')).join('\n');
}

/**
 * Reflectances from a table laid out by rows or by columns, names optional. Any grid covering 420 to 680 nm, resampled
 * to 380 to 780 nm; values in percent (any above 1.5) are divided by 100.
 */
export function readMaterials(text: string, layout: Layout = 'columns'): Material[] {
  return readReflectances(text, layout).materials;
}

/** As readMaterials, and whether the values were read as percent. */
export function readReflectances(text: string, layout: Layout = 'columns'): { materials: Material[]; percent: boolean } {
  const t = parseTable(layout === 'rows' ? rowsToColumns(text) : text, 1);
  const percent = t.columns.some((c) => c.some((v) => v > 1.5));
  return {
    materials: t.columns.map((c, k) => ({ name: t.names[k] || `Material ${k + 1}`, reflectance: resample(t.nm, percent ? c.map((v) => v / 100) : c) })),
    percent,
  };
}

/** Reflectances on the package grid (380 to 780 nm every 5 nm) as a comma-separated table, by rows or by columns. */
export function writeMaterials(materials: Material[], layout: Layout): string {
  const name = (n: string) => n.replace(/[,"]/g, ' ');                       // the reader splits at every comma
  const v = (x: number) => +x.toFixed(5);
  if (layout === 'rows') return [['name', ...wavelengths].join(','), ...materials.map((m) => [name(m.name), ...m.reflectance.map(v)].join(','))].join('\n');
  return [['nm', ...materials.map((m) => name(m.name))].join(','), ...wavelengths.map((nm, i) => [nm, ...materials.map((m) => v(m.reflectance[i]))].join(','))].join('\n');
}

/** A reflectance scaled and shifted (never below 0): scaling scales its Wpt shifts; a shift leaves them as they are. */
export function adjust(r: Spectrum, scale: number, shift: number): Spectrum {
  return r.map((v) => Math.max(0, v * scale + shift));
}

/** One material in one condition: its Wpt and WLab there, and their shifts from the reference condition. */
export interface Point { wpt: Vec3; wlab: Vec3; dWpt: Vec3; dWlab: Vec3; dE: number }

/** One material across the conditions: where it is in the reference condition, and a point for each condition. */
export interface Cloud { material: Material; refWpt: Vec3; refWlab: Vec3; points: Point[] }

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Each material's Wpt and WLab in every condition (norms[k] is the normalization of condition k) and in the reference. */
export function cloudsOf(materials: Material[], norms: WptNormalizationN[], reference: WptNormalizationN): Cloud[] {
  return materials.map((material) => {
    const refWpt = reference.wptOf(material.reflectance), refWlab = wptToWlab(refWpt);
    const points = norms.map((n) => {
      const wpt = n.wptOf(material.reflectance), wlab = wptToWlab(wpt);
      return { wpt, wlab, dWpt: minus(wpt, refWpt), dWlab: minus(wlab, refWlab), dE: deltaEWlab(wlab, refWlab) };
    });
    return { material, refWpt, refWlab, points };
  });
}

/** The pairs of materials to compare: each against the first, consecutive pairs (1–2, 3–4, …), or every pair. */
export type PairMode = 'first' | 'consecutive' | 'all';
export function pairIndices(count: number, mode: PairMode): [number, number][] {
  const out: [number, number][] = [];
  if (mode === 'first') for (let j = 1; j < count; j++) out.push([0, j]);
  else if (mode === 'consecutive') for (let i = 0; i + 1 < count; i += 2) out.push([i, i + 1]);
  else for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) out.push([i, j]);
  return out;
}

/** A pair: ΔE_WLab between its two materials in the reference condition and in each condition. */
export interface PairResult { a: number; b: number; refDE: number; dE: number[] }
export function pairsOf(clouds: Cloud[], pairs: [number, number][]): PairResult[] {
  return pairs.map(([a, b]) => ({
    a, b,
    refDE: deltaEWlab(clouds[a].refWlab, clouds[b].refWlab),
    dE: clouds[a].points.map((p, k) => deltaEWlab(p.wlab, clouds[b].points[k].wlab)),
  }));
}

/** Mean, median, smallest and largest of a list, with where the smallest and largest are. */
export function summary(v: number[]): { mean: number; median: number; min: number; argmin: number; max: number; argmax: number } {
  const sorted = [...v].sort((x, y) => x - y), n = v.length;
  let argmin = 0, argmax = 0;
  v.forEach((x, i) => { if (x < v[argmin]) argmin = i; if (x > v[argmax]) argmax = i; });
  return {
    mean: v.reduce((s, x) => s + x, 0) / n,
    median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    min: v[argmin], argmin, max: v[argmax], argmax,
  };
}

/**
 * A material in use: one of the given reflectances (its source), or a copy of one, with its own scale and shift. A
 * copy can be scaled and shifted on its own, for example to make other materials of the same spectral hue plane.
 */
export interface Entry { source: number; copy: boolean; scale: number; shift: number }

/**
 * The entries for n given reflectances: entries of reflectances no longer given are dropped, each reflectance has its
 * own entry (kept with its scale and shift if it had one), and copies follow their reflectance's entry.
 */
export function syncEntries(entries: Entry[], n: number): Entry[] {
  const out = entries.filter((e) => e.source < n);
  for (let i = 0; i < n; i++) if (!out.some((e) => e.source === i && !e.copy)) out.push({ source: i, copy: false, scale: 1, shift: 0 });
  // stable: copies stay in the order they were made
  return out.sort((a, b) => a.source - b.source || Number(a.copy) - Number(b.copy));
}

/** A copy of entry k, placed after the last entry of the same reflectance. */
export function copyEntry(entries: Entry[], k: number): Entry[] {
  const e = entries[k];
  let at = k + 1;
  while (at < entries.length && entries[at].source === e.source) at++;
  return [...entries.slice(0, at), { ...e, copy: true }, ...entries.slice(at)];
}

/** The names of the entries: a copy is numbered (#2, #3, …), and a scale or shift is written out. */
export function entryNames(entries: Entry[], baseNames: string[]): string[] {
  const copies = new Map<number, number>();
  return entries.map((e) => {
    let name = baseNames[e.source];
    if (e.copy) { const k = (copies.get(e.source) ?? 1) + 1; copies.set(e.source, k); name += ` #${k}`; }
    if (e.scale !== 1) name += ` × ${e.scale.toFixed(2)}`;
    if (e.shift !== 0) name += ` ${e.shift < 0 ? '−' : '+'} ${Math.abs(e.shift).toFixed(2)}`;
    return name;
  });
}

/** The materials in use: each entry's reflectance, scaled and shifted, under its name. */
export function materialsOf(base: Material[], entries: Entry[]): Material[] {
  const names = entryNames(entries, base.map((m) => m.name));
  return entries.map((e, k) => ({ name: names[k], reflectance: e.scale === 1 && e.shift === 0 ? base[e.source].reflectance : adjust(base[e.source].reflectance, e.scale, e.shift) }));
}

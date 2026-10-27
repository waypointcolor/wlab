// The computations of Lab C: materials (reflectances) in WLab and Wpt across many observing conditions, their shifts
// from a reference condition (the raw Wpt shift manifold of each material), and pairs compared condition by condition.
// No browser code, so that the tests can use it directly.

import { deltaEWlab, resample, solve, wavelengths, wptNormalizationN, wptToWlab, type Observer, type Spectrum, type Vec3, type WptNormalizationN } from '../../src/index.ts';
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

/**
 * The metameric black of a spectrum for one observing condition: the part of it that the condition's sensors do not
 * respond to (its projection onto the null space of the sensors weighted by the light). Added to a reflectance, it
 * gives a metamer in that condition: the same responses from a different spectrum.
 */
export function metamericBlack(v: Spectrum, observer: Observer, light: Spectrum): number[] {
  const rows = observer.curves.map((c) => c.map((x, i) => x * light[i]));
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const y = solve(rows.map((a) => rows.map((b) => dot(a, b))), rows.map((a) => dot(a, v)));
  return v.map((x, i) => x - rows.reduce((s, a, k) => s + y[k] * a[i], 0));
}

/** The shapes the gray's metameric blacks are made from, before the sensors' part is taken out. */
const BLACK_SHAPES: { label: string; shape: (nm: number) => number }[] = [
  { label: 'a slow wave', shape: (nm) => Math.cos((2 * Math.PI * (nm - 380)) / 400) },
  { label: 'a faster wave', shape: (nm) => Math.cos((2 * Math.PI * (nm - 380)) / 200) },
  { label: 'a bump at 450 nm', shape: (nm) => Math.exp(-(((nm - 450) / 20) ** 2) / 2) },
  { label: 'a bump at 610 nm', shape: (nm) => Math.exp(-(((nm - 610) / 20) ** 2) / 2) },
];

/**
 * A nonselective gray and metamers of it for one observing condition: the gray plus metameric blacks, each scaled to
 * swing at most `swing` of the room between the gray and 0 or 1, so that every reflectance stays between 0 and 1.
 */
export function grayMetamers(level: number, observer: Observer, light: Spectrum, swing = 0.8): Material[] {
  const pct = Math.round(level * 100);
  return [{ name: `Gray ${pct}%`, reflectance: wavelengths.map(() => level) }, ...BLACK_SHAPES.map(({ label, shape }) => ({
    name: `Gray ${pct}% plus the black of ${label}`,
    reflectance: plusBlack(level, scaledBlack(shape, observer, light, Math.min(level, 1 - level) * swing)),
  }))];
}

/**
 * Grays from light to dark, alone, then the same grays with one metameric black added in proportion to the gray: each
 * is the gray times (1 + b), one relative black b for all, as large as the lightest gray allows. A nonselective gray
 * does not shift (its Wpt is W = 100 × its reflectance, p = t = 0, in every condition), and each gray with the black
 * is the lightest one scaled, so their Wpt shift manifolds are one shape, scaled by the gray's level.
 */
export function graysWithBlack(levels: number[], observer: Observer, light: Spectrum, which = 3, swing = 0.8): Material[] {
  const { label, shape } = BLACK_SHAPES[which];
  // g (1 + b) stays within 0 to 1 for every gray when |b| ≤ (1 − g) / g and |b| ≤ 1
  const relative = scaledBlack(shape, observer, light, Math.min(1, ...levels.map((g) => (1 - g) / g)) * swing);
  const pct = (g: number) => Math.round(g * 100);
  return [...levels.map((g) => ({ name: `Gray ${pct(g)}%`, reflectance: wavelengths.map(() => g) })),
    ...levels.map((g) => ({ name: `Gray ${pct(g)}% plus the black of ${label}`, reflectance: plusBlack(g, relative.map((b) => g * b)) }))];
}

/** The metameric black of a shape, scaled so that its largest swing is `swing`. */
function scaledBlack(shape: (nm: number) => number, observer: Observer, light: Spectrum, swing: number): number[] {
  const black = metamericBlack(wavelengths.map(shape), observer, light);
  const k = swing / Math.max(...black.map(Math.abs));
  return black.map((b) => k * b);
}

const plusBlack = (level: number, black: number[]): Spectrum => black.map((b) => level + b);

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
export type PairMode = 'first' | 'consecutive' | 'halves' | 'all';
export function pairIndices(count: number, mode: PairMode): [number, number][] {
  const out: [number, number][] = [];
  if (mode === 'first') for (let j = 1; j < count; j++) out.push([0, j]);
  else if (mode === 'consecutive') for (let i = 0; i + 1 < count; i += 2) out.push([i, i + 1]);
  else if (mode === 'halves') for (let i = 0, h = Math.floor(count / 2); i < h; i++) out.push([i, i + h]);
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

/**
 * What a pair has in common, as numbers rather than verdicts. Wpt is linear, so the pair's Wpt difference in every
 * condition is the Wpt of its difference spectrum d = second − first: d's Wpt is the pair's difference manifold.
 * - fit: the second reflectance as a × the first + b, and the RMS left over. One spectral hue: r₂ = a r₁ + b exactly,
 *   and then the second's Wpt shifts are a × the first's and the two share one Wpt hue angle in every condition (a > 0).
 *   When the first is flat, a is not defined and the fit is the second as a constant.
 * - diff: d's mean and its RMS about the mean; 0 for a nonselective difference, which only moves W, by 100 × the mean.
 * - shiftFit: the second's Wpt shifts as k × the first's, and the share left over (RMS, relative to the second's).
 * - hueSpread: the largest difference of Wpt hue angle, in degrees, over the reference and the conditions; not defined
 *   where either has no chroma.
 * - matches: the conditions where ΔE_WLab between the two is 0.00 to two decimals (−1 for the reference): where the
 *   pair is a metamer, d a metameric black.
 */
export interface PairObservation {
  fit: { a?: number; b: number; rms: number };
  diff: { mean: number; rmsAboutMean: number };
  shiftFit?: { k: number; residual: number };
  hueSpread?: number;
  matches: number[];
  refDWpt: Vec3;
  dWpt: Vec3[];
}

export function observePair(clouds: Cloud[], pair: PairResult): PairObservation {
  const A = clouds[pair.a], B = clouds[pair.b];
  const r1 = A.material.reflectance, r2 = B.material.reflectance, n = r1.length;
  const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / n;
  const rms = (v: readonly number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / n);
  const m1 = mean(r1), m2 = mean(r2);
  const var1 = r1.reduce((s, x) => s + (x - m1) ** 2, 0);
  let fit: PairObservation['fit'];
  if (var1 < 1e-12 * n) fit = { b: m2, rms: rms(r2.map((x) => x - m2)) };
  else {
    const a = r1.reduce((s, x, i) => s + (x - m1) * (r2[i] - m2), 0) / var1, b = m2 - a * m1;
    fit = { a, b, rms: rms(r2.map((x, i) => x - a * r1[i] - b)) };
  }
  const d = r2.map((x, i) => x - r1[i]), md = mean(d);
  const s1 = A.points.map((p) => p.dWpt), s2 = B.points.map((p) => p.dWpt);
  const dot = (u: Vec3[], v: Vec3[]) => u.reduce((s, x, k) => s + x[0] * v[k][0] + x[1] * v[k][1] + x[2] * v[k][2], 0);
  const ss1 = dot(s1, s1), ss2 = dot(s2, s2);
  let shiftFit: PairObservation['shiftFit'];
  if (ss1 > 1e-18) {
    const k = dot(s1, s2) / ss1;
    shiftFit = { k, residual: ss2 > 1e-18 ? Math.sqrt(Math.max(0, ss2 - k * k * ss1) / ss2) : 0 };
  }
  const both = [[A.refWpt, B.refWpt], ...A.points.map((p, k) => [p.wpt, B.points[k].wpt])];
  const hue = (w: Vec3) => (Math.atan2(w[2], w[1]) * 180) / Math.PI;
  const chromaless = both.some(([u, v]) => Math.hypot(u[1], u[2]) < 1e-3 || Math.hypot(v[1], v[2]) < 1e-3);
  const hueSpread = chromaless ? undefined
    : Math.max(...both.map(([u, v]) => Math.abs(((hue(v) - hue(u) + 540) % 360) - 180)));
  const matches = [...(pair.refDE < 0.005 ? [-1] : []), ...pair.dE.flatMap((e, k) => (e < 0.005 ? [k] : []))];
  return {
    fit, diff: { mean: md, rmsAboutMean: rms(d.map((x) => x - md)) }, shiftFit, hueSpread, matches,
    refDWpt: minus(B.refWpt, A.refWpt), dWpt: A.points.map((p, k) => minus(B.points[k].wpt, p.wpt)),
  };
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

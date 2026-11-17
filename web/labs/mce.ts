// Lab H's computations: metamers of a material for one condition or several at once (the reflectances that share its
// Wpt there), how far they part in other conditions, and a plausible reflectance
// for a given Wpt. Pure functions, tested in test/mce.test.ts.
//
// The metameric blacks are those of the dissertation (Spectrally Based Material Color Equivalency, 2015, "Decomposing
// metameric blacks"): from a set of real reflectances R and their responses W in the conditions to match, the residuals
// B = R − R pinv(W) W, which no condition matched responds to, and the eigenvectors of B Bᵀ, the shapes such residuals
// take most. The estimate is its "Proposed spectral estimation": white and a characteristic reflectance of the target's
// hue, g + s·O, with g and s from the target's Wpt lightness and chroma.

import { solve, wavelengths, type Observer, type Spectrum, type Vec3, type WptNormalizationN } from '../../src/index.ts';

const N = wavelengths.length;

/** The rows a condition's sensors make of a reflectance: each sensor's curve times the light (3 rows for 3 sensors). */
export function conditionRows(observer: Observer, light: Spectrum): number[][] {
  return observer.curves.map((c) => c.map((x, i) => x * light[i]));
}

/** The part of a spectrum no row responds to: its projection onto the null space of all the rows. */
export function nullPart(v: readonly number[], rows: readonly (readonly number[])[]): number[] {
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const y = solve(rows.map((a) => rows.map((b) => dot(a, b))), rows.map((a) => dot(a, v)));
  return v.map((x, i) => x - rows.reduce((s, a, k) => s + y[k] * a[i], 0));
}

/** The eigenvalues and eigenvectors of a symmetric matrix (Jacobi rotations), largest eigenvalue first. */
export function symmetricEigen(m: readonly (readonly number[])[]): { values: number[]; vectors: number[][] } {
  const n = m.length, a = m.map((r) => [...r]), v: number[][] = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22 * (1 + a.reduce((s, r, i) => s + r[i] * r[i], 0))) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = a.map((r, i) => [r[i], i] as const).sort((x, y) => y[0] - x[0]);
  return { values: order.map(([val]) => val), vectors: order.map(([, i]) => v.map((r) => r[i])) };
}

/** A set of metameric blacks for some conditions: unit spectra no condition responds to, and how much each varies. */
export interface BlackBasis { blacks: number[][]; weights: number[]; rows: number[][] }

/**
 * The metameric blacks real materials carry for the conditions given: from reflectances R (each a spectrum) and the
 * conditions' rows S, the residuals B = R − R pinv(SR) SR, and the `count` eigenvectors of B Bᵀ with the largest
 * eigenvalues, each made exactly black for every condition. Their weights are the square roots of the eigenvalues over
 * the number of materials: the typical size of each black in a real material.
 */
export function blackBasis(reflectances: readonly Spectrum[], rows: readonly (readonly number[])[], count = 8): BlackBasis {
  const m = rows.length, n = reflectances.length;
  // W = S R (m × n), G = W Wᵀ, P = R Wᵀ (N × m); B Bᵀ = R Rᵀ − P G⁻¹ Pᵀ
  const W = rows.map((s) => reflectances.map((r) => s.reduce((t, x, i) => t + x * r[i], 0)));
  const G = W.map((a) => W.map((b) => a.reduce((t, x, j) => t + x * b[j], 0)));
  const P = Array.from({ length: N }, (_, i) => W.map((w) => reflectances.reduce((t, r, j) => t + r[i] * w[j], 0)));
  const X = P.map((row) => solve(G.map((r) => [...r]), [...row])); // rows of P G⁻¹ (G is symmetric)
  const BB = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, k) => {
    let rr = 0;
    for (const r of reflectances) rr += r[i] * r[k];
    let xp = 0;
    for (let c = 0; c < m; c++) xp += X[i][c] * P[k][c];
    return rr - xp;
  }));
  const { values, vectors } = symmetricEigen(BB);
  const blacks = vectors.slice(0, count).map((v) => { const b = nullPart(v, rows), len = Math.hypot(...b); return b.map((x) => x / len); });
  return { blacks, weights: values.slice(0, count).map((v) => Math.sqrt(Math.max(0, v) / n)), rows: rows.map((r) => [...r]) };
}

/** A seeded random number generator (mulberry32), uniform on [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far a reflectance can go along a black before leaving 0 to 1 somewhere: the largest t with 0 ≤ r + t·b ≤ 1. */
export function room(r: Spectrum, b: readonly number[]): number {
  let t = Infinity;
  b.forEach((x, i) => { if (x > 1e-12) t = Math.min(t, (1 - r[i]) / x); else if (x < -1e-12) t = Math.min(t, -r[i] / x); });
  return Math.max(0, t);
}

/**
 * Metamers of a reflectance for the conditions of a basis: the reflectance plus a random mix of the basis's blacks (each
 * in proportion to its weight), taken a random part of the way, 0 to 1, toward where the reflectance would leave 0 to 1
 * (`reach` of 1 goes all the way). Every one has the same responses as the reflectance in each condition matched.
 */
export function metamersOf(r: Spectrum, basis: BlackBasis, count: number, seed: number, reach = 1): Spectrum[] {
  const rand = seeded(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return Array.from({ length: count }, () => {
    const k = basis.weights.map((w) => w * normal());
    const b = wavelengths.map((_, i) => basis.blacks.reduce((s, black, j) => s + k[j] * black[i], 0));
    const t = room(r, b) * reach * rand();
    return r.map((v, i) => Math.min(1, Math.max(0, v + t * b[i])));
  });
}

/** The WLab differences of each metamer from the material, in one condition. */
export function spreadIn(norm: WptNormalizationN, material: Spectrum, metamers: readonly Spectrum[], deltaE: (a: Vec3, b: Vec3) => number): number[] {
  const at = norm.wlabOf(material);
  return metamers.map((m) => deltaE(norm.wlabOf(m), at));
}

// ---------------------------------------------------------------------------------------------------------------
// A plausible reflectance for a Wpt

/** A characteristic reflectance as the dissertation's estimation uses it: (R − min) / (max − min) over 420 to 680 nm, clipped to 0 to 1. */
export function estimationCharacteristic(r: Spectrum): Spectrum {
  const inside = r.filter((_, i) => wavelengths[i] >= 420 && wavelengths[i] <= 680);
  const lo = Math.min(...inside), hi = Math.max(...inside);
  return hi - lo < 1e-9 ? r.map(() => 0) : r.map((v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
}

/** A hue family: characteristic reflectances in order of their Wpt hue in one condition. */
export interface HueFamily { names: string[]; curves: Spectrum[]; wpts: Vec3[]; hues: number[] }

const hueAngle = (w: Vec3) => ((Math.atan2(w[2], w[1]) * 180) / Math.PI + 360) % 360;

/** The family of characteristic reflectances of some materials, sorted by their Wpt hue in a condition. */
export function hueFamily(names: readonly string[], reflectances: readonly Spectrum[], norm: WptNormalizationN): HueFamily {
  const curves = reflectances.map(estimationCharacteristic), wpts = curves.map((c) => norm.wptOf(c));
  const order = wpts.map((w, i) => [hueAngle(w), i] as const).sort((a, b) => a[0] - b[0]);
  return { names: order.map(([, i]) => names[i]), curves: order.map(([, i]) => curves[i]), wpts: order.map(([, i]) => wpts[i]), hues: order.map(([h]) => h) };
}

export interface Estimate {
  reflectance: Spectrum;
  /** the characteristic reflectance used: a mix of the family's two nearest in hue */
  characteristic: Spectrum;
  between: [string, string];
  /** the share of the second of the two in the mix */
  mix: number;
  /** the gray and the selective amounts: reflectance = g + s × characteristic */
  g: number; s: number;
  /** whether the reflectance stays within 0 to 1 */
  inRange: boolean;
}

/**
 * A plausible reflectance for a Wpt [W, p, t] in a condition, as the dissertation proposes: a characteristic reflectance
 * of the Wpt's hue (the family's two nearest in hue, mixed so that the mix has exactly that hue: Wpt is linear, so the
 * mix's Wpt lies on the line between theirs), then g of white and s of it, [g, s] = [[W_white, W_O], [0, C_O]]⁻¹ [W, C],
 * so that its Wpt is the one asked for. Undefined for a gray (no hue), where the gray itself, W / 100, is the answer.
 */
export function estimateReflectance(wpt: Vec3, family: HueFamily, norm: WptNormalizationN): Estimate | undefined {
  const C = Math.hypot(wpt[1], wpt[2]);
  if (C < 1e-9) return undefined;
  const h = hueAngle(wpt), k = family.hues.length;
  let j = family.hues.findIndex((x) => x >= h);
  if (j < 0) j = 0;
  const i = (j - 1 + k) % k, a = family.wpts[i], b = family.wpts[j];
  // the point of the line a + u (b − a) with hue h: (a + u (b − a)) × (cos h, sin h) has no component across the ray
  const ch = Math.cos((h * Math.PI) / 180), sh = Math.sin((h * Math.PI) / 180);
  const cross = (x: Vec3) => x[1] * sh - x[2] * ch;
  const u = Math.abs(cross(a) - cross(b)) < 1e-12 ? 0 : cross(a) / (cross(a) - cross(b));
  const characteristic = family.curves[i].map((x, n) => (1 - u) * x + u * family.curves[j][n]);
  const o = norm.wptOf(characteristic), white = norm.wptOf(wavelengths.map(() => 1));
  const co = Math.hypot(o[1], o[2]);
  const s = C / co, g = (wpt[0] - s * o[0]) / white[0];
  const reflectance = characteristic.map((x) => g + s * x);
  const inRange = reflectance.every((v) => v >= -1e-9 && v <= 1 + 1e-9);
  return { reflectance, characteristic, between: [family.names[i], family.names[j]], mix: u, g, s, inRange };
}

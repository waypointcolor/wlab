// The landing page's opening animation: the 99 color evaluation samples of CIE 224 (ANSI/IES TM-30) in CIELAB and in
// WLab, condition after condition. Pure computations, tested in test/hero.test.ts; web/hero.ts draws them.
//
// The viewers: the CIE observers, the CIE's categorical observers, and one camera. Cameras' sensors are not eyes, so
// even WLab moves more for them; most were left out (Max, 2026-11-17), and the one kept (2026-11-19) is the camera of
// the 52 whose sensors come closest to the CIE 1931 color-matching functions (see scripts/demo-camera.mjs).
//
// CIELAB needs XYZ. The CIE color-matching observers give it directly. The categorical observers, which are cone
// fundamentals, and the camera are first matched to the CIE 1931 color-matching functions: the
// 3 × 3 matrix that brings its curves closest to them, wavelength by wavelength (least squares), then each row scaled
// so that the condition's white comes out as the CIE 1931 white under the same light. Each condition's CIELAB is
// against its own white. WLab needs nothing of the kind: the Wpt normalization works on any observer's own sensors.

import {
  categoricalObserver, deltaE00, deltaEWlab, inv3, mulMV, observers, responses, whiteOf, wptNormalization,
  xyzToLab, type Mat3, type Observer, type Spectrum, type Vec3,
} from '../src/index.ts';
import ces99 from '../data/objects/cie-ces99.json' with { type: 'json' };
import demoCamera from './demo-camera.json' with { type: 'json' };
import { LIGHTS, type LightName } from './labs/lights.ts';

/** The 99 samples' names and reflectances (the set file: int16 at 1/scale, base64, 81 values per sample). */
export function samples(): { names: string[]; reflectances: Spectrum[] } {
  const bin = atob(ces99.data), view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const reflectances = ces99.names.map((_, j) => Array.from({ length: 81 }, (_, i) => view.getInt16((j * 81 + i) * 2, true) / ces99.scale));
  return { names: ces99.names, reflectances };
}

/** The credit of the camera the animation uses (rawtoaces-data, Apache License 2.0). */
export const HERO_CAMERA_CREDIT = `${demoCamera.source} ${demoCamera.license}. ${demoCamera.changes}`;

export type ObserverKind = 'standard' | 'categorical' | 'camera';
export interface Viewer { name: string; kind: ObserverKind; observer: Observer }

/** The viewers: the four CIE color-matching observers, the ten categorical observers (2°) and the bundled camera. */
export function viewers(): Viewer[] {
  const std: [keyof typeof observers, string][] = [['cie1931', 'CIE 1931 (2°)'], ['cie1964', 'CIE 1964 (10°)'], ['cie2015', 'CIE 2015 (2°)'], ['cie2015_10', 'CIE 2015 (10°)']];
  const cam = demoCamera.camera;
  return [
    ...std.map(([k, name]) => ({ name: `${name} standard observer`, kind: 'standard' as const, observer: observers[k] })),
    ...Array.from({ length: 10 }, (_, i) => ({ name: `categorical observer ${i + 1} (typical human vision)`, kind: 'categorical' as const, observer: categoricalObserver(i + 1) })),
    { name: `${cam.name} camera`, kind: 'camera' as const, observer: { name: `${cam.name} (camera)`, curves: cam.curves as unknown as Observer['curves'] } },
  ];
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/**
 * The 3 × 3 matrix that brings an observer's three curves closest to the CIE 1931 color-matching functions, wavelength
 * by wavelength: M = X Sᵀ (S Sᵀ)⁻¹, with S the observer's curves and X the CIE's.
 */
export function cmfFit(o: Observer): Mat3 {
  const S = o.curves.slice(0, 3), X = observers.cie1931.curves;
  const SS = S.map((a) => S.map((b) => dot(a, b))) as unknown as Mat3, inv = inv3(SS);
  const XS = X.map((x) => S.map((s) => dot(x, s)));
  return XS.map((row) => [0, 1, 2].map((c) => row.reduce((t, v, k) => t + v * inv[k][c], 0))) as unknown as Mat3;
}

/** The fitted matrix for one light: each row scaled so that white comes out as the CIE 1931 white under it. */
function whiteKept(o: Observer, light: Spectrum, fit: Mat3): Mat3 {
  const target = whiteOf(observers.cie1931, light), got = mulMV(fit, responses(new Array(81).fill(1), o, light));
  return fit.map((row, k) => row.map((v) => (v * target[k]) / got[k])) as unknown as Mat3;
}

/** An observer's XYZ for a light: its fitted matrix, each row scaled so that white is the CIE 1931 white there. */
export function toXyzFor(o: Observer, light: Spectrum, fit = cmfFit(o)): (r: Spectrum) => Vec3 {
  const m = whiteKept(o, light, fit);
  return (r) => mulMV(m, responses(r, o, light));
}

/**
 * The color-matching functions an observer is given for a light: its curves through the fitted matrix with white kept
 * (x̄, ȳ, z̄ in shape; their common scale is the observer's own). For the CIE color-matching observers, their own.
 */
export function xyzCurves(v: Viewer, light: Spectrum): number[][] {
  if (v.kind === 'standard') return v.observer.curves.slice(0, 3).map((c) => [...c]);
  const m = whiteKept(v.observer, light, cmfFit(v.observer)), S = v.observer.curves;
  return m.map((row) => S[0].map((_, i) => row[0] * S[0][i] + row[1] * S[1][i] + row[2] * S[2][i]));
}

export interface Placement { viewer: string; light: LightName; lab: Vec3[]; wlab: Vec3[]; moveLab: number; moveWlab: number }

/** The reference: the CIE 1931 observer under illuminant C, the condition WLab predicts for. */
export const REFERENCE = { viewer: 'CIE 1931 (2°) standard observer', light: 'C' as LightName };

/**
 * The samples in one condition: CIELAB (against the condition's own white) and WLab, and their mean moves from the
 * reference: ΔE00 for CIELAB and ΔE_WLab for WLab.
 */
export function place(v: Viewer, light: LightName, refl: readonly Spectrum[], ref?: { lab: Vec3[]; wlab: Vec3[] }): Placement {
  const spd = LIGHTS[light], norm = wptNormalization(v.observer, spd);
  const xyz = v.kind === 'standard' ? (r: Spectrum) => responses(r, v.observer, spd) : toXyzFor(v.observer, spd);
  const white = v.kind === 'standard' ? norm.white as Vec3 : whiteOf(observers.cie1931, spd);
  const lab = refl.map((r) => xyzToLab(xyz(r), white)), wlab = refl.map((r) => norm.wlabOf(r));
  const mean = (d: number[]) => d.reduce((s, x) => s + x, 0) / d.length;
  return {
    viewer: v.name, light, lab, wlab,
    moveLab: ref ? mean(lab.map((x, i) => deltaE00(x, ref.lab[i]))) : 0,
    moveWlab: ref ? mean(wlab.map((x, i) => deltaEWlab(x, ref.wlab[i]))) : 0,
  };
}

/** A seeded shuffle of every viewer under every light (but the reference first), for the animation's order. */
export function conditionOrder(vs: readonly Viewer[], lights: readonly LightName[], seed: number): [number, LightName][] {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const all: [number, LightName][] = vs.flatMap((_, i) => lights.map((l) => [i, l] as [number, LightName]));
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return all;
}


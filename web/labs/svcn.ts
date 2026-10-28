// Reading an iccMAX profile's spectral viewing conditions (its svcn tag), from the binary profile or its XML: the
// observing condition that defines the profile's PCS, for any lab's condition picker. A profile without them is on the
// standard PCS, CIE 1931 (2°) under D50.

import {
  daylight, illuminants, observers, planckian, resample, wavelengths, type Observer, type Spectrum, type Vec3,
} from '../../src/index.ts';

/** The spectral viewing conditions of a profile: its observer and light on the profile's own grid, and their names. */
export interface Svcn {
  description?: string;
  stdObserver: string;
  /** the observer functions on their own grid; undefined when the profile names a standard observer without giving them */
  observerNm?: number[];
  curves?: number[][];
  stdIlluminant: string;
  colorTemperature: number;
  /** the light on its own grid; undefined when the profile names a standard light without giving its spectrum */
  lightNm?: number[];
  light?: number[];
  illuminantXYZ: Vec3;
}

export const STD_OBSERVER_NAMES = ['Unknown observer', 'CIE 1931 (two degree) standard observer', 'CIE 1964 (ten degree) standard observer'];
export const STD_ILLUMINANT_NAMES = ['Illuminant Unknown', 'Illuminant D50', 'Illuminant D65', 'Illuminant D93', 'Illuminant F2', 'Illuminant D55',
  'Illuminant A', 'Illuminant EquiPowerE', 'Illuminant F8', 'Illuminant Black Body', 'Illuminant Daylight', 'Illuminant B', 'Illuminant C',
  'Illuminant F1', 'Illuminant F3', 'Illuminant F4', 'Illuminant F5', 'Illuminant F6', 'Illuminant F7', 'Illuminant F9', 'Illuminant F10',
  'Illuminant F11', 'Illuminant F12'];

const grid = (start: number, end: number, steps: number) => Array.from({ length: steps }, (_, i) => (steps > 1 ? start + ((end - start) * i) / (steps - 1) : start));

/** An IEEE half-precision number (iccMAX's float16, used for the wavelength ranges). */
function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1, exp = (bits >> 10) & 0x1f, frac = bits & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

/**
 * The spectral viewing conditions (svcn) of an iccMAX profile, from the binary profile (.icc) or its XML (as iccDEV's
 * iccToXml writes it, or iccFromXml reads it); undefined for a profile without them. Throws for what is not a profile.
 */
export function readSvcn(data: Uint8Array | string): Svcn | undefined {
  if (typeof data === 'string') return readSvcnXml(data);
  const head = new TextDecoder().decode(data.subarray(0, Math.min(data.length, 64))).trimStart();
  if (head.startsWith('<')) return readSvcnXml(new TextDecoder().decode(data));
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 132 || v.getUint32(36) !== 0x61637370) throw new Error('not an ICC profile (no "acsp" signature)');
  const tags = new Map<number, { at: number; size: number }>();
  for (let i = 0, count = v.getUint32(128); i < count; i++) {
    const e = 132 + 12 * i;
    if (e + 12 > data.length) break;
    tags.set(v.getUint32(e), { at: v.getUint32(e + 4), size: v.getUint32(e + 8) });
  }
  const svcnTag = tags.get(0x7376636e), embedded = tags.get(0x49434335);
  if (!svcnTag) {
    // a hybrid profile (version 2 or 4) carries its version 5 profile in its ICC5 tag: type 'ICCp', 4 reserved bytes,
    // then the whole profile
    if (embedded && embedded.at + embedded.size <= data.length && embedded.size > 8 + 132 && v.getUint32(embedded.at) === 0x49434370) {
      return readSvcn(data.subarray(embedded.at + 8, embedded.at + embedded.size));
    }
    return undefined;
  }
  const { at, size } = svcnTag;
  if (at + size > data.length || size < 24) throw new Error('the svcn tag runs past the end of the profile');
  const end = at + size;
  let p = at + 8;
  const need = (n: number) => { if (p + n > end) throw new Error('the svcn tag is shorter than its contents'); };
  const u32 = () => { need(4); const x = v.getUint32(p); p += 4; return x; };
  const u16 = () => { need(2); const x = v.getUint16(p); p += 2; return x; };
  const f32 = () => { need(4); const x = v.getFloat32(p); p += 4; return x; };
  const stdObs = u32(), oStart = half(u16()), oEnd = half(u16()), oSteps = u16(); u16();
  const curves = oSteps ? [0, 1, 2].map(() => Array.from({ length: oSteps }, f32)) : undefined;
  const stdIll = u32(), cct = f32(), iStart = half(u16()), iEnd = half(u16()), iSteps = u16(); u16();
  const light = iSteps ? Array.from({ length: iSteps }, f32) : undefined;
  const illuminantXYZ: Vec3 = [f32(), f32(), f32()];
  return {
    description: describe(v, tags.get(0x64657363)), stdObserver: STD_OBSERVER_NAMES[stdObs] ?? 'Custom observer',
    observerNm: curves && grid(oStart, oEnd, oSteps), curves,
    stdIlluminant: STD_ILLUMINANT_NAMES[stdIll] ?? 'Illuminant Unknown', colorTemperature: cct,
    lightNm: light && grid(iStart, iEnd, iSteps), light, illuminantXYZ,
  };
}

/** A binary profile's description (its desc tag): the first text of a multiLocalizedUnicodeType, or a version 2 textDescriptionType. */
function describe(v: DataView, tag?: { at: number; size: number }): string | undefined {
  if (!tag || tag.at + tag.size > v.byteLength || tag.size < 12) return undefined;
  const type = v.getUint32(tag.at);
  if (type === 0x6d6c7563 && v.getUint32(tag.at + 8) > 0) {                       // 'mluc': UTF-16BE records
    const len = v.getUint32(tag.at + 20), off = v.getUint32(tag.at + 24);
    if (off + len > tag.size) return undefined;
    let out = '';
    for (let i = 0; i + 1 < len; i += 2) out += String.fromCharCode(v.getUint16(tag.at + off + i));
    return out.replace(/\0+$/, '').trim() || undefined;
  }
  if (type === 0x64657363) {                                                       // 'desc': ASCII, version 2
    const n = v.getUint32(tag.at + 8);
    if (12 + n > tag.size) return undefined;
    let out = '';
    for (let i = 0; i < n; i++) out += String.fromCharCode(v.getUint8(tag.at + 12 + i));
    return out.replace(/\0+$/, '').trim() || undefined;
  }
  return undefined;
}

function readSvcnXml(xml: string): Svcn | undefined {
  if (!/<IccProfile[\s>]/.test(xml)) throw new Error('not an iccMAX profile in XML (no <IccProfile>)');
  const tag = /<spectralViewingConditionsType>([\s\S]*?)<\/spectralViewingConditionsType>/.exec(xml);
  if (!tag) return undefined;
  const body = tag[1];
  const text = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(body)?.[1].trim();
  const series = (name: string) => {
    const m = new RegExp(`<${name}\\s+start="([^"]+)"\\s+end="([^"]+)"\\s+steps="([^"]+)"\\s*>([\\s\\S]*?)</${name}>`).exec(body);
    if (!m) return undefined;
    const steps = Number(m[3]);
    return { nm: grid(Number(m[1]), Number(m[2]), steps), steps, values: m[4].trim().split(/\s+/).filter(Boolean).map(Number) };
  };
  const obs = series('ObserverFuncs');
  if (obs && (obs.values.length !== 3 * obs.steps || obs.values.some(Number.isNaN))) throw new Error('the observer functions of the svcn cannot be read');
  const ill = series('IlluminantSPD');
  const xyz = /<IlluminantXYZ\s+X="([^"]+)"\s+Y="([^"]+)"\s+Z="([^"]+)"/.exec(body);
  const desc = /<profileDescriptionTag>[\s\S]*?<LocalizedText[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/LocalizedText>/.exec(xml)?.[1];
  return {
    description: desc, stdObserver: text('StdObserver') ?? 'Unknown observer', observerNm: obs?.nm,
    curves: obs && [0, 1, 2].map((i) => obs.values.slice(i * obs.steps, (i + 1) * obs.steps)),
    stdIlluminant: text('StdIlluminant') ?? 'Illuminant Unknown', colorTemperature: Number(text('ColorTemperature') ?? 0),
    lightNm: ill && ill.values.length === ill.steps ? ill.nm : undefined, light: ill && ill.values.length === ill.steps ? ill.values : undefined,
    illuminantXYZ: xyz ? [Number(xyz[1]), Number(xyz[2]), Number(xyz[3])] : [0, 0, 0],
  };
}

/** The light a profile names without giving its spectrum, from iccMAX's name and color temperature. */
function namedLight(name: string, cct: number): Spectrum {
  const builtIn: Record<string, Spectrum> = {
    'Illuminant D50': illuminants.D50, 'Illuminant D65': illuminants.D65, 'Illuminant A': illuminants.A, 'Illuminant C': illuminants.C,
    'Illuminant EquiPowerE': illuminants.E, 'Illuminant F2': illuminants.F2, 'Illuminant F11': illuminants.F11,
  };
  if (builtIn[name]) return builtIn[name];
  if (name === 'Illuminant D55') return daylight(5500);
  if (name === 'Illuminant D93') return daylight(9300);
  if (name === 'Illuminant Daylight' && cct >= 4000) return daylight(cct);
  if (name === 'Illuminant Black Body' && cct > 0) return planckian(cct);
  throw new Error(`the profile names its light (${name}) without giving its spectrum, and it is not one built in here`);
}

/** The observer a profile names without giving its functions. */
function namedObserver(name: string): Observer {
  if (name === 'CIE 1931 (two degree) standard observer') return observers.cie1931;
  if (name === 'CIE 1964 (ten degree) standard observer') return observers.cie1964;
  throw new Error(`the profile names its observer (${name}) without giving its functions`);
}

/** Curves on the package grid, 0 outside the range they are given over (an observer does not respond there). */
function onGrid(nm: readonly number[], values: readonly number[]): Spectrum {
  const inside = resample(nm, values);
  return wavelengths.map((x, k) => (x < nm[0] - 1e-6 || x > nm[nm.length - 1] + 1e-6 ? 0 : inside[k]));
}

/**
 * The observing condition a profile defines: the observer and light of its spectral viewing conditions, on the package
 * grid, or CIE 1931 (2°) under D50, the standard PCS's, when it has none.
 */
export function profileCondition(data: Uint8Array | string): { observer: Observer; light: Spectrum; lightLabel: string; svcn?: Svcn } {
  const svcn = readSvcn(data);
  if (!svcn) return { observer: observers.cie1931, light: illuminants.D50, lightLabel: 'D50 (the profile has no spectral viewing conditions tag)' };
  const light = svcn.light && svcn.lightNm ? resample(svcn.lightNm, svcn.light) : namedLight(svcn.stdIlluminant, svcn.colorTemperature);
  const lightLabel = `the profile's light (${svcn.stdIlluminant.replace(/^Illuminant /, '')})`;
  if (!svcn.curves || !svcn.observerNm) return { observer: namedObserver(svcn.stdObserver), light, lightLabel, svcn };
  const curves = svcn.curves.map((c) => onGrid(svcn.observerNm!, c));
  if (!curves.every((c) => c.some((v) => v !== 0))) throw new Error('the observer functions of the profile are empty between 380 and 780 nm');
  const name = svcn.description ? `${svcn.description} (from the profile)` : `the profile's observer (${svcn.stdObserver})`;
  return { observer: { name, curves }, light, lightLabel, svcn };
}

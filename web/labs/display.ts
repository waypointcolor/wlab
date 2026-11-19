// Lab I's displays: a display as iccMAX describes it spectrally (the emission of its red, green and blue at full drive,
// what it emits at black, and the tone curve of each channel), read from or written as a version 5 display profile
// in the layout of iccDEV's Testing/Display/LCDDisplay.xml (AToB1: curves then an emission matrix; BToA1: the inverse
// emission matrix then the inverse curves). A display keeps its own wavelengths: a laser display's lines are 1 nm
// wide, so an observer is brought to the display's grid (linear interpolation), never the display to the observer's.
//
// An observer looking at a display (`viewOn`): its responses to what the display emits, with the display's white as
// the light, give the observer's Wpt normalization for that display (the 40 base samples as if lit by the display's
// white), its WLab of each display color, and the c2sp of its observer profile: the Wpt MAT from it to CIE 1931 (2°)
// under D50, the standard PCS, as Lab D's profiles carry.

import {
  illuminants, inv3, munsellBase, observers, wavelengths, wptMatrixOf, wptNormalization, wptToWlab,
  type Mat3, type Observer, type Spectrum, type Vec3,
} from '../../src/index.ts';
import { encodingProfileXml, type Converted } from './encoding.ts';

export interface Display {
  name: string;
  /** the wavelengths of every spectrum below, evenly spaced */
  nm: number[];
  /** the emission of red, green and blue at full drive (on top of black), scaled so that white's peak is 1 */
  primaries: [number[], number[], number[]];
  /** the emission at black (R = G = B = 0), on the same scale */
  black: number[];
  /** each channel's tone curve: drive (0 to 1, as linear light) at evenly spaced code values from 0 to 1 */
  curves: [number[], number[], number[]];
  /** where the display comes from, for the page */
  source?: string;
}

/** n evenly spaced wavelengths from start to end. */
export const gridOf = (start: number, end: number, steps: number) => Array.from({ length: steps }, (_, i) => (steps > 1 ? start + ((end - start) * i) / (steps - 1) : start));

/** Values on one grid brought to another by linear interpolation; 0 outside the values' own range. */
export function onGrid(from: readonly number[], values: readonly number[], to: readonly number[]): number[] {
  return to.map((x) => {
    if (x < from[0] || x > from[from.length - 1]) return 0;
    let j = 1;
    while (j < from.length - 1 && from[j] < x) j++;
    const t = (x - from[j - 1]) / (from[j] - from[j - 1] || 1);
    return values[j - 1] + (values[j] - values[j - 1]) * Math.max(0, Math.min(1, t));
  });
}

/** A sampled curve (evenly spaced over 0 to 1) at x, by linear interpolation; flat beyond its ends. */
export function curveAt(curve: readonly number[], x: number): number {
  const n = curve.length - 1, u = Math.max(0, Math.min(1, x)) * n, i = Math.min(n - 1, Math.floor(u));
  return curve[i] + (curve[i + 1] - curve[i]) * (u - i);
}

/** The inverse of a rising sampled curve at y: the code value (0 to 1) whose drive, by linear interpolation, is y. */
export function inverseAt(curve: readonly number[], y: number): number {
  const n = curve.length - 1;
  if (y <= curve[0]) return 0;
  if (y >= curve[n]) return 1;
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (curve[mid] < y) lo = mid; else hi = mid; }
  const d = curve[hi] - curve[lo];
  return (lo + (d > 0 ? (y - curve[lo]) / d : 0)) / n;
}

/**
 * Where the inverse tone curves are sampled: drive from 0 to 1 in segments that grow tenfold (0 to 10⁻⁴, to 10⁻³, …,
 * to 1), each sampled evenly, so that the inverse stays exact near black, where a display's tone curve is flattest.
 */
export const INVERSE_BREAKS = [0, 1e-4, 1e-3, 1e-2, 1e-1, 1];
export const INVERSE_SAMPLES = 256;

/** What a display emits at full white: black plus its three primaries. */
export const whiteOf = (d: Display) => d.black.map((b, i) => b + d.primaries[0][i] + d.primaries[1][i] + d.primaries[2][i]);

/** The drive of each channel for code values R, G, B (0 to 1), through its tone curve. */
export const driveOf = (d: Display, rgb: readonly number[]): Vec3 => [0, 1, 2].map((k) => curveAt(d.curves[k], rgb[k])) as Vec3;

/** What a display emits for code values R, G, B (0 to 1). */
export function emissionOf(d: Display, rgb: readonly number[]): number[] {
  const [r, g, b] = driveOf(d, rgb);
  return d.black.map((v, i) => v + r * d.primaries[0][i] + g * d.primaries[1][i] + b * d.primaries[2][i]);
}

// ---------------------------------------------------------------------------------------------------------------
// Tone curves

export type Tone = { kind: 'srgb' } | { kind: 'gamma'; gamma: number } | { kind: 'table'; curves: [number[], number[], number[]] };

/** The sRGB (IEC 61966-2-1) decoding: code value to linear light. */
export const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Sampled tone curves (count evenly spaced code values) for a kind of tone. */
export function toneCurves(t: Tone, count = 1024): [number[], number[], number[]] {
  if (t.kind === 'table') return t.curves;
  const f = t.kind === 'srgb' ? srgbDecode : (v: number) => v ** t.gamma;
  const c = Array.from({ length: count }, (_, i) => f(i / (count - 1)));
  return [c, [...c], [...c]];
}

/**
 * A measured tone table: code values (0 to 1, or 0 to 255, or 0 to 1023 …, found from the largest) and the drive of
 * each channel (any scale; each is divided by its last value). One drive column serves all three channels.
 */
export function toneTable(codes: readonly number[], drives: readonly (readonly number[])[], count = 1024): [number[], number[], number[]] {
  if (codes.length < 2) throw new Error('give at least two rows of the tone table');
  const top = codes[codes.length - 1];
  const x = codes.map((c) => c / top);
  const cols = drives.length === 1 ? [drives[0], drives[0], drives[0]] : drives;
  if (cols.length !== 3) throw new Error('give one drive column for all three channels, or one for each of R, G and B');
  return cols.map((col) => {
    const last = col[col.length - 1];
    if (!(last > 0)) throw new Error('the last row of the tone table must have a drive above 0');
    return onGrid(x, col.map((v) => v / last), gridOf(0, 1, count));
  }) as [number[], number[], number[]];
}

/** A display from measured spectra (any units: the white's peak becomes 1), on the spectra's own grid. */
export function displayFromSpectra(name: string, nm: readonly number[], rgb: readonly (readonly number[])[], black: readonly number[] | undefined, tone: Tone): Display {
  if (rgb.length !== 3) throw new Error('give the emission of red, green and blue');
  // only 380 to 780 nm counts: the observers end there
  const keep = nm.map((x, i) => [x, i] as const).filter(([x]) => x >= 380 && x <= 780).map(([, i]) => i);
  if (keep.length < 2) throw new Error('the wavelengths must cover 380 to 780 nm, or part of it');
  if (keep.length < nm.length) return displayFromSpectra(name, keep.map((i) => nm[i]), rgb.map((c) => keep.map((i) => c[i])), black && keep.map((i) => black[i]), tone);
  const step = nm[1] - nm[0];
  const even = nm.every((v, i) => !i || Math.abs(v - nm[i - 1] - step) < 1e-6 * step);
  // an uneven grid is brought to 1 nm, which keeps any narrow line
  const grid = even ? [...nm] : gridOf(Math.ceil(nm[0]), Math.floor(nm[nm.length - 1]), Math.floor(nm[nm.length - 1]) - Math.ceil(nm[0]) + 1);
  const at = (v: readonly number[]) => (even ? [...v] : onGrid(nm, v, grid));
  const p = rgb.map(at), b = black ? at(black) : grid.map(() => 0);
  const peak = Math.max(...b.map((v, i) => v + p[0][i] + p[1][i] + p[2][i]));
  if (!(peak > 0)) throw new Error('the display emits nothing at white');
  const scale = (v: number[]) => v.map((x) => x / peak);
  return { name, nm: grid, primaries: [scale(p[0]), scale(p[1]), scale(p[2])], black: scale(b), curves: toneCurves(tone) };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a version 5 display profile as XML (iccDEV's Testing/Display layout)

const numbersIn = (s: string) => s.trim().split(/\s+/).filter(Boolean).map(Number);

/** One curve of a CurveSetElement, sampled at `count` evenly spaced inputs from 0 to 1. */
function curveOf(xml: string, count = 1024): number[] {
  const single = xml.match(/<SingleSampledCurve\b([^>]*)>([\s\S]*?)<\/SingleSampledCurve>/);
  if (single) {
    const first = Number(single[1].match(/FirstEntry="([^"]+)"/)?.[1] ?? 0), last = Number(single[1].match(/LastEntry="([^"]+)"/)?.[1] ?? 1);
    const v = numbersIn(single[2]);
    return gridOf(0, 1, count).map((x) => curveAt(v, (x - first) / (last - first)));
  }
  const segs = [...xml.matchAll(/<FormulaSegment\b([^>]*)>([\s\S]*?)<\/FormulaSegment>/g)].map((m) => {
    const lim = (k: string) => { const s = m[1].match(new RegExp(`${k}="([^"]+)"`))?.[1] ?? ''; return s.includes('infinity') ? (s.startsWith('-') ? -Infinity : Infinity) : Number(s); };
    return { start: lim('Start'), end: lim('End'), type: Number(m[1].match(/FunctionType="(\d+)"/)?.[1]), p: numbersIn(m[2]) };
  });
  if (!segs.length) throw new Error('a curve this page cannot read (only sampled curves and formula segments of types 0 and 3)');
  return gridOf(0, 1, count).map((x) => {
    const s = segs.find((g) => x >= g.start && x <= g.end) ?? segs[segs.length - 1];
    // iccMAX formula segments: type 0, (a·x + b)^γ + c; type 3, a·(b·x + c)^γ + d
    if (s.type === 0) { const [g, a, b, c] = s.p; return Math.max(0, a * x + b) ** g + c; }
    if (s.type === 3) { const [g, a, b, c, d] = s.p; return a * Math.max(0, b * x + c) ** g + d; }
    throw new Error(`a formula segment of type ${s.type}, which this page cannot read`);
  });
}

/** A version 5 display profile's XML (as iccToXml writes it) read as a display: its AToB1 curves and emission matrix. */
export function displayFromXml(xml: string, source?: string): Display {
  const a2b1 = xml.match(/<TagSignature>A2B1<\/TagSignature>([\s\S]*?)<\/multiProcessElementType>/)?.[1]
    ?? xml.match(/<AToB1Tag>([\s\S]*?)<\/AToB1Tag>/)?.[1];
  if (!a2b1) throw new Error('no AToB1 (A2B1) tag: not a spectral display profile');
  const curveSet = a2b1.match(/<CurveSetElement[\s\S]*?<\/CurveSetElement>/)?.[0];
  const em = a2b1.match(/<EmissionMatrixElement[\s\S]*?<\/EmissionMatrixElement>/)?.[0];
  if (!curveSet || !em) throw new Error('the AToB1 is not tone curves followed by an emission matrix');
  const curves = [...curveSet.matchAll(/<(SingleSampledCurve|SegmentedCurve)\b[\s\S]*?<\/\1>/g)].map((m) => curveOf(m[0]));
  if (curves.length !== 3) throw new Error(`${curves.length} tone curves; a display has three`);
  const w = em.match(/<Wavelengths start="([^"]+)" end="([^"]+)" steps="(\d+)"/);
  if (!w) throw new Error('the emission matrix has no wavelengths');
  const nm = gridOf(Number(w[1]), Number(w[2]), Number(w[3])), n = nm.length;
  const part = (tag: string) => { const m = em.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? numbersIn(m[1]) : undefined; };
  const matrix = part('MatrixData');
  if (!matrix || matrix.length !== 3 * n) throw new Error('the emission matrix is not three spectra on its wavelengths');
  const black = part('OffsetData') ?? new Array(n).fill(0);
  const p = [0, 1, 2].map((k) => matrix.slice(k * n, (k + 1) * n));
  const peak = Math.max(...black.map((v, i) => v + p[0][i] + p[1][i] + p[2][i]));
  const scale = (v: number[]) => v.map((x) => x / peak);
  const name = xml.match(/<LocalizedText[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/LocalizedText>/)?.[1] ?? 'Display';
  return { name, nm, primaries: [scale(p[0]), scale(p[1]), scale(p[2])], black: scale(black), curves: curves as Display['curves'], source };
}

// ---------------------------------------------------------------------------------------------------------------
// An observer looking at a display

/** An observer's view of a display: its responses, Wpt and WLab of what the display emits, and its MAT to the standard PCS. */
export interface View {
  observer: Observer;
  /** the observer's curves on the display's wavelengths */
  curves: number[][];
  /** responses to an emission, scaled so that the display's white gives Y (the second) = 100 */
  respond(e: readonly number[]): Vec3;
  /** from those responses to Wpt: the observer's Wpt normalization with the display's white as the light */
  toWpt: Mat3;
  /** the responses to the display's white (Y = 100) */
  white: Vec3;
  /** the Wpt MAT from this view to CIE 1931 (2°) under D50 (responses in, standard PCS XYZ out, both white Y = 100) */
  c2sp: Mat3;
  wlabOf(rgb: readonly number[]): Vec3;
}

const STD = wptNormalization(observers.cie1931, illuminants.D50);

/** An observer looking at a display: everything on the display's own wavelengths. */
export function viewOn(d: Display, observer: Observer): View {
  if (observer.curves.length !== 3) throw new Error('an observer of three sensors');
  const curves = observer.curves.map((c) => onGrid(wavelengths, c, d.nm));
  const white = whiteOf(d);
  const raw = (e: readonly number[]) => curves.map((c) => c.reduce((s, v, i) => s + v * e[i], 0)) as Vec3;
  const k = 100 / raw(white)[1];
  const respond = (e: readonly number[]) => raw(e).map((v) => v * k) as Vec3;
  // the 40 base samples as if lit by the display's white
  const base = munsellBase.reflectances.map((r) => { const ro = onGrid(wavelengths, r, d.nm); return respond(white.map((w, i) => w * ro[i])); });
  const toWpt = wptMatrixOf(respond(white), base).toWpt as unknown as Mat3;
  const mul = (a: Mat3, b: Mat3) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])) as unknown as Mat3;
  const c2sp = mul(STD.fromWpt, toWpt);
  const wlabOf = (rgb: readonly number[]) => {
    const r = respond(emissionOf(d, rgb));
    return wptToWlab(toWpt.map((row) => row[0] * r[0] + row[1] * r[1] + row[2] * r[2]) as Vec3);
  };
  return { observer, curves, respond, toWpt, white: respond(white), c2sp, wlabOf };
}

/** Standard PCS XYZ (CIE 1931 under D50, white Y = 1) of a display color for an observer: through its Wpt MAT. */
export function pcsXyzOf(d: Display, v: View, rgb: readonly number[]): Vec3 {
  const r = v.respond(emissionOf(d, rgb));
  return v.c2sp.map((row) => (row[0] * r[0] + row[1] * r[1] + row[2] * r[2]) / 100) as Vec3;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a version 4 matrix/TRC display profile (as iccV5DspObsToV4Dsp writes it)

export interface MatrixTrc {
  version: string;
  /** the colorants: the XYZ (standard PCS, D50) of red, green and blue at full drive */
  red: Vec3; green: Vec3; blue: Vec3;
  /** the media white point */
  white: Vec3;
  /** each channel's tone curve (curv), as stored: evenly spaced code values from 0 to 1 */
  trc: number[][];
}

/** A binary version 2 or 4 matrix/TRC profile's colorants, white point and tone curves. */
export function readMatrixTrc(bytes: Uint8Array): MatrixTrc {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sig = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  const tags = new Map<string, number>();
  for (let i = 0, n = v.getUint32(128); i < n; i++) tags.set(sig(132 + 12 * i), v.getUint32(136 + 12 * i));
  const s15 = (o: number) => v.getInt32(o) / 65536;
  const xyzTag = (t: string): Vec3 => {
    const o = tags.get(t);
    if (o === undefined) throw new Error(`no ${t} tag`);
    return [s15(o + 8), s15(o + 12), s15(o + 16)];
  };
  const curv = (t: string) => {
    const o = tags.get(t);
    if (o === undefined) throw new Error(`no ${t} tag`);
    const n = v.getUint32(o + 8);
    return Array.from({ length: n }, (_, i) => v.getUint16(o + 12 + 2 * i) / 65535);
  };
  return {
    version: `${bytes[8]}.${bytes[9] >> 4}`, red: xyzTag('rXYZ'), green: xyzTag('gXYZ'), blue: xyzTag('bXYZ'), white: xyzTag('wtpt'),
    trc: ['rTRC', 'gTRC', 'bTRC'].map(curv),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Writing profiles (XML for iccDEV's iccFromXml)

const f = (v: number) => (Object.is(v, -0) || Math.abs(v) < 5e-13 ? 0 : v).toFixed(10);
const block = (v: readonly number[], indent: string, per = 8) => {
  const out: string[] = [];
  for (let i = 0; i < v.length; i += per) out.push(`${indent}${v.slice(i, i + per).map(f).join(' ')}`);
  return out.join('\n');
};
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const xyz = (v: readonly number[]) => `X="${f(v[0])}" Y="${f(v[1])}" Z="${f(v[2])}"`;
const curveSet = (curves: readonly (readonly number[])[]) => `        <CurveSetElement InputChannels="3" OutputChannels="3">
${curves.map((c) => `          <SingleSampledCurve Start="-infinity" End="+infinity" FirstEntry="0.0000000000" LastEntry="1.0000000000" StorageType="0" ExtensionType="0">
${block(c, '            ')}
          </SingleSampledCurve>`).join('\n')}
        </CurveSetElement>`;
/**
 * The inverse tone curves as segmented curves: sampled segments from 0 to 1 (see INVERSE_BREAKS), and beyond them the
 * drive itself ((1 · x + 0)^1 + 0), so that a color a display cannot reach comes out below 0 or above 1, not clipped.
 */
const inverseCurveSet = (curves: readonly (readonly number[])[]) => `        <CurveSetElement InputChannels="3" OutputChannels="3">
${curves.map((c) => `          <SegmentedCurve>
            <FormulaSegment Start="-infinity" End="0.0" FunctionType="0">1.0 1.0 0.0 0.0</FormulaSegment>
${INVERSE_BREAKS.slice(1).map((end, s) => {
    const start = INVERSE_BREAKS[s];
    // a sampled segment's values are evenly spaced over [start, end], the first included in the XML although iccDEV
    // replaces it with the previous segment's value at start (IccMpeXml.cpp keeps every value; Begin() overwrites [0])
    const v = Array.from({ length: INVERSE_SAMPLES + 1 }, (_, k) => inverseAt(c, start + ((end - start) * k) / INVERSE_SAMPLES));
    return `            <SampledSegment Start="${start}" End="${end}">
${block(v, '              ')}
            </SampledSegment>`;
  }).join('\n')}
            <FormulaSegment Start="1.0" End="+infinity" FunctionType="0">1.0 1.0 0.0 0.0</FormulaSegment>
          </SegmentedCurve>`).join('\n')}
        </CurveSetElement>`;
const emission = (tag: string, d: Display) => {
  const grid = `start="${d.nm[0].toFixed(8)}" end="${d.nm[d.nm.length - 1].toFixed(8)}" steps="${d.nm.length}"`;
  return `        <${tag} InputChannels="3" OutputChannels="3">
          <Wavelengths ${grid}/>
          <WhiteData>
${block(whiteOf(d), '            ', 16)}
          </WhiteData>
          <MatrixData>
${d.primaries.map((p) => block(p, '            ', 16)).join('\n')}
          </MatrixData>
          <OffsetData>
${block(d.black, '            ', 16)}
          </OffsetData>
        </${tag}>`;
};
const matrixTag = (sig: string, m: Mat3) => `    <multiProcessElementType>
      <TagSignature>${sig}</TagSignature>
      <MultiProcessElements InputChannels="3" OutputChannels="3">
        <MatrixElement InputChannels="3" OutputChannels="3">
          <MatrixData>
${m.map((r) => `            ${r.map(f).join(' ')}`).join('\n')}
          </MatrixData>
        </MatrixElement>
      </MultiProcessElements>
    </multiProcessElementType>`;

/**
 * A display as an iccMAX version 5 display profile (XML for iccFromXml), laid out as iccDEV's LCDDisplay.xml: AToB1
 * the tone curves then the emission matrix, BToA1 the inverse emission matrix then the inverse curves. Its own
 * spectral viewing conditions are the CIE 1931 (2°) observer with the display's white as the light, and its c2sp and
 * s2cp the Wpt MAT between them and the standard PCS; another observer's profile can stand in for them (iccDEV's -pcc).
 */
export function displayProfileXml(d: Display, copyright = 'No copyright; use freely'): string {
  const v = viewOn(d, observers.cie1931);
  const white = v.white.map((x) => x / 100);
  const grid = `start="${d.nm[0].toFixed(8)}" end="${d.nm[d.nm.length - 1].toFixed(8)}" steps="${d.nm.length}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<IccProfile>
  <Header>
    <PreferredCMMType></PreferredCMMType>
    <ProfileVersion>5.00</ProfileVersion>
    <ProfileDeviceClass>mntr</ProfileDeviceClass>
    <DataColourSpace>RGB </DataColourSpace>
    <PCS>XYZ </PCS>
    <CreationDateTime>now</CreationDateTime>
    <ProfileFlags EmbeddedInFile="true" UseWithEmbeddedDataOnly="false"/>
    <DeviceAttributes ReflectiveOrTransparency="reflective" GlossyOrMatte="glossy" MediaPolarity="positive" MediaColour="colour"/>
    <RenderingIntent>Relative Colorimetric</RenderingIntent>
    <PCSIlluminant>
      <XYZNumber ${xyz(white)}/>
    </PCSIlluminant>
    <ProfileCreator></ProfileCreator>
    <ProfileID>1</ProfileID>
  </Header>
  <Tags>
    <multiLocalizedUnicodeType>
      <TagSignature>desc</TagSignature>
      <LocalizedText LanguageCountry="enUS">${cdata(d.name)}</LocalizedText>
    </multiLocalizedUnicodeType>
    <multiProcessElementType>
      <TagSignature>A2B1</TagSignature>
      <MultiProcessElements InputChannels="3" OutputChannels="3">
${curveSet(d.curves)}
${emission('EmissionMatrixElement', d)}
      </MultiProcessElements>
    </multiProcessElementType>
    <multiProcessElementType>
      <TagSignature>B2A1</TagSignature>
      <MultiProcessElements InputChannels="3" OutputChannels="3">
${emission('InvEmissionMatrixElement', d)}
${inverseCurveSet(d.curves)}
      </MultiProcessElements>
    </multiProcessElementType>
${matrixTag('c2sp', v.c2sp)}
${matrixTag('s2cp', inv3(v.c2sp))}
    <spectralViewingConditionsType>
      <TagSignature>svcn</TagSignature>
      <StdObserver>Custom observer</StdObserver>
      <IlluminantXYZ ${xyz(white.map((x) => x * 100))}/>
      <ObserverFuncs ${grid}>
${v.curves.map((c) => block(c, '        ')).join('\n')}
      </ObserverFuncs>
      <StdIlluminant>Illuminant Unknown</StdIlluminant>
      <ColorTemperature>${f(0)}</ColorTemperature>
      <IlluminantSPD ${grid}>
${block(whiteOf(d), '        ')}
      </IlluminantSPD>
      <SurroundXYZ ${xyz(white.map((x) => x * 100))}/>
    </spectralViewingConditionsType>
    <XYZType>
      <TagSignature>wtpt</TagSignature>
      <XYZNumber ${xyz(white)}/>
    </XYZType>
    <multiLocalizedUnicodeType>
      <TagSignature>cprt</TagSignature>
      <LocalizedText LanguageCountry="enUS">${cdata(copyright)}</LocalizedText>
    </multiLocalizedUnicodeType>
  </Tags>
</IccProfile>
`;
}

/**
 * An observer's profile for a display (XML for iccFromXml): Lab D's colorimetric encoding profile (class spac,
 * subclass pcc; XYZ in floating point) with the observer's own curves, on the display's wavelengths, and the display's
 * white as the light; its c2sp the Wpt MAT of `viewOn`. iccDEV takes it as the profile connection conditions of the
 * display profile (-pcc) and iccV5DspObsToV4Dsp as the observer.
 */
export function observerProfileXml(d: Display, v: View, description: string): string {
  const c: Converted = {
    mat: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], curves: v.curves, standard: false, c2sp: v.c2sp, s2cp: inv3(v.c2sp),
    white: v.white.map((x) => x / 100) as Vec3,
  };
  return encodingProfileXml(c, whiteOf(d) as Spectrum, { encoding: 'XYZ', numbers: 'float', description, luminance: 100, nm: d.nm });
}

// Lab D's computations: a source observer converted by a MAT for an observing condition, and the iccMAX colorimetric
// encoding profile (XML for iccDEV's iccFromXml) whose spectral viewing conditions carry it. The spectral viewing
// conditions define the profile's PCS. A MAT to CIE 1931 (2°) under D50 gives an observer for the standard PCS, and the
// conversions between custom and standard PCS (c2sp, s2cp) are the identity; a MAT to any other condition gives a
// custom PCS, and c2sp and s2cp are the MATs from it to the standard PCS and back.

import {
  illuminants, inv3, mat, observers, wavelengths, wptNormalization, type Mat3, type Observer, type Spectrum, type Vec3,
} from '../../src/index.ts';

/** The standard PCS's condition: CIE 1931 (2°) under D50. */
export const STANDARD = { observer: observers.cie1931 as Observer, light: illuminants.D50 as Spectrum };
const identity = (): Mat3 => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Whether a condition is the standard PCS's own (the built-in CIE 1931 observer and D50, not a copy of either). */
export const isStandard = (observer: Observer, light: Spectrum) => observer === STANDARD.observer && light === STANDARD.light;

/** The tristimulus white of a light seen by three curves, scaled to Y = 1 (the second curve's response 1). */
export function whiteOf(curves: readonly (readonly number[])[], light: Spectrum): Vec3 {
  const sum = (c: readonly number[]) => c.reduce((s, v, i) => s + v * light[i], 0);
  const y = sum(curves[1]);
  return [sum(curves[0]) / y, 1, sum(curves[2]) / y];
}

export interface Converted {
  /** the MAT from the source observer under the condition's light to the condition */
  mat: Mat3;
  /** the converted observer: the MAT applied to the source's curves */
  curves: number[][];
  /** whether the condition is the standard PCS's, so that c2sp and s2cp are the identity */
  standard: boolean;
  /** custom PCS to standard PCS, and back */
  c2sp: Mat3;
  s2cp: Mat3;
  /** the condition's light seen by the converted observer, Y = 1 */
  white: Vec3;
}

/**
 * A source observer (cone fundamentals, color-matching functions or other sensor functions, three curves) converted for
 * an observing condition: the MAT from the source observer under the condition's light to the condition, applied to
 * the source's curves. The converted observer under the condition's light gives the condition's responses as the MAT
 * predicts them, so it defines the profile's PCS. Off the standard condition, c2sp is the MAT from that PCS (the
 * converted observer under the light) to the standard one, and s2cp its inverse.
 */
export function convertObserver(source: Observer, observer: Observer, light: Spectrum): Converted {
  if (source.curves.length !== 3) throw new Error(`a MAT needs three sensors; the source observer has ${source.curves.length}`);
  if (observer.curves.length !== 3) throw new Error(`a MAT needs three sensors; the condition's observer has ${observer.curves.length}`);
  const M = mat(wptNormalization(source, light), wptNormalization(observer, light));
  const curves = M.map((row) => source.curves[0].map((_, k) => row[0] * source.curves[0][k] + row[1] * source.curves[1][k] + row[2] * source.curves[2][k]));
  const standard = isStandard(observer, light);
  const converted: Observer = { name: 'converted observer', curves };
  const c2sp = standard ? identity() : mat(wptNormalization(converted, light), wptNormalization(STANDARD.observer, STANDARD.light));
  return { mat: M, curves, standard, c2sp, s2cp: standard ? identity() : inv3(c2sp), white: whiteOf(curves, light) };
}

// ---------------------------------------------------------------------------------------------------------------
// The profile

export type Encoding = 'XYZ' | 'Lab';
/** Floating-point data are the PCS values themselves; integer data are scaled to 0 to 1 (as 8- or 16-bit images store them). */
export type Numbers = 'float' | 'integer';

export interface ProfileOptions {
  encoding: Encoding;
  numbers?: Numbers;
  description: string;
  /** iccMAX's name for the light ("Illuminant Unknown" otherwise), and its color temperature (0 when it has none) */
  stdIlluminant?: string;
  colorTemperature?: number;
  /** the luminance of the illuminant and the surround, in cd/m² */
  luminance: number;
  copyright?: string;
}

/** Whether two spectra are the same, to 1 part in 10⁹ of the larger's peak. */
function same(a: readonly number[], b: readonly number[]): boolean {
  const peak = Math.max(...a.map(Math.abs), ...b.map(Math.abs));
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-9 * peak);
}

/** iccMAX's name for a converted observer that is one of the CIE standard observers, which a svcn names by index. */
export function standardObserverOf(curves: readonly (readonly number[])[]): string | undefined {
  if (observers.cie1931.curves.every((c, i) => same(c, curves[i]))) return 'CIE 1931 (two degree) standard observer';
  if (observers.cie1964.curves.every((c, i) => same(c, curves[i]))) return 'CIE 1964 (ten degree) standard observer';
  return undefined;
}

/** Whether a light is D50, which a svcn names by index. */
export const isD50 = (light: Spectrum) => light === illuminants.D50 || same(light, illuminants.D50);

const f = (v: number) => (Object.is(v, -0) || Math.abs(v) < 5e-13 ? 0 : v).toFixed(12);
const xyzAttrs = (v: readonly number[]) => `X="${f(v[0])}" Y="${f(v[1])}" Z="${f(v[2])}"`;
const rows = (v: readonly number[], per = 8) => {
  const out: string[] = [];
  for (let i = 0; i < v.length; i += per) out.push(`        ${v.slice(i, i + per).map(f).join(' ')}`);
  return out.join('\n');
};
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const matrixMpe = (sig: string, m: Mat3) => `    <${sig}> <multiProcessElementType>
      <MultiProcessElements InputChannels="3" OutputChannels="3">
        <MatrixElement InputChannels="3" OutputChannels="3">
          <MatrixData>
${m.map((r) => `            ${r.map(f).join(' ')}`).join('\n')}
          </MatrixData>
        </MatrixElement>
      </MultiProcessElements>
    </multiProcessElementType> </${sig}>`;
const emptyMpe = (sig: string) => `    <${sig}> <multiProcessElementType>
      <MultiProcessElements InputChannels="3" OutputChannels="3">
      </MultiProcessElements>
    </multiProcessElementType> </${sig}>`;
/** A scaling with an offset, as one matrix element: out = diag(scale) × in + offset. */
const scaleMpe = (sig: string, scale: Vec3, offset?: Vec3) => `    <${sig}> <multiProcessElementType>
      <MultiProcessElements InputChannels="3" OutputChannels="3">
        <MatrixElement InputChannels="3" OutputChannels="3">
          <MatrixData>
${scale.map((v, i) => `            ${[0, 1, 2].map((j) => f(i === j ? v : 0)).join(' ')}`).join('\n')}
          </MatrixData>${offset ? `
          <ConstantData>
            ${offset.map(f).join(' ')}
          </ConstantData>` : ''}
        </MatrixElement>
      </MultiProcessElements>
    </multiProcessElementType> </${sig}>`;

/**
 * The data-to-PCS and PCS-to-data tags (AToB1, BToA1) of each encoding, as in the ICS ColorimetricEncoding package:
 * floating point passes the PCS values through; integer XYZ scales 0 to 1 onto 0 to 65535/32768 (u1Fixed15), and
 * integer Lab scales L* by 100 and a*, b* by 256 about 0.5 (a* = 256 × data − 128).
 */
function dataTags(encoding: Encoding, numbers: Numbers): string {
  if (numbers === 'float') return `${emptyMpe('AToB1Tag')}\n\n${emptyMpe('BToA1Tag')}`;
  if (encoding === 'XYZ') {
    const k = 65535 / 32768;
    return `${scaleMpe('AToB1Tag', [k, k, k])}\n\n${scaleMpe('BToA1Tag', [1 / k, 1 / k, 1 / k])}`;
  }
  return `${scaleMpe('AToB1Tag', [100, 256, 256], [0, -128, -128])}\n\n${scaleMpe('BToA1Tag', [1 / 100, 1 / 256, 1 / 256], [0, 0.5, 0.5])}`;
}

/**
 * An iccMAX v5 colorimetric encoding profile (class spac, subclass pcc) carrying a converted observer, as XML for
 * iccDEV's iccFromXml, laid out like the ICS ColorimetricEncoding package's encodings: XYZ or Lab, in floating point
 * or integer (see `dataTags`). The spectral viewing conditions hold the converted observer and the condition's light;
 * c2sp and s2cp convert between this PCS and the standard one. A CIE 1931 (2°) or 1964 (10°) observer is named by its
 * index without its functions, and D50 without its spectrum.
 */
export function encodingProfileXml(c: Converted, light: Spectrum, o: ProfileOptions): string {
  const grid = `start="${wavelengths[0].toFixed(8)}" end="${wavelengths[wavelengths.length - 1].toFixed(8)}" steps="${wavelengths.length}"`;
  const absolute = c.white.map((v) => v * o.luminance);
  const stdObserver = standardObserverOf(c.curves), d50 = isD50(light);
  const observerFuncs = stdObserver ? '' : `
      <ObserverFuncs ${grid}>
${c.curves.map((curve) => rows(curve)).join('\n')}
      </ObserverFuncs>`;
  const illuminantSpd = d50 ? '' : `
      <IlluminantSPD ${grid}>
${rows(light)}
      </IlluminantSPD>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<IccProfile>
  <Header>
    <PreferredCMMType></PreferredCMMType>
    <ProfileVersion>5.00</ProfileVersion>
    <ProfileSubClassVersion>1.00</ProfileSubClassVersion>
    <ProfileDeviceClass>spac</ProfileDeviceClass>
    <ProfileDeviceSubClass>pcc </ProfileDeviceSubClass>
    <DataColourSpace>${o.encoding} </DataColourSpace>
    <PCS>${o.encoding} </PCS>
    <CreationDateTime>now</CreationDateTime>
    <ProfileFlags EmbeddedInFile="true" UseWithEmbeddedDataOnly="false"/>
    <DeviceAttributes ReflectiveOrTransparency="reflective" GlossyOrMatte="glossy" MediaPolarity="positive" MediaColour="colour"/>
    <RenderingIntent>Relative</RenderingIntent>
    <PCSIlluminant>
      <XYZNumber ${xyzAttrs(c.white)}/>
    </PCSIlluminant>
    <ProfileCreator>NULL</ProfileCreator>
    <ProfileID>1</ProfileID>
  </Header>
  <Tags>
    <profileDescriptionTag> <multiLocalizedUnicodeType>
      <LocalizedText LanguageCountry="enUS">${cdata(o.description)}</LocalizedText>
    </multiLocalizedUnicodeType> </profileDescriptionTag>

${dataTags(o.encoding, o.numbers ?? 'float')}

${matrixMpe('customToStandardPccTag', c.c2sp)}

${matrixMpe('standardToCustomPccTag', c.s2cp)}

    <spectralViewingConditionsTag> <spectralViewingConditionsType>
      <StdObserver>${stdObserver ?? 'Custom observer'}</StdObserver>
      <IlluminantXYZ ${xyzAttrs(absolute)}/>${observerFuncs}
      <StdIlluminant>${d50 ? 'Illuminant D50' : o.stdIlluminant ?? 'Illuminant Unknown'}</StdIlluminant>
      <ColorTemperature>${f(d50 ? 5000 : o.colorTemperature ?? 0)}</ColorTemperature>${illuminantSpd}
      <SurroundXYZ ${xyzAttrs(absolute)}/>
    </spectralViewingConditionsType> </spectralViewingConditionsTag>

    <mediaWhitePointTag> <XYZArrayType>
      <XYZNumber ${xyzAttrs(c.white)}/>
    </XYZArrayType> </mediaWhitePointTag>

    <copyrightTag> <multiLocalizedUnicodeType>
      <LocalizedText LanguageCountry="enUS">${cdata(o.copyright ?? 'No copyright; use freely')}</LocalizedText>
    </multiLocalizedUnicodeType> </copyrightTag>
  </Tags>
</IccProfile>
`;
}

/** iccMAX's names for the built-in lights that it knows, with their color temperatures. */
export const STD_ILLUMINANT: Record<string, { name: string; cct: number }> = {
  D50: { name: 'Illuminant D50', cct: 5000 }, D65: { name: 'Illuminant D65', cct: 6500 }, A: { name: 'Illuminant A', cct: 2856 },
  C: { name: 'Illuminant C', cct: 6774 }, E: { name: 'Illuminant EquiPowerE', cct: 5455 }, F2: { name: 'Illuminant F2', cct: 4230 },
  F11: { name: 'Illuminant F11', cct: 4000 },
};

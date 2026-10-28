// Lab D's computations (web/labs/encoding.ts): an observer converted by a MAT for an observing condition, and the
// iccMAX colorimetric encoding profile that carries it. Where iccDEV's tools are found (ICCDEV_BIN, or this machine's
// build), the written XML is also built with iccFromXml and read back with iccDumpProfile.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { categoricalObserver, daylight, illuminants, mat, mulMM, observers, wptNormalization, type Spectrum } from '../src/index.ts';
import { convertObserver, encodingProfileXml, isStandard, STANDARD, whiteOf, type ProfileOptions } from '../web/labs/encoding.ts';
import { encodingProfileIcc, md5 } from '../web/labs/iccbinary.ts';
import { profileCondition, readSvcn } from '../web/labs/svcn.ts';

const close = (a: readonly number[], b: readonly number[], tol: number) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${v} and ${b[i]} differ by more than ${tol}`));
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const cat8 = categoricalObserver(8, 2);

test('converted for the standard condition: the PCS is the standard one, c2sp and s2cp the identity', () => {
  assert.ok(isStandard(observers.cie1931, illuminants.D50));
  assert.ok(!isStandard(observers.cie1931, illuminants.D65));
  const c = convertObserver(cat8, observers.cie1931, illuminants.D50);
  assert.ok(c.standard);
  assert.deepEqual(c.c2sp, identity);
  assert.deepEqual(c.s2cp, identity);
  // a MAT carries white exactly, so the converted observer sees D50 as CIE 1931 does
  close(c.white, whiteOf(observers.cie1931.curves, illuminants.D50), 1e-12);
  // the converted observer is the MAT applied to the source's curves
  c.curves.forEach((curve, j) => close(curve, cat8.curves[0].map((_, k) => c.mat[j].reduce((s, m, i) => s + m * cat8.curves[i][k], 0)), 1e-12));
});

test('converted for another condition: a custom PCS, with c2sp the MAT from it to the standard PCS', () => {
  const c = convertObserver(cat8, observers.cie1931, illuminants.D65);
  assert.ok(!c.standard);
  // MATs compose: c2sp × MAT is the MAT from the source under D65 straight to the standard condition
  const direct = mat(wptNormalization(cat8, illuminants.D65), wptNormalization(STANDARD.observer, STANDARD.light));
  close(mulMM(c.c2sp, c.mat).flat(), direct.flat(), 1e-9);
  // and c2sp is the standard D65-to-D50 MAT, the same for every source observer
  close(c.c2sp.flat(), mat(wptNormalization('cie1931', 'D65'), wptNormalization('cie1931', 'D50')).flat(), 1e-9);
  close(mulMM(c.s2cp, c.c2sp).flat(), identity.flat(), 1e-12);
  close(c.white, whiteOf(observers.cie1931.curves, illuminants.D65), 1e-12);
});

test('a source that is the condition\'s own observer is unchanged', () => {
  const c = convertObserver(observers.cie1931, observers.cie1931, illuminants.A);
  close(c.mat.flat(), identity.flat(), 1e-12);
  c.curves.forEach((curve, i) => close(curve, observers.cie1931.curves[i], 1e-12));
});

test('the profile XML: a spac/pcc encoding with the converted observer, its light and the PCC matrices', () => {
  const c = convertObserver(cat8, observers.cie1931, illuminants.D65);
  for (const encoding of ['XYZ', 'Lab'] as const) {
    const xml = encodingProfileXml(c, illuminants.D65, { encoding, description: 'Cat8 for CIE 1931 under D65', stdIlluminant: 'Illuminant D65', colorTemperature: 6500, luminance: 203 });
    assert.match(xml, /<ProfileDeviceClass>spac<\/ProfileDeviceClass>/);
    assert.match(xml, new RegExp(`<DataColourSpace>${encoding} </DataColourSpace>`));
    assert.match(xml, /<AToB1Tag>/);
    const funcs = xml.split('<ObserverFuncs')[1].split('</ObserverFuncs>')[0].split('>').slice(1).join('>').trim().split(/\s+/).map(Number);
    assert.equal(funcs.length, 3 * 81);
    close(funcs.slice(81, 162), c.curves[1], 1e-11);
    const y = Number(/<IlluminantXYZ X="[^"]*" Y="([^"]*)"/.exec(xml)![1]);
    assert.equal(y, 203);
  }
});

// iccDEV's tools, from ICCDEV_BIN or this machine's build of the iccDEV checkout
const bin = process.env.ICCDEV_BIN ?? 'C:/_gitws/icc/iccDEV/out/vs2026-x64/bin/Release';
const tool = (name: string) => [join(bin, `${name}.exe`), join(bin, name)].find(existsSync);
const tools = tool('iccFromXml') && tool('iccDumpProfile');

test('iccFromXml builds the written profiles, and iccDumpProfile finds them valid', { skip: !tools && 'iccDEV tools not found (set ICCDEV_BIN)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlab-encoding-'));
  try {
    const cases = [
      { light: illuminants.D50, name: 'D50' }, { light: illuminants.D65, name: 'D65' }, { light: illuminants.A, name: 'A' },
    ];
    for (const { light, name } of cases) for (const encoding of ['XYZ', 'Lab'] as const) for (const numbers of ['float', 'integer'] as const) {
      const c = convertObserver(cat8, observers.cie1931, light);
      const xml = join(dir, `cat8-${name}-${encoding}-${numbers}.xml`), icc = xml.replace(/\.xml$/, '.icc');
      writeFileSync(xml, encodingProfileXml(c, light, { encoding, numbers, description: `Cat8 for CIE 1931 under ${name}`, stdIlluminant: `Illuminant ${name}`, luminance: 203 }));
      execFileSync(tool('iccFromXml')!, [xml, icc], { stdio: 'pipe' });
      assert.ok(existsSync(icc), `${icc} was not written`);
      const dump = execFileSync(tool('iccDumpProfile')!, ['-v', icc, 'ALL'], { encoding: 'utf8', stdio: 'pipe' });
      assert.match(dump, /spectralViewingConditionsTag/);
      assert.match(dump, /customToStandardPccTag/);
      assert.match(dump, /Profile is valid for version 5/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reading the svcn of a profile's XML gives back the converted observer and its light", () => {
  const c = convertObserver(cat8, observers.cie1931, illuminants.D65);
  const xml = encodingProfileXml(c, illuminants.D65, { encoding: 'Lab', description: 'Cat8 for D65', stdIlluminant: 'Illuminant D65', colorTemperature: 6500, luminance: 203 });
  const svcn = readSvcn(xml)!;
  assert.equal(svcn.description, 'Cat8 for D65');
  assert.equal(svcn.stdIlluminant, 'Illuminant D65');
  assert.equal(svcn.colorTemperature, 6500);
  svcn.curves!.forEach((curve, i) => close(curve, c.curves[i], 1e-11));
  const cond = profileCondition(xml);
  close(cond.light, illuminants.D65, 1e-9);
  // the profile's observer, converted for its own condition's observer under its light, needs no change: an identity MAT
  close(convertObserver(cond.observer, observers.cie1931, cond.light).mat.flat(), identity.flat(), 1e-9);
});

test('a profile without spectral viewing conditions is on the standard PCS, CIE 1931 (2°) under D50', () => {
  const xml = '<?xml version="1.0"?><IccProfile><Header></Header><Tags></Tags></IccProfile>';
  assert.equal(readSvcn(xml), undefined);
  const cond = profileCondition(xml);
  assert.equal(cond.observer, observers.cie1931);
  assert.equal(cond.light, illuminants.D50);
  assert.throws(() => readSvcn('<html></html>'), /not an iccMAX profile/);
  assert.throws(() => readSvcn(new Uint8Array(200)), /not an ICC profile/);
});

const testing = 'C:/_gitws/icc/iccDEV/Testing';
test("reading binary profiles: one written here and built by iccFromXml, and iccDEV's own", { skip: !tools && 'iccDEV tools not found (set ICCDEV_BIN)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlab-svcn-'));
  try {
    const c = convertObserver(cat8, observers.cie1931, illuminants.A);
    const xml = join(dir, 'cat8-A.xml'), icc = join(dir, 'cat8-A.icc');
    writeFileSync(xml, encodingProfileXml(c, illuminants.A, { encoding: 'XYZ', description: 'Cat8 for A', stdIlluminant: 'Illuminant A', colorTemperature: 2856, luminance: 203 }));
    execFileSync(tool('iccFromXml')!, [xml, icc], { stdio: 'pipe' });
    const svcn = readSvcn(new Uint8Array(readFileSync(icc)))!;
    assert.equal(svcn.stdIlluminant, 'Illuminant A');
    assert.equal(svcn.observerNm!.length, 81);
    close([svcn.observerNm![0], svcn.observerNm![80]], [380, 780], 1e-9);
    // stored as 32-bit floats
    svcn.curves!.forEach((curve, i) => curve.forEach((v, k) => assert.ok(Math.abs(v - c.curves[i][k]) <= 1e-6 * Math.max(1, Math.abs(v)))));
    const cond = profileCondition(new Uint8Array(readFileSync(icc)));
    close(convertObserver(cond.observer, observers.cie1931, cond.light).mat.flat(), identity.flat(), 1e-5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const mat65 = join(testing, 'ApplyDataFiles/test-profiles/sRGB_D65_MAT.icc');
  if (existsSync(mat65)) {
    const svcn = readSvcn(new Uint8Array(readFileSync(mat65)))!;
    assert.equal(svcn.stdObserver, 'CIE 1931 (two degree) standard observer');
    assert.equal(svcn.stdIlluminant, 'Illuminant D65');
    close(svcn.curves![1], observers.cie1931.curves[1], 1e-5);
  }
  const v4 = join(testing, 'sRGB_v4_ICC_preference.icc');
  if (existsSync(v4)) assert.equal(profileCondition(new Uint8Array(readFileSync(v4))).light, illuminants.D50);
});

const ics = 'C:/_gitws/icc/ics/packages';
test('hybrid profiles: the svcn of the version 5 profile in their ICC5 tag, standard observers named without their functions', () => {
  const hybrid = join(ics, 'HybridMultiSpectralEncoding/ICC/P-MultiSpectralRGB.icc'), hybridXml = join(ics, 'HybridMultiSpectralEncoding/MultiSpectralRGB.xml');
  const f11 = join(ics, 'HybridPrinterWithReflectance/ICC/4-Lab_float-F11_2deg-MAT.icc');
  const found = [hybrid, hybridXml, f11].filter(existsSync);
  if (!found.length) return;
  for (const file of [hybrid, hybridXml].filter(existsSync)) {
    const cond = profileCondition(new Uint8Array(readFileSync(file)));
    assert.ok(cond.svcn, `${file} has spectral viewing conditions in its version 5 part`);
    assert.equal(cond.observer, observers.cie1931);
    assert.equal(cond.light, illuminants.D50);
  }
  if (existsSync(f11)) {
    const cond = profileCondition(new Uint8Array(readFileSync(f11)));
    assert.equal(cond.svcn!.stdIlluminant, 'Illuminant F11');
    close(cond.light.map((v) => v / cond.light[36]), illuminants.F11.map((v) => v / illuminants.F11[36]), 2e-3);
  }
});

test('a svcn names CIE 1931, CIE 1964 and D50 by index without their data, and gives a custom observer its functions', () => {
  const tag = (xml: string) => xml.split('<spectralViewingConditionsType>')[1].split('</spectralViewingConditionsType>')[0];
  const std = tag(encodingProfileXml(convertObserver(observers.cie1931, observers.cie1931, illuminants.D50), illuminants.D50, { encoding: 'Lab', description: 'standard', luminance: 160 }));
  assert.match(std, /<StdObserver>CIE 1931 \(two degree\) standard observer<\/StdObserver>/);
  assert.match(std, /<StdIlluminant>Illuminant D50<\/StdIlluminant>/);
  assert.doesNotMatch(std, /ObserverFuncs|IlluminantSPD/);
  const ten = tag(encodingProfileXml(convertObserver(observers.cie1964, observers.cie1964, illuminants.D65), illuminants.D65, { encoding: 'Lab', description: '10°', stdIlluminant: 'Illuminant D65', luminance: 160 }));
  assert.match(ten, /<StdObserver>CIE 1964 \(ten degree\) standard observer<\/StdObserver>/);
  assert.doesNotMatch(ten, /ObserverFuncs/);
  assert.match(ten, /IlluminantSPD/);
  // a custom observer converted by a MAT for CIE 1931 under D50 is still custom: it is named so and carries its functions
  const custom = tag(encodingProfileXml(convertObserver(cat8, observers.cie1931, illuminants.D50), illuminants.D50, { encoding: 'Lab', description: 'Cat8', luminance: 203 }));
  assert.match(custom, /<StdObserver>Custom observer<\/StdObserver>/);
  assert.match(custom, /ObserverFuncs/);
  assert.doesNotMatch(custom, /IlluminantSPD/);
  // and reading such a profile gives the built-in observer and light back
  const back = profileCondition(encodingProfileXml(convertObserver(observers.cie1931, observers.cie1931, illuminants.D50), illuminants.D50, { encoding: 'XYZ', description: 'standard', luminance: 160 }));
  assert.equal(back.observer, observers.cie1931);
  assert.equal(back.light, illuminants.D50);
});

test('iccFromXml builds svcn tags that name their observer and light, and they read back', { skip: !tools && 'iccDEV tools not found (set ICCDEV_BIN)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlab-std-'));
  try {
    const cases = [
      { source: observers.cie1931, observer: observers.cie1931, light: illuminants.D50, name: 'std', obs: observers.cie1931 },
      { source: observers.cie1964, observer: observers.cie1964, light: illuminants.D65, name: 'ten', obs: observers.cie1964 },
    ];
    for (const { source, observer, light, name, obs } of cases) {
      const xml = join(dir, `${name}.xml`), icc = join(dir, `${name}.icc`);
      writeFileSync(xml, encodingProfileXml(convertObserver(source, observer, light), light, { encoding: 'Lab', description: name, stdIlluminant: light === illuminants.D65 ? 'Illuminant D65' : undefined, luminance: 160 }));
      execFileSync(tool('iccFromXml')!, [xml, icc], { stdio: 'pipe' });
      assert.match(execFileSync(tool('iccDumpProfile')!, ['-v', icc, 'ALL'], { encoding: 'utf8', stdio: 'pipe' }), /Profile is valid for version 5/);
      const cond = profileCondition(new Uint8Array(readFileSync(icc)));
      assert.equal(cond.observer, obs);
      if (light === illuminants.D50) assert.equal(cond.light, illuminants.D50);
      else close(cond.light, light, 1e-3);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The binary profile written in the page (web/labs/iccbinary.ts) is the profile iccFromXml builds from the XML, byte
// for byte (the date set to iccFromXml's own, which also enters the MD5 profile ID), and iccDumpProfile finds it valid.
test('the binary profile written directly is iccFromXml\'s, byte for byte', { skip: !tools && 'iccDEV tools not found (set ICCDEV_BIN)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wlab-binary-'));
  try {
    const cases: { name: string; c: ReturnType<typeof convertObserver>; light: Spectrum; o: ProfileOptions }[] = [];
    for (const [name, light, std] of [['D50', illuminants.D50, undefined], ['D65', illuminants.D65, 'Illuminant D65'], ['A', illuminants.A, 'Illuminant A']] as const) {
      for (const encoding of ['XYZ', 'Lab'] as const) for (const numbers of ['float', 'integer'] as const) {
        cases.push({ name: `cat8-${name}-${encoding}-${numbers}`, c: convertObserver(cat8, observers.cie1931, light), light,
          o: { encoding, numbers, description: `Cat8 for CIE 1931 under ${name}, ${encoding} ${numbers}`, stdIlluminant: std, colorTemperature: 0, luminance: 203 } });
      }
    }
    const day = daylight(7500);
    cases.push(
      { name: 'std', c: convertObserver(observers.cie1931, observers.cie1931, illuminants.D50), light: illuminants.D50, o: { encoding: 'Lab', description: 'std', luminance: 160 } },
      { name: 'ten', c: convertObserver(observers.cie1964, observers.cie1964, illuminants.D65), light: illuminants.D65, o: { encoding: 'XYZ', numbers: 'integer', description: 'ten degree, D65', stdIlluminant: 'Illuminant D65', colorTemperature: 6500, luminance: 80 } },
      { name: 'day', c: convertObserver(observers.cie2006_2, observers.cie1964, day), light: day, o: { encoding: 'Lab', description: 'Daylight 7500 K — ΔE für alle', stdIlluminant: 'Illuminant Daylight', colorTemperature: 7500, luminance: 203 } },
    );
    for (const { name, c, light, o } of cases) {
      const xml = join(dir, `${name}.xml`), icc = join(dir, `${name}.icc`), mine = join(dir, `${name}-direct.icc`);
      writeFileSync(xml, encodingProfileXml(c, light, o));
      execFileSync(tool('iccFromXml')!, [xml, icc], { stdio: 'pipe' });
      const theirs = new Uint8Array(readFileSync(icc)), v = new DataView(theirs.buffer, theirs.byteOffset);
      const created = new Date(v.getUint16(24), v.getUint16(26) - 1, v.getUint16(28), v.getUint16(30), v.getUint16(32), v.getUint16(34));
      const ours = encodingProfileIcc(c, light, o, created);
      const first = ours.findIndex((x, i) => x !== theirs[i]);
      assert.ok(ours.length === theirs.length && first < 0, `${name}: ${ours.length} bytes against ${theirs.length}; first difference at byte ${first}`);
      writeFileSync(mine, ours);
      assert.match(execFileSync(tool('iccDumpProfile')!, ['-v', mine, 'ALL'], { encoding: 'utf8', stdio: 'pipe' }), /Profile is valid for version 5/, name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('md5, for the profile ID, gives the RFC 1321 digests', () => {
  const hex = (s: string) => [...md5(new TextEncoder().encode(s))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890'), '57edf4a22be3c955ac49da2e2107b67a');
});

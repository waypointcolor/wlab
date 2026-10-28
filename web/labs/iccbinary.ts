// Lab D's colorimetric encoding profile written directly as a binary iccMAX (version 5) profile, the same profile as
// encodingProfileXml's XML built by iccDEV's iccFromXml, byte for byte (test/encoding.test.ts checks it): the same
// header, the same tags in the same order, every number as iccFromXml stores the XML's decimal text (float32 from
// the value rounded to 12 decimals, s15Fixed16 rounded half away from zero, float16 as iccDEV rounds it), and the
// profile ID, the MD5 of the profile with its flags, rendering intent and ID set to 0.

import { wavelengths, type Mat3, type Spectrum, type Vec3 } from '../../src/index.ts';
import { isD50, standardObserverOf, type Converted, type ProfileOptions } from './encoding.ts';
import { STD_ILLUMINANT_NAMES, STD_OBSERVER_NAMES } from './svcn.ts';

/** A number as the XML writes it (12 decimals) and iccFromXml reads it back. */
const decimal = (v: number) => Number((Object.is(v, -0) || Math.abs(v) < 5e-13 ? 0 : v).toFixed(12));

/** A growing big-endian byte buffer. */
class Bytes {
  private buf = new Uint8Array(4096);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) { this.room(1); this.view.setUint8(this.length, v); this.length += 1; return this; }
  u16(v: number) { this.room(2); this.view.setUint16(this.length, v); this.length += 2; return this; }
  u32(v: number) { this.room(4); this.view.setUint32(this.length, v >>> 0); this.length += 4; return this; }
  f32(v: number) { this.room(4); this.view.setFloat32(this.length, decimal(v)); this.length += 4; return this; }
  f16(v: number) { return this.u16(float16(decimal(v))); }
  s15f16(v: number) { this.room(4); this.view.setInt32(this.length, s15Fixed16(decimal(v))); this.length += 4; return this; }
  sig(s: string) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i) || 0x20); return this; }
  zeros(n: number) { for (let i = 0; i < n; i++) this.u8(0); return this; }
  pad4() { while (this.length % 4) this.u8(0); return this; }
  bytes(b: Uint8Array) { this.room(b.length); this.buf.set(b, this.length); this.length += b.length; return this; }
  done(): Uint8Array { return this.buf.slice(0, this.length); }
}

/** iccDEV's icDtoF: the value as float32, times 65536, rounded half away from zero. */
function s15Fixed16(v: number): number {
  const x = Math.min(32767, Math.max(-32768, Math.fround(v))) * 65536;
  return Math.trunc(x < 0 ? x - 0.5 : x + 0.5);
}

/** iccDEV's icFtoF16: the value as float32, to a half-precision number, rounding up on the 13th mantissa bit. */
function float16(v: number): number {
  const f = new DataView(new ArrayBuffer(4));
  f.setFloat32(0, v);
  const flt = f.getUint32(0);
  if (!(flt & 0x7fffffff)) return flt >>> 16;
  const sgn = (flt & 0x80000000) >>> 16, fexp = flt & 0x7f800000, mnt = flt & 0x007fffff;
  if (!fexp) return sgn;
  if (fexp === 0x7f800000) return mnt ? 0xfe00 : sgn | 0x7c00;
  const exp = (fexp >>> 23) - 127 + 15;
  if (exp >= 0x1f) return sgn | 0x7c00;
  if (exp <= 0) {
    if (14 - exp > 24) return sgn;
    const m = mnt | 0x00800000;
    let rv = m >>> (14 - exp);
    if ((m >>> (13 - exp)) & 1) rv += 1;
    return (sgn | rv) & 0xffff;
  }
  const rv = sgn | (exp << 10) | (mnt >>> 13);
  return (mnt & 0x00001000 ? rv + 1 : rv) & 0xffff;
}

/** A multiLocalizedUnicodeType with one en-US text, UTF-16 big-endian with no terminator. */
function mluc(text: string): Uint8Array {
  const b = new Bytes().sig('mluc').u32(0).u32(1).u32(12).sig('enUS').u32(2 * text.length).u32(28);
  for (let i = 0; i < text.length; i++) b.u16(text.charCodeAt(i));
  return b.done();
}

/** A multiProcessElementType of three channels with matrix elements, each 3 × 3 (row by row) and its offsets. */
function mpet(elements: { m: Mat3; offset?: Vec3 }[]): Uint8Array {
  const b = new Bytes().sig('mpet').u32(0).u16(3).u16(3).u32(elements.length);
  const size = 12 + 4 * 12, start = 16 + 8 * elements.length;
  elements.forEach((_, k) => b.u32(start + k * size).u32(size));
  for (const e of elements) {
    b.sig('matf').u32(0).u16(3).u16(3);
    for (const row of e.m) for (const v of row) b.f32(v);
    for (const v of e.offset ?? [0, 0, 0]) b.f32(v);
  }
  return b.done();
}

const diag = (v: Vec3): Mat3 => [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]];

/** The data-to-PCS and PCS-to-data tags of each encoding, as encodingProfileXml's dataTags. */
function dataTags(o: ProfileOptions): [Uint8Array, Uint8Array] {
  if ((o.numbers ?? 'float') === 'float') return [mpet([]), mpet([])];
  if (o.encoding === 'XYZ') {
    const k = 65535 / 32768;
    return [mpet([{ m: diag([k, k, k]) }]), mpet([{ m: diag([1 / k, 1 / k, 1 / k]) }])];
  }
  return [mpet([{ m: diag([100, 256, 256]), offset: [0, -128, -128] }]), mpet([{ m: diag([1 / 100, 1 / 256, 1 / 256]), offset: [0, 0.5, 0.5] }])];
}

/** The spectral viewing conditions, as encodingProfileXml's spectralViewingConditionsType. */
function svcn(c: Converted, light: Spectrum, o: ProfileOptions): Uint8Array {
  const stdObserver = standardObserverOf(c.curves), d50 = isD50(light);
  const illuminant = d50 ? 'Illuminant D50' : o.stdIlluminant ?? 'Illuminant Unknown';
  const absolute = c.white.map((v) => v * o.luminance);
  const first = wavelengths[0], last = wavelengths[wavelengths.length - 1], n = wavelengths.length;
  const b = new Bytes().sig('svcn').u32(0);
  b.u32(stdObserver ? STD_OBSERVER_NAMES.indexOf(stdObserver) : 0);
  if (stdObserver) b.zeros(8);
  else {
    b.f16(first).f16(last).u16(n).u16(0);
    for (const curve of c.curves) for (const v of curve) b.f32(v);
  }
  b.u32(Math.max(0, STD_ILLUMINANT_NAMES.indexOf(illuminant))).f32(d50 ? 5000 : o.colorTemperature ?? 0);
  if (d50) b.zeros(8);
  else {
    b.f16(first).f16(last).u16(n).u16(0);
    for (const v of light) b.f32(v);
  }
  for (const v of absolute) b.f32(v);
  for (const v of absolute) b.f32(v);
  return b.done();
}

/** The local date and time as iccFromXml takes "now" (year, month, day, hours, minutes, seconds). */
const dateFields = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];

/**
 * The binary profile of `encodingProfileXml(c, light, o)`: the same profile iccFromXml builds from that XML, created
 * at `created` (now by default; iccFromXml sets the date itself).
 */
export function encodingProfileIcc(c: Converted, light: Spectrum, o: ProfileOptions, created = new Date()): Uint8Array {
  const [a2b1, b2a1] = dataTags(o);
  const tags: [string, Uint8Array][] = [
    ['desc', mluc(o.description)], ['A2B1', a2b1], ['B2A1', b2a1],
    ['c2sp', mpet([{ m: c.c2sp }])], ['s2cp', mpet([{ m: c.s2cp }])], ['svcn', svcn(c, light, o)],
    ['wtpt', new Bytes().sig('XYZ ').u32(0).s15f16(c.white[0]).s15f16(c.white[1]).s15f16(c.white[2]).done()],
    ['cprt', mluc(o.copyright ?? 'No copyright; use freely')],
  ];
  // the tag data, each from a 4-byte boundary, after the 128-byte header and the tag table
  let at = 128 + 4 + 12 * tags.length;
  const placed = tags.map(([sig, data]) => { at += (4 - (at % 4)) % 4; const p = { sig, data, at }; at += data.length; return p; });
  const b = new Bytes();
  b.u32(at).u32(0).u8(5).u8(0).u8(1).u8(0).sig('spac').sig(`${o.encoding} `).sig(`${o.encoding} `);
  for (const v of dateFields(created)) b.u16(v);
  b.sig('acsp').u32(0).u32(1).u32(0).u32(0).zeros(8).u32(1);
  b.s15f16(c.white[0]).s15f16(c.white[1]).s15f16(c.white[2]).sig('NULL').zeros(16);
  b.zeros(20).sig('pcc ').zeros(4);
  b.u32(tags.length);
  for (const p of placed) b.sig(p.sig).u32(p.at).u32(p.data.length);
  for (const p of placed) { b.pad4(); b.bytes(p.data); }
  const profile = b.done();
  // the profile ID: the MD5 of the profile with its flags (44), rendering intent (64) and ID (84) zeroed
  const copy = profile.slice();
  copy.fill(0, 44, 48); copy.fill(0, 64, 68); copy.fill(0, 84, 100);
  profile.set(md5(copy), 84);
  return profile;
}

// ---------------------------------------------------------------------------------------------------------------
// MD5 (RFC 1321), for the profile ID

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** The MD5 digest of some bytes. */
export function md5(data: Uint8Array): Uint8Array {
  const bits = data.length * 8, n = (((data.length + 8) >>> 6) + 1) * 64;
  const msg = new Uint8Array(n);
  msg.set(data);
  msg[data.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(n - 8, bits >>> 0, true);
  view.setUint32(n - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const w = new Uint32Array(16);
  for (let off = 0; off < n; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + 4 * i, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + w[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(4 * i, v, true));
  return new Uint8Array(out.buffer);
}

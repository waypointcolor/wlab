// Display colors: sRGB, Display P3, Adobe RGB (a98-rgb) and Rec. 2020 into WLab through the D65 Wpt normalization.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  illuminants, inGamut, observers, rgbToWlab, rgbToXyz, toPolar, whiteOf, wlabToRgb, xyzToRgb,
  type RgbSpace, type Vec3,
} from '../src/index.ts';

const SPACES: RgbSpace[] = ['srgb', 'display-p3', 'a98-rgb', 'rec2020'];

function close(a: number[], e: number[], tol: number, what: string): void {
  a.forEach((v, i) => assert.ok(Math.abs(v - e[i]) <= tol, `${what}[${i}]: ${v} against ${e[i]}`));
}

test('white and grays land on the WLab neutral axis in every space', () => {
  const white = whiteOf(observers.cie1931, illuminants.D65);
  for (const s of SPACES) {
    close(rgbToXyz([1, 1, 1], s), white, 1e-9, `${s} white XYZ`);
    close(rgbToWlab([1, 1, 1], s), [100, 0, 0], 1e-9, `${s} white WLab`);
    close(rgbToWlab([0, 0, 0], s), [0, 0, 0], 1e-9, `${s} black WLab`);
    const g = rgbToWlab([0.5, 0.5, 0.5], s);
    close([g[1], g[2]], [0, 0], 1e-9, `${s} gray is neutral`);
  }
});

test('sRGB to XYZ follows CSS Color 4 (up to the small white scaling)', () => {
  // sRGB red, green, blue: the columns of the CSS matrix, times 100, give Y = 21.26, 71.52, 7.22
  close([rgbToXyz([1, 0, 0])[1], rgbToXyz([0, 1, 0])[1], rgbToXyz([0, 0, 1])[1]], [21.264, 71.517, 7.219], 0.01, 'Y of primaries');
});

test('RGB to WLab and back is exact', () => {
  for (const s of SPACES) {
    for (const rgb of [[0.9, 0.2, 0.1], [0.1, 0.7, 0.3], [0.2, 0.3, 0.9], [0.5, 0.5, 0.2], [0.02, 0.03, 0.01]] as Vec3[]) {
      close(wlabToRgb(rgbToWlab(rgb, s), s), rgb, 1e-9, `${s} round trip`);
      close(xyzToRgb(rgbToXyz(rgb, s), s), rgb, 1e-12, `${s} XYZ round trip`);
    }
  }
});

test('the wider spaces reach more vivid greens than sRGB', () => {
  const chroma = (s: RgbSpace) => toPolar(rgbToWlab([0, 1, 0], s))[1];
  assert.ok(chroma('display-p3') > chroma('srgb'));
  assert.ok(chroma('a98-rgb') > chroma('srgb'));
  assert.ok(chroma('rec2020') > chroma('display-p3'));
  // the most vivid sRGB green is inside Adobe RGB and Display P3, not the other way round
  const xyzSrgbGreen = rgbToXyz([0, 1, 0], 'srgb');
  assert.ok(inGamut(xyzToRgb(xyzSrgbGreen, 'a98-rgb')));
  assert.ok(!inGamut(xyzToRgb(rgbToXyz([0, 1, 0], 'a98-rgb'), 'srgb')));
});

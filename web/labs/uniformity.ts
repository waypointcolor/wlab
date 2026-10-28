// Lab F: uniformity and hue (begun). Section 1 is the constant-hue experiment, moved from the landing page: chips of one
// WLab hue at every lightness and chroma, each split against the same CIELAB lightness and chroma at constant CIELAB
// hue. The Munsell loci, the object-color solid and checks against published data sets are to come.
// Bundled into labs/uniformity.html by scripts/build-web.mjs.

import {
  illuminants, inGamut, labToXyz, mulMV, observers, toPolar, whiteOf, wlabToRgb, wlabToWpt, wptNormalization, xyzToLab,
  xyzToRgb, type RgbSpace, type Vec3,
} from '../../src/index.ts';
import { $ } from './kit.ts';

const D65 = wptNormalization('cie1931', 'D65');
const WHITE = whiteOf(observers.cie1931, illuminants.D65);
const p3 = typeof CSS !== 'undefined' && CSS.supports('color', 'color(display-p3 1 0 0)')
  && matchMedia('(color-gamut: p3)').matches;

function constantHue(): void {
  const H = Number($<HTMLInputElement>('hue').value);
  const anchorAt = $<HTMLSelectElement>('anchor').value;
  const space = $<HTMLSelectElement>('space').value as RgbSpace;
  $('hueVal').textContent = `${H}°`;
  const Ls = Array.from({ length: 19 }, (_, i) => 95 - 5 * i);
  const Cs = Array.from({ length: 31 }, (_, i) => 5 * i);
  type Chip = { L: number; C: number; wl: Vec3; rgb: Vec3; lab: Vec3 };
  const chips: Chip[] = [];
  for (const L of Ls) for (const C of Cs) {
    const wl: Vec3 = [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
    const rgb = wlabToRgb(wl, space);
    if (!inGamut(rgb)) continue;
    chips.push({ L, C, wl, rgb, lab: xyzToLab(mulMV(D65.fromWpt, wlabToWpt(wl)), WHITE) });
  }
  const cmax = Math.max(...chips.map((c) => c.C));
  const top = chips.filter((c) => c.C === cmax).sort((a, b) => (anchorAt === 'dark' ? a.L - b.L : b.L - a.L))[0];
  const hab = toPolar(top.lab)[2];
  const cols = cmax / 5 + 1, chip = 24, gap = 2, x0 = 44, y0 = 8;
  const width = x0 + cols * (chip + gap) + 8, height = y0 + Ls.length * (chip + gap) + 34;
  const canvas = $<HTMLCanvasElement>('plane');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d', space === 'display-p3' && p3 ? { colorSpace: 'display-p3' } : undefined)!;
  ctx.scale(dpr, dpr);
  const css = (v: Vec3) => {
    const c = v.map((x) => Math.min(1, Math.max(0, x)));
    return space === 'display-p3' && p3 ? `color(display-p3 ${c.join(' ')})` : `rgb(${c.map((x) => Math.round(255 * x)).join(',')})`;
  };
  const ink = getComputedStyle(document.body).color;
  ctx.font = '11px system-ui, sans-serif';
  Ls.forEach((L, r) => {
    const y = y0 + r * (chip + gap);
    ctx.fillStyle = css(wlabToRgb([L, 0, 0], space));
    ctx.fillRect(x0, y - gap / 2, cols * (chip + gap), chip + gap);
    if (L % 20 === 15) { ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.fillText(String(L), x0 - 6, y + chip / 2 + 4); }
  });
  const gaps: number[] = [];
  for (const c of chips) {
    const x = x0 + (c.C / 5) * (chip + gap) + gap / 2, y = y0 + Ls.indexOf(c.L) * (chip + gap);
    const [Ll, Cab] = toPolar(c.lab);
    const labHeld: Vec3 = [Ll, Cab * Math.cos((hab * Math.PI) / 180), Cab * Math.sin((hab * Math.PI) / 180)];
    const rgbHeld = xyzToRgb(labToXyz(labHeld, WHITE), space);
    // CIELAB's half upper left, WLab's lower right
    ctx.fillStyle = css(rgbHeld);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + chip, y); ctx.lineTo(x, y + chip); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(c.rgb);
    ctx.beginPath(); ctx.moveTo(x + chip, y); ctx.lineTo(x + chip, y + chip); ctx.lineTo(x, y + chip); ctx.closePath(); ctx.fill();
    if (!inGamut(rgbHeld)) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(x + chip * 0.28, y + chip * 0.28, 1.8, 0, 7); ctx.fill(); }
    if (c === top) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x - 1.5, y - 1.5, chip + 3, chip + 3); }
    if (c.C >= 10) gaps.push(((toPolar(c.lab)[2] - hab + 540) % 360) - 180);
  }
  ctx.fillStyle = ink; ctx.textAlign = 'center';
  for (let k = 0; k < cols; k += 2) ctx.fillText(String(5 * k), x0 + k * (chip + gap) + gap / 2 + chip / 2, height - 18);
  ctx.fillText('chroma (WLab)', x0 + (cols * (chip + gap)) / 2, height - 4);
  ctx.save(); ctx.translate(12, y0 + (Ls.length * (chip + gap)) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('lightness', 0, 0); ctx.restore();
  $('planeNote').textContent = `WLab hue ${H}°, against CIELAB hue ${Math.round(hab)}°. Across the chips of WLab chroma 10 and up, `
    + `their CIELAB hue runs ${Math.min(...gaps).toFixed(1)}° to ${Math.max(...gaps).toFixed(1)}° from the anchor's. `
    + `CIE 1931 observer, D65; a dot marks a CIELAB half outside the screen's colors.`;
}

$<HTMLSelectElement>('space').replaceChildren(new Option('sRGB', 'srgb'), ...(p3 ? [new Option('Display P3 (wide gamut)', 'display-p3')] : []));
for (const id of ['hue', 'anchor', 'space']) $(id).addEventListener('input', constantHue);
document.querySelectorAll<HTMLButtonElement>('button[data-h]').forEach((b) =>
  b.addEventListener('click', () => { $<HTMLInputElement>('hue').value = b.dataset.h!; constantHue(); }));
// redrawn when the page turns dark or light, for the ink of the labels
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', constantHue);
constantHue();

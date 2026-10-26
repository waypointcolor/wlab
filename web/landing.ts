// The landing page: a metamerism demo (two materials that match under one light) and the constant-hue experiment.
// Bundled into wlab-onramp.html by scripts/build-web.mjs.

import {
  cat, deltaE00, deltaEWlab, illuminants, inGamut, labToXyz, mulMV, observers, resample, responses, toPolar,
  whiteOf, wlabToRgb, wlabToWpt, wptNormalization, xyzToLab, xyzToRgb,
  type ObserverName, type RgbSpace, type Spectrum, type Vec3, type WptNormalization,
} from '../src/index.ts';
import { madeUpLed, pairs } from './demo-data.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number) => v.toFixed(1);

// ---------- Demo 1: metamerism ----------

const LIGHTS: Record<string, Spectrum> = {
  'D50 (graphic arts booth)': illuminants.D50,
  'D65 (daylight)': illuminants.D65,
  'A (incandescent bulb)': illuminants.A,
  'F2 (cool white fluorescent)': illuminants.F2,
  'F11 (tri-band store fluorescent)': illuminants.F11,
  'LED-B2 (warm white LED, about 3000 K)': illuminants['LED-B2'],
  'LED-B3 (neutral white LED, about 4100 K)': illuminants['LED-B3'],
  'Made-up white LED': resample(madeUpLed.nm, madeUpLed.values),
};
const LIGHT_OF_MATCH: Record<string, string> = { D50: 'D50 (graphic arts booth)', D65: 'D65 (daylight)' };
const OBSERVERS: Record<ObserverName, string> = { cie1931: 'CIE 1931 (2°)', cie1964: 'CIE 1964 (10°)', cie2015: 'CIE 2015 (2°)', cie2015_10: 'CIE 2015 (10°)',
  cie2006_2: 'CIE 2006 (2°)', cie2006_10: 'CIE 2006 (10°)' };
const PAIRS = pairs.map((p) => ({ ...p, ra: resample(p.a.nm, p.a.values), rb: resample(p.b.nm, p.b.values) }));
const nm = Array.from({ length: 71 }, (_, i) => 380 + 5 * i);    // 380 to 730 nm for the plot

function fill(sel: HTMLSelectElement, options: [string, string][], value?: string): void {
  sel.replaceChildren(...options.map(([v, t]) => new Option(t, v)));
  if (value) sel.value = value;
}

/** sRGB (0 to 255) of a reflectance under a light, as an adapted viewer would see it: Bradford to D65, CIE 1931. */
function chipColor(r: Spectrum, light: Spectrum): string {
  const xyz = responses(r, observers.cie1931, light);
  const m = cat(whiteOf(observers.cie1931, light), whiteOf(observers.cie1931, illuminants.D65), 'bradford');
  const rgb = xyzToRgb(mulMV(m, xyz), 'srgb').map((v) => Math.round(255 * Math.min(1, Math.max(0, v))));
  return `rgb(${rgb.join(',')})`;
}

function plot(a: Spectrum, b: Spectrum, light: Spectrum, match: Spectrum, names: [string, string]): string {
  const W = 720, H = 250, pw = 300, ph = 160, top = 34, gap = 80, l0 = 46, r0 = l0 + pw + gap;
  const x = (x0: number, w: number) => (v: number) => x0 + ((v - 380) / 350) * pw;
  const xl = x(l0, pw), xr = x(r0, pw);
  const ymaxL = Math.max(1, ...a.slice(0, 71), ...b.slice(0, 71));
  const yl = (v: number) => top + ph - (v / ymaxL) * ph;
  const norm = (s: Spectrum) => { const k = 100 / s[36]; return s.slice(0, 71).map((v) => v * k); };     // 560 nm = 100
  const L = norm(light), M = norm(match);
  const ymaxR = Math.max(150, ...L, ...M) * 1.05;
  const yr = (v: number) => top + ph - (v / ymaxR) * ph;
  const path = (vals: number[], X: (v: number) => number, Y: (v: number) => number) =>
    vals.map((v, i) => `${i ? 'L' : 'M'}${X(nm[i]).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const stops = [[0, '#4b0063'], [0.057, '#7a00c4'], [0.143, '#3f00ff'], [0.229, '#0046ff'], [0.314, '#00c0ff'], [0.371, '#00ff6a'],
    [0.457, '#7fff00'], [0.543, '#e6ff00'], [0.571, '#ffef00'], [0.629, '#ff9b00'], [0.714, '#ff3000'], [0.8, '#ff0000'], [0.914, '#b30000'], [1, '#6e0000']]
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const axes = (x0: number, Y: (v: number) => number, ticks: number[]) => [
    `<line x1="${x0}" x2="${x0 + pw}" y1="${top + ph}" y2="${top + ph}" stroke="var(--line)"/>`,
    ...ticks.map((t) => `<line x1="${x0}" x2="${x0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)" stroke-opacity="0.5"/><text x="${x0 - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`),
    `<rect x="${x0}" y="${top + ph + 6}" width="${pw}" height="9" fill="url(#rainbow)"/>`,
    ...[400, 500, 600, 700].map((t) => `<text x="${x0 + ((t - 380) / 350) * pw}" y="${top + ph + 30}" text-anchor="middle">${t}</text>`),
    `<text x="${x0 + pw / 2}" y="${top + ph + 46}" text-anchor="middle">wavelength (nm)</text>`,
  ].join('');
  const tl = ymaxL > 1.01 ? [0, 0.5, 1, Math.round(ymaxL * 10) / 10] : [0, 0.25, 0.5, 0.75, 1];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Reflectance of the two materials and the light's spectrum">
    <defs><linearGradient id="rainbow">${stops}</linearGradient></defs>
    <text class="title" x="${l0}" y="18">Reflectance</text>
    <text class="title" x="${r0}" y="18">Light (560 nm = 100)</text>
    ${axes(l0, yl, tl)}${axes(r0, yr, [0, 50, 100, 150, 200].filter((t) => t <= ymaxR))}
    <path d="${path(a.slice(0, 71), xl, yl)}" fill="none" stroke="var(--muted)" stroke-width="2"/>
    <path d="${path(b.slice(0, 71), xl, yl)}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <text x="${l0 + 6}" y="${top + 12}" style="fill:var(--muted);font-weight:600">${names[0]}</text>
    <text x="${l0 + 6}" y="${top + 26}" style="fill:var(--accent);font-weight:600">${names[1]}</text>
    <path d="${path(M, xr, yr)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <path d="${path(L, xr, yr)}" fill="none" stroke="var(--accent2)" stroke-width="2"/>
    <text x="${r0 + 6}" y="${top + 12}" style="fill:var(--accent2);font-weight:600">chosen light</text>
    <text x="${r0 + 6}" y="${top + 26}" style="fill:var(--muted)">dashed: the light where they match</text>
  </svg>`;
}

function demo1(): void {
  const p = PAIRS.find((q) => q.key === $<HTMLSelectElement>('pair').value)!;
  const lightName = $<HTMLSelectElement>('light').value;
  const obs = $<HTMLSelectElement>('observer').value as ObserverName;
  const light = LIGHTS[lightName], match = LIGHTS[LIGHT_OF_MATCH[p.match]];
  const n = wptNormalization(obs, light), n0 = wptNormalization(obs, match);
  const lab = (r: Spectrum, c: WptNormalization) => xyzToLab(responses(r, c.observer, c.light), c.white);
  const pairLab = deltaE00(lab(p.ra, n), lab(p.rb, n)), pairW = deltaEWlab(n.wlabOf(p.ra), n.wlabOf(p.rb));
  const chA = [deltaE00(lab(p.ra, n0), lab(p.ra, n)), deltaEWlab(n0.wlabOf(p.ra), n.wlabOf(p.ra))];
  const chB = [deltaE00(lab(p.rb, n0), lab(p.rb, n)), deltaEWlab(n0.wlabOf(p.rb), n.wlabOf(p.rb))];

  $('plot').innerHTML = plot(p.ra, p.rb, light, match, [p.a.name, p.b.name]);
  $('chips').innerHTML = [[p.a.name, p.ra], [p.b.name, p.rb]].map(([name, r]) =>
    `<div class="chip"><div style="background:${chipColor(r as Spectrum, light)}"></div><span>${name}</span></div>`).join('');
  const matchLabel = LIGHT_OF_MATCH[p.match].replace(/ \(.*/, '');
  $('pairTable').innerHTML = `<table>
    <thead><tr><th>Under ${lightName}, ${OBSERVERS[obs]}</th><th>${p.a.name}</th><th>${p.b.name}</th></tr></thead>
    <tbody>
      <tr><td>Change from ${matchLabel}, CIELAB ΔE<sub>00</sub></td><td>${fmt(chA[0])}</td><td>${fmt(chB[0])}</td></tr>
      <tr><td>Change from ${matchLabel}, ΔE<sub>WLab</sub></td><td>${fmt(chA[1])}</td><td>${fmt(chB[1])}</td></tr>
      <tr><td>Between the two: ΔE<sub>00</sub> ${fmt(pairLab)}, ΔE<sub>WLab</sub> ${fmt(pairW)}</td><td></td><td></td></tr>
    </tbody></table>`;
  let verdict = '';
  if (light === match && obs === 'cie1931') verdict = `This is the light where they match: the same numbers, though the spectra differ.`;
  else {
    const labSays = chA[0] > chB[0] ? p.a.name : p.b.name, wSays = chA[1] > chB[1] ? p.a.name : p.b.name;
    verdict = labSays === wSays
      ? `CIELAB and WLab agree: ${wSays} moves more.`
      : `CIELAB says ${labSays} moves more; WLab says ${wSays} does. WLab separates what the material does from what dividing by white misses.`;
  }
  $('verdict').textContent = verdict;
}

// ---------- Demo 2: constant hue ----------

const D65 = wptNormalization('cie1931', 'D65');
const WHITE = whiteOf(observers.cie1931, illuminants.D65);
const p3 = typeof CSS !== 'undefined' && CSS.supports('color', 'color(display-p3 1 0 0)')
  && matchMedia('(color-gamut: p3)').matches;

function demo2(): void {
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
    ctx.fillStyle = css(c.rgb);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + chip, y); ctx.lineTo(x, y + chip); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(rgbHeld);
    ctx.beginPath(); ctx.moveTo(x + chip, y); ctx.lineTo(x + chip, y + chip); ctx.lineTo(x, y + chip); ctx.closePath(); ctx.fill();
    if (!inGamut(rgbHeld)) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(x + chip * 0.72, y + chip * 0.72, 1.8, 0, 7); ctx.fill(); }
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

// ---------- start ----------

fill($('pair'), PAIRS.map((p) => [p.key, p.title]));
// each pair opens on a light where CIELAB and WLab disagree about which material moves more
const START_LIGHT: Record<string, string> = { smurf: 'D50 (graphic arts booth)', ublue: 'A (incandescent bulb)', red: 'A (incandescent bulb)' };
fill($('light'), Object.keys(LIGHTS).map((k) => [k, k]), START_LIGHT[PAIRS[0].key]);
fill($('observer'), (Object.keys(OBSERVERS) as ObserverName[]).map((k) => [k, OBSERVERS[k]]));
fill($('space'), [['srgb', 'sRGB'], ...(p3 ? [['display-p3', 'Display P3 (wide gamut)'] as [string, string]] : [])]);
$('pair').addEventListener('change', () => {
  const start = START_LIGHT[$<HTMLSelectElement>('pair').value];
  if (start) $<HTMLSelectElement>('light').value = start;
  demo1();
});
for (const id of ['light', 'observer']) $(id).addEventListener('change', demo1);
for (const id of ['hue', 'anchor', 'space']) $(id).addEventListener('input', demo2);
document.querySelectorAll<HTMLButtonElement>('button[data-h]').forEach((b) =>
  b.addEventListener('click', () => { $<HTMLInputElement>('hue').value = b.dataset.h!; demo2(); }));
demo1();
demo2();

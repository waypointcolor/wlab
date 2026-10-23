// The WLab robustness report page: spectra in, ΔE_WLab per light and observer out. Bundled into
// robustness-report.html by scripts/build-web.mjs.

import {
  deltaE00, deltaEWlab, illuminants, observers, resample, responses, wptNormalization, xyzToLab,
  type IlluminantName, type ObserverName, type Spectrum, type Vec3,
} from '../src/index.ts';
import { example } from './example.ts';

interface Condition { label: string; observer: ObserverName; light: Spectrum; lightName: string }
interface Lights { [name: string]: Spectrum }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const OBSERVER_LABEL: Record<ObserverName, string> = { cie1931: 'CIE 1931 (2°)', cie1964: 'CIE 1964 (10°)', cie2015: 'CIE 2015 (2°)', cie2015_10: 'CIE 2015 (10°)' };
const LIGHT_LABEL: Record<IlluminantName, string> = {
  D50: 'D50 booth', D65: 'D65 daylight', A: 'A, home incandescent', F2: 'F2, cool white fluorescent',
  F11: 'F11, tri-band store fluorescent', C: 'C, older daylight', E: 'E, equal energy',
};

const lights: Lights = Object.fromEntries(Object.keys(LIGHT_LABEL).map((k) => [LIGHT_LABEL[k as IlluminantName], illuminants[k as IlluminantName]]));
const conditions: Condition[] = [];
let lastCsv = '';

function addCondition(observer: ObserverName, lightName: string): void {
  const label = observer === 'cie1931' ? lightName : `${lightName}, ${OBSERVER_LABEL[observer]} observer`;
  if (conditions.some((c) => c.label === label)) return;
  conditions.push({ label, observer, light: lights[lightName], lightName });
  drawConditions();
}

function drawConditions(): void {
  const ul = $('conditions');
  ul.replaceChildren(...conditions.map((c, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = c.label;
    li.append(name);
    if (i === 0) {
      const tag = document.createElement('span');
      tag.className = 'first';
      tag.textContent = 'reference';
      li.append(tag);
    }
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    li.append(spacer);
    const up = button('↑', () => { if (i > 0) { [conditions[i - 1], conditions[i]] = [conditions[i], conditions[i - 1]]; drawConditions(); } });
    up.title = 'Move up (the first condition is the reference)';
    li.append(up, button('Remove', () => { conditions.splice(i, 1); drawConditions(); }));
    return li;
  }));
}

function sub(text: string): HTMLElement {
  const s = document.createElement('sub');
  s.textContent = text;
  return s;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function fillSelects(): void {
  $<HTMLSelectElement>('addObserver').replaceChildren(...(Object.keys(OBSERVER_LABEL) as ObserverName[]).map((k) => new Option(OBSERVER_LABEL[k], k)));
  $<HTMLSelectElement>('addLight').replaceChildren(...Object.keys(lights).map((k) => new Option(k, k)));
}

/** Parse a table of numbers: first column wavelength, then one column per series; header row optional. */
function parseTable(text: string): { names: string[]; nm: number[]; columns: number[][] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('paste at least two rows');
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
  const hasHeader = Number.isNaN(Number(cells[0][0]));
  const body = hasHeader ? cells.slice(1) : cells;
  const width = Math.max(...body.map((r) => r.length));
  const names = hasHeader ? cells[0].slice(1, width) : Array.from({ length: width - 1 }, (_, k) => (k === 0 ? 'Standard' : `Sample ${k}`));
  const nm: number[] = [];
  const columns: number[][] = names.map(() => []);
  for (const r of body) {
    const v = r.map(Number);
    if (v.some((x) => Number.isNaN(x)) || v.length < width) throw new Error(`not a number in the row starting "${r[0]}"`);
    nm.push(v[0]);
    v.slice(1).forEach((x, k) => columns[k].push(x));
  }
  for (let i = 1; i < nm.length; i++) if (nm[i] <= nm[i - 1]) throw new Error('wavelengths must increase down the first column');
  if (nm[0] > 420 || nm[nm.length - 1] < 680) throw new Error(`the wavelengths run from ${nm[0]} to ${nm[nm.length - 1]} nm; cover at least 420 to 680 nm`);
  return { names, nm, columns };
}

function readSpectra(): { names: string[]; spectra: Spectrum[]; note: string; nm: number[]; values: number[][] } {
  const t = parseTable($<HTMLTextAreaElement>('spectra').value);
  if (t.columns.length < 2) throw new Error('give a standard and at least one sample');
  const max = Math.max(...t.columns.flat());
  const percent = max > 1.5;
  const values = percent ? t.columns.map((c) => c.map((x) => x / 100)) : t.columns;
  const spectra = values.map((c) => resample(t.nm, c));
  const note = `${t.columns.length - 1} sample${t.columns.length > 2 ? 's' : ''}, ${t.nm[0]}–${t.nm[t.nm.length - 1]} nm`
    + (percent ? ', read as percent' : '');
  return { names: t.names, spectra, note, nm: t.nm, values };
}

// Line colors of the samples (the standard is drawn in the text color), then dash patterns once they run out.
const LINE_COLORS = ['#c2570c', '#1f8a5b', '#7a3fb0', '#c0306a', '#2f74c0', '#8a6d00'];
const DASHES = ['', '6 4', '2 3'];
const RAINBOW = [[0, '#4b0063'], [0.057, '#7a00c4'], [0.143, '#3f00ff'], [0.229, '#0046ff'], [0.314, '#00c0ff'], [0.371, '#00ff6a'],
  [0.457, '#7fff00'], [0.543, '#e6ff00'], [0.571, '#ffef00'], [0.629, '#ff9b00'], [0.714, '#ff3000'], [0.8, '#ff0000'], [0.914, '#b30000'],
  [1, '#6e0000']] as const;

/** The reflectances as given (not resampled), the standard first; the rainbow bar runs from 380 to 730 nm. */
function plotSpectra(names: string[], nm: number[], values: number[][], spectra: Spectrum[]): void {
  const W = 720, H = 270, l0 = 46, top = 14, pw = 650, ph = 190;
  const lo = nm[0], hi = nm[nm.length - 1];
  const X = (v: number) => l0 + ((v - lo) / (hi - lo)) * pw;
  const ymax = Math.max(0.2, Math.ceil(Math.max(...values.flat()) * 10) / 10);
  const step = ymax <= 0.5 ? 0.1 : ymax <= 1 ? 0.2 : 0.25;
  const Y = (v: number) => top + ph - (v / ymax) * ph;
  const ticks = Array.from({ length: Math.floor(ymax / step + 1e-9) + 1 }, (_, i) => +(i * step).toFixed(2));
  const xt = [400, 450, 500, 550, 600, 650, 700, 750].filter((t) => t >= lo && t <= hi);
  // the bar's colors belong to wavelengths, so it is placed by wavelength and clipped to the plotted range
  const bx0 = X(380), bx1 = X(730);
  const stops = RAINBOW.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const style = (k: number) => k === 0
    ? { color: 'var(--ink)', width: 2.75, dash: '' }
    : { color: LINE_COLORS[(k - 1) % LINE_COLORS.length], width: 2, dash: DASHES[Math.floor((k - 1) / LINE_COLORS.length) % DASHES.length] };
  const lines = values.map((v, k) => {
    const s = style(k);
    const d = v.map((y, i) => `${i ? 'L' : 'M'}${X(nm[i]).toFixed(1)} ${Y(y).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-dasharray="${s.dash}" stroke-linejoin="round"/>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Spectral reflectance of the standard and the samples">
    <defs><linearGradient id="rainbow" gradientUnits="userSpaceOnUse" x1="${bx0}" x2="${bx1}">${stops}</linearGradient>
      <clipPath id="plotArea"><rect x="${l0}" y="0" width="${pw}" height="${H}"/></clipPath></defs>
    ${ticks.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    <rect x="${l0}" y="${top + ph + 6}" width="${pw}" height="9" fill="url(#rainbow)" clip-path="url(#plotArea)"/>
    ${xt.map((t) => `<text x="${X(t)}" y="${top + ph + 30}" text-anchor="middle">${t}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${top + ph + 48}" text-anchor="middle">wavelength (nm)</text>
    ${lines.slice(1).join('')}${lines[0]}
  </svg>`;
  const legend = names.map((n, k) => {
    const s = style(k);
    return `<span class="key"><svg width="26" height="10" aria-hidden="true"><line x1="1" x2="25" y1="5" y2="5" stroke="${s.color}"
      stroke-width="${s.width}" stroke-dasharray="${s.dash}"/></svg><span class="chip" style="background:${chip(spectra[k])}"></span>`
      + `${escapeHtml(n)}${k === 0 ? ' (standard)' : ''}</span>`;
  }).join('');
  $('reflPlot').innerHTML = svg + `<div class="legend">${legend}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** sRGB of a reflectance under D65, CIE 1931, for the chips. */
function chip(r: Spectrum): string {
  const [x, y, z] = responses(r, observers.cie1931, illuminants.D65).map((v) => v / 100);
  const lin = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
  const g = lin.map((v) => Math.min(1, Math.max(0, v))).map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  return `rgb(${g.map((v) => Math.round(v * 255)).join(',')})`;
}

function run(): void {
  const out = $('report');
  const note = $('reportNote');
  try {
    if (!conditions.length) throw new Error('choose at least one condition');
    const { names, spectra } = readSpectra();
    const [std, ...samples] = spectra;
    const rows: { label: string; values: number[]; de00?: boolean }[] = [];
    conditions.forEach((c, i) => {
      const n = wptNormalization(c.observer, c.light);
      if (i === 0) {
        const lab = (r: Spectrum): Vec3 => xyzToLab(responses(r, n.observer, n.light), n.white);
        rows.push({ label: `${c.label}, ΔE00`, values: samples.map((s) => deltaE00(lab(std), lab(s))), de00: true });
      }
      const w0 = n.wlabOf(std);
      rows.push({ label: c.label, values: samples.map((s) => deltaEWlab(w0, n.wlabOf(s))) });
    });
    const head = ['Light (observer)', ...names.slice(1)];
    const table = document.createElement('table');
    const thead = table.createTHead().insertRow();
    head.forEach((h, k) => {
      const th = document.createElement('th');
      if (k > 0) {
        const c = document.createElement('span');
        c.className = 'chip';
        c.style.background = chip(samples[k - 1]);
        c.title = 'Approximate sRGB rendering under D65';
        th.append(c, document.createElement('br'));
      } else {
        const c = document.createElement('span');
        c.className = 'chip';
        c.style.background = chip(std);
        c.title = `${names[0]} (the standard)`;
        th.append(c, ' ');
      }
      th.append(k === 0 ? `${h}, against ${names[0]}` : h);
      thead.append(th);
    });
    const tbody = table.createTBody();
    for (const r of rows) {
      const tr = tbody.insertRow();
      if (r.de00) tr.className = 'de00';
      const cell = tr.insertCell();
      if (r.de00) cell.append(r.label.replace(/, ΔE00$/, ', ΔE'), sub('00'));
      else cell.textContent = r.label;
      for (const v of r.values) tr.insertCell().textContent = v.toFixed(1);
    }
    out.replaceChildren(table);
    note.className = 'note';
    note.replaceChildren('All values are ΔE', sub('WLab'), ' against the standard, except the ΔE', sub('00'),
      ' row. Read them like ΔE values; look for samples that stay small under every light, and for lights where one jumps.');
    lastCsv = [['condition', ...names.slice(1)], ...rows.map((r) => [r.de00 ? r.label : `${r.label}, ΔE_WLab`, ...r.values.map((v) => v.toFixed(2))])]
      .map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
    $<HTMLButtonElement>('download').disabled = false;
  } catch (e) {
    out.replaceChildren();
    note.className = 'error';
    note.textContent = `Cannot make the report: ${(e as Error).message}.`;
    $<HTMLButtonElement>('download').disabled = true;
  }
}

function status(): void {
  const s = $('spectraStatus');
  $('reflPlot').replaceChildren();
  try {
    if (!$<HTMLTextAreaElement>('spectra').value.trim()) { s.textContent = ''; return; }
    const r = readSpectra();
    s.className = 'note';
    s.textContent = r.note;
    plotSpectra(r.names, r.nm, r.values, r.spectra);
  } catch (e) {
    s.className = 'error';
    s.textContent = (e as Error).message;
  }
}

function init(): void {
  fillSelects();
  addCondition('cie1931', 'D50 booth');
  addCondition('cie1931', 'D65 daylight');
  addCondition('cie1931', 'A, home incandescent');
  addCondition('cie1931', 'F2, cool white fluorescent');
  addCondition('cie1931', 'F11, tri-band store fluorescent');
  addCondition('cie1964', 'D50 booth');
  $('add').addEventListener('click', () => addCondition($<HTMLSelectElement>('addObserver').value as ObserverName, $<HTMLSelectElement>('addLight').value));
  $('example').addEventListener('click', () => { $<HTMLTextAreaElement>('spectra').value = example; status(); run(); });
  $('spectra').addEventListener('input', status);
  $<HTMLInputElement>('spectraFile').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) { $<HTMLTextAreaElement>('spectra').value = await f.text(); status(); }
  });
  $('addLightBtn').addEventListener('click', () => {
    const s = $('lightStatus');
    try {
      const name = $<HTMLInputElement>('lightName').value.trim() || `Custom light ${Object.keys(lights).length - 6}`;
      const t = parseTable($<HTMLTextAreaElement>('lightSpectrum').value);
      lights[name] = resample(t.nm, t.columns[0]);
      fillSelects();
      $<HTMLSelectElement>('addLight').value = name;
      addCondition($<HTMLSelectElement>('addObserver').value as ObserverName, name);
      s.className = 'note';
      s.textContent = `Added "${name}".`;
    } catch (e) {
      s.className = 'error';
      s.textContent = (e as Error).message;
    }
  });
  $('run').addEventListener('click', run);
  $('download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lastCsv], { type: 'text/csv' }));
    a.download = 'wlab-robustness-report.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

init();

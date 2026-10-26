// The shared kit of the Waypoint Labs pages: reading tables of numbers, choosing an observing condition (sensors and
// light), plotting spectra, and writing matrices in the formats people paste into their own code.

import {
  categoricalObserver, categoricalObserverAges, cie2006, daylight, illuminants, observers, planckian,
  resample, wavelengths, type IlluminantName, type Mat3, type Observer, type ObserverName, type Spectrum,
} from '../../src/index.ts';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A table of numbers: first column wavelength (increasing), then one column per series; a header row is optional. */
export function parseTable(text: string, minColumns = 1): { names: string[]; nm: number[]; columns: number[][] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('paste at least two rows');
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : lines[0].includes(',') ? ',' : /\s+/;
  const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
  const hasHeader = Number.isNaN(Number(cells[0][0]));
  const body = hasHeader ? cells.slice(1) : cells;
  const width = Math.max(...body.map((r) => r.length));
  if (width - 1 < minColumns) throw new Error(`give wavelength and ${minColumns} column${minColumns > 1 ? 's' : ''} of values`);
  const names = hasHeader ? cells[0].slice(1, width) : Array.from({ length: width - 1 }, (_, k) => `Column ${k + 1}`);
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

// ---------------------------------------------------------------------------------------------------------------
// Observing conditions

export interface Condition { readonly observer: Observer; readonly light: Spectrum; readonly label: string; readonly lightLabel: string }

const OBSERVER_LABEL: Record<ObserverName, string> = {
  cie1931: 'CIE 1931 (2°)', cie1964: 'CIE 1964 (10°)', cie2015: 'CIE 2015 (2°)', cie2015_10: 'CIE 2015 (10°)',
  cie2006_2: 'CIE 2006 cone fundamentals (2°)', cie2006_10: 'CIE 2006 cone fundamentals (10°)',
};
const LIGHT_LABEL: Record<IlluminantName, string> = {
  A: 'A (incandescent)', C: 'C (older daylight)', D50: 'D50 (graphic arts booth)', D65: 'D65 (daylight)', E: 'E (equal energy)',
  F2: 'F2 (cool white fluorescent)', F11: 'F11 (tri-band fluorescent)',
  'LED-B1': 'LED-B1 (blue-pumped phosphor white, about 2700 K)',
  'LED-B2': 'LED-B2 (blue-pumped phosphor white, about 3000 K)',
  'LED-B3': 'LED-B3 (blue-pumped phosphor white, about 4100 K)',
  'LED-B4': 'LED-B4 (blue-pumped phosphor white, about 5100 K)',
  'LED-B5': 'LED-B5 (blue-pumped phosphor white, about 6600 K)',
  'LED-BH1': 'LED-BH1 (phosphor white with red, about 2850 K)',
  'LED-RGB1': 'LED-RGB1 (red, green and blue chips, about 2850 K)',
  'LED-V1': 'LED-V1 (violet-pumped phosphor white, about 2700 K)',
  'LED-V2': 'LED-V2 (violet-pumped phosphor white, about 4100 K)',
};

const SENSOR_COLORS = ['#c0306a', '#1f8a5b', '#2f74c0'];

/** Names for the three curves of an observer: x̄ ȳ z̄ for CIE color-matching functions, l̄ m̄ s̄ for cone fundamentals. */
function curveNames(o: Observer): string[] {
  if (/^(CIE 2006|Categorical)/.test(o.name)) return ['l̄', 'm̄', 's̄'];
  if (o.name.startsWith('CIE')) return ['x̄', 'ȳ', 'z̄'];
  return ['sensor 1', 'sensor 2', 'sensor 3'];
}

/** The sensors and the light of a condition, side by side. */
export function conditionPlots(cond: Condition): string {
  const names = curveNames(cond.observer);
  const k = 100 / cond.light[36];
  return `<div>${spectrumPlot('Sensors', cond.observer.curves.map((c, i) => ({ values: c, color: SENSOR_COLORS[i], label: names[i] })))}</div>`
    + `<div>${spectrumPlot('Light (560 nm = 100)', [{ values: cond.light.map((v) => v * k), color: 'var(--accent2)', label: cond.lightLabel }])}</div>`;
}

/**
 * A condition picker: sensors (a CIE observer, CIE 2006 cone fundamentals for any age and field size, Asano's
 * categorical observers for any field size, or three pasted curves) and a light (a CIE illuminant, daylight
 * or a Planckian radiator at a chosen temperature, or a pasted spectrum), with an option to plot both. `get()`
 * returns the condition or throws.
 */
export function conditionPicker(host: HTMLElement, start: { observer: ObserverName; light: IlluminantName }, onChange: () => void): { get(): Condition } {
  host.innerHTML = `
    <div class="row">
      <label>Sensors <select data-k="obs"></select></label>
      <label data-k="catBox" hidden>Category <select data-k="cat"></select></label>
      <label data-k="ageBox" hidden>Age <input type="number" data-k="age" min="20" max="80" step="1" value="32"> years</label>
      <label data-k="fieldBox" hidden>Field size <input type="number" data-k="field" min="1" max="10" step="0.5" value="2">°</label>
      <label>Light <select data-k="light"></select></label>
      <label data-k="kelvinBox" hidden><span data-k="kelvinLabel">Temperature</span>
        <input type="number" data-k="kelvin" min="1000" max="25000" step="100" value="5500"> K</label>
      <label><input type="checkbox" data-k="show"> Show the curves</label>
    </div>
    <p class="note" data-k="cfNote" hidden>CIE 2006 (CIE 170-1) cone fundamentals, L, M and S with their peaks at 1, for an
    observer of this age (20 to 80 years) viewing a field of this size (1 to 10°); 32 years and 2° is the CIE's
    standard case. For the CIE's further functions for any age and field size (color-matching functions, luminous
    efficiency), see <a href="https://github.com/ifarup/ciefunctions">CIE Functions</a>, the program of CIE technical
    committee 1-97.</p>
    <p class="note" data-k="catNote" hidden>The 10 categorical observers of Asano and Fairchild: CIE 2006 cone
    fundamentals at each category's age with its own lens and macular density and its own photopigment densities and
    peak wavelengths, chosen so that together they stand for the variety of color-normal observers. Each curve is
    scaled to an area of 100.</p>
    <p class="note" data-k="kelvinNote" hidden></p>
    <div data-k="obsPasteBox" hidden>
      <p class="note">Wavelength in nm, then three sensitivity curves (color-matching functions, cone fundamentals,
      for example an individual's from a custom-observer measurement platform, or a camera's sensors), any scale; comma,
      tab or space separated, header row optional, at least 420 to 680 nm.</p>
      <textarea data-k="obsPaste" spellcheck="false" placeholder="nm, s1, s2, s3&#10;380, 0.0014, 0.00004, 0.0065&#10;…"></textarea>
    </div>
    <div data-k="lightPasteBox" hidden>
      <p class="note">Wavelength in nm and relative power, any scale.</p>
      <textarea data-k="lightPaste" spellcheck="false" placeholder="380, 2.1&#10;385, 2.3&#10;…"></textarea>
    </div>
    <div class="cols" data-k="plots" hidden></div>`;
  const el = <T extends HTMLElement>(k: string) => host.querySelector(`[data-k="${k}"]`) as T;
  const obs = el<HTMLSelectElement>('obs'), light = el<HTMLSelectElement>('light'), show = el<HTMLInputElement>('show');
  obs.replaceChildren(...(Object.keys(OBSERVER_LABEL) as ObserverName[]).map((k) => new Option(OBSERVER_LABEL[k], k)),
    new Option('CIE 2006 for any age and field size…', 'cie2006'),
    new Option('Categorical observer (category, field size)…', 'categorical'), new Option('Your own sensors (paste)…', 'paste'));
  el<HTMLSelectElement>('cat').replaceChildren(...categoricalObserverAges.map((age, i) => new Option(`${i + 1} (${age} years)`, String(i + 1))));
  light.replaceChildren(...(Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k) => new Option(LIGHT_LABEL[k], k)),
    new Option('Daylight at a temperature…', 'daylight'), new Option('Planckian at a temperature…', 'planckian'),
    new Option('Your own light (paste)…', 'paste'));
  obs.value = start.observer;
  light.value = start.light;
  const sync = () => {
    const o = obs.value;
    el('obsPasteBox').hidden = o !== 'paste';
    el('ageBox').hidden = el('cfNote').hidden = o !== 'cie2006';
    el('catBox').hidden = el('catNote').hidden = o !== 'categorical';
    el('fieldBox').hidden = o !== 'cie2006' && o !== 'categorical';
    el('lightPasteBox').hidden = light.value !== 'paste';
    // the temperature field only for the lights made from one: daylight (a CCT) and Planckian radiators (a temperature)
    const day = light.value === 'daylight', planck = light.value === 'planckian';
    el('kelvinBox').hidden = el('kelvinNote').hidden = !day && !planck;
    if (day || planck) {
      const k = el<HTMLInputElement>('kelvin');
      el('kelvinLabel').textContent = day ? 'Correlated color temperature (CCT)' : 'Temperature';
      k.min = day ? '4000' : '1000';
      el('kelvinNote').textContent = day
        ? 'CIE daylight for this CCT, from 4000 to 25000 K: its white lies near that of a blackbody at that temperature (5000 K gives D50).'
        : 'A blackbody (Planckian) radiator at this temperature; about 2700 K is a household incandescent bulb, 2856 K is CIE illuminant A.';
    }
    el('plots').hidden = !show.checked;
    onChange();
  };
  host.addEventListener('input', sync);
  host.addEventListener('change', sync);
  sync();
  const read = (): Condition => {
    let observer: Observer;
    const field = Number(el<HTMLInputElement>('field').value);
    if (obs.value === 'paste') {
      const t = parseTable(el<HTMLTextAreaElement>('obsPaste').value, 3);
      if (t.columns.length !== 3) throw new Error('give exactly three sensor curves (more than three is not supported yet)');
      observer = { name: 'Your sensors', curves: t.columns.map((c) => resample(t.nm, c)) as unknown as Observer['curves'] };
    } else if (obs.value === 'cie2006') {
      observer = cie2006(field, Number(el<HTMLInputElement>('age').value));
    } else if (obs.value === 'categorical') {
      observer = categoricalObserver(Number(el<HTMLSelectElement>('cat').value), field);
    } else observer = observers[obs.value as ObserverName];
    let spd: Spectrum, lightLabel: string;
    const kelvin = Number(el<HTMLInputElement>('kelvin').value);
    if (light.value === 'paste') {
      const t = parseTable(el<HTMLTextAreaElement>('lightPaste').value, 1);
      spd = resample(t.nm, t.columns[0]);
      lightLabel = 'your light';
    } else if (light.value === 'daylight') {
      spd = daylight(kelvin);
      lightLabel = `daylight at ${kelvin} K`;
    } else if (light.value === 'planckian') {
      spd = planckian(kelvin);
      lightLabel = `Planckian at ${kelvin} K`;
    } else {
      spd = illuminants[light.value as IlluminantName];
      lightLabel = light.value;
    }
    if (spd.some((v) => v < 0) || !spd.some((v) => v > 0)) throw new Error('the light needs positive power');
    return { observer, light: spd, label: `${observer.name}, ${lightLabel}`, lightLabel };
  };
  return {
    get(): Condition {
      try {
        const cond = read();
        if (show.checked) el('plots').innerHTML = conditionPlots(cond);
        return cond;
      } catch (e) {
        el('plots').replaceChildren();
        throw e;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Matrices

export type MatrixFormat = 'plain' | 'octave' | 'python' | 'typescript' | 'json';
export const MATRIX_FORMATS: [MatrixFormat, string][] = [
  ['plain', 'Plain'], ['octave', 'Octave / MATLAB'], ['python', 'Python (NumPy)'], ['typescript', 'TypeScript'], ['json', 'JSON'],
];

const num = (v: number) => (Object.is(v, -0) ? 0 : v).toPrecision(12).replace(/\.?0+(e|$)/, '$1');

/** A 3 x 3 matrix as text in one of the formats. */
export function formatMatrix(m: Mat3, name: string, format: MatrixFormat): string {
  const rows = m.map((r) => r.map(num));
  switch (format) {
    case 'octave': return `${name} = [${rows.map((r) => r.join(' ')).join('; ...\n  ')}];`;
    case 'python': return `${name} = np.array([\n${rows.map((r) => `    [${r.join(', ')}],`).join('\n')}\n])`;
    case 'typescript': return `const ${name}: Mat3 = [\n${rows.map((r) => `  [${r.join(', ')}],`).join('\n')}\n];`;
    case 'json': return JSON.stringify({ [name]: m });
    default: return rows.map((r) => r.join('\t')).join('\n');
  }
}

/** A 3 x 3 matrix as an HTML table, rounded for reading. */
export function matrixTable(m: Mat3, digits = 6): string {
  return `<table class="matrix"><tbody>${m.map((r) => `<tr>${r.map((v) => `<td>${v.toFixed(digits)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  const was = button.textContent;
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; } catch { button.textContent = 'Copy failed'; }
  setTimeout(() => { button.textContent = was; }, 1400);
}

export function download(name: string, text: string, type = 'text/plain'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------------------------------------------
// Plots

export interface Series { values: readonly number[]; color: string; width?: number; dash?: string; label: string }

const RAINBOW = [[0, '#4b0063'], [0.057, '#7a00c4'], [0.143, '#3f00ff'], [0.229, '#0046ff'], [0.314, '#00c0ff'], [0.371, '#00ff6a'],
  [0.457, '#7fff00'], [0.543, '#e6ff00'], [0.571, '#ffef00'], [0.629, '#ff9b00'], [0.714, '#ff3000'], [0.8, '#ff0000'], [0.914, '#b30000'],
  [1, '#6e0000']] as const;
let plotId = 0;

/** Curves on the package's grid (380 to 780 nm), with a spectrum bar under the axis and a legend. */
export function spectrumPlot(title: string, series: Series[], opts: { width?: number; height?: number } = {}): string {
  const W = opts.width ?? 460, H = opts.height ?? 230, l0 = 44, top = 26, pw = W - l0 - 12, ph = H - top - 56;
  const id = `rainbow${++plotId}`;
  const X = (nm: number) => l0 + ((nm - 380) / 400) * pw;
  const ymax = Math.max(...series.flatMap((s) => s.values)) * 1.05 || 1;
  const Y = (v: number) => top + ph - (v / ymax) * ph;
  const step = niceStep(ymax / 4);
  const ticks = Array.from({ length: Math.floor(ymax / step) + 1 }, (_, i) => i * step);
  const stops = RAINBOW.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const paths = series.map((s) => `<path d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${X(wavelengths[i]).toFixed(1)} ${Y(v).toFixed(1)}`).join('')}"
    fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2}" stroke-dasharray="${s.dash ?? ''}" stroke-linejoin="round"/>`).join('');
  const legend = series.map((s) => `<span class="key"><svg width="24" height="10" aria-hidden="true"><line x1="1" x2="23" y1="5" y2="5"
    stroke="${s.color}" stroke-width="${s.width ?? 2}" stroke-dasharray="${s.dash ?? ''}"/></svg>${escapeHtml(s.label)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(title)}">
    <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${X(380)}" x2="${X(730)}">${stops}</linearGradient></defs>
    <text class="title" x="${l0}" y="14">${escapeHtml(title)}</text>
    ${ticks.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${fmtTick(t)}</text>`).join('')}
    <rect x="${l0}" y="${top + ph + 6}" width="${pw}" height="8" fill="url(#${id})"/>
    ${[400, 500, 600, 700].map((t) => `<text x="${X(t)}" y="${top + ph + 28}" text-anchor="middle">${t}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${top + ph + 44}" text-anchor="middle">wavelength (nm)</text>
    ${paths}</svg><div class="legend">${legend}</div>`;
}

export function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

export function fmtTick(v: number): string {
  return Math.abs(v) >= 1000 || v === 0 ? String(Math.round(v)) : String(+v.toPrecision(3));
}

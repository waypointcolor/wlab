// The shared kit of the Waypoint Labs pages: reading tables of numbers, choosing an observing condition (sensors and
// light), plotting spectra, and writing matrices in the formats people paste into their own code.

import {
  categoricalObserver, categoricalObserverAges, cie2006, daylight, illuminants, observers, observersN, planckian,
  resample, wavelengths, type IlluminantName, type Mat3, type Observer, type ObserverName, type Spectrum,
} from '../../src/index.ts';
import { CAMERA_CREDIT, CAMERAS, camerasNow, retryCameras } from './cameras.ts';
import { profileCondition } from './svcn.ts';

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

export interface Condition {
  readonly observer: Observer; readonly light: Spectrum; readonly label: string; readonly lightLabel: string;
  /** iccMAX's name and color temperature for a light read from a profile */
  readonly lightStd?: { name: string; cct: number };
}

export const OBSERVER_LABEL: Record<ObserverName, string> = {
  cie1931: 'CIE 1931 (2°)', cie1964: 'CIE 1964 (10°)', cie2015: 'CIE 2015 (2°)', cie2015_10: 'CIE 2015 (10°)',
  cie2006_2: 'CIE 2006 cone fundamentals (2°)', cie2006_10: 'CIE 2006 cone fundamentals (10°)',
};
export const LIGHT_LABEL: Record<IlluminantName, string> = {
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

const SENSOR_COLORS = ['#c0306a', '#1f8a5b', '#2f74c0', '#8a6d00', '#7a3fb0', '#c2570c', '#2f8f9f'];

/** Names for the three curves of an observer: x̄ ȳ z̄ for CIE color-matching functions, l̄ m̄ s̄ for cone fundamentals. */
function curveNames(o: Observer): string[] {
  if (/cones plus rods/.test(o.name)) return ['l̄', 'm̄', 's̄', 'V′ (rods)'];
  if (/\(camera\)$/.test(o.name)) return ['R', 'G', 'B'];
  if (/^(CIE 2006|Categorical)/.test(o.name)) return ['l̄', 'm̄', 's̄'];
  if (o.name.startsWith('CIE')) return ['x̄', 'ȳ', 'z̄'];
  return o.curves.map((_, i) => `sensor ${i + 1}`);
}

/** The sensors and the light of a condition, side by side. */
export function conditionPlots(cond: Condition): string {
  const names = curveNames(cond.observer);
  const k = 100 / cond.light[36];
  return `<div>${spectrumPlot('Sensors', cond.observer.curves.map((c, i) => ({ values: c, color: SENSOR_COLORS[i % SENSOR_COLORS.length], label: names[i] })))}</div>`
    + (cond.lightLabel ? `<div>${spectrumPlot('Light (560 nm = 100)', [{ values: cond.light.map((v) => v * k), color: 'var(--accent2)', label: cond.lightLabel }])}</div>` : '');
}

/**
 * A condition picker: sensors (a CIE observer, CIE 2006 cone fundamentals for any age and field size, Asano's
 * categorical observers for any field size, or three pasted curves) and a light (a CIE illuminant, daylight
 * or a Planckian radiator at a chosen temperature, or a pasted spectrum), with an option to plot both. `get()`
 * returns the condition or throws; `set()` chooses a built-in observer and light. With `light: false` it picks
 * sensors only (the light is then E, and not shown). The observer, the light or both can also come from an iccMAX
 * profile: the observing condition of its spectral viewing conditions (svcn), or CIE 1931 (2°) under D50 without them.
 */
export function conditionPicker(host: HTMLElement, start: { observer: ObserverName; light: IlluminantName }, onChange: () => void,
  opts: { light?: boolean; threeSensors?: boolean } = {}): { get(): Condition; set(observer: ObserverName, light: IlluminantName): void } {
  host.innerHTML = `
    <div class="row">
      <label>Sensors <select data-k="obs"></select></label>
      <label data-k="catBox" hidden>Category <select data-k="cat"></select></label>
      <label data-k="camBox" hidden>Camera <select data-k="cam"></select></label>
      <label data-k="ageBox" hidden>Age <input type="number" data-k="age" min="20" max="80" step="1" value="32"> years</label>
      <label data-k="fieldBox" hidden>Field size <input type="number" data-k="field" min="1" max="10" step="0.5" value="2">°</label>
      <label data-k="lightBox">Light <select data-k="light"></select></label>
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
    <p class="note" data-k="camNote" hidden></p>
    <p class="note" data-k="kelvinNote" hidden></p>
    <div data-k="obsPasteBox" hidden>
      <p class="note">${opts.threeSensors
        ? `Wavelength in nm, then three sensitivity curves (color-matching functions, cone fundamentals, for example an
      individual's from a custom-observer measurement platform, or a camera's sensors), any scale; comma, tab or space
      separated, header row optional, at least 420 to 680 nm.`
        : `Wavelength in nm, then three or more sensitivity curves (color-matching functions, cone
      fundamentals, for example an individual's from a custom-observer measurement platform, a camera's sensors, or cones
      plus rods for mesopic vision), any scale; comma, tab or space separated, header row optional, at least 420 to 680
      nm. More than three sensors give a 3 × N normalization to Wpt and no MAT.`}</p>
      <textarea data-k="obsPaste" spellcheck="false" placeholder="nm, s1, s2, s3&#10;380, 0.0014, 0.00004, 0.0065&#10;…"></textarea>
    </div>
    <div data-k="profileBox" hidden>
      <div class="row"><label>ICC or iccMAX profile <input type="file" data-k="profileFile" accept=".icc,.icm,.xml"></label></div>
      <p class="note" data-k="profileNote">An ICC (version 2 or 4) or iccMAX (version 5) profile, binary (.icc) or as XML
      (as iccDEV's iccToXml writes it). The spectral viewing conditions of an iccMAX profile (its svcn tag, or that of
      the version 5 profile inside a hybrid profile) give the observer and the light; a profile without them, as every
      version 2 or 4 profile, is on the standard PCS, CIE 1931 (2°) under D50.</p>
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
    ...(opts.threeSensors ? [] : [new Option('CIE 2006 (10°) cones plus rods, for mesopic vision (4 sensors)', 'rods')]),
    new Option('Categorical observer (category, field size)…', 'categorical'), new Option('A camera (open data)…', 'camera'),
    new Option('Your own sensors (paste)…', 'paste'),
    new Option('From an ICC/iccMAX profile…', 'profile'));
  // the cameras grouped by maker
  const makers = new Map<string, HTMLOptGroupElement>();
  CAMERAS.forEach((c, i) => {
    const maker = c.name.split(' ')[0];
    if (!makers.has(maker)) { const g = document.createElement('optgroup'); g.label = maker; makers.set(maker, g); }
    makers.get(maker)!.append(new Option(c.name, String(i)));
  });
  el<HTMLSelectElement>('cam').replaceChildren(...makers.values());
  el<HTMLSelectElement>('cat').replaceChildren(...categoricalObserverAges.map((age, i) => new Option(`${i + 1} (${age} years)`, String(i + 1))));
  light.replaceChildren(...(Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k) => new Option(LIGHT_LABEL[k], k)),
    new Option('Candlelight (Planckian, 1850 K), for mesopic viewing', 'candle'),
    new Option('Daylight at a temperature…', 'daylight'), new Option('Planckian at a temperature…', 'planckian'),
    new Option('Your own light (paste)…', 'paste'), new Option('From the ICC/iccMAX profile…', 'profile'));
  obs.value = start.observer;
  light.value = opts.light === false ? 'E' : start.light;
  el('lightBox').hidden = opts.light === false;
  // the condition of a loaded profile, or why it could not be read
  let loaded: { cond: ReturnType<typeof profileCondition>; file: string } | { error: string } | undefined;
  let lastObs = obs.value;
  const sync = () => {
    const o = obs.value;
    // choosing the profile's observer brings its light along (it can still be changed)
    if (o === 'profile' && lastObs !== 'profile' && opts.light !== false) light.value = 'profile';
    lastObs = o;
    el('obsPasteBox').hidden = o !== 'paste';
    el('profileBox').hidden = o !== 'profile' && light.value !== 'profile';
    el('ageBox').hidden = el('cfNote').hidden = o !== 'cie2006';
    el('catBox').hidden = el('catNote').hidden = o !== 'categorical';
    el('camBox').hidden = el('camNote').hidden = o !== 'camera';
    if (o === 'camera') {
      retryCameras();
      const c = CAMERAS[Number(el<HTMLSelectElement>('cam').value)];
      el('camNote').textContent = `A camera's red, green and blue sensitivities, as sensors: measured by ${c.measuredBy}. `
        + `A camera rarely meets the Luther-Ives condition, so its MAT to an observer carries some materials better than others. ${CAMERA_CREDIT}`;
    }
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
        : 'A blackbody (Planckian) radiator at this temperature; about 2700 K is a household incandescent bulb, 2856 K is CIE illuminant A, about 1850 K a candle.';
    }
    el('plots').hidden = !show.checked;
    onChange();
  };
  host.addEventListener('input', sync);
  host.addEventListener('change', sync);
  el<HTMLInputElement>('profileFile').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      loaded = { cond: profileCondition(new Uint8Array(await file.arrayBuffer())), file: file.name };
      const c = loaded.cond;
      el('profileNote').textContent = c.svcn
        ? `${file.name}: ${c.observer.name}, ${c.lightLabel}.`
        : `${file.name} has no spectral viewing conditions: CIE 1931 (2°) under D50, the standard PCS.`;
    } catch (err) {
      loaded = { error: `${file.name}: ${(err as Error).message}` };
      el('profileNote').textContent = `Cannot read ${loaded.error}.`;
    }
    sync();
  });
  const fromProfile = () => {
    if (!loaded) throw new Error('choose an ICC or iccMAX profile to read');
    if ('error' in loaded) throw new Error(`cannot read ${loaded.error}`);
    return loaded.cond;
  };
  sync();
  const read = (): Condition => {
    let observer: Observer;
    const field = Number(el<HTMLInputElement>('field').value);
    if (obs.value === 'profile') {
      observer = fromProfile().observer;
    } else if (obs.value === 'paste') {
      const t = parseTable(el<HTMLTextAreaElement>('obsPaste').value, 3);
      if (opts.threeSensors && t.columns.length !== 3) throw new Error(`give exactly three sensor curves here, not ${t.columns.length}`);
      observer = { name: 'Your sensors', curves: t.columns.map((c) => resample(t.nm, c)) as unknown as Observer['curves'] };
    } else if (obs.value === 'rods') {
      observer = observersN.cie2006_10_rods;
    } else if (obs.value === 'cie2006') {
      observer = cie2006(field, Number(el<HTMLInputElement>('age').value));
    } else if (obs.value === 'categorical') {
      observer = categoricalObserver(Number(el<HTMLSelectElement>('cat').value), field);
    } else if (obs.value === 'camera') {
      observer = camerasNow(onChange)[Number(el<HTMLSelectElement>('cam').value)];
    } else observer = observers[obs.value as ObserverName];
    let spd: Spectrum, lightLabel: string, lightStd: Condition['lightStd'];
    const kelvin = Number(el<HTMLInputElement>('kelvin').value);
    if (light.value === 'profile') {
      const c = fromProfile();
      ({ light: spd, lightLabel } = c);
      lightStd = c.svcn ? { name: c.svcn.stdIlluminant, cct: c.svcn.colorTemperature } : { name: 'Illuminant D50', cct: 5000 };
    } else if (light.value === 'paste') {
      const t = parseTable(el<HTMLTextAreaElement>('lightPaste').value, 1);
      spd = resample(t.nm, t.columns[0]);
      lightLabel = 'your light';
    } else if (light.value === 'daylight') {
      spd = daylight(kelvin);
      lightLabel = `daylight at ${kelvin} K`;
    } else if (light.value === 'candle') {
      // a candle flame is close to a blackbody at about 1850 K: dim, warm light where rods join the cones
      spd = planckian(1850);
      lightLabel = 'candlelight (1850 K)';
    } else if (light.value === 'planckian') {
      spd = planckian(kelvin);
      lightLabel = `Planckian at ${kelvin} K`;
    } else {
      spd = illuminants[light.value as IlluminantName];
      lightLabel = light.value;
    }
    if (spd.some((v) => v < 0) || !spd.some((v) => v > 0)) throw new Error('the light needs positive power');
    if (opts.light === false) return { observer, light: spd, label: observer.name, lightLabel: '' };
    return { observer, light: spd, label: `${observer.name}, ${lightLabel}`, lightLabel, lightStd };
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
    set(observer: ObserverName, lightName: IlluminantName): void {
      obs.value = observer;
      light.value = lightName;
      sync();
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

/** A matrix (3 × 3, or 3 × N for N sensors) as text in one of the formats. */
export function formatMatrix(m: readonly (readonly number[])[], name: string, format: MatrixFormat): string {
  const rows = m.map((r) => r.map(num));
  switch (format) {
    case 'octave': return `${name} = [${rows.map((r) => r.join(' ')).join('; ...\n  ')}];`;
    case 'python': return `${name} = np.array([\n${rows.map((r) => `    [${r.join(', ')}],`).join('\n')}\n])`;
    case 'typescript': return `const ${name}: number[][] = [\n${rows.map((r) => `  [${r.join(', ')}],`).join('\n')}\n];`;
    case 'json': return JSON.stringify({ [name]: m });
    default: return rows.map((r) => r.join('\t')).join('\n');
  }
}

/** A matrix as an HTML table, rounded for reading. */
export function matrixTable(m: readonly (readonly number[])[], digits = 6): string {
  return `<table class="matrix"><tbody>${m.map((r) => `<tr>${r.map((v) => `<td>${v.toFixed(digits)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  const was = button.textContent;
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; } catch { button.textContent = 'Copy failed'; }
  setTimeout(() => { button.textContent = was; }, 1400);
}

export function download(name: string, data: string | Uint8Array, type = 'text/plain'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type }));
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

/** Overlaid histograms of sorted values, one color per set. */
export function histogram(sets: number[][], labels: string[], colors: string[],
  o: { xLabel?: string; yLabel?: string } = {}): string {
  const W = 440, H = 230, l0 = 40, top = 12, pw = W - l0 - 12, ph = H - top - 46;
  const hi = Math.max(...sets.map((v) => v[Math.min(v.length - 1, Math.round(0.98 * (v.length - 1)))])) || 1;
  const width = niceStep(hi / 12), bins = Math.ceil(hi / width) + 1;
  const counts = sets.map((v) => { const c = new Array<number>(bins).fill(0); for (const x of v) c[Math.min(bins - 1, Math.floor(x / width))]++; return c; });
  const cmax = Math.max(...counts.flat()) || 1;
  const X = (b: number) => l0 + (b / bins) * pw, Y = (c: number) => top + ph - (c / cmax) * ph;
  const bw = pw / bins;
  const bars = counts.map((c, s) => c.map((n, b) => n ? `<rect x="${(X(b) + (s * bw) / sets.length).toFixed(1)}" y="${Y(n).toFixed(1)}"
    width="${(bw / sets.length - 1).toFixed(1)}" height="${(top + ph - Y(n)).toFixed(1)}" fill="${colors[s]}"/>` : '').join('')).join('');
  const yt = niceStep(cmax / 4);
  const ticks = []; for (let t = 0; t <= cmax; t += yt) ticks.push(t);
  const xt = []; for (let b = 0; b <= bins; b += Math.max(1, Math.round(bins / 6))) xt.push(b);
  const legend = labels.map((l, s) => `<span class="key"><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" fill="${colors[s]}"/></svg>${l}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Histogram">
    ${ticks.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    ${bars}
    ${xt.map((b) => `<text x="${X(b)}" y="${top + ph + 16}" text-anchor="middle">${fmtTick(b * width)}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${top + ph + 34}" text-anchor="middle">${escapeHtml(o.xLabel ?? 'ΔE_WLab (the last bin holds everything above)')}</text>
    <text x="${l0 + 4}" y="${top + 10}">${escapeHtml(o.yLabel ?? 'materials')}</text></svg><div class="legend">${legend}</div>`;
}

/** Points (dots or rings) on two axes, with optional lines or arrows between pairs of points. */
export function scatter(o: {
  xLabel: string; yLabel: string; x: [number, number]; y?: [number, number]; xTicks?: number[]; square?: boolean;
  sets: { pts: number[][]; color: string; label: string; ring?: boolean; titles?: string[]; colors?: string[] }[]; links?: number[][]; arrows?: boolean;
  /** an outline around each dot, so that a dot of any color shows against the page */
  outline?: boolean;
  /** the radius of each dot (2.8 by default, 3.4 with an outline) */
  dot?: number;
}): string {
  const W = 440, H = o.square ? 400 : 250, l0 = 46, top = 10, pw = W - l0 - 12, ph = H - top - 44;
  const ys = o.sets.flatMap((s) => s.pts.map((p) => p[1]));
  let [y0, y1] = o.y ?? [Math.min(...ys), Math.max(...ys)];
  if (!o.y) { const pad = (y1 - y0) * 0.08 || 0.5; y0 -= pad; y1 += pad; }
  const X = (v: number) => l0 + ((v - o.x[0]) / (o.x[1] - o.x[0])) * pw;
  const Y = (v: number) => top + ph - ((v - y0) / (y1 - y0)) * ph;
  const ystep = niceStep((y1 - y0) / 4);
  const yt = []; for (let t = Math.ceil(y0 / ystep) * ystep; t <= y1 + 1e-9; t += ystep) yt.push(+t.toFixed(10));
  const xstep = niceStep((o.x[1] - o.x[0]) / 4);
  const xt = o.xTicks ?? (() => { const a = []; for (let t = Math.ceil(o.x[0] / xstep) * xstep; t <= o.x[1] + 1e-9; t += xstep) a.push(+t.toFixed(10)); return a; })();
  // a point's hover text is its title; a ring takes the pointer over its whole circle, not only its outline
  const tip = (s: { titles?: string[] }, i: number) => (s.titles?.[i] ? `<title>${escapeHtml(s.titles[i])}</title>` : '');
  // points with hover text are drawn last, on top, so that the others never hide them
  const drawOrder = [...o.sets.filter((s) => !s.titles), ...o.sets.filter((s) => s.titles)];
  const dots = drawOrder.map((s) => s.pts.map(([x, y], i) => s.ring
    ? `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="4" fill="#fff" fill-opacity="0" stroke="${s.color}" stroke-width="1.3">${tip(s, i)}</circle>`
    : `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${o.dot ?? (o.outline ? 3.4 : 2.8)}" fill="${s.colors?.[i] ?? s.color}"${o.outline ? ' stroke="var(--quiet)" stroke-width="0.6"' : ''}>${tip(s, i)}</circle>`).join('')).join('');
  const id = `arrow${++plotId}`;
  const links = (o.links ?? []).map(([a, b, c, d]) => `<line x1="${X(a).toFixed(1)}" y1="${Y(b).toFixed(1)}" x2="${X(c).toFixed(1)}" y2="${Y(d).toFixed(1)}"
    stroke="var(--quiet)" stroke-opacity="0.7"${o.arrows ? ` marker-end="url(#${id})"` : ''}/>`).join('');
  const legend = o.sets.filter((s) => !s.colors).map((s) => `<span class="key"><svg width="12" height="12" aria-hidden="true">${s.ring
    ? `<circle cx="6" cy="6" r="4" fill="none" stroke="${s.color}" stroke-width="1.3"/>` : `<circle cx="6" cy="6" r="3" fill="${s.color}"/>`}</svg>${escapeHtml(s.label)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(o.yLabel)} against ${escapeHtml(o.xLabel)}">
    ${yt.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${fmtTick(t)}</text>`).join('')}
    ${xt.map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + ph}" stroke="var(--line)" stroke-opacity="0.6"/><text x="${X(t)}" y="${top + ph + 16}" text-anchor="middle">${fmtTick(t)}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${top + ph + 34}" text-anchor="middle">${escapeHtml(o.xLabel)}</text>
    <text x="${l0 + 4}" y="${top + 12}">${escapeHtml(o.yLabel)}</text>
    <defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--quiet)"/></marker></defs>
    ${links}${dots}</svg><div class="legend">${legend}</div>`;
}

// one hue, light to dark, for magnitudes (heat maps); in dark mode the darkest step is the smallest, so that small
// values recede into the page in either mode
const SEQUENTIAL = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab',
  '#184f95', '#104281', '#0d366b'];
const darkMode = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The sequential color of t, from 0 (smallest) to 1 (largest). */
export function sequential(t: number): string {
  const ramp = darkMode() ? [...SEQUENTIAL].reverse() : SEQUENTIAL;
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i;
  const rgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [a, b] = [rgb(ramp[i]), rgb(ramp[i + 1])];
  return `rgb(${a.map((v, k) => Math.round(v + f * (b[k] - v))).join(',')})`;
}

/**
 * A grid of values as colored cells (rows top to bottom, columns left to right), each with its value on hover, a
 * ring around one cell, and the color scale under it.
 */
export function heatMap(o: {
  title: string; rowLabel: string; colLabel: string; rows: string[]; cols: string[]; values: number[][];
  ring?: [number, number]; tip: (r: number, c: number) => string;
}): string {
  const cw = 26, ch = 18, l0 = 62, top = 24, W = l0 + o.cols.length * cw + 12, ph = o.rows.length * ch, H = top + ph + 84;
  const all = o.values.flat().filter(Number.isFinite), lo = Math.min(...all), hi = Math.max(...all);
  const t = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);
  const cells = o.values.map((row, r) => row.map((v, c) => Number.isFinite(v)
    ? `<rect x="${l0 + c * cw + 1}" y="${top + r * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="${sequential(t(v))}"><title>${escapeHtml(o.tip(r, c))}</title></rect>` : '').join('')).join('');
  const ring = o.ring ? `<rect x="${l0 + o.ring[1] * cw - 0.5}" y="${top + o.ring[0] * ch - 0.5}" width="${cw + 1}" height="${ch + 1}" rx="3"
    fill="none" stroke="var(--ink)" stroke-width="2" pointer-events="none"/>` : '';
  const every = (n: number) => Math.max(1, Math.ceil(n / 14));
  const rowTicks = o.rows.map((l, r) => (r % every(o.rows.length) ? '' : `<text x="${l0 - 6}" y="${top + r * ch + ch / 2 + 4}" text-anchor="end">${escapeHtml(l)}</text>`)).join('');
  const colTicks = o.cols.map((l, c) => (c % every(o.cols.length) ? '' : `<text x="${l0 + c * cw + cw / 2}" y="${top + ph + 14}" text-anchor="middle">${escapeHtml(l)}</text>`)).join('');
  const id = `seq${++plotId}`, bw = Math.min(200, W - l0 - 12), by = top + ph + 48;
  const stops = Array.from({ length: 11 }, (_, k) => `<stop offset="${k / 10}" stop-color="${sequential(k / 10)}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width: ${W * 1.6}px" role="img" aria-label="${escapeHtml(o.title)}">
    <defs><linearGradient id="${id}">${stops}</linearGradient></defs>
    <text class="title" x="${l0}" y="14">${escapeHtml(o.title)}</text>
    ${cells}${ring}${rowTicks}${colTicks}
    <text x="${l0 + (o.cols.length * cw) / 2}" y="${top + ph + 30}" text-anchor="middle">${escapeHtml(o.colLabel)}</text>
    <text transform="translate(12 ${top + ph / 2}) rotate(-90)" text-anchor="middle">${escapeHtml(o.rowLabel)}</text>
    <rect x="${l0}" y="${by}" width="${bw}" height="8" rx="2" fill="url(#${id})"/>
    <text x="${l0}" y="${by + 22}">${fmtTick(lo)}</text><text x="${l0 + bw}" y="${by + 22}" text-anchor="end">${fmtTick(hi)}</text></svg>`;
}

/** Lines through points on two axes, the smallest point of each line marked, every point with its hover text. */
export function linePlot(o: {
  xLabel: string; yLabel: string;
  series: { pts: [number, number][]; color: string; dash?: string; label: string; tips: string[] }[];
}): string {
  const W = 460, H = 262, l0 = 46, top = 24, pw = W - l0 - 26, ph = H - top - 44;
  const xs = o.series.flatMap((s) => s.pts.map((p) => p[0])), ys = o.series.flatMap((s) => s.pts.map((p) => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys) * 1.05 || 1;
  const X = (v: number) => l0 + ((v - x0) / (x1 - x0 || 1)) * pw, Y = (v: number) => top + ph - (v / y1) * ph;
  const ys0 = niceStep(y1 / 4), xs0 = niceStep((x1 - x0) / 5);
  const yt: number[] = []; for (let v = 0; v <= y1 + 1e-9; v += ys0) yt.push(+v.toFixed(10));
  const xt: number[] = []; for (let v = Math.ceil(x0 / xs0) * xs0; v <= x1 + 1e-9; v += xs0) xt.push(v);
  const lines = o.series.map((s) => {
    const best = s.pts.reduce((b, p, i) => (p[1] < s.pts[b][1] ? i : b), 0);
    return `<path d="${s.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join('')}" fill="none" stroke="${s.color}"
      stroke-width="2" stroke-dasharray="${s.dash ?? ''}" stroke-linejoin="round"/>
      <circle cx="${X(s.pts[best][0]).toFixed(1)}" cy="${Y(s.pts[best][1]).toFixed(1)}" r="4.5" fill="${s.color}" stroke="var(--bg)" stroke-width="2"/>
      ${s.pts.map(([x, y], i) => `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="6" fill="transparent"><title>${escapeHtml(s.tips[i])}</title></circle>`).join('')}`;
  }).join('');
  const legend = o.series.map((s) => `<span class="key"><svg width="24" height="10" aria-hidden="true"><line x1="1" x2="23" y1="5" y2="5"
    stroke="${s.color}" stroke-width="2" stroke-dasharray="${s.dash ?? ''}"/></svg>${escapeHtml(s.label)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(o.yLabel)} against ${escapeHtml(o.xLabel)}">
    ${yt.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${fmtTick(t)}</text>`).join('')}
    ${xt.map((t) => `<text x="${X(t)}" y="${top + ph + 16}" text-anchor="middle">${fmtTick(t)}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${top + ph + 34}" text-anchor="middle">${escapeHtml(o.xLabel)}</text>
    <text x="${l0}" y="12">${escapeHtml(o.yLabel)}</text>${lines}</svg><div class="legend">${legend}</div>`;
}

/**
 * An opt-in box: shown only while its checkbox is ticked. Unticking puts the defaults back (`reset`) and hides it,
 * so that what the page computes with is always either the defaults or what the reader chose in the box.
 */
export function optIn(check: HTMLInputElement, box: HTMLElement, reset: () => void, onChange: () => void): void {
  box.hidden = !check.checked;
  check.addEventListener('change', () => { box.hidden = !check.checked; if (!check.checked) reset(); onChange(); });
}

/** Views that turn together: turning one turns every view drawn with the group. */
export interface ViewGroup { yaw: number; pitch: number; draws: Set<() => void> }
export const viewGroup = (from?: { yaw: number; pitch: number }): ViewGroup => ({ yaw: from?.yaw ?? -0.6, pitch: from?.pitch ?? 0.45, draws: new Set() });

/**
 * Points in three dimensions on a canvas, turned by dragging (or with the arrow keys): one color per set, axes through
 * the origin, the same scale on every axis so that shapes are true. The view's angles stay on the canvas between
 * redraws, or are shared by a group of views.
 */
export function cloud3d(canvas: HTMLCanvasElement, o: {
  sets: { pts: number[][]; color: string; colors?: string[] }[]; axes: [string, string, string];
  /** an outline around each point, so that a point of any color shows against the page */
  outline?: boolean;
  /** lines, each from one point to another, drawn under the points */
  lines?: { from: number[][]; to: number[][]; color: string };
  /** the radius of each point, in pixels (2.4 by default; smaller where lines should show) */
  dot?: number;
  /** a view that does not turn (for example straight down, { yaw: 0, pitch: π/2 }): many points drawn fast */
  fixed?: { yaw: number; pitch: number };
  /** views that turn together */
  group?: ViewGroup;
  /** the extent of every axis (the same for views to be compared at one scale); by default the points' own */
  range?: number;
}): void {
  const c = canvas as HTMLCanvasElement & { view?: { yaw: number; pitch: number }; data?: typeof o; bound?: boolean };
  c.view = o.fixed ?? o.group ?? c.view ?? { yaw: -0.6, pitch: 0.45 };
  c.data = o;
  const draw = () => {
    const d = c.data!, v = c.view!;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--quiet').trim() || '#5c636b', line = css.getPropertyValue('--line').trim() || '#d9dde1';
    const w = c.clientWidth || 440, h = Math.round(w * 0.8), dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = `${h}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    // every point at the origin (a nonselective gray's shifts, say): one point, drawn on axes of ±1
    const far = d.range ?? Math.max(...[...d.sets.map((s) => s.pts), d.lines?.from ?? [], d.lines?.to ?? []].flatMap((pts) => pts.flatMap((p) => p.map(Math.abs))));
    const still = !(far > 1e-6), R = still ? 1 : far;
    const k = (0.4 * Math.min(w, h)) / R, cx = w / 2, cy = h / 2;
    const cy0 = Math.cos(v.yaw), sy0 = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
    // x and y lie in the horizontal plane, z points up
    const project = (x: number, y: number, z: number) => {
      const x1 = x * cy0 - y * sy0, y1 = x * sy0 + y * cy0;
      return { sx: cx + k * x1, sy: cy - k * (z * cp + y1 * sp), depth: y1 * cp - z * sp };
    };
    g.lineWidth = 1;
    g.font = '11px system-ui, sans-serif';
    ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const).forEach((a, i) => {
      const p0 = project(-a[0] * R, -a[1] * R, -a[2] * R), p1 = project(a[0] * R, a[1] * R, a[2] * R);
      g.strokeStyle = line;
      g.beginPath(); g.moveTo(p0.sx, p0.sy); g.lineTo(p1.sx, p1.sy); g.stroke();
      g.fillStyle = ink;
      g.fillText(d.axes[i], p1.sx + 4, p1.sy - 4);
    });
    if (d.lines) {
      g.strokeStyle = d.lines.color; g.globalAlpha = 0.75;
      g.beginPath();
      d.lines.from.forEach((p, k) => {
        const q = d.lines!.to[k], a = project(p[0], p[1], p[2]), b = project(q[0], q[1], q[2]);
        g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy);
      });
      g.stroke(); g.globalAlpha = 1;
    }
    const dots = d.sets.flatMap((s) => s.pts.map((p, i) => ({ ...project(p[0], p[1], p[2]), color: s.colors?.[i] ?? s.color })));
    dots.sort((a, b) => b.depth - a.depth);
    const r = d.dot ?? (d.outline ? 3.2 : 2.4);
    g.strokeStyle = ink; g.lineWidth = 0.6;
    for (const p of dots) {
      g.fillStyle = p.color; g.beginPath(); g.arc(p.sx, p.sy, r, 0, 2 * Math.PI); g.fill();
      if (d.outline) g.stroke();
    }
    g.fillStyle = ink;
    g.fillText(still ? 'no shift: every point at the origin' : `each axis ±${fmtTick(R)}`, 6, h - 6);
  };
  if (!c.bound && !o.fixed) {
    c.bound = true;
    c.tabIndex = 0;
    let last: { x: number; y: number } | undefined;
    const turn = (dx: number, dy: number) => {
      c.view!.yaw += dx * 0.01;
      c.view!.pitch = Math.max(-1.5, Math.min(1.5, c.view!.pitch + dy * 0.01));
      const group = c.data!.group;
      if (group) group.draws.forEach((d) => d()); else draw();
    };
    c.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (!last) return; turn(e.clientX - last.x, e.clientY - last.y); last = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointerup', () => { last = undefined; });
    c.addEventListener('keydown', (e) => {
      const step: Record<string, [number, number]> = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
      if (step[e.key]) { e.preventDefault(); turn(...step[e.key]); }
    });
    window.addEventListener('resize', () => { if (c.isConnected) draw(); });
  }
  o.group?.draws.add(draw);
  draw();
}

// Lab I: a display described by the light it emits (an iccMAX version 5 display profile), the version 4 profile for
// any observer (iccDEV's iccV5DspObsToV4Dsp), how observers agree on one display and on two matched for one of them,
// and colors run through iccDEV's color management (iccApplyNamedCmm). iccDEV's tools run in the page as WebAssembly
// (vendor/iccdev, published in labs/data/iccdev/), loaded on first use. Bundled into labs/profiles.html by
// scripts/build-web.mjs.

import {
  categoricalObserver, deltaE00, deltaEWlab, observers, wlabToRgb, type Observer, type Vec3,
} from '../../src/index.ts';
import {
  displayFromSpectra, displayProfileXml, observerProfileXml, readMatrixTrc, toneTable, viewOn, whiteOf,
  type Display, type MatrixTrc, type Tone, type View,
} from './display.ts';
import { BUILT_IN_DISPLAYS } from './displays-builtin.ts';
import { convertObserver, STANDARD } from './encoding.ts';
import { encodingProfileIcc } from './iccbinary.ts';
import { browserLoader, run, type RunResult, type Tool } from './iccdev.ts';
import { $, conditionPicker, download, escapeHtml, parseTable, scatter, spectrumPlot } from './kit.ts';

const loader = browserLoader('data/iccdev/');
const enc = new TextEncoder();
const message = (e: unknown) => (e as Error).message;
const fmt = (v: number, d = 4) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

// iccDEV's runs, timed for the status line under the introduction
let toolMs = 0, toolRuns = 0;
const loaded = new Set<Tool>();
async function tool(name: Tool, args: string[], files: Record<string, Uint8Array | string>, want: string[] = []): Promise<RunResult> {
  const t0 = performance.now();
  const r = await run(loader, name, args, files, want);
  toolMs += performance.now() - t0; toolRuns++; loaded.add(name);
  $('toolStatus').textContent = `iccDEV's tools loaded in this page: ${[...loaded].join(', ')}; ${toolRuns} runs so far, ${Math.round(toolMs)} ms in all.`;
  return r;
}
async function build(xml: string, what: string): Promise<Uint8Array> {
  const r = await tool('iccFromXml', ['p.xml', 'p.icc'], { 'p.xml': enc.encode(xml) }, ['p.icc']);
  if (r.code !== 0 || !r.files['p.icc']) throw new Error(`iccFromXml could not build ${what}: ${r.output.trim()}`);
  return r.files['p.icc'];
}
/** The numbers before each ";" in iccApplyNamedCmm's output, one row per color. */
const outRows = (out: string) => out.split('\n').filter((l) => /^\s*-?[\d.]/.test(l) && l.includes(';')).map((l) => l.split(';')[0].trim().split(/\s+/).map(Number));
const dataFile = (rgbs: readonly (readonly number[])[]) => `'RGB '\t; Data Format\nicEncodeFloat\t; Encoding\n\n${rgbs.map((r) => r.map((v) => v.toFixed(6)).join(' ')).join('\n')}\n`;

// the standard PCS as CIELAB (CIE 1931, 2°, under D50), floating point: Lab D's encoding profile for the standard condition
const LAB_ICC = encodingProfileIcc(convertObserver(STANDARD.observer, STANDARD.observer, STANDARD.light), STANDARD.light,
  { encoding: 'Lab', numbers: 'float', description: 'CIELAB, CIE 1931 (2°) under D50, floating point', luminance: 160 });

// ---------------------------------------------------------------------------------------------------------------
// Section 1: the display

const OWN = 'own';
const displaySelect = $<HTMLSelectElement>('display'), secondSelect = $<HTMLSelectElement>('second');
displaySelect.innerHTML = [...BUILT_IN_DISPLAYS.map((d, i) => `<option value="${i}">${escapeHtml(d.name)}</option>`), `<option value="${OWN}">Your own (below)</option>`].join('');
secondSelect.innerHTML = BUILT_IN_DISPLAYS.map((d, i) => `<option value="${i}">${escapeHtml(d.name)}</option>`).join('');
secondSelect.value = '1';

let ownDisplay: Display | undefined;
function readOwn(): void {
  const text = $<HTMLTextAreaElement>('ownSpectra').value;
  ownDisplay = undefined;
  if (!text.trim()) { $('ownStatus').className = 'note'; $('ownStatus').textContent = 'Paste the spectra to use your own display.'; return; }
  try {
    const t = parseTable(text, 3);
    const kind = $<HTMLSelectElement>('ownTone').value;
    let tone: Tone = { kind: 'srgb' };
    if (kind === 'gamma') tone = { kind: 'gamma', gamma: Number($<HTMLInputElement>('ownGamma').value) || 2.2 };
    if (kind === 'table') {
      const lines = $<HTMLTextAreaElement>('ownToneTable').value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      const cells = lines.map((l) => l.split(/[\s,;]+/).map(Number)).filter((r) => r.every((v) => !Number.isNaN(v)));
      if (cells.length < 2) throw new Error('paste the tone table (code value, then drive)');
      tone = { kind: 'table', curves: toneTable(cells.map((r) => r[0]), cells[0].slice(1).map((_, k) => cells.map((r) => r[k + 1]))) };
    }
    ownDisplay = displayFromSpectra($<HTMLInputElement>('ownName').value.trim() || 'My display', t.nm, t.columns.slice(0, 3), t.columns[3], tone);
    ownDisplay.source = `Your measurements: ${t.nm.length} wavelengths from ${t.nm[0]} to ${t.nm[t.nm.length - 1]} nm${t.columns[3] ? ', with black' : ''}.`;
    $('ownStatus').className = 'note';
    $('ownStatus').textContent = `Read: red, green and blue${t.columns[3] ? ' and black' : ''}, ${ownDisplay.nm.length} wavelengths from ${ownDisplay.nm[0]} to ${ownDisplay.nm[ownDisplay.nm.length - 1]} nm.`;
  } catch (e) {
    $('ownStatus').className = 'error';
    $('ownStatus').textContent = `Cannot read your display: ${message(e)}.`;
  }
}
const displayOf = (value: string): Display | undefined => (value === OWN ? ownDisplay : BUILT_IN_DISPLAYS[Number(value)]);

function drawDisplay(d: Display): void {
  $('displaySource').textContent = d.source ?? '';
  const w = whiteOf(d);
  $('displayPlot').innerHTML = spectrumPlot(`${d.name}: what it emits (white's peak = 1)`, [
    { values: w, color: 'var(--quiet)', width: 1.4, dash: '4 3', label: 'white' },
    { values: d.primaries[0], color: '#d62728', label: 'red' },
    { values: d.primaries[1], color: '#2ca02c', label: 'green' },
    { values: d.primaries[2], color: '#1f5fd6', label: 'blue' },
    ...(d.black.some((v) => v > 0) ? [{ values: d.black, color: 'var(--ink)', width: 1.2, label: 'black' }] : []),
  ], { nm: d.nm });
}

// ---------------------------------------------------------------------------------------------------------------
// Section 2: the observer (the light is the display's white)

let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(() => void render(), 30); };
const picker = conditionPicker($('observerPick'), { observer: 'cie1931', light: 'E' }, schedule, { light: false, threeSensors: true });

// ---------------------------------------------------------------------------------------------------------------
// Section 4's observers

const MANY: [string, string, () => Observer][] = [
  ['cie1964', 'CIE 1964 (10°)', () => observers.cie1964],
  ['cie2015', 'CIE 2015 (2°)', () => observers.cie2015],
  ['cie2015_10', 'CIE 2015 (10°)', () => observers.cie2015_10],
  ...Array.from({ length: 10 }, (_, i) => [`cat${i + 1}`, `Categorical observer ${i + 1}`, () => categoricalObserver(i + 1)] as [string, string, () => Observer]),
  ['picked', 'The observer of section 2', () => picker.get().observer],
];
$('manyObservers').innerHTML = MANY.map(([v, t]) => `<label><input type="checkbox" value="${v}"${v === 'picked' ? '' : ' checked'}> ${escapeHtml(t)}</label>`).join('');
const manyTicked = (): [string, Observer][] => {
  const on = new Set([...$('manyObservers').querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value));
  return MANY.filter(([v]) => on.has(v)).flatMap(([, t, o]) => { try { return [[t, o()] as [string, Observer]]; } catch { return []; } });
};

/** The 27 colors whose R, G and B are each 0, 0.5 or 1. */
const CUBE = [0, 0.5, 1].flatMap((r) => [0, 0.5, 1].flatMap((g) => [0, 0.5, 1].map((b) => [r, g, b])));
const rgbName = (c: readonly number[]) => c.map((v) => fmt(v, 2).replace(/\.?0+$/, '') || '0').join(', ');

// ---------------------------------------------------------------------------------------------------------------
// Plots of section 3

const x_y = (v: readonly number[]) => { const s = v[0] + v[1] + v[2]; return s > 0 ? [v[0] / s, v[1] / s] : [0, 0]; };
function gamutPlot(tri: number[][], ref: number[][], label: string): string {
  const W = 300, H = 300, l0 = 40, top = 12, pw = W - l0 - 10, ph = H - top - 36;
  const X = (x: number) => l0 + (x / 0.8) * pw, Y = (y: number) => top + ph - (y / 0.9) * ph;
  const locus = observers.cie1931.curves[0].map((_, i) => x_y([observers.cie1931.curves[0][i], observers.cie1931.curves[1][i], observers.cie1931.curves[2][i]]))
    .filter((p, i) => i >= 4 && i <= 70 && p[0] + p[1] > 0);
  const path = (pts: number[][], close: boolean) => `${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join('')}${close ? 'Z' : ''}`;
  const ticks = [0, 0.2, 0.4, 0.6, 0.8];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Chromaticities of the colorants">
    ${ticks.map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + ph}" stroke="var(--line)"/><text x="${X(t)}" y="${top + ph + 14}" text-anchor="middle">${t}</text>`).join('')}
    ${ticks.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${H - 4}" text-anchor="middle">x</text><text x="10" y="${top + ph / 2}">y</text>
    <path d="${path(locus, true)}" fill="none" stroke="var(--quiet)" stroke-width="1"/>
    <path d="${path(ref, true)}" fill="none" stroke="var(--quiet)" stroke-width="1.2" stroke-dasharray="5 4"/>
    <path d="${path(tri, true)}" fill="var(--accent-soft)" fill-opacity="0.35" stroke="var(--accent)" stroke-width="1.8"/>
    ${tri.map(([x, y], i) => `<circle cx="${X(x)}" cy="${Y(y)}" r="3.2" fill="${['#d62728', '#2ca02c', '#1f5fd6'][i]}"/>`).join('')}
    </svg><div class="legend"><span class="key"><svg width="24" height="10" aria-hidden="true"><line x1="1" x2="23" y1="5" y2="5" stroke="var(--accent)" stroke-width="2"/></svg>${escapeHtml(label)}</span>
    <span class="key"><svg width="24" height="10" aria-hidden="true"><line x1="1" x2="23" y1="5" y2="5" stroke="var(--quiet)" stroke-dasharray="5 4"/></svg>CIE 1931 (2°)</span></div>`;
}
function trcPlot(m: MatrixTrc): string {
  const W = 300, H = 300, l0 = 40, top = 12, pw = W - l0 - 10, ph = H - top - 36;
  const X = (x: number) => l0 + x * pw, Y = (y: number) => top + ph - y * ph;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const line = (c: number[], color: string) => `<path d="${c.map((v, i) => `${i ? 'L' : 'M'}${X(i / (c.length - 1)).toFixed(1)} ${Y(v).toFixed(1)}`).join('')}" fill="none" stroke="${color}" stroke-width="1.6"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Tone curves">
    ${ticks.map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + ph}" stroke="var(--line)"/><text x="${X(t)}" y="${top + ph + 14}" text-anchor="middle">${t}</text>`).join('')}
    ${ticks.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${H - 4}" text-anchor="middle">code value</text><text x="${l0 + 6}" y="${top + 12}">drive</text>
    ${line(m.trc[0], '#d62728')}${line(m.trc[1], '#2ca02c')}${line(m.trc[2], '#1f5fd6')}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Render

let gen = 0;
let files: { display?: Uint8Array; displayXml?: string; observer?: Uint8Array; observerXml?: string; v4?: Uint8Array; name: string; obsName: string } = { name: '', obsName: '' };
let runCsv = '';
const cache = new Map<string, Promise<Uint8Array>>();
const cached = (key: string, make: () => Promise<Uint8Array>) => { if (!cache.has(key)) cache.set(key, make().catch((e) => { cache.delete(key); throw e; })); return cache.get(key)!; };
const keyOf = (d: Display) => (d === ownDisplay ? `own:${$<HTMLTextAreaElement>('ownSpectra').value.length}:${$<HTMLSelectElement>('ownTone').value}:${$<HTMLInputElement>('ownGamma').value}:${$<HTMLTextAreaElement>('ownToneTable').value.length}:${d.name}` : d.name);
const obsKey = (o: Observer) => `${o.name}:${o.curves[1].slice(20, 23).join(',')}`;
const displayIcc = (d: Display) => cached(`d|${keyOf(d)}`, () => build(displayProfileXml(d), `the profile of ${d.name}`));
const observerIcc = (d: Display, v: View) => cached(`o|${keyOf(d)}|${obsKey(v.observer)}`, () => build(observerProfileXml(d, v, `${v.observer.name}, with the white of ${d.name}`), 'the observer\'s profile'));

async function render(): Promise<void> {
  const me = ++gen;
  const stale = () => me !== gen;
  // section 1
  const d = displayOf(displaySelect.value);
  if (!d) {
    $('displaySource').textContent = 'Paste your display\'s spectra below, or choose a built-in display.';
    for (const k of ['displayPlot', 'v4Table', 'v4Gamut', 'v4Curves', 'sameTable', 'pairTable', 'pairPlot', 'pairSwatches', 'runTable']) $(k).replaceChildren();
    return;
  }
  drawDisplay(d);
  // section 2
  let obs: Observer;
  try { obs = picker.get().observer; $('observerStatus').className = 'note'; $('observerStatus').textContent = obs.name; } catch (e) {
    $('observerStatus').className = 'error'; $('observerStatus').textContent = `Cannot use this observer: ${message(e)}.`; return;
  }
  let v: View, ref: View;
  try { v = viewOn(d, obs); ref = viewOn(d, observers.cie1931); } catch (e) {
    $('observerStatus').className = 'error'; $('observerStatus').textContent = `Cannot use this observer with this display: ${message(e)}.`; return;
  }
  // section 4, on this display (the page's own numbers)
  renderSame(d, ref);

  try {
    const dsp = await displayIcc(d);
    const obsIcc = await observerIcc(d, v);
    if (stale()) return;
    files = { display: dsp, displayXml: displayProfileXml(d), observer: obsIcc, observerXml: observerProfileXml(d, v, `${obs.name}, with the white of ${d.name}`), name: d.name, obsName: obs.name };
    // section 3
    const conv = await tool('iccV5DspObsToV4Dsp', ['display.icc', 'observer.icc', 'v4.icc'], { 'display.icc': dsp, 'observer.icc': obsIcc }, ['v4.icc']);
    if (stale()) return;
    if (conv.code !== 0 || !conv.files['v4.icc']) throw new Error(`iccV5DspObsToV4Dsp: ${conv.output.trim()}`);
    files.v4 = conv.files['v4.icc'];
    const refIcc = await observerIcc(d, ref);
    const refConv = await tool('iccV5DspObsToV4Dsp', ['display.icc', 'observer.icc', 'v4.icc'], { 'display.icc': dsp, 'observer.icc': refIcc }, ['v4.icc']);
    if (stale()) return;
    renderV4(readMatrixTrc(files.v4), refConv.files['v4.icc'] ? readMatrixTrc(refConv.files['v4.icc']) : undefined, obs.name);
    $('v4Commands').textContent = [
      'iccFromXml display.xml display.icc', 'iccFromXml observer.xml observer.icc', 'iccV5DspObsToV4Dsp display.icc observer.icc v4.icc',
      `  ${conv.output.trim()}`,
    ].join('\n');
    const dump = await tool('iccDumpProfile', ['v4.icc', 'ALL'], { 'v4.icc': files.v4 });
    if (stale()) return;
    $('v4Dump').textContent = dump.output.replace(/^\s*Built with[^\n]*\n/, '');
    // section 4, on a second display; section 5
    await renderPair(d, ref, dsp, stale);
    if (stale()) return;
    await renderRun(dsp, obsIcc, files.v4, stale);
  } catch (e) {
    if (stale()) return;
    $('v4Table').innerHTML = `<p class="error">${escapeHtml(message(e))}</p>`;
  }
}

function renderV4(m: MatrixTrc, r: MatrixTrc | undefined, name: string): void {
  const row = (label: string, a: Vec3, b?: Vec3) => `<tr><th>${label}</th>${a.map((x) => `<td>${fmt(x)}</td>`).join('')}${x_y(a).map((x) => `<td>${fmt(x)}</td>`).join('')}${b ? x_y(b).map((x) => `<td>${fmt(x)}</td>`).join('') : ''}</tr>`;
  $('v4Table').innerHTML = `<div class="table-wrap"><table><thead><tr><th></th><th>X</th><th>Y</th><th>Z</th><th>x</th><th>y</th>${r ? '<th>x, CIE 1931</th><th>y, CIE 1931</th>' : ''}</tr></thead><tbody>
    ${row('Red', m.red, r?.red)}${row('Green', m.green, r?.green)}${row('Blue', m.blue, r?.blue)}${row('White', m.white, r?.white)}</tbody></table></div>
    <p class="note">Version ${m.version}, for ${escapeHtml(name)}.</p>`;
  $('v4Gamut').innerHTML = gamutPlot([m.red, m.green, m.blue].map(x_y), r ? [r.red, r.green, r.blue].map(x_y) : [], name);
  $('v4Curves').innerHTML = trcPlot(m);
}

/** Section 4, on this display: each observer's WLab of the 27 colors against the CIE 1931 observer's. */
function renderSame(d: Display, ref: View): void {
  const refW = CUBE.map((c) => ref.wlabOf(c));
  const rows = manyTicked().map(([label, o]) => {
    try {
      const v = viewOn(d, o), de = CUBE.map((c, i) => deltaEWlab(v.wlabOf(c), refW[i]));
      return `<tr><td class="name">${escapeHtml(label)}</td><td>${fmt(de.reduce((s, x) => s + x, 0) / de.length, 2)}</td><td>${fmt(Math.max(...de), 2)}</td></tr>`;
    } catch (e) { return `<tr><td class="name">${escapeHtml(label)}</td><td colspan="2" class="error">${escapeHtml(message(e))}</td></tr>`; }
  });
  $('sameTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Observer</th><th>Mean ΔE<sub>WLab</sub></th><th>Largest</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  $('sameNote').innerHTML = 'ΔE<sub>WLab</sub> of each color, as each observer sees it on this display, from the same color as the CIE 1931 observer sees it; the mean over the 27 colors and the largest.';
}

/** Section 4, on a second display matched for the CIE 1931 observer (by iccApplyNamedCmm, relative colorimetric). */
async function renderPair(d: Display, ref: View, dsp: Uint8Array, stale: () => boolean): Promise<void> {
  const d2 = BUILT_IN_DISPLAYS[Number(secondSelect.value)] ?? BUILT_IN_DISPLAYS[0];
  const ref2 = viewOn(d2, observers.cie1931);
  const dsp2 = await displayIcc(d2), refIcc = await observerIcc(d, ref), refIcc2 = await observerIcc(d2, ref2);
  // through the standard PCS (CIELAB, D50) in two runs: a direct link between two version 5 display profiles is made
  // by iccDEV without converting between their viewing conditions (iccDEV 2.3.28), which would not take each
  // display's white as white
  const toLab = await tool('iccApplyNamedCmm', ['colors.txt', '3', '0', 'a.icc', '1', '-pcc', 'a-cie1931.icc', 'lab.icc', '1'],
    { 'colors.txt': dataFile(CUBE), 'a.icc': dsp, 'a-cie1931.icc': refIcc, 'lab.icc': LAB_ICC });
  if (stale()) return;
  if (toLab.code !== 0) throw new Error(`iccApplyNamedCmm: ${toLab.output.trim()}`);
  const labData = `'Lab '\t; Data Format\nicEncodeFloat\t; Encoding\n\n${outRows(toLab.output).map((r) => r.map((x) => x.toFixed(6)).join(' ')).join('\n')}\n`;
  const r = await tool('iccApplyNamedCmm', ['lab.txt', '3', '0', 'lab.icc', '1', 'b.icc', '1', '-pcc', 'b-cie1931.icc'],
    { 'lab.txt': labData, 'lab.icc': LAB_ICC, 'b.icc': dsp2, 'b-cie1931.icc': refIcc2 });
  if (stale()) return;
  if (r.code !== 0) throw new Error(`iccApplyNamedCmm: ${r.output.trim()}`);
  const matched = outRows(r.output);
  // a match needs code values of 0 to 1 on the second display; outside, the color is beyond its reach
  const inside = matched.map((m) => m.every((x) => x >= -2e-4 && x <= 1 + 2e-4));
  const clip = (m: number[]) => m.map((x) => Math.max(0, Math.min(1, x)));
  const ticked = manyTicked();
  const seenSel = $<HTMLSelectElement>('seenBy');
  const keep = seenSel.value;
  seenSel.innerHTML = ['CIE 1931 (2°)', ...ticked.map(([t]) => t)].map((t) => `<option>${escapeHtml(t)}</option>`).join('');
  seenSel.value = [...seenSel.options].some((o) => o.value === keep) ? keep : (ticked[0]?.[0] ?? 'CIE 1931 (2°)');
  const all: [string, Observer][] = [['CIE 1931 (2°)', observers.cie1931], ...ticked];
  const idx = CUBE.map((_, i) => i).filter((i) => inside[i]);
  const rows = all.map(([label, o]) => {
    const va = viewOn(d, o), vb = viewOn(d2, o);
    const de = idx.map((i) => deltaEWlab(va.wlabOf(CUBE[i]), vb.wlabOf(clip(matched[i]))));
    return { label, va, vb, de };
  });
  $('pairTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Observer</th><th>Mean ΔE<sub>WLab</sub></th><th>Largest</th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td class="name">${escapeHtml(x.label)}</td><td>${x.de.length ? fmt(x.de.reduce((s, y) => s + y, 0) / x.de.length, 2) : '–'}</td><td>${x.de.length ? fmt(Math.max(...x.de), 2) : '–'}</td></tr>`).join('')}</tbody></table></div>`;
  const seen = rows.find((x) => x.label === seenSel.value) ?? rows[0];
  const a = idx.map((i) => seen.va.wlabOf(CUBE[i])), b = idx.map((i) => seen.vb.wlabOf(clip(matched[i])));
  const css = (w: Vec3) => `rgb(${wlabToRgb(w).map((x) => Math.round(255 * Math.max(0, Math.min(1, x)))).join(',')})`;
  $('pairPlot').innerHTML = scatter({
    xLabel: 'aw', yLabel: 'bw', x: [-60, 60], y: [-60, 60], square: true, outline: true,
    sets: [
      { pts: a.map((w) => [w[1], w[2]]), color: 'var(--ink)', label: `${d.name}`, ring: true, titles: idx.map((i) => `${rgbName(CUBE[i])} on ${d.name}`) },
      { pts: b.map((w) => [w[1], w[2]]), color: 'var(--accent)', label: `${d2.name}, matched for CIE 1931`, colors: b.map(css), titles: idx.map((i) => `${rgbName(CUBE[i])} matched on ${d2.name}: ${rgbName(clip(matched[i]))}`) },
    ],
    links: a.map((w, k) => [w[1], w[2], b[k][1], b[k][2]]),
  });
  $('pairSwatches').innerHTML = `<p class="note">As ${escapeHtml(seen.label)} sees them (sRGB, approximate): each color on ${escapeHtml(d.name)} (left half) and matched on ${escapeHtml(d2.name)} (right half).</p>
    <div class="swatches tiles">${idx.map((i, k) => `<div class="swatch" title="${escapeHtml(rgbName(CUBE[i]))}"><div style="background:linear-gradient(90deg, ${css(a[k])} 50%, ${css(b[k])} 50%)"></div></div>`).join('')}</div>`;
  const out = CUBE.length - idx.length;
  $('pairNote').innerHTML = `In the plot, a ring is a color on the first display and a dot its match on the second, joined by a line, in the WLab of the observer chosen. The match is made by iccApplyNamedCmm, from the first display to CIELAB in the standard PCS and from there to the second, each display's profile with the CIE 1931 observer's profile as its viewing conditions (relative colorimetric). ${out ? `${out} of the 27 colors lie beyond the second display's reach and are left out. ` : ''}ΔE<sub>WLab</sub> between each color on the first display and its match on the second, as each observer sees them; for the CIE 1931 observer it is the match's own error.`;
}

/** Section 5: the pasted colors through iccApplyNamedCmm. */
async function renderRun(dsp: Uint8Array, obsIcc: Uint8Array, v4: Uint8Array, stale: () => boolean): Promise<void> {
  let rgbs: number[][];
  try {
    const lines = $<HTMLTextAreaElement>('runColors').value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    rgbs = lines.map((l) => { const v = l.split(/[\s,;]+/).map(Number); if (v.length < 3 || v.slice(0, 3).some(Number.isNaN)) throw new Error(`not three numbers: "${l}"`); return v.slice(0, 3); });
    if (!rgbs.length) throw new Error('give at least one color');
    if (rgbs.some((r) => r.some((x) => x > 1))) rgbs = rgbs.map((r) => r.map((x) => x / 255));
  } catch (e) { $('runTable').innerHTML = `<p class="error">Cannot read the colors: ${escapeHtml(message(e))}.</p>`; return; }
  const intent = $<HTMLSelectElement>('intent').value;
  const toLab = await tool('iccApplyNamedCmm', ['colors.txt', '3', '0', 'display.icc', intent, '-pcc', 'observer.icc', 'lab.icc', intent], { 'colors.txt': dataFile(rgbs), 'display.icc': dsp, 'observer.icc': obsIcc, 'lab.icc': LAB_ICC });
  const viaV4 = await tool('iccApplyNamedCmm', ['colors.txt', '3', '0', 'v4.icc', intent, 'lab.icc', intent], { 'colors.txt': dataFile(rgbs), 'v4.icc': v4, 'lab.icc': LAB_ICC });
  if (stale()) return;
  if (toLab.code !== 0) throw new Error(`iccApplyNamedCmm: ${toLab.output.trim()}`);
  const labs = outRows(toLab.output), labs4 = viaV4.code === 0 ? outRows(viaV4.output) : [];
  const labData = `'Lab '\t; Data Format\nicEncodeFloat\t; Encoding\n\n${labs.map((r) => r.map((x) => x.toFixed(6)).join(' ')).join('\n')}\n`;
  const back = await tool('iccApplyNamedCmm', ['lab.txt', '3', '0', 'lab.icc', intent, 'display.icc', intent, '-pcc', 'observer.icc'], { 'lab.txt': labData, 'display.icc': dsp, 'observer.icc': obsIcc, 'lab.icc': LAB_ICC });
  if (stale()) return;
  const backs = back.code === 0 ? outRows(back.output) : [];
  const rows = rgbs.map((c, i) => {
    const l5 = labs[i] as Vec3, l4 = labs4[i] as Vec3 | undefined, bk = backs[i];
    return { c, l5, l4, de: l4 ? deltaE00(l5, l4) : NaN, bk, err: bk ? Math.max(...bk.map((x, k) => Math.abs(x - c[k]))) : NaN };
  });
  $('runTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>R, G, B</th><th>L*</th><th>a*</th><th>b*</th><th>L*, v4</th><th>a*, v4</th><th>b*, v4</th><th>ΔE<sub>00</sub></th><th>Back to R, G, B</th><th>Back</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${rgbName(r.c)}</td>${r.l5.map((x) => `<td>${fmt(x, 2)}</td>`).join('')}${r.l4 ? r.l4.map((x) => `<td>${fmt(x, 2)}</td>`).join('') : '<td colspan="3">–</td>'}<td>${Number.isNaN(r.de) ? '–' : fmt(r.de, 3)}</td><td>${r.bk ? r.bk.map((x) => fmt(x, 4)).join(', ') : '–'}</td><td>${Number.isNaN(r.err) ? '–' : r.err.toExponential(1)}</td></tr>`).join('')}</tbody></table></div>`;
  runCsv = ['R,G,B,L*,a*,b*,L* (v4),a* (v4),b* (v4),dE00,R back,G back,B back', ...rows.map((r) => [...r.c, ...r.l5, ...(r.l4 ?? ['', '', '']), r.de, ...(r.bk ?? ['', '', ''])].map(String).join(','))].join('\n');
  $('runCommands').textContent = [
    `iccApplyNamedCmm colors.txt 3 0 display.icc ${intent} -pcc observer.icc lab.icc ${intent}`,
    `iccApplyNamedCmm colors.txt 3 0 v4.icc ${intent} lab.icc ${intent}`,
    `iccApplyNamedCmm lab.txt 3 0 lab.icc ${intent} display.icc ${intent} -pcc observer.icc`,
    '', 'lab.icc: CIELAB in the standard PCS (CIE 1931, 2°, under D50), floating point (the Observers lab\'s encoding profile).',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Wiring

displaySelect.addEventListener('change', () => { if (displaySelect.value === OWN) ($('ownBox') as HTMLDetailsElement).open = true; schedule(); });
secondSelect.addEventListener('change', schedule);
$('seenBy').addEventListener('change', schedule);
$('manyObservers').addEventListener('change', schedule);
$('intent').addEventListener('change', schedule);
$('runColors').addEventListener('input', schedule);
const ownChanged = () => {
  $('gammaBox').hidden = $<HTMLSelectElement>('ownTone').value !== 'gamma';
  $('toneTableBox').hidden = $<HTMLSelectElement>('ownTone').value !== 'table';
  readOwn();
  if (ownDisplay && displaySelect.value !== OWN) displaySelect.value = OWN;
  schedule();
};
for (const id of ['ownSpectra', 'ownName', 'ownGamma', 'ownToneTable']) $(id).addEventListener('input', ownChanged);
$('ownTone').addEventListener('change', ownChanged);
const safe = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '');
$('displayIcc').addEventListener('click', () => { if (files.display) download(`${safe(files.name)}-v5.icc`, files.display, 'application/vnd.iccprofile'); });
$('displayXml').addEventListener('click', () => { if (files.displayXml) download(`${safe(files.name)}-v5.xml`, files.displayXml, 'application/xml'); });
$('v4Icc').addEventListener('click', () => { if (files.v4) download(`${safe(files.name)}-${safe(files.obsName)}-v4.icc`, files.v4, 'application/vnd.iccprofile'); });
$('obsIcc').addEventListener('click', () => { if (files.observer) download(`${safe(files.obsName)}-observer.icc`, files.observer, 'application/vnd.iccprofile'); });
$('obsXml').addEventListener('click', () => { if (files.observerXml) download(`${safe(files.obsName)}-observer.xml`, files.observerXml, 'application/xml'); });
$('runCsv').addEventListener('click', () => { if (runCsv) download('colors-through-profiles.csv', runCsv, 'text/csv'); });
$('toolStatus').textContent = 'iccDEV\'s tools load when first needed.';
readOwn();
schedule();

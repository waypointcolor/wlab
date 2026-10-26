// Lab C: materials (reflectances) across many lights and observers: each material's shifts from a reference condition
// (its raw Wpt shift manifold), and pairs compared condition by condition.
// Bundled into labs/objects.html by scripts/build-web.mjs.
//
// N observers × M lights make N·M observing conditions, each with its own Wpt normalization. They are built once
// and kept (NormalizationCache), in slices so that the page stays responsive, and only when there are few of them
// without asking: changing the materials, the sliders or the plots needs no new normalization.

import {
  categoricalObserver, categoricalObserverAges, cie2006, daylight, illuminants, munsell1600, observers, observersN, planckian,
  resample, wlabToRgb, type IlluminantName, type Observer, type ObserverName, type Spectrum, type Vec3,
  type WptNormalizationN,
} from '../../src/index.ts';
import { pairs as demoPairs } from '../demo-data.ts';
import { example as brandRed } from '../example.ts';
import {
  $, cloud3d, download, escapeHtml, histogram, LIGHT_LABEL, OBSERVER_LABEL, parseTable, scatter, spectrumPlot, viewGroup, type ViewGroup,
} from './kit.ts';
import {
  cloudsOf, copyEntry, materialsOf, NormalizationCache, pairIndices, pairsOf, readMaterials, summary, syncEntries, writeMaterials,
  type Cloud, type Entry, type Layout, type Material, type ObservingCondition, type PairMode,
} from './shifts.ts';

/** Conditions normalized without asking; above this the page shows the count and a Compute button. */
const AUTO = 3000;
/** Microseconds per normalization, for the estimate shown before a large computation. */
const US_PER_NORMALIZATION = 60;
const PALETTE = ['#0b72b9', '#d9690f', '#2a9d5c', '#9b3fb5', '#c9302c', '#a07d00', '#0098a8', '#7a7a7a', '#d6337a', '#4a5fb0'];
const MAX_PLOTTED = PALETTE.length;

const cache = new NormalizationCache();
const message = (e: unknown) => (e as Error).message;
let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(() => void update(false), 0); };
let run = 0;
// the CSV files are written when they are downloaded, not on every change: with many conditions they are long
let pointsCsv: (() => string) | undefined, pairsCsv: (() => string) | undefined;
// the materials in use: each given reflectance and the copies made of it, each with its own scale and shift
let entries: Entry[] = [];

// ---------------------------------------------------------------------------------------------------------------
// The lights and observers to choose from

interface Choice { value: string; label: string; checked?: boolean }
const LIGHT_CHOICES: Choice[] = [
  ...(Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k) => ({ value: k, label: LIGHT_LABEL[k], checked: true })),
  { value: 'candle', label: 'Candlelight (Planckian, 1850 K)' },
  { value: 'daylightSeries', label: 'CIE daylight from 4000 to 10000 K, every 500 K (13 lights)' },
  { value: 'planckianSeries', label: 'Planckian from 2000 to 6500 K, every 500 K (10 lights)' },
  { value: 'paste', label: 'Your own light (paste)…' },
];
const OBSERVER_CHOICES: Choice[] = [
  ...(Object.keys(OBSERVER_LABEL) as ObserverName[]).map((k) => ({ value: k, label: OBSERVER_LABEL[k], checked: k === 'cie1931' || k === 'cie1964' })),
  { value: 'rods', label: 'CIE 2006 (10°) cones plus rods (4 sensors)' },
  { value: 'categorical', label: 'The 10 categorical observers of Asano and Fairchild', checked: true },
  { value: 'sweep', label: 'The CIE 2006 model over ages and field sizes (below)' },
  { value: 'paste', label: 'Your own observer (paste)…' },
];

function checkboxes(host: HTMLElement, choices: Choice[]): void {
  host.innerHTML = choices.map((c) => `<label><input type="checkbox" value="${c.value}"${c.checked ? ' checked' : ''}> ${escapeHtml(c.label)}</label>`).join('');
}
const checked = (id: string) => new Set([...$(id).querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value));

/** A short fingerprint of pasted text, so that a pasted light or observer keeps its normalizations while unchanged. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const observerCache = new Map<string, Observer>();
const memo = (key: string, make: () => Observer) => { let o = observerCache.get(key); if (!o) { o = make(); observerCache.set(key, o); } return o; };

interface Named<T> { key: string; label: string; value: T }

function chosenLights(): Named<Spectrum>[] {
  const on = checked('lights'), out: Named<Spectrum>[] = [];
  for (const k of Object.keys(LIGHT_LABEL) as IlluminantName[]) if (on.has(k)) out.push({ key: k, label: k, value: illuminants[k] });
  if (on.has('candle')) out.push({ key: 'candle', label: 'candlelight (1850 K)', value: planckian(1850) });
  if (on.has('daylightSeries')) for (let t = 4000; t <= 10000; t += 500) out.push({ key: `day${t}`, label: `daylight ${t} K`, value: daylight(t) });
  if (on.has('planckianSeries')) for (let t = 2000; t <= 6500; t += 500) out.push({ key: `planck${t}`, label: `Planckian ${t} K`, value: planckian(t) });
  const lightText = $<HTMLTextAreaElement>('lightPaste').value;
  if (on.has('paste') && lightText.trim()) {
    const text = lightText;
    const t = parseTable(text, 1);
    const spd = resample(t.nm, t.columns[0]);
    if (spd.some((v) => v < 0) || !spd.some((v) => v > 0)) throw new Error('your light needs positive power');
    out.push({ key: `paste:${hash(text)}`, label: 'your light', value: spd });
  }
  return out;
}

function chosenObservers(): Named<Observer>[] {
  const on = checked('observers'), out: Named<Observer>[] = [];
  for (const k of Object.keys(OBSERVER_LABEL) as ObserverName[]) if (on.has(k)) out.push({ key: k, label: OBSERVER_LABEL[k], value: observers[k] });
  if (on.has('rods')) out.push({ key: 'rods', label: 'CIE 2006 (10°) cones plus rods', value: observersN.cie2006_10_rods });
  if (on.has('categorical')) {
    const field = Number($<HTMLInputElement>('catField').value);
    if (!(field >= 1 && field <= 10)) throw new Error('the categorical observers need a field size from 1 to 10°');
    categoricalObserverAges.forEach((age, i) => out.push({
      key: `cat${i + 1}@${field}`, label: `categorical observer ${i + 1} (${age} years, ${field}°)`,
      value: memo(`cat${i + 1}@${field}`, () => categoricalObserver(i + 1, field)),
    }));
  }
  if (on.has('sweep')) {
    const step = Number($<HTMLSelectElement>('ageStep').value), fields = $<HTMLSelectElement>('fieldSet').value.split(',').map(Number);
    for (const field of fields) for (let age = 20; age <= 80; age += step) {
      out.push({ key: `cie2006@${field}/${age}`, label: `CIE 2006, ${age} years, ${field}°`, value: memo(`cie2006@${field}/${age}`, () => cie2006(field, age)) });
    }
  }
  const obsText = $<HTMLTextAreaElement>('obsPaste').value;
  if (on.has('paste') && obsText.trim()) {
    const text = obsText;
    const t = parseTable(text, 3);
    out.push({ key: `paste:${hash(text)}`, label: 'your observer', value: { name: 'Your observer', curves: t.columns.map((c) => resample(t.nm, c)) as unknown as Observer['curves'] } });
  }
  return out;
}

function referenceCondition(): ObservingCondition {
  const o = $<HTMLSelectElement>('refObserver').value as ObserverName, l = $<HTMLSelectElement>('refLight').value as IlluminantName;
  return { key: `${o}|${l}`, observerLabel: OBSERVER_LABEL[o], lightLabel: l, observer: observers[o], light: illuminants[l] };
}

// ---------------------------------------------------------------------------------------------------------------
// Computing and showing

const f2 = (v: number) => v.toFixed(2);
const where = (c: ObservingCondition) => `${c.observerLabel}, ${c.lightLabel}`;

/** A chip: the material's display color from its WLab (as under D65), clipped where it is outside sRGB. */
function chip(w: Vec3): string {
  const rgb = wlabToRgb(w);
  const outside = rgb.some((v) => v < 0 || v > 1);
  const c = rgb.map((v) => Math.round(255 * Math.min(1, Math.max(0, v))));
  return `<span class="chip" style="background:rgb(${c.join(',')})"${outside ? ' title="outside sRGB: shown clipped"' : ''}></span>`;
}

function clear(ids: string[]): void { for (const k of ids) $(k).replaceChildren(); }
const RESULTS = ['summary', 'table', 'plotPlane', 'plotPositions', 'pairsSummary', 'pairsTable', 'pairsHist'];

async function update(force: boolean): Promise<void> {
  const id = ++run;
  const status = (elId: string, text: string, error = false) => { $(elId).className = error ? 'error' : 'note'; $(elId).textContent = text; };
  // the materials
  let materials: Material[];
  const text = $<HTMLTextAreaElement>('materials').value;
  if (!text.trim()) {
    status('materialsStatus', 'Paste reflectances, import a file, or try one of the examples.');
    clear([...RESULTS, 'entries', 'spectra']); clearPlot3d(); pointsCsv = pairsCsv = undefined;
    entries = []; entriesShape = '';
    materials = [];
  } else {
    let base: Material[];
    try { base = readMaterials(text, orient()); } catch (e) { status('materialsStatus', `Cannot read the reflectances: ${message(e)}.`, true); clear(RESULTS); clearPlot3d(); return; }
    entries = syncEntries(entries, base.length);
    materials = materialsOf(base, entries);
    showEntries(base, materials);
    const copies = entries.filter((e) => e.copy).length;
    status('materialsStatus', `${base.length} reflectance${base.length === 1 ? '' : 's'} given${copies ? ` and ${copies} ${copies === 1 ? 'copy' : 'copies'}` : ''}: ${materials.length} material${materials.length === 1 ? '' : 's'} in use.`);
  }
  // the conditions: every chosen observer under every chosen light
  let conds: ObservingCondition[], lights: Named<Spectrum>[], obs: Named<Observer>[];
  try {
    lights = chosenLights(); obs = chosenObservers();
    conds = obs.flatMap((o) => lights.map((l) => ({ key: `${o.key}|${l.key}`, observerLabel: o.label, lightLabel: l.label, observer: o.value, light: l.value })));
  } catch (e) { status('count', `Cannot build the conditions: ${message(e)}.`, true); clear(RESULTS); return; }
  const missing = conds.filter((c) => !cache.has(c.key)).length;
  const seconds = (n: number) => (n * US_PER_NORMALIZATION / 1e6 < 1 ? 'under a second' : `about ${Math.ceil(n * US_PER_NORMALIZATION / 1e6)} s`);
  status('count', `${obs.length} observer${obs.length === 1 ? '' : 's'} × ${lights.length} light${lights.length === 1 ? '' : 's'} = ${conds.length} observing condition${conds.length === 1 ? '' : 's'}`
    + (missing ? `, ${missing} of them still to normalize (${seconds(missing)}).` : ', all normalized.'));
  $('count').className = 'count';
  if (!conds.length) { status('progress', 'Choose at least one light and one observer.'); clear(RESULTS); clearPlot3d(); return; }
  const big = missing > AUTO && !force;
  $('compute').hidden = !big;
  if (big) { status('progress', 'Many new conditions: press Compute to normalize them.'); return; }
  if (!materials.length) { status('progress', ''); return; }

  // the normalizations, in slices so that the page stays responsive; a newer update stops this one
  const t0 = performance.now();
  let slice = t0;
  const norms: WptNormalizationN[] = [];
  try {
    for (let i = 0; i < conds.length; i++) {
      norms.push(cache.get(conds[i]));
      if (performance.now() - slice > 40) {
        status('progress', `Normalizing: ${i + 1} of ${conds.length} conditions…`);
        await new Promise((r) => setTimeout(r, 0));
        if (id !== run) return;
        slice = performance.now();
      }
    }
  } catch (e) { status('progress', `Cannot normalize ${where(conds[norms.length])}: ${message(e)}.`, true); clear(RESULTS); return; }
  if (id !== run) return;
  const ref = referenceCondition();
  const clouds = cloudsOf(materials, norms, cache.get(ref));
  status('progress', missing ? `Normalized ${missing} new conditions in ${((performance.now() - t0) / 1000).toFixed(2)} s.` : '');
  if (missing) status('count', `${obs.length} observer${obs.length === 1 ? '' : 's'} × ${lights.length} light${lights.length === 1 ? '' : 's'} = ${conds.length} observing condition${conds.length === 1 ? '' : 's'}, all normalized.`);
  $('count').className = 'count';
  $('compute').hidden = true;
  showMaterials(clouds, conds, ref);
  showManifolds(clouds, conds);
  showPairs(clouds, conds, ref);
}

function showMaterials(clouds: Cloud[], conds: ObservingCondition[], ref: ObservingCondition): void {
  $('summary').textContent = `${clouds.length} material${clouds.length === 1 ? '' : 's'} in ${conds.length} observing condition${conds.length === 1 ? '' : 's'}; the reference is ${where(ref)}.`;
  const rows = clouds.map((cl) => {
    const s = summary(cl.points.map((p) => p.dE));
    return `<tr><td>${escapeHtml(cl.material.name)}</td><td>${chip(cl.refWlab)}</td>${cl.refWlab.map((v, i) => `<td${i ? '' : ' class="sep"'}>${f2(v)}</td>`).join('')}
      <td class="sep">${f2(s.mean)}</td><td>${f2(s.median)}</td><td>${f2(s.max)}</td><td class="where">${escapeHtml(where(conds[s.argmax]))}</td></tr>`;
  }).join('');
  $('table').innerHTML = `<table><thead>
    <tr><th></th><th></th><th class="sep" colspan="3">In the reference condition</th><th class="sep" colspan="4">ΔE<sub>WLab</sub> from the reference, over the conditions</th></tr>
    <tr><th>Name</th><th>Color</th><th class="sep">L<sub>w</sub></th><th>a<sub>w</sub></th><th>b<sub>w</sub></th><th class="sep">mean</th><th>median</th><th>largest</th><th>where it is largest</th></tr>
    </thead><tbody>${rows}</tbody></table>`;
  const n = (v: number) => v.toFixed(4);
  pointsCsv = () => [['material', 'observer', 'light', 'W', 'p', 't', 'Lw', 'aw', 'bw', 'dW', 'dp', 'dt', 'dLw', 'daw', 'dbw', 'DeltaE_WLab_from_reference'].join(','),
    ...clouds.flatMap((cl) => cl.points.map((p, k) => [cl.material.name, conds[k].observerLabel, conds[k].lightLabel].map((s) => `"${s.replace(/"/g, '""')}"`)
      .concat([...p.wpt, ...p.wlab, ...p.dWpt, ...p.dWlab, p.dE].map(n)).join(',')))].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// The materials in use

let entriesShape = '';
const scaleText = (v: number) => `× ${v.toFixed(2)}`;
const shiftText = (v: number) => `${v < 0 ? '−' : '+'} ${Math.abs(v).toFixed(2)}`;

/** The list of materials in use, each with its scale and shift; rebuilt only when materials come or go, so that a slider being dragged stays. */
function showEntries(base: Material[], materials: Material[]): void {
  const shape = entries.map((e) => `${e.source}${e.copy ? 'c' : ''}`).join(',') + '|' + base.map((m) => m.name).join('|');
  if (shape !== entriesShape) {
    entriesShape = shape;
    $('entries').innerHTML = `<table class="entries"><thead><tr><th></th><th>Material</th><th>Scale</th><th>Shift</th><th></th></tr></thead><tbody>${entries.map((e, k) => `
      <tr data-k="${k}"><td><span class="dot" style="background:${PALETTE[k] ?? 'var(--line)'}"></span></td><td class="name"></td>
      <td><input type="range" data-f="scale" min="0.1" max="1.5" step="0.05" value="${e.scale}" aria-label="scale"> <span data-v="scale"></span></td>
      <td><input type="range" data-f="shift" min="-0.5" max="0.5" step="0.01" value="${e.shift}" aria-label="shift"> <span data-v="shift"></span></td>
      <td><button data-act="copy">Copy</button> <button data-act="reset">Reset</button>${e.copy ? ' <button data-act="remove">Remove</button>' : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  $('entries').querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr, k) => {
    tr.querySelector('.name')!.textContent = materials[k].name;
    tr.querySelector('[data-v="scale"]')!.textContent = scaleText(entries[k].scale);
    tr.querySelector('[data-v="shift"]')!.textContent = shiftText(entries[k].shift);
  });
  const shown = materials.slice(0, MAX_PLOTTED);
  $('spectra').innerHTML = spectrumPlot('Reflectances of the materials in use', shown.map((m, i) => ({ values: m.reflectance, color: PALETTE[i], label: m.name })))
    + (materials.length > MAX_PLOTTED ? `<p class="note">The first ${MAX_PLOTTED} of ${materials.length} materials.</p>` : '');
}

$('entries').addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement, tr = input.closest('tr');
  if (!tr || !input.dataset.f) return;
  const k = Number(tr.dataset.k);
  entries[k] = { ...entries[k], [input.dataset.f]: Number(input.value) };
  schedule();
});
$('entries').addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest('button'), tr = button?.closest('tr');
  if (!button || !tr) return;
  const k = Number(tr.dataset.k);
  if (button.dataset.act === 'copy') entries = copyEntry(entries, k);
  else if (button.dataset.act === 'remove') entries = entries.filter((_, j) => j !== k);
  else { entries[k] = { ...entries[k], scale: 1, shift: 0 }; entriesShape = ''; }
  schedule();
});

let lastClouds: Cloud[] = [], lastConds: ObservingCondition[] = [];
let group: ViewGroup | undefined;
function clearPlot3d(): void { lastClouds = []; const c = $<HTMLCanvasElement>('plot3d'); c.getContext('2d')?.clearRect(0, 0, c.width, c.height); }

function showManifolds(clouds: Cloud[], conds: ObservingCondition[]): void {
  lastClouds = clouds; lastConds = conds;
  const wpt = $<HTMLSelectElement>('space').value === 'wpt';
  const shown = clouds.slice(0, MAX_PLOTTED);
  // lightness up: [p, t, W] or [a_w, b_w, L_w]
  const shift = (p: Cloud['points'][number]) => (wpt ? [p.dWpt[1], p.dWpt[2], p.dWpt[0]] : [p.dWlab[1], p.dWlab[2], p.dWlab[0]]);
  const axes: [string, string, string] = wpt ? ['Δp', 'Δt', 'ΔW'] : ['Δaw', 'Δbw', 'ΔLw'];
  const each = $<HTMLSelectElement>('layout').value === 'each';
  $('one3d').hidden = each;
  $('each3d').hidden = !each;
  $('viewScaleBox').hidden = !each;
  if (each) {
    // one view per material, turning together; on its own scale (shapes) or on one scale (sizes)
    group = viewGroup(group);
    const same = $<HTMLSelectElement>('viewScale').value === 'same';
    const extent = (cl: Cloud) => Math.max(1e-9, ...cl.points.flatMap((p) => shift(p).map(Math.abs)));
    const R = Math.max(...shown.map(extent));
    $('multiples').innerHTML = shown.map((cl, i) => `<figure><figcaption><span class="dot" style="background:${PALETTE[i]}"></span>${escapeHtml(cl.material.name)}</figcaption>
      <canvas class="cloud" aria-label="The shifts of ${escapeHtml(cl.material.name)}; drag to turn every view"></canvas></figure>`).join('');
    $('multiples').querySelectorAll('canvas').forEach((c, i) => cloud3d(c, { sets: [{ pts: shown[i].points.map(shift), color: PALETTE[i] }], axes, group, range: same ? R : undefined }));
  } else cloud3d($<HTMLCanvasElement>('plot3d'), { sets: shown.map((cl, i) => ({ pts: cl.points.map(shift), color: PALETTE[i] })), axes });
  const total = shown.reduce((s, cl) => s + cl.points.length, 0);
  const titled = total <= 4000;                                               // hover text, unless the points are many
  const tip = (cl: Cloud, k: number) => `${cl.material.name}: ${where(conds[k])}; ΔE_WLab ${f2(cl.points[k].dE)} from the reference`;
  const R = Math.max(1e-6, ...shown.flatMap((cl) => cl.points.flatMap((p) => shift(p).slice(0, 2).map(Math.abs)))) * 1.08;
  const [xl, yl] = wpt ? ['Δp', 'Δt'] : ['Δa_w', 'Δb_w'];
  if (!titled) {
    // many points: drawn on a canvas, seen straight down, rather than as thousands of SVG circles
    $('plotPlane').innerHTML = '<canvas class="cloud flat" aria-label="The shifts seen from above"></canvas>';
    cloud3d($('plotPlane').querySelector('canvas')!, {
      sets: shown.map((cl, i) => ({ pts: cl.points.map(shift), color: PALETTE[i] })),
      axes: wpt ? ['Δp', 'Δt', ''] : ['Δaw', 'Δbw', ''], fixed: { yaw: 0, pitch: Math.PI / 2 },
    });
    $('plotPlane').insertAdjacentHTML('beforeend', `<div class="legend">${shown.map((cl, i) => `<span class="key"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3" fill="${PALETTE[i]}"/></svg>${escapeHtml(cl.material.name)}</span>`).join('')}</div>`);
  } else $('plotPlane').innerHTML = scatter({
    xLabel: xl, yLabel: yl, x: [-R, R], y: [-R, R], square: true,
    sets: shown.map((cl, i) => ({ pts: cl.points.map((p) => shift(p).slice(0, 2)), color: PALETTE[i], label: cl.material.name, titles: titled ? cl.points.map((_, k) => tip(cl, k)) : undefined })),
  });
  if ($<HTMLInputElement>('positions').checked) {
    const pos = (v: Vec3) => [v[1], v[2]];
    const at = (p: Cloud['points'][number]) => pos(wpt ? p.wpt : p.wlab);
    const xs = shown.flatMap((cl) => [...cl.points.map((p) => at(p)[0]), pos(wpt ? cl.refWpt : cl.refWlab)[0]]);
    const lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.08 || 1;
    $('plotPositions').innerHTML = `<h3>Where the materials are</h3>` + scatter({
      xLabel: wpt ? 'p' : 'a_w', yLabel: wpt ? 't' : 'b_w', x: [lo - pad, hi + pad], square: true,
      sets: [
        ...shown.map((cl, i) => ({ pts: cl.points.map(at), color: PALETTE[i], label: cl.material.name, titles: titled ? cl.points.map((_, k) => tip(cl, k)) : undefined })),
        { pts: shown.map((cl) => pos(wpt ? cl.refWpt : cl.refWlab)), color: 'var(--ink)', label: 'in the reference condition', ring: true, titles: shown.map((cl) => `${cl.material.name}: the reference condition`) },
      ],
    });
  } else $('plotPositions').replaceChildren();
  $('plotNote').textContent = (clouds.length > MAX_PLOTTED ? `The plots show the first ${MAX_PLOTTED} materials; the tables and CSV files have all ${clouds.length}. ` : '')
    + (titled ? 'Hover over a point for its material and condition.' : `With ${total} points, the points carry no hover text; the CSV file has every one.`);
}

function showPairs(clouds: Cloud[], conds: ObservingCondition[], ref: ObservingCondition): void {
  const mode = $<HTMLSelectElement>('pairMode').value as PairMode;
  const results = pairsOf(clouds, pairIndices(clouds.length, mode));
  if (!results.length) {
    $('pairsSummary').textContent = 'Give two or more materials to compare them in pairs.';
    clear(['pairsTable', 'pairsHist']); pairsCsv = undefined;
    return;
  }
  const name = (i: number) => clouds[i].material.name;
  const one = conds.length === 1;
  $('pairsSummary').textContent = `${results.length} pair${results.length === 1 ? '' : 's'}, in ${conds.length} observing condition${one ? '' : 's'} and in the reference (${where(ref)}).`;
  const head = one
    ? `<th class="sep">in the reference</th><th class="sep">in ${escapeHtml(where(conds[0]))}</th>`
    : `<th class="sep">in the reference</th><th class="sep">mean</th><th>median</th><th>smallest</th><th>largest</th><th>where it is largest</th>`;
  const rows = results.map((r) => {
    const cells = one
      ? `<td class="sep">${f2(r.refDE)}</td><td class="sep">${f2(r.dE[0])}</td>`
      : (() => { const s = summary(r.dE); return `<td class="sep">${f2(r.refDE)}</td><td class="sep">${f2(s.mean)}</td><td>${f2(s.median)}</td><td>${f2(s.min)}</td><td>${f2(s.max)}</td><td class="where">${escapeHtml(where(conds[s.argmax]))}</td>`; })();
    return `<tr><td>${escapeHtml(name(r.a))}</td><td>${escapeHtml(name(r.b))}</td><td>${chip(clouds[r.a].refWlab)}${chip(clouds[r.b].refWlab)}</td>${cells}</tr>`;
  }).join('');
  $('pairsTable').innerHTML = `<table><thead>
    <tr><th></th><th></th><th></th><th class="sep" colspan="${one ? 2 : 6}">ΔE<sub>WLab</sub> between the two</th></tr>
    <tr><th>First</th><th>Second</th><th>Colors</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  const shown = results.slice(0, 6);
  $('pairsHist').innerHTML = one ? '<p class="note">With one condition, the table says it all.</p>' : histogram(
    shown.map((r) => [...r.dE].sort((x, y) => x - y)), shown.map((r) => `${name(r.a)} – ${name(r.b)}`), PALETTE,
    { xLabel: 'ΔE_WLab between the two (the last bin holds everything above)', yLabel: 'conditions' },
  ) + (results.length > 6 ? `<p class="note">The first 6 of ${results.length} pairs.</p>` : '');
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  pairsCsv = () => [['first', 'second', 'observer', 'light', 'DeltaE_WLab'].join(','),
    ...results.map((r) => [q(name(r.a)), q(name(r.b)), q(`reference: ${ref.observerLabel}`), q(ref.lightLabel), r.refDE.toFixed(4)].join(',')),
    ...results.flatMap((r) => r.dE.map((d, k) => [q(name(r.a)), q(name(r.b)), q(conds[k].observerLabel), q(conds[k].lightLabel), d.toFixed(4)].join(',')))].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Examples and inputs

const orient = () => $<HTMLSelectElement>('orient').value as Layout;
/** A table of reflectances on the package grid, laid out as chosen. */
const tableOf = (names: string[], columns: Spectrum[]) => writeMaterials(names.map((name, k) => ({ name, reflectance: columns[k] })), orient());

function example(which: string): void {
  let text: string;
  entries = [];
  if (which === 'red') text = writeMaterials(readMaterials(brandRed, 'columns'), orient());
  else if (which === 'plane') {
    // one reflectance and copies of it scaled and shifted: one spectral hue plane, seen side by side on their own scales
    const { names, reflectances } = munsell1600(false);
    text = tableOf(['Munsell 5PB 5/8'], [reflectances[names.indexOf('5PB 5/8')]]);
    entries = [{ source: 0, copy: false, scale: 1, shift: 0 },
      ...[[0.75, 0], [0.5, 0], [0.5, 0.25], [0.25, 0.5]].map(([scale, shift]) => ({ source: 0, copy: true, scale, shift }))];
    $<HTMLSelectElement>('layout').value = 'each';
    $<HTMLSelectElement>('viewScale').value = 'own';
  }
  else if (which === 'munsell') {
    const { names, reflectances } = munsell1600(false);
    const picks = ['R', 'YR', 'Y', 'GY', 'G', 'BG', 'B', 'PB', 'P', 'RP'].map((h) => `5${h} 5/6`).filter((n) => names.includes(n));
    text = tableOf(picks.map((n) => `Munsell ${n}`), picks.map((n) => reflectances[names.indexOf(n)]));
  } else {
    const p = demoPairs.find((x) => x.key === which)!;
    text = tableOf([p.a.name, `Twin of ${p.a.name}`], [resample(p.a.nm, p.a.values), resample(p.b.nm, p.b.values)]);
  }
  $<HTMLTextAreaElement>('materials').value = text;
  schedule();
}

checkboxes($('lights'), LIGHT_CHOICES);
checkboxes($('observers'), OBSERVER_CHOICES);
$<HTMLSelectElement>('refObserver').replaceChildren(...(Object.keys(OBSERVER_LABEL) as ObserverName[]).map((k) => new Option(OBSERVER_LABEL[k], k)));
$<HTMLSelectElement>('refLight').replaceChildren(...(Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k) => new Option(LIGHT_LABEL[k], k)));
$<HTMLSelectElement>('refObserver').value = 'cie1931';
$<HTMLSelectElement>('refLight').value = 'C';

function syncPasteBoxes(): void {
  $('lightPasteBox').hidden = !checked('lights').has('paste');
  $('obsPasteBox').hidden = !checked('observers').has('paste');
}
for (const id of ['lights', 'observers']) $(id).addEventListener('change', () => { syncPasteBoxes(); schedule(); });
document.querySelectorAll<HTMLButtonElement>('[data-all]').forEach((b) => b.addEventListener('click', () => {
  $(b.dataset.all!).querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.checked = i.value !== 'paste'; });
  syncPasteBoxes(); schedule();
}));
document.querySelectorAll<HTMLButtonElement>('[data-none]').forEach((b) => b.addEventListener('click', () => {
  $(b.dataset.none!).querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.checked = false; });
  syncPasteBoxes(); schedule();
}));
document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((b) => b.addEventListener('click', () => example(b.dataset.example!)));
for (const id of ['materials', 'lightPaste', 'obsPaste', 'catField', 'ageStep', 'fieldSet', 'refObserver', 'refLight', 'pairMode']) {
  $(id).addEventListener('input', schedule);
  $(id).addEventListener('change', schedule);
}
for (const id of ['space', 'positions', 'layout', 'viewScale']) $(id).addEventListener('change', () => { if (lastClouds.length) showManifolds(lastClouds, lastConds); });
$('compute').addEventListener('click', () => void update(true));
// a change of layout rewrites the table in the box, if it can be read in the layout it was in
let lastOrient = orient();
$('orient').addEventListener('change', () => {
  const box = $<HTMLTextAreaElement>('materials');
  try { if (box.value.trim()) box.value = writeMaterials(readMaterials(box.value, lastOrient), orient()); } catch { /* left as it is, to be read in the new layout */ }
  lastOrient = orient();
  schedule();
});
$<HTMLInputElement>('importFile').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) { $<HTMLTextAreaElement>('materials').value = await file.text(); schedule(); }
});
$('downloadPoints').addEventListener('click', () => { if (pointsCsv) download('wlab-shift-manifolds.csv', pointsCsv(), 'text/csv'); });
$('downloadPairs').addEventListener('click', () => { if (pairsCsv) download('wlab-pairs-by-condition.csv', pairsCsv(), 'text/csv'); });
syncPasteBoxes();
example('smurf');

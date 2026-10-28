// Lab D: a source observer converted by a MAT for an observing condition; how closely the source observer matches the
// condition's (the thesis's OME and OCE, over a library of objects and lights), the closest CIE 2006 and categorical
// observers; and the iccMAX colorimetric encoding profile that carries the converted observer.
// Bundled into labs/observer.html by scripts/build-web.mjs.

import {
  categoricalObserver, categoricalObserverAges, cie2006, daylight, deltaEsOf, deltaEWlab, fluorescents, illuminants, mulMV,
  planckian, resample, responses, wavelengths, wlabsOf, wptNormalization, wptToWlab, type IlluminantName, type Mat3, type Observer,
  type Spectrum,
} from '../../src/index.ts';
import {
  $, conditionPicker, copy, download, escapeHtml, formatMatrix, heatMap, LIGHT_LABEL, linePlot, matrixTable, MATRIX_FORMATS,
  optIn, parseTable, spectrumPlot, type Condition, type MatrixFormat,
} from './kit.ts';
import { conversions, curveRms, deltaEsAsTarget, type Conversion } from './conversions.ts';
import { fromDisk } from './fetchdata.ts';
import { encodingProfileIcc } from './iccbinary.ts';
import { OBJECT_SETS, objectsOf, ownSet, type ObjectSet } from './library.ts';
import { readObjectFile } from './objectfile.ts';
import {
  convertObserver, encodingProfileXml, isD50, standardObserverOf, STD_ILLUMINANT, type Converted, type Encoding, type Numbers,
  type ProfileOptions,
} from './encoding.ts';

// a format choice in section 3 (the MAT) and in section 5 (c2sp, s2cp), kept the same
const fmtSels = [$<HTMLSelectElement>('fmt'), $<HTMLSelectElement>('fmt2')];
for (const sel of fmtSels) {
  sel.replaceChildren(...MATRIX_FORMATS.map(([k, l]) => new Option(l, k)));
  sel.addEventListener('change', () => { for (const other of fmtSels) other.value = sel.value; });
}

let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(render, 0); };
// Lab D's observers have three sensors: a MAT, the conversions and the profile's svcn all need three
const pickSrc = conditionPicker($('source'), { observer: 'cie2006_2', light: 'E' }, schedule, { light: false, threeSensors: true });
const pickCond = conditionPicker($('condition'), { observer: 'cie1931', light: 'D50' }, schedule, { threeSensors: true });

const message = (e: unknown) => (e as Error).message;
const CURVE_COLORS = ['#c0306a', '#1f8a5b', '#2f74c0'];

let last: { src: Condition; cond: Condition; conv: Converted } | undefined;
const matrices: Record<string, { m: Mat3; name: string } | undefined> = {};

function render(): void {
  last = undefined;
  for (const k of Object.keys(matrices)) matrices[k] = undefined;
  const status = $('status');
  let src: Condition, cond: Condition, conv: Converted;
  try {
    src = pickSrc.get();
    cond = pickCond.get();
    conv = convertObserver(src.observer, cond.observer, cond.light);
  } catch (e) {
    status.className = 'error';
    status.textContent = `Cannot convert the observer: ${message(e)}.`;
    for (const id of ['mat', 'c2sp', 's2cp', 'pccNote', 'curves', 'methods', 'ome', 'metrics', 'closest', 'heat2006', 'heatCat', 'oce', 'oceTable', 'xmlPreview']) $(id).replaceChildren();
    syncButtons();
    return;
  }
  last = { src, cond, conv };
  status.className = 'note';
  status.textContent = `The MAT goes from ${src.observer.name} under ${cond.lightLabel} to ${cond.label}.`;
  matrices.mat = { m: conv.mat, name: 'M' };
  matrices.c2sp = { m: conv.c2sp, name: 'c2sp' };
  matrices.s2cp = { m: conv.s2cp, name: 's2cp' };
  $('mat').innerHTML = matrixTable(conv.mat);
  $('c2sp').innerHTML = matrixTable(conv.c2sp);
  $('s2cp').innerHTML = matrixTable(conv.s2cp);
  $('pccNote').textContent = conv.standard
    ? 'The target condition is the standard PCS\'s own, CIE 1931 (2°) under D50: the converted observer approximates it, the profile\'s PCS is the standard one, and c2sp and s2cp are the identity.'
    : `The target condition is not the standard PCS's, so the profile has a custom PCS: the converted observer under ${cond.lightLabel}. c2sp is the MAT from it to the standard PCS (CIE 1931 (2°) under D50), and s2cp the MAT back.`;
  drawCurves(cond, conv);
  void drawMetrics(src, cond);
  showProfile();
  syncButtons();
}

/** The converted observer beside the target condition's own, scaled to see the light's white the same, and how close they are. */
function drawCurves(cond: Condition, conv: Converted): void {
  const L = cond.light;
  const yOf = (c: readonly number[]) => c.reduce((s, v, i) => s + v * L[i], 0);
  const k = yOf(conv.curves[1]) / yOf(cond.observer.curves[1]);
  const target = cond.observer.curves.map((c) => c.map((v) => v * k));
  $('curves').innerHTML = spectrumPlot('The converted observer (solid) and the target condition\'s observer (dashed)', [
    ...conv.curves.map((c, i) => ({ values: c, color: CURVE_COLORS[i], label: `converted ${i + 1}` })),
    ...target.map((c, i) => ({ values: c, color: CURVE_COLORS[i], dash: '4 3', label: `${cond.observer.name} ${i + 1}` })),
  ]);
}

/** The 90th percentile of a set of values (the value 90% of the way up their sorted order, as in the other tables). */
const p90 = (v: ArrayLike<number>) => { const s = Array.from(v).sort((a, b) => a - b); return s[Math.round(0.9 * (s.length - 1))]; };

/** Section 4's ways of converting an observer: the five conversions of the thesis, side by side. */
function drawMethods(src: Condition, cond: Condition, sets: Sets): void {
  let list: Conversion[];
  try {
    list = conversions(src.observer, cond.observer, cond.light);
  } catch (e) {
    $('methods').innerHTML = `<p class="note">${escapeHtml(message(e))}.</p>`;
    return;
  }
  const R = sets.objects.reflectances;
  const rows = list.map((c) => {
    const own = deltaEsAsTarget(c.observer, cond.observer, cond.light, R);
    const over = meanOf(sets.lights.map((l) => meanOf(deltaEsAsTarget(c.observer, cond.observer, l.spd, R))));
    // the method's name on two lines: what it is, then its variant
    const name = c.id === 'wpt' ? 'Wpt based<br>(the MAT, section 3)' : escapeHtml(c.title).replace(', ', ',<br>');
    return `<tr${c.id === 'wpt' ? ' class="own"' : ''}><td>${name}</td>
      <td class="what">${escapeHtml(c.keeps)}</td><td class="sep">${(100 * curveRms(c.observer, cond.observer, cond.light)).toFixed(2)}%</td>
      <td class="sep">${f3(meanOf(own))}</td><td>${f3(p90(own))}</td><td>${f3(Math.max(...own))}</td><td class="sep">${f3(over)}</td></tr>`;
  }).join('');
  const dE = 'mean<br>ΔE<sub>WLab</sub>';
  $('methods').innerHTML = `<div class="table-wrap"><table class="methods"><thead>
    <tr><th></th><th></th><th class="sep">Curves</th><th class="sep" colspan="3">Objects, under ${escapeHtml(cond.lightLabel)}</th>
      <th class="sep">Objects,<br>${sets.lights.length} light${sets.lights.length > 1 ? 's' : ''}</th></tr>
    <tr><th>Method</th><th class="what">What it matches</th><th class="sep">RMS,<br>of peak</th><th class="sep">${dE}</th><th>90th<br>percentile</th>
      <th>largest</th><th class="sep">${dE}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The objects and lights the metrics use: the thesis's by default, the reader's own choice when opted in

interface Light { key: string; label: string; spd: Spectrum }
interface LightSet { id: string; title: string; about: string; lights(cond: Condition): Light[] }

const builtIn = (k: IlluminantName): Light => ({ key: k, label: LIGHT_LABEL[k], spd: illuminants[k] });
const FLUORESCENT: Light[] = Object.entries(fluorescents).map(([k, spd]) => ({ key: k, label: LIGHT_LABEL[k as IlluminantName] ?? `${k} (fluorescent)`, spd }));
const LEDS = (Object.keys(illuminants) as IlluminantName[]).filter((k) => k.startsWith('LED-'));

/** The reader's own lights, from files and the paste box, each with where it came from. */
let yourLights: Light[] = [];

const LIGHT_SETS: LightSet[] = [
  {
    id: 'library', title: 'Common lights: A, C, D50, D65, E, F2, F11 and the nine CIE LED lamps (16 lights)',
    about: 'The lights the other labs offer: the CIE standard illuminants, two fluorescent lamps and the white LEDs of today\'s lighting (blue- and violet-pumped phosphor whites and a red, green and blue mix).',
    lights: () => (Object.keys(LIGHT_LABEL) as IlluminantName[]).map(builtIn),
  },
  {
    id: 'thesis', title: 'D65, D50, A, E and the CIE fluorescent lights F1 to F12 (16 lights)',
    about: 'The lights the thesis computed its observer metrics under: daylight, incandescent light, equal energy and the twelve fluorescent lamp types of CIE 15, from broadband to tri-band.',
    lights: () => [...(['D65', 'D50', 'A', 'E'] as IlluminantName[]).map(builtIn), ...FLUORESCENT],
  },
  {
    id: 'fluorescent', title: 'The CIE fluorescent lights F1 to F12 (12 lights)',
    about: 'The twelve fluorescent lamp types of CIE 15: standard halophosphate lamps (F1 to F6), broadband lamps (F7 to F9) and narrow tri-band lamps (F10 to F12), whose spiky spectra test an observer most.',
    lights: () => FLUORESCENT,
  },
  {
    id: 'led', title: `The CIE LED lights (${LEDS.length} lights)`,
    about: 'The CIE\'s typical LED lamps (CIE 015:2018): five blue-pumped phosphor whites from about 2700 to 6600 K, a phosphor white with a red LED, a mix of red, green and blue LEDs, and two violet-pumped phosphor whites.',
    lights: () => LEDS.map(builtIn),
  },
  {
    id: 'daylight', title: 'CIE daylight from 4000 to 10000 K, every 500 K (13 lights)',
    about: 'Daylight from a warm late afternoon to a blue north sky.',
    lights: () => Array.from({ length: 13 }, (_, i) => 4000 + 500 * i).map((t) => ({ key: `day${t}`, label: `daylight ${t} K`, spd: daylight(t) })),
  },
  {
    id: 'planckian', title: 'Planckian from 2000 to 6500 K, every 500 K (10 lights)',
    about: 'Incandescent and fire light, the smooth spectra of hot bodies, from warm to cool.',
    lights: () => Array.from({ length: 10 }, (_, i) => 2000 + 500 * i).map((t) => ({ key: `planck${t}`, label: `Planckian ${t} K`, spd: planckian(t) })),
  },
  {
    id: 'own', title: 'The target condition\'s own light only',
    about: 'The light the profile is for: the OME of the profile\'s condition alone.',
    lights: (cond) => {
      const k = (Object.keys(illuminants) as IlluminantName[]).find((n) => illuminants[n] === cond.light);
      return [k ? builtIn(k) : { key: `own:${fingerprint([cond.light])}`, label: cond.lightLabel, spd: cond.light }];
    },
  },
  {
    id: 'yours', title: 'Your own lights',
    about: 'From files or pasted below: wavelength in nm in the first column and one light per column (a header row can name them), relative power at any scale, covering at least 420 to 680 nm. Read in this page; they go nowhere.',
    lights: () => {
      if (!yourLights.length) throw new Error('give your own lights below (a file or pasted), or untick "Your own lights"');
      return yourLights;
    },
  },
];

/** The lights of a table of numbers: one per column after the wavelength, named by the header or by `source`. */
function readLights(text: string, source: string): Light[] {
  const t = parseTable(text, 1);
  return t.columns.map((c, k) => {
    const spd = resample(t.nm, c);
    const unnamed = /^Column \d+$/.test(t.names[k]);
    const name = !unnamed ? t.names[k] : t.columns.length > 1 ? `${source}, light ${k + 1}` : source;
    if (spd.some((v) => v < 0) || !spd.some((v) => v > 0)) throw new Error(`${name}: a light needs positive power and none below 0`);
    return { key: `yours:${fingerprint([spd])}`, label: `${name} (yours)`, spd };
  });
}

let fileLights: Light[] = [], pastedLights: Light[] = [];
const syncYourLights = () => {
  yourLights = [...fileLights, ...pastedLights];
  const box = document.querySelector<HTMLInputElement>('#setsBox input[name=lights][value=yours]');
  if (box && yourLights.length) box.checked = true;
  schedule();
};
$<HTMLInputElement>('lightFiles').addEventListener('change', async (e) => {
  const notes: string[] = [];
  fileLights = [];
  for (const file of [...((e.target as HTMLInputElement).files ?? [])]) {
    try {
      const l = readLights(await file.text(), file.name);
      fileLights.push(...l);
      notes.push(`${file.name}: ${l.length} light${l.length > 1 ? 's' : ''}`);
    } catch (err) { notes.push(`${file.name}: cannot read it (${(err as Error).message})`); }
  }
  $('lightNote').textContent = notes.length ? `${notes.join('; ')}.` : '';
  syncYourLights();
});
$('lightPaste').addEventListener('input', () => {
  const text = $<HTMLTextAreaElement>('lightPaste').value;
  try {
    pastedLights = text.trim() ? readLights(text, 'pasted light') : [];
    $('lightPasteNote').textContent = pastedLights.length ? `Pasted: ${pastedLights.length} light${pastedLights.length > 1 ? 's' : ''}.` : '';
  } catch (err) {
    pastedLights = [];
    $('lightPasteNote').textContent = `Cannot read the pasted lights: ${(err as Error).message}.`;
  }
  syncYourLights();
});
const DEFAULT_OBJECTS = ['munsell271', 'cie-ces99', 'pmcc', 'morimoto-natural-objects'], DEFAULT_LIGHTS = ['library'];

/** A short fingerprint of curves or spectra, so that results are reused while what they were computed from is unchanged. */
function fingerprint(curves: readonly (readonly number[])[]): string {
  let h = 2166136261;
  for (const c of curves) for (const v of c) h = Math.imul(h ^ Math.round(v * 1e6), 16777619);
  return (h >>> 0).toString(36);
}

/** The sets the reader loaded from files, after the library's. */
let ownSets: ObjectSet[] = [];
const allSets = () => [...OBJECT_SETS, ...ownSets];

/** The object and light checkboxes; `on` gives the object sets to tick (the defaults when the page opens). */
function buildSets(on: readonly string[] = DEFAULT_OBJECTS): void {
  const box = (name: string, id: string, title: string, about: string, checked: boolean, credit = '') => `<label><input type="checkbox"
    name="${name}" value="${escapeHtml(id)}"${checked ? ' checked' : ''}><span><b>${escapeHtml(title)}</b><span class="about">${escapeHtml(about)}</span>${credit}</span></label>`;
  const where = (s: ObjectSet) => (s.builtIn ? '' : fromDisk() ? ' Not available in a page opened from a file on disk.' : ' Loaded when chosen.');
  $('objectSets').innerHTML = allSets().map((s) => box('objects', s.id, `${s.title} (${s.count.toLocaleString('en')})`, s.description, on.includes(s.id),
    s.credit ? `<span class="credit">${escapeHtml(s.credit)} Terms: ${escapeHtml(s.license)}. <a href="${s.url}">Source</a>.${where(s)}</span>` : `<span class="credit">${escapeHtml(s.license)}.</span>`)).join('');
  if (!$('lightSets').childElementCount) $('lightSets').innerHTML = LIGHT_SETS.map((s) => box('lights', s.id, s.title, s.about, DEFAULT_LIGHTS.includes(s.id))).join('');
}

$<HTMLInputElement>('ownFiles').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])], notes: string[] = [], added: string[] = [];
  for (const file of files) {
    try {
      const text = await file.text();
      const { objects, note } = readObjectFile(text);
      const id = `own:${file.name}:${fingerprint(objects.reflectances)}`;
      ownSets = [...ownSets.filter((s) => s.id !== id), ownSet(id, file.name, objects, `Your file: ${note}`)];
      added.push(id);
      notes.push(`${file.name}: ${note}`);
    } catch (err) { notes.push(`${file.name}: cannot read it (${(err as Error).message})`); }
  }
  $('ownNote').textContent = notes.join(' ');
  buildSets([...ticked('objects'), ...added]);
  schedule();
});
function resetSets(): void {
  document.querySelectorAll<HTMLInputElement>('#setsBox input[type=checkbox]').forEach((i) => {
    i.checked = (i.name === 'objects' ? DEFAULT_OBJECTS : DEFAULT_LIGHTS).includes(i.value);
  });
}
const ticked = (name: string) => [...document.querySelectorAll<HTMLInputElement>(`#setsBox input[name=${name}]:checked`)].map((i) => i.value);

interface Sets { objects: Awaited<ReturnType<typeof objectsOf>>; lights: Light[]; key: string }

async function chosenSets(cond: Condition): Promise<Sets> {
  const objects = await objectsOf(ticked('objects'), allSets());
  const seen = new Set<string>(), lights: Light[] = [];
  for (const s of LIGHT_SETS.filter((s) => ticked('lights').includes(s.id))) for (const l of s.lights(cond)) if (!seen.has(l.key)) { seen.add(l.key); lights.push(l); }
  if (!lights.length) throw new Error('choose at least one set of lights');
  const custom = $<HTMLInputElement>('chooseSets').checked;
  $('setsNow').textContent = custom
    ? `Your choice: ${objects.reflectances.length.toLocaleString('en')} objects (${objects.sets.map((s) => s.title).join('; ')}) and ${lights.length} light${lights.length > 1 ? 's' : ''}.`
    : `Sections 4 to 6 use 759 objects, 271 of the corrected Munsell colors (ten hues at every Value and at Chroma 4 to 16, and the neutrals), the CIE's 99 color evaluation samples (those of TM-30-18), the 30 patches of the PMCC and 359 natural objects measured in Japan (flowers, leaves, fruit, vegetables, bark and stones), under 16 common lights, A, C, D50, D65, E, F2, F11 and the nine CIE LED lamps. The thesis's own objects (all 1,600 Munsell colors) and lights (D65, D50, A, E and F1 to F12) are among the choices.`;
  return { objects, lights, key: `${objects.sets.map((s) => s.id).join('+')}|${lights.map((l) => l.key).join('+')}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Section 4: the OME of the source observer and the target condition's, and light by light

const meanOf = (v: ArrayLike<number>) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s / v.length; };
const f3 = (v: number) => v.toFixed(3);

/**
 * The flag for two observers that are, for color matching, one: an OME of 0 (the same observer), or under 0.001
 * (likely the same, Max's rule; what is left is then the rounding of tabulated curves, as for CIE 2006 against CIE
 * 2015). Such observers meet the Luther-Ives condition: each one's curve is a linear mix of the other's.
 */
function same(ome: number, largest: number, src: Condition, cond: Condition): string {
  if (ome >= 0.001) return '';
  const names = `${escapeHtml(src.observer.name)} and ${escapeHtml(cond.observer.name)}`;
  if (ome === 0) {
    return `<p class="flag"><b>The same observer.</b> ${names} give every object the same WLab under every light chosen:
      they meet the Luther-Ives condition (each one's curve is a linear mix of the other's), so for color matching they are
      one observer, and the MAT carries one onto the other exactly.</p>`;
  }
  return `<p class="flag"><b>Likely the same observer.</b> The OME of ${names} is under 0.001 (the largest difference
    ${largest.toPrecision(2)}): two observers this close are likely one, meeting the Luther-Ives condition (each one's
    curve is a linear mix of the other's), with what is left coming from the rounding of tabulated curves, as for the CIE
    2006 cone fundamentals and the CIE 2015 color-matching functions made from them.</p>`;
}

function drawOme(src: Condition, cond: Condition, sets: Sets): void {
  const objs = sets.objects;
  const moved = (light: Spectrum) => deltaEsOf(wlabsOf(src.observer, light, objs), wlabsOf(cond.observer, light, objs));
  const per = sets.lights.map((l) => ({ l, d: moved(l.spd) }));
  const ome = meanOf(per.map((p) => meanOf(p.d)));
  // every object under every light, for the spread and the largest
  const all: { v: number; j: number; k: number }[] = [];
  per.forEach((p, k) => p.d.forEach((v, j) => all.push({ v, j, k })));
  all.sort((a, b) => a.v - b.v);
  const at = (q: number) => all[Math.min(all.length - 1, Math.round(q * (all.length - 1)))].v;
  const worst = all[all.length - 1];
  const lightSets = LIGHT_SETS.filter((s) => ticked('lights').includes(s.id)).map((s) => s.title.replace(/ \(\d+ lights?\)$/, ''));
  const row = (k: string, v: string, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><th>${k}</th><td>${v}</td></tr>`;
  $('ome').innerHTML = `<div class="table-wrap"><table class="kv"><tbody>
    ${row('Source observer', escapeHtml(src.observer.name))}
    ${row('Target condition\'s observer', escapeHtml(cond.observer.name))}
    ${row('Objects', `${objs.reflectances.length.toLocaleString('en')}: ${objs.sets.map((s) => `${escapeHtml(s.title)} (${s.count.toLocaleString('en')})`).join('; ')}`)}
    ${row('Lights', `${sets.lights.length}: ${escapeHtml(lightSets.join('; '))}`)}
    ${row('OME, the mean ΔE<sub>WLab</sub>', `<span class="big">${f3(ome)}</span>`, 'own')}
    ${row('Median', f3(at(0.5)))}
    ${row('90th percentile', f3(at(0.9)))}
    ${row('Largest', `${f3(worst.v)}: ${escapeHtml(objs.names[worst.j])}, under ${escapeHtml(per[worst.k].l.label)}`)}
    </tbody></table></div>${same(ome, worst.v, src, cond)}
    <p class="note">Over the ${all.length.toLocaleString('en')} WLab differences, one for each object under each light. The
    converted observer would give the same: a MAT changes no object's Wpt.</p>`;
  const summary = (v: ArrayLike<number>) => {
    const order = Array.from(v, (_, i) => i).sort((a, b) => v[a] - v[b]);
    const q = (p: number) => v[order[Math.min(v.length - 1, Math.round(p * (v.length - 1)))]];
    const w = order[order.length - 1];
    return `<td class="sep">${f3(meanOf(v))}</td><td>${f3(q(0.5))}</td><td>${f3(q(0.9))}</td><td>${f3(v[w])}</td><td class="where">${escapeHtml(objs.names[w])}</td>`;
  };
  // without the MAT: the source observer's responses taken as the target condition's
  const b = wptNormalization(cond.observer, cond.light);
  const raw = objs.reflectances.map((r) => deltaEWlab(wptToWlab(mulMV(b.toWpt as Mat3, responses(r, src.observer, cond.light))), b.wlabOf(r)));
  $('metrics').innerHTML = `<div class="table-wrap"><table><thead>
    <tr><th></th><th class="sep" colspan="5">ΔE<sub>WLab</sub> over the objects</th></tr>
    <tr><th>Light</th><th class="sep">mean</th><th>median</th><th>90th percentile</th><th>largest</th><th>where it is largest</th></tr></thead>
    <tbody><tr class="own"><td>${escapeHtml(cond.lightLabel)} (the target condition's)</td>${summary(moved(cond.light))}</tr>
    ${per.map((p) => `<tr><td>${escapeHtml(p.l.label)}</td>${summary(p.d)}</tr>`).join('')}
    <tr class="without"><td>${escapeHtml(cond.lightLabel)}, without the MAT</td>${summary(raw)}</tr></tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 5: the closest CIE 2006 observer and the closest categorical observer, by OME

const AGES = Array.from({ length: 13 }, (_, i) => 20 + 5 * i);
const observerCache = new Map<string, Observer>();
const memo = (key: string, make: () => Observer) => { let o = observerCache.get(key); if (!o) { o = make(); observerCache.set(key, o); } return o; };
let sweepRun = 0, sweepKey = '', sweepCsv = '';

async function drawSweep(src: Condition, cond: Condition, sets: Sets): Promise<void> {
  const which = $<HTMLSelectElement>('placeWhich').value, step = Number($<HTMLSelectElement>('fieldStep').value);
  const T = which === 'source' ? src.observer : cond.observer;
  const key = `${fingerprint(T.curves)}|${sets.key}|${step}`;
  if (key === sweepKey) return;
  const run = ++sweepRun;
  sweepKey = '';
  $<HTMLButtonElement>('downloadSweep').disabled = true;
  const objs = sets.objects, tW = sets.lights.map((l) => wlabsOf(T, l.spd, objs));
  const omeOf = (o: Observer) => meanOf(sets.lights.map((l, k) => meanOf(deltaEsOf(wlabsOf(o, l.spd, objs), tW[k]))));
  const fields = Array.from({ length: Math.round(9 / step) + 1 }, (_, i) => 1 + step * i).reverse();
  const catFields = Array.from({ length: 10 }, (_, i) => i + 1);
  const total = fields.length * AGES.length + 10 * catFields.length;
  let done = 0;
  const tick = async () => {
    if (++done % 4) return true;
    $('sweepProgress').textContent = `Computing: ${done} of ${total} observers…`;
    await new Promise((r) => setTimeout(r, 0));
    return run === sweepRun;
  };
  const grid: number[][] = [], cats: number[][] = [];
  for (const f of fields) {
    const row: number[] = [];
    for (const a of AGES) { row.push(omeOf(memo(`2006/${f}/${a}`, () => cie2006(f, a)))); if (!(await tick())) return; }
    grid.push(row);
  }
  for (let c = 1; c <= 10; c++) {
    const row: number[] = [];
    for (const f of catFields) { row.push(omeOf(memo(`cat/${c}/${f}`, () => categoricalObserver(c, f)))); if (!(await tick())) return; }
    cats.push(row);
  }
  const best = (g: number[][]) => g.reduce<[number, number]>((b, row, r) => row.reduce<[number, number]>((bb, v, c) => (v < g[bb[0]][bb[1]] ? [r, c] : bb), b), [0, 0]);
  const [r6, c6] = best(grid), [rc, cc] = best(cats);
  $('sweepProgress').textContent = '';
  $('closest').innerHTML = `Closest to ${escapeHtml(T.name)}: the CIE 2006 observer of <b>${fields[r6]}° and ${AGES[c6]} years</b> (OME
    ${f3(grid[r6][c6])}), and categorical observer <b>${rc + 1}</b> (${categoricalObserverAges[rc]} years) at <b>${catFields[cc]}°</b> (OME ${f3(cats[rc][cc])}).`;
  $('heat2006').innerHTML = heatMap({
    title: 'CIE 2006 observers', rowLabel: 'field size (°)', colLabel: 'age (years)', rows: fields.map(String), cols: AGES.map(String),
    values: grid, ring: [r6, c6], tip: (r, c) => `${fields[r]}°, ${AGES[c]} years: OME ${f3(grid[r][c])}`,
  });
  $('heatCat').innerHTML = heatMap({
    title: 'Categorical observers', rowLabel: 'category', colLabel: 'field size (°)', rows: cats.map((_, i) => String(i + 1)),
    cols: catFields.map(String), values: cats, ring: [rc, cc],
    tip: (r, c) => `category ${r + 1} (${categoricalObserverAges[r]} years), ${catFields[c]}°: OME ${f3(cats[r][c])}`,
  });
  sweepCsv = [`# OME of ${T.name} against CIE 2006 and categorical observers; ${objs.reflectances.length} objects, ${sets.lights.length} lights`,
    'model,field size,age or category,OME',
    ...fields.flatMap((f, r) => AGES.map((a, c) => `CIE 2006,${f},${a},${grid[r][c].toFixed(6)}`)),
    ...cats.flatMap((row, c) => row.map((v, k) => `categorical,${catFields[k]},${c + 1},${v.toFixed(6)}`))].join('\n') + '\n';
  sweepKey = key;
  $<HTMLButtonElement>('downloadSweep').disabled = false;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 6: the OCE of the source observer, and of the target condition's, under Planckian and daylight lights

const range = (a: number, b: number, s: number) => Array.from({ length: Math.round((b - a) / s) + 1 }, (_, i) => a + s * i);
const PLANCK = range(1750, 12000, 250), DAY = range(4000, 14000, 250);
const lightCache = new Map<string, Spectrum>();
const lightOf = (kind: 'planck' | 'day', t: number) => {
  const k = `${kind}${t}`;
  let l = lightCache.get(k);
  if (!l) { l = kind === 'planck' ? planckian(t) : daylight(t); lightCache.set(k, l); }
  return l;
};

function drawOce(src: Condition, cond: Condition, sets: Sets): void {
  const objs = sets.objects, ref = wlabsOf(cond.observer, cond.light, objs);
  const line = (o: Observer, kind: 'planck' | 'day') => (kind === 'planck' ? PLANCK : DAY)
    .map((t): [number, number] => [t, meanOf(deltaEsOf(wlabsOf(o, lightOf(kind, t), objs), ref))]);
  const rows = [{ o: src.observer, who: 'the source observer', color: 'var(--accent)' }, { o: cond.observer, who: 'the target condition\'s observer', color: 'var(--accent2)' }]
    .map((r) => ({ ...r, planck: line(r.o, 'planck'), day: line(r.o, 'day') }));
  const series = rows.flatMap((r) => [
    { pts: r.planck, color: r.color, label: `${r.who}, Planckian`, tips: r.planck.map(([t, v]) => `${r.o.name}, Planckian ${t} K: OCE ${f3(v)}`) },
    { pts: r.day, color: r.color, dash: '5 3', label: `${r.who}, daylight`, tips: r.day.map(([t, v]) => `${r.o.name}, daylight ${t} K: OCE ${f3(v)}`) },
  ]);
  $('oce').innerHTML = linePlot({ xLabel: 'color temperature (K)', yLabel: `OCE against ${cond.label}`, series });
  const low = (pts: [number, number][]) => pts.reduce((b, p) => (p[1] < b[1] ? p : b));
  $('oceTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Observer</th><th class="sep">closest Planckian</th><th>OCE</th>
    <th class="sep">closest daylight</th><th>OCE</th></tr></thead><tbody>${rows.map((r) => {
    const [p, d] = [low(r.planck), low(r.day)];
    return `<tr><td>${escapeHtml(r.o.name)} (${r.who})</td><td class="sep">${p[0]} K</td><td>${f3(p[1])}</td><td class="sep">${d[0]} K</td><td>${f3(d[1])}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

let metricsRun = 0;

async function drawMetrics(src: Condition, cond: Condition): Promise<void> {
  const run = ++metricsRun;
  let sets: Sets;
  // a set still to load says so while it loads
  const slow = setTimeout(() => { if (run === metricsRun) $('setsNow').textContent = 'Loading the chosen objects…'; }, 150);
  try {
    sets = await chosenSets(cond);
  } catch (e) {
    if (run !== metricsRun) return;
    for (const id of ['ome', 'metrics', 'methods', 'closest', 'heat2006', 'heatCat', 'oce', 'oceTable']) $(id).replaceChildren();
    $('ome').innerHTML = `<p class="error">${escapeHtml(message(e))}.</p>`;
    $('setsNow').textContent = '';
    sweepKey = ''; sweepRun++;
    return;
  } finally { clearTimeout(slow); }
  if (run !== metricsRun) return;
  drawOme(src, cond, sets);
  drawMethods(src, cond, sets);
  drawOce(src, cond, sets);
  void drawSweep(src, cond, sets);
}

buildSets();
optIn($<HTMLInputElement>('chooseSets'), $('setsBox'), resetSets, schedule);
$('setsBox').addEventListener('change', schedule);
for (const id of ['placeWhich', 'fieldStep']) {
  $(id).addEventListener('change', async () => { if (last) { const l = last; void drawSweep(l.src, l.cond, await chosenSets(l.cond)); } });
}
$('downloadSweep').addEventListener('click', () => { if (sweepCsv) download(`${fileName}-closest-observers.csv`, sweepCsv, 'text/csv'); });

// ---------------------------------------------------------------------------------------------------------------
// The profile

/** iccMAX's names for the converted observer and the target condition's light, where it has them. */
function stdNames(conv: Converted, cond: Condition): { observer?: string; illuminant?: string; cct?: number } {
  const observer = standardObserverOf(conv.curves);
  if (isD50(cond.light)) return { observer, illuminant: 'Illuminant D50', cct: 5000 };
  if (cond.lightStd) return { observer, illuminant: cond.lightStd.name, cct: cond.lightStd.cct || undefined };
  const std = STD_ILLUMINANT[cond.lightLabel];
  if (std) return { observer, illuminant: std.name, cct: std.cct };
  const day = /^daylight at (\d+) K$/.exec(cond.lightLabel), black = /(\d+) K\)?$/.exec(cond.lightLabel);
  if (day) return { observer, illuminant: 'Illuminant Daylight', cct: Number(day[1]) };
  if (black && /Planckian|candlelight/.test(cond.lightLabel)) return { observer, illuminant: 'Illuminant Black Body', cct: Number(black[1]) };
  return { observer };
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
let xml = '', fileName = '';
let icc: (() => Uint8Array) | undefined;

function showProfile(): void {
  if (!last) { xml = ''; icc = undefined; return; }
  const { src, cond, conv } = last;
  const [encoding, numbers] = $<HTMLSelectElement>('encoding').value.split(' ') as [Encoding, Numbers];
  const names = stdNames(conv, cond);
  const auto = `${src.observer.name} converted by a Wpt MAT for ${cond.label}; ${encoding} encoding, ${numbers === 'float' ? 'floating point' : 'integer'}`;
  const desc = $<HTMLInputElement>('description');
  if (!desc.dataset.edited) desc.value = auto;
  const luminance = Number($<HTMLInputElement>('luminance').value) || 203;
  const options: ProfileOptions = {
    encoding, numbers, description: desc.value || auto, stdIlluminant: names.illuminant,
    colorTemperature: names.cct, luminance,
  };
  xml = encodingProfileXml(conv, cond.light, options);
  // the binary profile, written when it is downloaded (with the date of that moment)
  icc = () => encodingProfileIcc(conv, cond.light, options);
  fileName = `${slug(src.observer.name)}-for-${slug(cond.label)}-${encoding}_${numbers}`;
  $('stdNames').textContent = `In the svcn: StdObserver "${names.observer ?? 'Custom observer'}"${names.observer ? ', named by its index without its functions' : ', with the functions of the converted observer, as a custom observer'}; `
    + `StdIlluminant "${names.illuminant ?? 'Illuminant Unknown'}"${names.cct ? `, ${names.cct} K` : ''}${isD50(cond.light) ? ', named by its index without its spectrum' : ', with the spectrum of the light'}.`;
  $('commands').textContent = `iccFromXml ${fileName}.xml ${fileName}.icc\niccDumpProfile -v ${fileName}.icc`;
  $('xmlPreview').textContent = xml;
}

function syncButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((b) => { b.hidden = !matrices[b.dataset.copy!]; });
  for (const id of ['downloadIcc', 'downloadXml', 'copyXml', 'downloadObserver']) $<HTMLButtonElement>(id).disabled = !xml;
}

document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((b) => b.addEventListener('click', () => {
  const m = matrices[b.dataset.copy!];
  if (m) void copy(formatMatrix(m.m, m.name, fmtSels[0].value as MatrixFormat), b);
}));
for (const id of ['encoding', 'luminance']) $(id).addEventListener('input', () => { showProfile(); syncButtons(); });
$('description').addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.value) input.dataset.edited = '1'; else delete input.dataset.edited;
  showProfile();
});
$('downloadObserver').addEventListener('click', () => {
  if (!last) return;
  const { src, cond, conv } = last;
  const csv = [`# ${src.observer.name} converted by a Wpt MAT for ${cond.label}`, 'nm,curve 1,curve 2,curve 3',
    ...wavelengths.map((nm, k) => [nm, ...conv.curves.map((c) => c[k].toPrecision(10))].join(','))].join('\n') + '\n';
  download(`${fileName}-observer.csv`, csv, 'text/csv');
});
$('downloadIcc').addEventListener('click', () => { if (icc) download(`${fileName}.icc`, icc(), 'application/vnd.iccprofile'); });
$('downloadXml').addEventListener('click', () => { if (xml) download(`${fileName}.xml`, xml, 'application/xml'); });
$('copyXml').addEventListener('click', (e) => { if (xml) void copy(xml, e.currentTarget as HTMLButtonElement); });


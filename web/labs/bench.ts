// Lab G: comparing MATs and CATs, as predictors of material color (what a material measures under another light, not
// the corresponding color of appearance). First the one formula all the transforms share; then, built up, one material
// and one change of light, a library of objects (with the guide's numbers checked on the Munsell colors), and many
// lights at once, closed by a recap. The observer stays the same throughout, as a CAT assumes (the observer lab
// compares ways of converting an observer).
// Bundled into labs/bench.html by scripts/build-web.mjs.

import {
  cat, CAT02, categoricalObserver, cie2006, daylight, deltaE00, deltaEWlab, fluorescents, illuminants, inv3, mat, mulMM, mulMV, munsell1600,
  munsellBase, observers, planckian, responses, sensorResponses, wptNormalization, wptToWlab, xyzToLab, xyzToRgb,
  type IlluminantName, type Mat3, type Observer, type SampleSet, type Spectrum, type Vec3,
} from '../../src/index.ts';
import { cameraObservers } from './cameras.ts';
import { fromDisk } from './fetchdata.ts';
import { MUNSELL_HUES, munsellChips } from './hue.ts';
import { $, cloud3d, download, escapeHtml, fmtTick, histogram, LIGHT_LABEL, niceStep, optIn, spectrumPlot } from './kit.ts';
import { OBJECT_SETS, objectsOf, ownSet, type ObjectSet } from './library.ts';
import { readObjectFile } from './objectfile.ts';
import { LIGHT_TRANSFORMS, predictPair, summarize, type Errors, type Pair } from './predictions.ts';

const message = (e: unknown) => (e as Error).message;
const f2 = (v: number) => v.toFixed(2);
const COLORS = ['var(--accent)', 'var(--accent2)', '#1f8a5b', '#7a3fb0'];
const range = (a: number, b: number, s: number) => Array.from({ length: Math.round((b - a) / s) + 1 }, (_, i) => a + s * i);
const shortLight = (k: string) => LIGHT_LABEL[k as IlluminantName]?.replace(/ \(.*$/, '') ?? k;

let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(() => void render(), 0); };

// ---------------------------------------------------------------------------------------------------------------
// The choices of section 2, which sections 3 and 4 follow

for (const id of ['fromLight', 'toLight']) $<HTMLSelectElement>(id).replaceChildren(...(Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k) => new Option(LIGHT_LABEL[k], k)));
$<HTMLSelectElement>('fromLight').value = 'A';
$<HTMLSelectElement>('toLight').value = 'D65';
const observerOf = (): Observer => observers[$<HTMLSelectElement>('observer').value as 'cie1931' | 'cie1964'];
const lightKey = (id: string) => $<HTMLSelectElement>(id).value as IlluminantName;
for (const id of ['observer', 'fromLight', 'toLight']) $(id).addEventListener('input', schedule);
$('material').addEventListener('input', () => drawOne());
$('split').addEventListener('input', () => drawOne());

// ---------------------------------------------------------------------------------------------------------------
// The objects: Lab D's 759 by default, the reader's choice when opted in

const DEFAULT_OBJECTS = ['munsell271', 'cie-ces99', 'pmcc', 'morimoto-natural-objects'];
let ownSets: ObjectSet[] = [];
const allSets = () => [...OBJECT_SETS, ...ownSets];
function fingerprint(curves: readonly (readonly number[])[]): string {
  let h = 2166136261;
  for (const c of curves) for (const v of c) h = Math.imul(h ^ Math.round(v * 1e6), 16777619);
  return (h >>> 0).toString(36);
}
function buildSets(on: readonly string[] = DEFAULT_OBJECTS): void {
  const where = (s: ObjectSet) => (s.builtIn ? '' : fromDisk() ? ' Not available in a page opened from a file on disk.' : ' Loaded when chosen.');
  $('objectSets').innerHTML = allSets().map((s) => `<label><input type="checkbox" name="objects" value="${escapeHtml(s.id)}"${on.includes(s.id) ? ' checked' : ''} autocomplete="off">
    <span><b>${escapeHtml(`${s.title} (${s.count.toLocaleString('en')})`)}</b><span class="about">${escapeHtml(s.description)}</span>${s.credit
    ? `<span class="credit">${escapeHtml(s.credit)} Terms: ${escapeHtml(s.license)}. <a href="${s.url}">Source</a>.${where(s)}</span>` : `<span class="credit">${escapeHtml(s.license)}.</span>`}</span></label>`).join('');
}
const ticked = () => [...document.querySelectorAll<HTMLInputElement>('#setsBox input[name=objects]:checked')].map((i) => i.value);
$<HTMLInputElement>('ownFiles').addEventListener('change', async (e) => {
  const notes: string[] = [], added: string[] = [];
  for (const file of [...((e.target as HTMLInputElement).files ?? [])]) {
    try {
      const { objects, note } = readObjectFile(await file.text());
      const id = `own:${file.name}:${fingerprint(objects.reflectances)}`;
      ownSets = [...ownSets.filter((s) => s.id !== id), ownSet(id, file.name, objects, `Your file: ${note}`)];
      added.push(id);
      notes.push(`${file.name}: ${note}`);
    } catch (err) { notes.push(`${file.name}: cannot read it (${message(err)})`); }
  }
  $('ownNote').textContent = notes.join(' ');
  buildSets([...ticked(), ...added]);
  schedule();
});
buildSets();
optIn($<HTMLInputElement>('chooseSets'), $('setsBox'), () => document.querySelectorAll<HTMLInputElement>('#setsBox input[name=objects]').forEach((i) => { i.checked = DEFAULT_OBJECTS.includes(i.value); }), schedule);
$('setsBox').addEventListener('change', schedule);

// ---------------------------------------------------------------------------------------------------------------
// Sections 1 and 2: one change of light, for one material and for all

let objects: (SampleSet & { sets: readonly ObjectSet[] }) | undefined;
let errors: Errors[] | undefined;
let pickDefault = true;

/** The transforms' matrices for the chosen observer and lights, in the order of LIGHT_TRANSFORMS. */
function transforms(): { T: Mat3[]; from: Spectrum; to: Spectrum; o: Observer } {
  const o = observerOf(), from = illuminants[lightKey('fromLight')], to = illuminants[lightKey('toLight')];
  const ns = wptNormalization(o, from), nd = wptNormalization(o, to);
  return { o, from, to, T: [mat(ns, nd), cat(ns.white, nd.white, 'bradford'), cat(ns.white, nd.white, 'cat02'), cat(ns.white, nd.white, 'xyz')] };
}

/** A color's numbers shown as they would look on an sRGB screen (D65 white), unadapted. */
const screen = (xyz: Vec3) => `rgb(${xyzToRgb(xyz, 'srgb').map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))).join(',')})`;

/** The two lights, at the same luminance (CIE 1931 ȳ), and the material's spectral reflectance. */
function drawSpectra(name: string, reflectance: Spectrum): void {
  const from = illuminants[lightKey('fromLight')], to = illuminants[lightKey('toLight')];
  const k = (s: Spectrum) => 100 / s.reduce((a, v, i) => a + v * observers.cie1931.curves[1][i], 0);
  $('spectra').innerHTML = `<div>${spectrumPlot('The two lights, at the same luminance', [
    { values: from.map((v) => v * k(from)), color: 'var(--accent)', label: `measured under: ${LIGHT_LABEL[lightKey('fromLight')]}` },
    { values: to.map((v) => v * k(to)), color: 'var(--accent2)', dash: '5 3', label: `predicted for: ${LIGHT_LABEL[lightKey('toLight')]}` },
  ])}</div><div>${spectrumPlot('The material\'s spectral reflectance', [{ values: reflectance, color: 'var(--ink)', label: name }])}</div>`;
}

function drawOne(): void {
  if (!objects || !errors) return;
  const k = Number($<HTMLSelectElement>('material').value) || 0, r = objects.reflectances[k];
  drawSpectra(objects.names[k], r);
  const { T, from, to, o } = transforms(), nd = wptNormalization(o, to);
  const measured = responses(r, o, from), actual = responses(r, o, to);
  const lab = (x: Vec3) => xyzToLab(x, nd.white), wl = (x: Vec3) => wptToWlab(mulMV(nd.toWpt, x));
  const fromName = shortLight(lightKey('fromLight')), toName = shortLight(lightKey('toLight'));
  // for the challenge: how far apart the two white points are, how far the measurement moves, how far CAT02 moves it
  const ns = wptNormalization(o, from);
  const uv = (x: Vec3) => { const d = x[0] + 15 * x[1] + 3 * x[2]; return [(4 * x[0]) / d, (9 * x[1]) / d]; };
  const [u1, v1] = uv(ns.white), [u2, v2] = uv(nd.white);
  const moves = deltaE00(lab(measured), lab(actual)), catMoves = deltaE00(lab(mulMV(T[2], measured)), lab(measured));
  $('whiteNote').textContent = `The two lights' white points are Δu′v′ ${Math.hypot(u1 - u2, v1 - v2).toFixed(4)} apart. Between them this `
    + `material's measurement moves by ΔE00 ${f2(moves)}; CAT02 changes it by ${f2(catMoves)}.`;
  // with `above`, the box is split along its diagonal: `above` in the upper triangle (nearest the measurement it is,
  // in the row above), the color x in the lower one
  const chip = (x: Vec3, title: string, sub: string, above?: Vec3) => `<div class="swatch"><div style="background:${above
    ? `linear-gradient(to bottom left, ${screen(above)} 50%, ${screen(x)} 50%)` : screen(x)}"></div><span><b>${escapeHtml(title)}</b><br>${sub}</span></div>`;
  const split = $<HTMLInputElement>('split').checked;
  $('splitLabel').textContent = `Show the measurement under ${toName} in the upper triangle of each prediction`;
  const labText = (x: Vec3) => { const [L, a, b] = lab(x); return `L* ${L.toFixed(1)}, a* ${a.toFixed(1)}, b* ${b.toFixed(1)}`; };
  const preds = T.map((m) => mulMV(m, measured));
  // the two measurements side by side, then each transform's prediction of the second from the first
  $('one').innerHTML = `<div class="swatches">
    ${chip(measured, `Measured under ${fromName}`, 'the source light')}
    ${chip(actual, `Measured under ${toName}`, 'the light predicted for')}
    </div>
    <p class="tile">Predicted measurements under ${escapeHtml(toName)} from the measurement under ${escapeHtml(fromName)}</p>
    <div class="swatches">
    ${preds.map((p, i) => chip(p, `${LIGHT_TRANSFORMS[i]}`, `ΔE<sub>00</sub> ${f2(deltaE00(lab(p), lab(actual)))} from the measurement under ${escapeHtml(toName)}`, split ? actual : undefined)).join('')}
    </div>`;
  // the table goes below the split checkbox, which sits under the predictions
  $('oneTable').innerHTML = `<div class="table-wrap"><table class="many"><thead><tr><th>The material's color</th><th class="sep">CIELAB under ${escapeHtml(toName)}</th>
      <th class="sep">ΔE<sub>00</sub> from the actual</th><th>ΔE<sub>WLab</sub></th></tr></thead><tbody>
      <tr class="own"><td>Measured under ${escapeHtml(toName)}</td><td class="sep">${labText(actual)}</td><td class="sep">–</td><td>–</td></tr>
      ${preds.map((p, i) => `<tr><td>${LIGHT_TRANSFORMS[i]}</td><td class="sep">${labText(p)}</td><td class="sep">${f2(deltaE00(lab(p), lab(actual)))}</td>
        <td>${f2(deltaEWlab(wl(p), wl(actual)))}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function drawMany(): void {
  if (!objects || !errors) return;
  const names = objects.names, n = names.length;
  const rows = errors.map((e) => { const s = summarize(e.de00!), sorted = Array.from(e.de00!).sort((a, b) => a - b); return { e, s, median: sorted[Math.round(0.5 * (n - 1))] }; });
  $('manyStats').innerHTML = `<div class="table-wrap"><table class="many"><thead><tr><th>Predicted by</th><th class="sep">mean</th><th>median</th>
    <th>90th percentile</th><th>largest</th></tr></thead><tbody>${rows.map(({ e, s, median }) => `<tr${e.transform === 'Wpt MAT' ? ' class="own"' : ''}><td>${e.transform}</td>
    <td class="sep">${f2(s.mean)}</td><td>${f2(median)}</td><td>${f2(s.p90)}</td><td>${f2(s.max)}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">ΔE<sub>00</sub> between each prediction and what the object actually measures, over ${n.toLocaleString('en')} objects.</p>`;
  const sorted = (i: number) => Array.from(errors![i].de00!).sort((a, b) => a - b);
  $('manyHist').innerHTML = histogram([sorted(0), sorted(2)], [LIGHT_TRANSFORMS[0], LIGHT_TRANSFORMS[2]], [COLORS[0], COLORS[2]],
    { xLabel: 'ΔE00 from what each object measures (the last bin holds everything above)', yLabel: 'objects' });
  const worst = Array.from({ length: n }, (_, j) => j).sort((a, b) => errors![0].de00![b] - errors![0].de00![a]).slice(0, 8);
  $('manyWorst').innerHTML = `<div class="table-wrap"><table class="many"><thead><tr><th>Object</th>${LIGHT_TRANSFORMS.map((t, i) => `<th${i ? '' : ' class="sep"'}>${t}</th>`).join('')}</tr></thead>
    <tbody>${worst.map((j) => `<tr><td>${escapeHtml(names[j])}</td>${errors!.map((e, i) => `<td${i ? '' : ' class="sep"'}>${f2(e.de00![j])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 4: many lights

interface LightSet { id: string; title: string; about: string; observer: Observer; lights(): [string, Spectrum][] }
const COMMON = () => (Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k): [string, Spectrum] => [shortLight(k), illuminants[k]]);
const FLUOR = () => Object.entries(fluorescents).map(([k, l]): [string, Spectrum] => [k, l]);
const SERIES = () => [...range(4000, 10000, 1000).map((t): [string, Spectrum] => [`daylight ${t} K`, daylight(t)]),
  ...range(2000, 6500, 500).map((t): [string, Spectrum] => [`Planckian ${t} K`, planckian(t)])];
const LIGHT_SETS: LightSet[] = [
  { id: 'common1931', title: 'The common lights, CIE 1931 (2°)', about: 'A, C, D50, D65, E, F2, F11 and the nine CIE LED lamps.', observer: observers.cie1931, lights: COMMON },
  { id: 'common1964', title: 'The common lights, CIE 1964 (10°)', about: 'The same lights for the 10° observer.', observer: observers.cie1964, lights: COMMON },
  { id: 'fl1931', title: 'The CIE fluorescent lights F1 to F12, CIE 1931 (2°)', about: 'Standard, broadband and tri-band lamps.', observer: observers.cie1931, lights: FLUOR },
  { id: 'series1931', title: 'Daylight and Planckian lights, CIE 1931 (2°)', about: 'Daylight from 4000 to 10000 K by 1000 K, Planckian from 2000 to 6500 K by 500 K.', observer: observers.cie1931, lights: SERIES },
];
const DEFAULT_LIGHT_SETS = ['common1931', 'common1964'];
$('lightPairSets').innerHTML = LIGHT_SETS.map((s) => `<label><input type="checkbox" name="pairs" value="${s.id}"${DEFAULT_LIGHT_SETS.includes(s.id) ? ' checked' : ''} autocomplete="off">
  <span><b>${escapeHtml(s.title)}</b><span class="about">${escapeHtml(s.about)}</span></span></label>`).join('');
$('lightPairSets').addEventListener('change', () => void runLights());
for (const id of ['metric', 'statistic']) $(id).addEventListener('input', () => drawLights());

type Row = { pair: Pair; errors: Errors[] };
let lightRows: Row[] | undefined;
let lightRun = 0;

async function runLights(): Promise<void> {
  const me = ++lightRun;
  if (!objects) return;
  const toKey = lightKey('toLight'), to = illuminants[toKey];
  const chosen = LIGHT_SETS.filter((s) => [...document.querySelectorAll<HTMLInputElement>('input[name=pairs]:checked')].some((i) => i.value === s.id));
  if (!chosen.length) {
    $('benchStatus').className = 'error';
    $('benchStatus').textContent = 'Choose at least one set of lights.';
    lightRows = undefined;
    drawLights();
    return;
  }
  const pairs: Pair[] = chosen.flatMap((s) => s.lights().filter(([, l]) => l !== to).map(([name, l]) => ({ label: name, group: s.observer.name, source: { observer: s.observer, light: l }, destination: { observer: s.observer, light: to } })));
  const rows: Row[] = [];
  let slice = performance.now();
  for (let i = 0; i < pairs.length; i++) {
    rows.push({ pair: pairs[i], errors: predictPair(pairs[i], objects, true) });
    if (performance.now() - slice > 40) {
      $('benchStatus').textContent = `Computing: ${i + 1} of ${pairs.length} lights…`;
      await new Promise((r) => setTimeout(r, 0));
      if (me !== lightRun) return;
      slice = performance.now();
    }
  }
  $('benchStatus').className = 'note';
  $('benchStatus').textContent = `${pairs.length} lights, each predicted for ${LIGHT_LABEL[toKey]}, over the ${objects.reflectances.length.toLocaleString('en')} objects of section 3.`;
  lightRows = rows;
  drawLights();
}

/** The chosen statistic of the chosen error, for one transform of one light. */
function valueOf(e: Errors): number {
  const metric = $<HTMLSelectElement>('metric').value, stat = $<HTMLSelectElement>('statistic').value as 'mean' | 'p90' | 'max';
  return summarize(metric === 'de00' ? e.de00! : e.dewlab)[stat];
}

/** Rows of dots on one error axis, a row per light and a color per transform. */
function dotPlot(rows: Row[], axis: string): string {
  const W = 640, rowH = 16, l0 = 200, top = 10, pw = W - l0 - 16, H = top + rows.length * rowH + 44;
  const vmax = Math.max(...rows.flatMap((r) => r.errors.map(valueOf))) * 1.05 || 1, X = (v: number) => l0 + (v / vmax) * pw;
  const step = niceStep(vmax / 5), ticks: number[] = [];
  for (let t = 0; t <= vmax; t += step) ticks.push(+t.toFixed(6));
  const grid = ticks.map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + rows.length * rowH}" stroke="var(--line)"/><text x="${X(t)}" y="${top + rows.length * rowH + 14}" text-anchor="middle">${fmtTick(t)}</text>`).join('');
  const body = rows.map((r, i) => {
    const y = top + i * rowH + rowH / 2;
    return `<text x="${l0 - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(`${r.pair.label} · ${r.pair.group}`.slice(0, 40))}</text>`
      + r.errors.map((e, k) => `<circle cx="${X(valueOf(e)).toFixed(1)}" cy="${y}" r="4" fill="${COLORS[k]}" fill-opacity="0.85"><title>${escapeHtml(`${r.pair.label}, ${r.pair.group}: ${LIGHT_TRANSFORMS[k]} ${f2(valueOf(e))}`)}</title></circle>`).join('');
  }).join('');
  const legend = LIGHT_TRANSFORMS.map((n, k) => `<span class="key"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="${COLORS[k]}"/></svg>${escapeHtml(n)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(axis)} by light">${grid}${body}
    <text x="${l0 + pw / 2}" y="${H - 8}" text-anchor="middle">${escapeHtml(axis)}</text></svg><div class="legend">${legend}</div>`;
}

let csv = '';

function drawLights(): void {
  for (const id of ['lightTable', 'lightPlot', 'recap']) $(id).replaceChildren();
  $('recap').hidden = true;
  $<HTMLButtonElement>('downloadBench').disabled = true;
  if (!lightRows) return;
  const metric = $<HTMLSelectElement>('metric').value === 'de00' ? 'ΔE00' : 'ΔE_WLab';
  const stat = { mean: 'mean', p90: '90th percentile', max: 'largest' }[$<HTMLSelectElement>('statistic').value]!;
  const vals = lightRows.map((r) => r.errors.map(valueOf)), lowest = vals.map((v) => v.indexOf(Math.min(...v)));
  const n = lightRows.length;
  $('lightTable').innerHTML = `<div class="table-wrap"><table class="many bench"><thead><tr><th>Observer</th><th>Measured under</th>${LIGHT_TRANSFORMS.map((t, k) => `<th${k ? '' : ' class="sep"'}>${t}</th>`).join('')}</tr></thead>
    <tbody>${lightRows.map((r, i) => `<tr><td>${escapeHtml(r.pair.group)}</td><td>${escapeHtml(r.pair.label)}</td>${vals[i].map((v, k) => `<td${k ? '' : ' class="sep"'}>${lowest[i] === k ? `<i>${f2(v)}</i>` : f2(v)}</td>`).join('')}</tr>`).join('')}
    <tr class="own"><td colspan="2">Mean over the ${n} lights</td>${LIGHT_TRANSFORMS.map((_, k) => `<td${k ? '' : ' class="sep"'}>${f2(vals.reduce((s, v) => s + v[k], 0) / n)}</td>`).join('')}</tr>
    <tr><td colspan="2">Smallest in</td>${LIGHT_TRANSFORMS.map((_, k) => `<td${k ? '' : ' class="sep"'}>${lowest.filter((x) => x === k).length} of ${n}</td>`).join('')}</tr>
    </tbody></table></div>`;
  $('lightPlot').innerHTML = dotPlot(lightRows, `${stat} ${metric} from what the objects measure`);
  // the page's last word: what the table says, in numbers
  const meanOf = (k: number) => f2(vals.reduce((s, v) => s + v[k], 0) / n);
  $('recap').hidden = false;
  $('recap').textContent = `In short: over these ${n} lights and ${objects!.reflectances.length.toLocaleString('en')} objects, the Wpt MAT's predictions `
    + `had the smallest ${stat} ${metric} for ${lowest.filter((x) => x === 0).length} of the ${n} lights; over the lights it averaged ${meanOf(0)}, `
    + `against ${meanOf(1)} for Bradford, ${meanOf(2)} for CAT02 and ${meanOf(3)} for von Kries. That is material color; corresponding color, `
    + 'the CATs\' own job, is not tested here.';
  const cell = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  csv = [`# Comparing MATs and CATs (material color), each light predicted for ${LIGHT_LABEL[lightKey('toLight')]}`, 'observer,measured under,transform,mean dE00,p90 dE00,max dE00,mean dE_WLab,p90 dE_WLab,max dE_WLab',
    ...lightRows.flatMap((r) => r.errors.map((e) => {
      const a = summarize(e.de00!), b = summarize(e.dewlab);
      return [cell(r.pair.group), cell(r.pair.label), cell(e.transform), ...[a.mean, a.p90, a.max, b.mean, b.p90, b.max].map((v) => v.toFixed(4))].join(',');
    }))].join('\n') + '\n';
  $<HTMLButtonElement>('downloadBench').disabled = false;
}
$('downloadBench').addEventListener('click', () => { if (csv) download('comparing-mats-and-cats.csv', csv, 'text/csv'); });

// ---------------------------------------------------------------------------------------------------------------
// The page

let run = 0;

async function render(): Promise<void> {
  const me = ++run;
  try {
    objects = await objectsOf(ticked(), allSets());
  } catch (e) {
    if (me !== run) return;
    objects = undefined; errors = undefined;
    for (const id of ['one', 'oneTable', 'manyStats', 'manyHist', 'manyWorst']) $(id).replaceChildren();
    $('manyStats').innerHTML = `<p class="error">${escapeHtml(message(e))}.</p>`;
    return;
  }
  if (me !== run) return;
  const o = observerOf(), from = illuminants[lightKey('fromLight')], to = illuminants[lightKey('toLight')];
  errors = predictPair({ label: '', group: '', source: { observer: o, light: from }, destination: { observer: o, light: to } }, objects, true);
  // the material list, opening on the one whose CAT02 and MAT predictions are furthest apart; after that the material
  // chosen stays, through changes of observer and lights, and by name through changes of the objects while it is there
  const sel = $<HTMLSelectElement>('material'), wasName = sel.selectedOptions[0]?.text;
  sel.replaceChildren(...objects.names.map((n, j) => new Option(n, String(j))));
  const kept = wasName === undefined ? -1 : objects.names.indexOf(wasName);
  if (pickDefault || kept < 0) {
    const gap = (j: number) => Math.abs(errors![2].de00![j] - errors![0].de00![j]);
    sel.value = String(objects.names.map((_, j) => j).reduce((b, j) => (gap(j) > gap(b) ? j : b), 0));
    pickDefault = false;
  } else sel.value = String(kept);
  drawOne();
  drawMany();
  void runLights();
}

// ---------------------------------------------------------------------------------------------------------------
// Section 3's check: the guide's numbers, rerun on the 1,600 Munsell colors

function guide(): void {
  const munsell = munsell1600();
  const rows = ([['CIE 1931 (2°)', observers.cie1931, '1.09 and 2.26 (wpt-onramp ex05, these colors)'], ['CIE 1964 (10°)', observers.cie1964, '1.24 and 2.35 (the Wpt paper, 5,162 reflectances)']] as const).map(([name, o, theirs]) => {
    const e = predictPair({ label: '', group: '', source: { observer: o, light: illuminants.A }, destination: { observer: o, light: illuminants.D65 } }, munsell, true);
    return `<tr><td>${name}</td>${e.map((x, k) => `<td${k ? '' : ' class="sep"'}>${f2(summarize(x.de00!).mean)}</td>`).join('')}<td class="sep" style="text-align: left; white-space: normal">${theirs}</td></tr>`;
  }).join('');
  $('guideTable').innerHTML = `<div class="table-wrap"><table class="many"><thead><tr><th>Observer</th>${LIGHT_TRANSFORMS.map((t, k) => `<th${k ? '' : ' class="sep"'}>${t}</th>`).join('')}
    <th class="sep" style="text-align: left">Published, MAT and CAT02</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 5: watching the transforms work. Each condition's measurements move, step by step, through its T into the
// common representation and back out; every step is a 3 × 3 matrix, so a point moves in a straight line between steps.

/** The colors that move: the 40 base colors (a hue circle at Value 5), and ten hue spokes at Values 2, 5 and 8. */
const ANIM = (() => {
  const all = munsell1600(), chips = munsellChips();
  const names: string[] = [], reflectances: Spectrum[] = [], links: [number, number][] = [];
  const add = (n: string, r: Spectrum) => { names.push(n); reflectances.push(r); return names.length - 1; };
  // the hue circle, in hue order, closed
  const circle = MUNSELL_HUES.map((h) => { const j = munsellBase.names.indexOf(`${h} 5/6`); return add(munsellBase.names[j], munsellBase.reflectances[j]); });
  circle.forEach((k, i) => links.push([k, circle[(i + 1) % circle.length]]));
  // the spokes, each from its neutral outward
  for (const v of [2, 5, 8]) {
    const n = all.names.indexOf(`N ${v}/`), gray = add(`N ${v}/`, all.reflectances[n]);
    for (const h of ['5R', '5YR', '5Y', '5GY', '5G', '5BG', '5B', '5PB', '5P', '5RP']) {
      let prev = gray;
      for (const c of chips.filter((x) => x.hue === h && x.value === v).sort((a, b) => a.chroma - b.chroma)) {
        const k = add(`${h} ${v}/${c.chroma}`, c.reflectance);
        links.push([prev, k]);
        prev = k;
      }
    }
  }
  return { names, reflectances, links };
})();
const ANIM_HUES = MUNSELL_HUES.length;

interface Stage { label: string; m: Mat3 }
interface AnimCondition { name: string; observer: Observer; light: Spectrum; color: string }

/** The steps of a transform for one condition, from its measurements (stage 0) to the common representation. */
function stagesOf(kind: string, c: AnimCondition): Stage[] {
  const I: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const white = sensorResponses(new Array(81).fill(1), c.observer, c.light) as Vec3;
  if (kind === 'wpt') {
    const n = wptNormalization(c.observer, c.light), R = n.steps.rotation as Mat3;
    const S = mulMM([[n.steps.scale, 0, 0], [0, 1, 0], [0, 0, 1]], R);
    const a = n.steps.level, L: Mat3 = [S[0].map((v, j) => v - a[0] * S[1][j] - a[1] * S[2][j]) as unknown as Vec3, S[1], S[2]];
    return [{ label: 'measured', m: I }, { label: '1. white turned onto the first axis', m: R }, { label: '2. white scaled to W = 100', m: S },
      { label: '3. the base colors leveled to one W', m: L }, { label: '4. fitted to the reference: Wpt, the common representation', m: n.toWpt }];
  }
  if (kind === 'cat02') {
    const sharp = CAT02, w = mulMV(sharp, white);
    return [{ label: 'measured (XYZ)', m: I }, { label: '1. sharpened into cone-like channels', m: sharp },
      { label: '2. each channel scaled so that white is 100, 100, 100: the common representation', m: mulMM([[100 / w[0], 0, 0], [0, 100 / w[1], 0], [0, 0, 100 / w[2]]], sharp) }];
  }
  return [{ label: 'measured', m: I }, { label: '1. each channel scaled so that white is 100, 100, 100: the common representation', m: [[100 / white[0], 0, 0], [0, 100 / white[1], 0], [0, 0, 100 / white[2]]] }];
}

const ANIM_COLORS = ['#c0306a', 'var(--ink)', '#2f74c0'];
// the observers to choose three from: the CIE observers, CIE 2006 observers, the categorical observers and a few cameras
const CAMERA_CHOICES = ['Nikon D200', 'Canon EOS-1D X Mark II', 'ARRI D21'];
const ANIM_OBSERVERS: [string, string][] = [['cie1931', 'CIE 1931 (2°)'], ['cie1964', 'CIE 1964 (10°)'], ['2006/2/32', 'CIE 2006, 2°, 32 years'],
  ['2006/5/45', 'CIE 2006, 5°, 45 years'], ['2006/10/32', 'CIE 2006, 10°, 32 years'], ['2006/2/70', 'CIE 2006, 2°, 70 years'],
  ...range(1, 10, 1).map((c): [string, string] => [`cat/${c}`, `categorical observer ${c} (2°)`]),
  ...CAMERA_CHOICES.map((n): [string, string] => [`cam/${n}`, `${n} (camera)`])];
for (const id of ['animO1', 'animO2', 'animO3']) $<HTMLSelectElement>(id).replaceChildren(...ANIM_OBSERVERS.map(([k, l]) => new Option(l, k)));
$<HTMLSelectElement>('animO1').value = 'cie1931'; $<HTMLSelectElement>('animO2').value = '2006/5/45'; $<HTMLSelectElement>('animO3').value = 'cam/Nikon D200';
/** An observer of the menus above, loading the cameras when one is chosen. */
async function animObserver(key: string): Promise<Observer> {
  if (key === 'cie1931' || key === 'cie1964') return observers[key];
  const [kind, a, b] = key.split('/');
  if (kind === '2006') return cie2006(Number(a), Number(b));
  if (kind === 'cat') return categoricalObserver(Number(a), 2);
  const cams = await cameraObservers();
  return cams.find((c) => c.name.startsWith(a)) ?? cams[0];
}
for (const id of ['animL1', 'animL2', 'animL3']) {
  $<HTMLSelectElement>(id).replaceChildren(...(Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k) => new Option(shortLight(k), k)), new Option('D93', 'D93'));
}
$<HTMLSelectElement>('animL1').value = 'A'; $<HTMLSelectElement>('animL2').value = 'D50'; $<HTMLSelectElement>('animL3').value = 'D93';
const animLight = (id: string) => { const k = $<HTMLSelectElement>(id).value; return { name: k === 'D93' ? 'D93' : shortLight(k), spd: k === 'D93' ? daylight(9300) : illuminants[k as IlluminantName] }; };

/** The three conditions chosen. */
async function animConditions(): Promise<AnimCondition[]> {
  if ($<HTMLSelectElement>('animConditions').value === 'lights') {
    return ['animL1', 'animL2', 'animL3'].map((id, i) => { const l = animLight(id); return { name: l.name, observer: observers.cie1931, light: l.spd, color: ANIM_COLORS[i] }; });
  }
  const list = await Promise.all(['animO1', 'animO2', 'animO3'].map((id) => animObserver($<HTMLSelectElement>(id).value)));
  return list.map((o, i) => ({ name: o.name, observer: o, light: illuminants.D65, color: ANIM_COLORS[i] }));
}

/** Every frame's points, as matrices of stage positions: for each condition, the measurements' path in and back out. */
interface Path { conds: AnimCondition[]; stages: Stage[][]; measured: Vec3[][]; back: Vec3[][]; target: number[] }
let path: Path | undefined;

async function buildAnimation(): Promise<void> {
  const kind = $<HTMLSelectElement>('animTransform').value, observersMode = $<HTMLSelectElement>('animConditions').value === 'observers';
  $('animLights').hidden = observersMode;
  $('animObservers').hidden = !observersMode;
  // a CAT works on XYZ within one observer: not between observers
  const catOption = $<HTMLSelectElement>('animTransform').querySelector<HTMLOptionElement>('option[value=cat02]')!;
  catOption.disabled = observersMode;
  if (observersMode && kind === 'cat02') { $<HTMLSelectElement>('animTransform').value = 'wpt'; return buildAnimation(); }
  $('animNote').textContent = observersMode
    ? 'Three observers under D65. CAT02 is made for one observer adapting to a light, so it is not offered here; von Kries scales each observer\'s own sensors.'
    : 'Three lights seen by the CIE 1931 (2°) observer; D93 is CIE daylight at 9300 K.';
  const conds = await animConditions();
  // the same material's three points, carried into the common representation and out under the first condition, for
  // every transform: one measure for all (ΔE00 when the first observer's responses are XYZ, ΔE_WLab otherwise)
  const xyzFirst = conds[0].observer === observers.cie1931 || conds[0].observer === observers.cie1964;
  const nf = wptNormalization(conds[0].observer, conds[0].light), m0 = conds.map((c) => ANIM.reflectances.map((r) => sensorResponses(r, c.observer, c.light) as Vec3));
  const apartFor = (k: string) => {
    const st = conds.map((c) => stagesOf(k, c)), K = st[0].length - 1, out = inv3(st[0][K].m);
    const q = conds.map((_, c) => m0[c].map((x) => mulMV(out, mulMV(st[c][K].m, x))));
    const d = (a: Vec3, b: Vec3) => (xyzFirst ? deltaE00(xyzToLab(a, nf.white), xyzToLab(b, nf.white)) : deltaEWlab(wptToWlab(mulMV(nf.toWpt, a)), wptToWlab(mulMV(nf.toWpt, b))));
    let s = 0;
    for (let j = 0; j < ANIM.names.length; j++) s += (d(q[0][j], q[1][j]) + d(q[0][j], q[2][j]) + d(q[1][j], q[2][j])) / 3;
    return s / ANIM.names.length;
  };
  const kinds = observersMode ? [['wpt', 'Wpt MAT'], ['vk', 'von Kries']] : [['wpt', 'Wpt MAT'], ['cat02', 'CAT02'], ['vk', 'von Kries']];
  $('animSpread').textContent = `Carried into the common representation and out under ${conds[0].name}, the same material's three points land this far `
    + `apart (mean ${xyzFirst ? 'ΔE00' : 'ΔE_WLab'}): ${kinds.map(([k, l]) => `${l} ${f2(apartFor(k))}`).join(', ')}. Under one condition they would be one point.`;
  const stages = conds.map((c) => stagesOf(kind, c));
  const measured = conds.map((c) => ANIM.reflectances.map((r) => sensorResponses(r, c.observer, c.light) as Vec3));
  // the way back: into the common representation by the condition's own T, out by the target's T⁻¹
  const own = $<HTMLSelectElement>('animBack').value === 'own', target = conds.map((_, i) => (own ? i : 0));
  const back = conds.map((_, i) => {
    const K = stages[i].length - 1, t = target[i], out = inv3(stages[t][K].m);
    return measured[i].map((x) => mulMV(out, mulMV(stages[i][K].m, x)));
  });
  path = { conds, stages, measured, back, target };
  $('animLegend').innerHTML = conds.map((c) => `<span class="key"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="${c.color}"/></svg>${escapeHtml(c.name)}</span>`).join('')
    + '<span class="key">larger points: the 40 hues at Value 5, Chroma 6; lines join each condition\'s hue circle and spokes</span>';
  drawAnimation();
}

/** Where every point is at animation time t (0 to 1): in, step by step, then back out, each move eased. */
function framePoints(t: number): { pts: Vec3[][]; label: string; inside: boolean } {
  const p = path!, K = p.stages[0].length - 1, moves = 2 * K;
  const x = Math.min(moves, Math.max(0, t * moves)), i = Math.min(moves - 1, Math.floor(x)), f0 = x - i;
  const f = f0 < 0.2 ? 0 : f0 > 0.8 ? 1 : (1 - Math.cos(((f0 - 0.2) / 0.6) * Math.PI)) / 2;
  const at = (c: number, k: number, out: boolean): Vec3[] => (out ? p.back[c].map((v) => mulMV(p.stages[p.target[c]][k].m, v)) : p.measured[c].map((v) => mulMV(p.stages[c][k].m, v)));
  const pts = p.conds.map((_, c) => {
    // moves 0 … K−1 go in (stage i to i+1); moves K … 2K−1 come out (stage 2K−i to 2K−i−1)
    const out = i >= K, a = out ? 2 * K - i : i, b = out ? a - 1 : a + 1;
    const A = at(c, a, out), B = at(c, b, out);
    return A.map((v, j) => v.map((u, d) => u + f * (B[j][d] - u)) as unknown as Vec3);
  });
  const stageIndex = i >= K ? (f > 0.5 ? 2 * K - i - 1 : 2 * K - i) : (f > 0.5 ? i + 1 : i);
  // going out, a move undoes the stage it starts from (2K − i), named until the last move lands
  const undoing = i >= K && !(i === K && f === 0) ? 2 * K - i : 0;
  const label = undoing && !(stageIndex === 0 && f === 1) ? `Back out: ${p.stages[0][undoing].label.replace(/^\d\. /, 'undoing ')}`
    : stageIndex === 0 ? (i >= K ? `Back out: ${own() ? 'each in its own condition again' : `the predictions under ${p.conds[0].name}`}` : 'The measurements, each in its own condition')
    : p.stages[0][stageIndex].label;
  return { pts, label, inside: stageIndex === K };
}
const own = () => $<HTMLSelectElement>('animBack').value === 'own';

let animT = 0, playing = false, last = 0;

function drawAnimation(): void {
  if (!path) return;
  const { pts, label } = framePoints(animT);
  $('animStage').textContent = label;
  cloud3d($<HTMLCanvasElement>('anim3d'), {
    // the 40 hues (the first points) drawn larger than the spokes, so the circle stands out in the Value 5 plane
    sets: path.conds.flatMap((c, i) => {
      const all = pts[i].map(([a, b, cc]) => [b, cc, a]);
      return [{ pts: all.slice(0, ANIM_HUES), color: c.color, dot: 3.2 }, { pts: all.slice(ANIM_HUES), color: c.color }];
    }),
    lines: { from: path.conds.flatMap((_, i) => ANIM.links.map(([a]) => [pts[i][a][1], pts[i][a][2], pts[i][a][0]])), to: path.conds.flatMap((_, i) => ANIM.links.map(([, b]) => [pts[i][b][1], pts[i][b][2], pts[i][b][0]])), color: 'var(--line)',
      colors: path.conds.flatMap((c) => ANIM.links.map(() => c.color)) },
    // from above, so the planes of Value open into rings
    // the scale fitted to each frame: it changes smoothly as the points move, and the points fill the view at every step
    axes: ['2nd', '3rd', '1st'], range: Math.max(...pts.flat(2).map(Math.abs)) * 1.05, dot: 2, start: { yaw: -0.6, pitch: 1 },
  });
  $<HTMLInputElement>('animT').value = String(Math.round(animT * 1000));
}

function tick(now: number): void {
  if (!playing || !path) return;
  const K = path.stages[0].length - 1, seconds = 2 * K * 1.6;
  animT = Math.min(1, animT + (now - last) / 1000 / seconds);
  last = now;
  drawAnimation();
  if (animT >= 1) { playing = false; $('animPlay').textContent = 'Play again'; return; }
  requestAnimationFrame(tick);
}
$('animPlay').addEventListener('click', () => {
  if (playing) { playing = false; $('animPlay').textContent = 'Play'; return; }
  if (animT >= 1) animT = 0;
  playing = true;
  $('animPlay').textContent = 'Pause';
  last = performance.now();
  requestAnimationFrame(tick);
});
$('animT').addEventListener('input', () => { playing = false; $('animPlay').textContent = 'Play'; animT = Number($<HTMLInputElement>('animT').value) / 1000; drawAnimation(); });
for (const id of ['animTransform', 'animConditions', 'animBack', 'animL1', 'animL2', 'animL3', 'animO1', 'animO2', 'animO3']) {
  $(id).addEventListener('input', () => { playing = false; animT = 0; $('animPlay').textContent = 'Play'; void buildAnimation(); });
}

guide();
void render();
void buildAnimation();

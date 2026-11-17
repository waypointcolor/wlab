// Lab H: metamers and material color equivalency. The reflectances that share a material's Wpt in a condition (the
// matches of section 2), made with the metameric blacks real materials carry, narrowed by matching several conditions
// at once (section 3), and a realistic reflectance for given color values (section 4); the results go to the Objects lab as a
// table of reflectances (section 5). The computations are in mce.ts.
// Bundled into labs/metamers.html by scripts/build-web.mjs.

import {
  deltaEWlab, fromPolar, munsell1600, observers, resample, toPolar, wavelengths, wlabToRgb, wlabToWpt, wptNormalization,
  type ObserverName, type Spectrum, type Vec3, type WptNormalization,
} from '../../src/index.ts';
import { LIGHTS, type LightName } from './lights.ts';
import { $, copy, download, escapeHtml, LIGHT_LABEL, OBSERVER_LABEL, parseTable, scatter, spectrumPlot } from './kit.ts';
import { OBJECT_SETS, objectsOf, type ObjectSet } from './library.ts';
import { fromSpace, inSpace, munsellChips } from './hue.ts';
import { writeMaterials, type Material } from './shifts.ts';
import { blackBasis, conditionRows, estimateReflectance, hueFamily, metamersOf, spreadIn, type BlackBasis, type HueFamily } from './mce.ts';

const f1 = (v: number) => v.toFixed(1), f2 = (v: number) => v.toFixed(2), f3 = (v: number) => v.toFixed(3);
const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;
// the CIE color-matching observers (the 2015 ones stand for the CIE 2006 cone fundamentals they are made from)
const OBS: ObserverName[] = ['cie1931', 'cie1964', 'cie2015', 'cie2015_10'], LIGHT_KEYS = Object.keys(LIGHT_LABEL) as LightName[];
const shortLight = (k: LightName) => LIGHT_LABEL[k].replace(/ \(.*$/, '');
const shortObserver = (o: ObserverName) => OBSERVER_LABEL[o];

// ---------------------------------------------------------------------------------------------------------------
// Conditions

interface Cond { key: string; label: string; observer: ObserverName; light: LightName; norm: WptNormalization; rows: number[][] }
const conds = new Map<string, Cond>();
function condOf(observer: ObserverName, light: LightName): Cond {
  const key = `${observer}|${light}`;
  let c = conds.get(key);
  if (!c) {
    const o = observers[observer];
    c = { key, label: `${shortObserver(observer)} under ${shortLight(light)}`, observer, light, norm: wptNormalization(o, LIGHTS[light]), rows: conditionRows(o, LIGHTS[light]) };
    conds.set(key, c);
  }
  return c;
}

const fill = (id: string, options: [string, string][], value: string) => {
  const s = $<HTMLSelectElement>(id);
  s.replaceChildren(...options.map(([v, t]) => new Option(t, v)));
  s.value = value;
};
fill('observer', OBS.map((k) => [k, OBSERVER_LABEL[k]]), 'cie1931');
fill('light', LIGHT_KEYS.map((k) => [k, LIGHT_LABEL[k]]), 'D65');
const matched = () => condOf($<HTMLSelectElement>('observer').value as ObserverName, $<HTMLSelectElement>('light').value as LightName);

// the conditions to look in: every observer ticked under every light ticked
const checks = (id: string, items: [string, string][], on: string[]) => {
  $(id).innerHTML = items.map(([v, t]) => `<label><input type="checkbox" value="${v}"${on.includes(v) ? ' checked' : ''}> ${escapeHtml(t)}</label>`).join('');
};
checks('lookObservers', OBS.map((k) => [k, OBSERVER_LABEL[k]]), ['cie1931', 'cie1964']);
checks('lookLights', LIGHT_KEYS.map((k) => [k, LIGHT_LABEL[k]]), ['D65', 'D50', 'A', 'F11', 'LED-B3', 'LED-V1']);
const ticked = (id: string) => [...$(id).querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value);
function lookConditions(): Cond[] {
  return ticked('lookObservers').flatMap((o) => ticked('lookLights').map((l) => condOf(o as ObserverName, l as LightName)));
}

// ---------------------------------------------------------------------------------------------------------------
// The material

const SET_IDS = ['munsell1600', 'pmcc', 'colorchecker-sg', 'cie-ces99', 'morimoto-natural-objects'];
const SETS = SET_IDS.map((id) => OBJECT_SETS.find((s) => s.id === id)).filter((s): s is ObjectSet => !!s);
fill('set', SETS.map((s) => [s.id, `${s.title} (${s.count})`]), 'munsell1600');
const loaded = new Map<string, { names: readonly string[]; reflectances: readonly Spectrum[] }>();
async function loadSet(id: string) {
  if (!loaded.has(id)) { const o = await objectsOf([id]); loaded.set(id, { names: o.names, reflectances: o.reflectances }); }
  return loaded.get(id)!;
}
async function showSet(prefer?: string): Promise<void> {
  const id = $<HTMLSelectElement>('set').value, s = await loadSet(id);
  fill('material', s.names.map((n, i) => [String(i), n]), String(Math.max(0, prefer ? s.names.indexOf(prefer) : 0)));
  const set = SETS.find((x) => x.id === id)!;
  $('setCredit').textContent = `${set.title}: ${set.credit}`;
}

let pasted: Material | undefined;
function material(): Material {
  if (pasted) return pasted;
  const s = loaded.get($<HTMLSelectElement>('set').value)!, i = Number($<HTMLSelectElement>('material').value);
  return { name: s.names[i], reflectance: s.reflectances[i] };
}
$('paste').addEventListener('input', () => {
  const text = $<HTMLTextAreaElement>('paste').value.trim();
  pasted = undefined;
  $('pasteStatus').textContent = '';
  if (text) {
    try {
      const t = parseTable(text, 1);
      if (t.nm[0] > 420 || t.nm[t.nm.length - 1] < 680) throw new Error('it needs to cover 420 to 680 nm');
      const pct = Math.max(...t.columns[0]) > 1.5 ? 100 : 1;
      pasted = { name: /^Column \d+$/.test(t.names[0]) ? 'Your reflectance' : t.names[0], reflectance: resample(t.nm, t.columns[0].map((v) => v / pct)) };
      $('pasteStatus').textContent = `Using ${pasted.name}.`;
    } catch (e) { $('pasteStatus').textContent = `Cannot read it: ${e instanceof Error ? e.message : String(e)}.`; }
  }
  materialChanged();
});

// ---------------------------------------------------------------------------------------------------------------
// Metameric blacks, from the corrected Munsell colors, for a set of conditions

const MUNSELL = munsell1600().reflectances;
const bases = new Map<string, BlackBasis>();
function basisFor(cs: Cond[], count: number): BlackBasis {
  const key = `${cs.map((c) => c.key).join('+')}#${count}`;
  if (!bases.has(key)) bases.set(key, blackBasis(MUNSELL, cs.flatMap((c) => c.rows), count));
  return bases.get(key)!;
}

const screen = (wl: Vec3) => `rgb(${wlabToRgb(wl, 'srgb').map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))).join(',')})`;
let seed = 1;
let oneFamily: Spectrum[] = [], manyFamily: { label: string; family: Spectrum[] } | undefined, estimate: { name: string; reflectance: Spectrum } | undefined;

// ---------------------------------------------------------------------------------------------------------------
// Section 1 and 2: the material, and its metamers for one condition

function spreadCells(c: Cond, r: Spectrum, family: Spectrum[], isMatched: boolean): string {
  const d = spreadIn(c.norm, r, family, deltaEWlab);
  return `<td class="sep">${isMatched ? '0' : f2(mean(d))}</td><td>${isMatched ? '0' : f2(Math.max(...d))}</td>`;
}

function renderOne(): void {
  const m = material(), c = matched(), look = lookConditions();
  const count = Number($<HTMLSelectElement>('count').value), nBlacks = Number($<HTMLSelectElement>('blacks').value);
  $('materialPlot').innerHTML = spectrumPlot(m.name, [{ values: m.reflectance, color: 'var(--ink)', label: m.name }]);
  oneFamily = metamersOf(m.reflectance, basisFor([c], nBlacks), count, seed);
  $('oneSpectra').innerHTML = spectrumPlot(`${m.name} and ${count} metamers for ${c.label}`, [
    ...oneFamily.map((v, i) => ({ values: v, color: 'var(--accent)', width: 0.8, label: i ? '' : `metamers for ${c.label}` })),
    { values: m.reflectance, color: 'var(--ink)', width: 2.4, label: m.name },
  ]);
  const rows = [c, ...look.filter((x) => x.key !== c.key)];
  $('oneTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Looked in</th><th class="sep">mean</th><th>largest</th></tr></thead>
    <tbody>${rows.map((x) => `<tr${x.key === c.key ? ' class="own"' : ''}><td>${escapeHtml(x.label)}${x.key === c.key ? ' (matched)' : ''}</td>
    ${spreadCells(x, m.reflectance, oneFamily, x.key === c.key)}</tr>`).join('')}</tbody></table></div>`;
  const seen = $<HTMLSelectElement>('seenIn'), was = seen.value;
  seen.replaceChildren(...rows.filter((x) => x.key !== c.key).map((x) => new Option(x.label, x.key)));
  if ([...seen.options].some((o) => o.value === was)) seen.value = was;
  renderOnePlot();
}

function renderOnePlot(): void {
  const m = material(), c = matched(), other = conds.get($<HTMLSelectElement>('seenIn').value);
  const views = [c, ...(other ? [other] : [])];
  const at = views.map((v) => ({ v, mat: v.norm.wlabOf(m.reflectance), fam: oneFamily.map((r) => v.norm.wlabOf(r)) }));
  const half = Math.max(2, ...at.flatMap((a) => a.fam.flatMap((w) => [Math.abs(w[1] - a.mat[1]), Math.abs(w[2] - a.mat[2])]))) * 1.15;
  $('onePlot').innerHTML = at.map((a) => `<div>${scatter({
    xLabel: `aw, ${a.v.label}`, yLabel: 'bw', square: true, outline: true,
    x: [a.mat[1] - half, a.mat[1] + half], y: [a.mat[2] - half, a.mat[2] + half],
    sets: [
      { pts: a.fam.map((w) => [w[1], w[2]]), color: 'var(--accent)', label: 'metamers', colors: a.fam.map(screen), titles: a.fam.map((w, i) => `metamer ${i + 1}: ΔE_WLab ${f2(deltaEWlab(w, a.mat))}`) },
      { pts: [[a.mat[1], a.mat[2]]], color: 'var(--ink)', label: m.name, ring: true, titles: [m.name] },
    ],
  })}</div>`).join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Section 3: several conditions at once

const EXTRA_DEFAULTS: [boolean, ObserverName, LightName][] = [[true, 'cie1931', 'A'], [true, 'cie1964', 'D65'], [false, 'cie1931', 'F11']];
$('moreConditions').innerHTML = EXTRA_DEFAULTS.map(([on], k) => `<div class="row"><label><input type="checkbox" id="extraOn${k}"${on ? ' checked' : ''}> Also match</label>
  <label>Observer <select id="extraO${k}" autocomplete="off"></select></label><label>Light <select id="extraL${k}" autocomplete="off"></select></label></div>`).join('');
EXTRA_DEFAULTS.forEach(([, o, l], k) => { fill(`extraO${k}`, OBS.map((x) => [x, OBSERVER_LABEL[x]]), o); fill(`extraL${k}`, LIGHT_KEYS.map((x) => [x, LIGHT_LABEL[x]]), l); });
const extras = () => EXTRA_DEFAULTS.map((_, k) => k).filter((k) => $<HTMLInputElement>(`extraOn${k}`).checked)
  .map((k) => condOf($<HTMLSelectElement>(`extraO${k}`).value as ObserverName, $<HTMLSelectElement>(`extraL${k}`).value as LightName));

function renderMany(): void {
  const m = material(), c = matched(), look = lookConditions();
  const count = Number($<HTMLSelectElement>('count').value), nBlacks = Number($<HTMLSelectElement>('blacks').value);
  const sets: Cond[][] = [[c]];
  for (const x of extras()) if (!sets[sets.length - 1].some((y) => y.key === x.key)) sets.push([...sets[sets.length - 1], x]);
  const families = sets.map((s) => metamersOf(m.reflectance, basisFor(s, nBlacks), count, seed));
  const rows = [...new Map([...sets[sets.length - 1], ...look].map((x) => [x.key, x])).values()];
  const head = sets.map((s, k) => `<th class="sep">${k ? `+ ${escapeHtml(s[s.length - 1].label)}` : escapeHtml(c.label)}<span class="what">${s.length} matched</span></th>`).join('');
  $('manyTable').innerHTML = `<div class="table-wrap"><table class="many"><thead><tr><th>Looked in</th>${head}</tr></thead><tbody>${rows.map((x) => `<tr><td>${escapeHtml(x.label)}</td>${sets.map((s, k) => {
    if (s.some((y) => y.key === x.key)) return '<td class="sep">0</td>';
    const d = spreadIn(x.norm, m.reflectance, families[k], deltaEWlab);
    return `<td class="sep">${f2(mean(d))} (${f2(Math.max(...d))})</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
  const last = families[families.length - 1], lastSet = sets[sets.length - 1];
  manyFamily = sets.length > 1 ? { label: `${lastSet.length} conditions`, family: last } : undefined;
  $('manySpectra').innerHTML = sets.length > 1 ? spectrumPlot(`${m.name} and metamers for ${lastSet.length} conditions at once`, [
    ...last.map((v, i) => ({ values: v, color: 'var(--accent2)', width: 0.8, label: i ? '' : `metamers for all ${lastSet.length} conditions` })),
    { values: m.reflectance, color: 'var(--ink)', width: 2.4, label: m.name },
  ]) : '<p class="note">Tick at least one condition to match as well.</p>';
}

// ---------------------------------------------------------------------------------------------------------------
// Section 4: from a color (in WLch, WLab, CIELCh or CIELAB, converted to Wpt) to a reflectance

const families = new Map<string, HueFamily>();
function familyFor(c: Cond): HueFamily {
  if (!families.has(c.key)) {
    const top = new Map<string, ReturnType<typeof munsellChips>[number]>();
    for (const chip of munsellChips()) { const b = top.get(chip.hue); if (!b || chip.chroma > b.chroma) top.set(chip.hue, chip); }
    const chips = [...top.values()];
    families.set(c.key, hueFamily(chips.map((x) => `${x.hue} ${x.value}/${x.chroma}`), chips.map((x) => x.reflectance), c.norm));
  }
  return families.get(c.key)!;
}

// the spaces a target can be given in: WLab and CIELAB (the condition's, against its white), each also in polar form
type Space = 'wlch' | 'wlab' | 'cielch' | 'cielab';
const SPACE: Record<Space, { name: string; coords: [string, string, string]; text: [string, string, string]; polar: boolean }> = {
  wlch: { name: 'WLch', coords: ['L<sub>w</sub>', 'C<sub>w</sub>', 'h<sub>w</sub> (°)'], text: ['Lw', 'Cw', 'hw'], polar: true },
  wlab: { name: 'WLab', coords: ['L<sub>w</sub>', 'a<sub>w</sub>', 'b<sub>w</sub>'], text: ['Lw', 'aw', 'bw'], polar: false },
  cielch: { name: 'CIELCh', coords: ['L*', 'C*<sub>ab</sub>', 'h<sub>ab</sub> (°)'], text: ['L*', 'C*ab', 'hab'], polar: true },
  cielab: { name: 'CIELAB', coords: ['L*', 'a*', 'b*'], text: ['L*', 'a*', 'b*'], polar: false },
};
const space = () => $<HTMLSelectElement>('estSpace').value as Space;
/** A WLab color's coordinates in a space, in a condition. */
function toSpace(wlab: Vec3, s: Space, c: Cond): Vec3 {
  const v = s === 'wlch' || s === 'wlab' ? wlab : inSpace('cielab', wlab, c.norm);
  return SPACE[s].polar ? toPolar(v) : v;
}
/** The WLab color with these coordinates in a space, in a condition. */
function fromSpaceCoords(v: Vec3, s: Space, c: Cond): Vec3 {
  const cart = SPACE[s].polar ? fromPolar([v[0], Math.max(0, v[1]), v[2]]) : v;
  return s === 'wlch' || s === 'wlab' ? cart : fromSpace('cielab', cart, c.norm);
}
const fmtIn = (s: Space, v: Vec3) => v.map((x, i) => (SPACE[s].polar && i === 2 ? f1(x) : f2(x)));
function writeTarget(wlab: Vec3): void {
  const s = space(), v = fmtIn(s, toSpace(wlab, s, matched()));
  SPACE[s].coords.forEach((n, i) => { $(`estN${i}`).innerHTML = n; $<HTMLInputElement>(`est${i}`).value = v[i]; });
}
/** The target as WLab, from the inputs read in a space (undefined while one is not a number). */
function readTarget(s = space()): Vec3 | undefined {
  const v = [0, 1, 2].map((i) => Number($<HTMLInputElement>(`est${i}`).value)) as Vec3;
  return v.every(Number.isFinite) && $<HTMLInputElement>('est0').value.trim() !== '' ? fromSpaceCoords(v, s, matched()) : undefined;
}
function setTargetFromMaterial(): void { writeTarget(matched().norm.wlabOf(material().reflectance)); }
let lastSpace: Space = space();
$('estSpace').addEventListener('input', () => {
  const was = readTarget(lastSpace);
  lastSpace = space();
  if (was) writeTarget(was); else setTargetFromMaterial();
  renderEstimate();
});

function spreadOf(r: Spectrum, c: Cond, look: Cond[]): number {
  const others = look.filter((x) => x.key !== c.key), at = c.norm.wlabOf(r);
  return others.length ? mean(others.map((x) => deltaEWlab(x.norm.wlabOf(r), at))) : 0;
}

function renderEstimate(): void {
  const c = matched(), m = material(), look = lookConditions();
  const s = space(), target = readTarget(s);
  if (!target) { $('estResult').innerHTML = '<p class="note">Give all three values.</p>'; return; }
  const wpt = wlabToWpt(target);
  const asText = (wl: Vec3) => { const v = fmtIn(s, toSpace(wl, s, c)); return SPACE[s].text.map((n, i) => `${n} ${v[i]}`).join(', '); };
  const name = `Estimate for ${SPACE[s].name} ${asText(target)} (${c.label})`;
  const e = estimateReflectance(wpt, familyFor(c), c.norm);
  const reflectance = e ? e.reflectance : wavelengths.map(() => wpt[0] / 100);
  estimate = { name, reflectance };
  const got = c.norm.wlabOf(reflectance);
  const rows: [string, string][] = e ? [
    ['Characteristic reflectance', `a mix of ${escapeHtml(e.between[0])} and ${escapeHtml(e.between[1])}, ${f2(1 - e.mix)} and ${f2(e.mix)}`],
    ['Gray part g and selective part s', `g ${f3(e.g)}, s ${f3(e.s)}: the reflectance is g + s × the characteristic reflectance`],
    ['Within 0 to 1', e.inRange ? 'yes' : `no: it runs from ${f3(Math.min(...reflectance))} to ${f3(Math.max(...reflectance))}, beyond what a reflectance can be; no material of this hue family reaches this lightness and chroma`],
  ] : [['A gray', `no hue: the nonselective gray of reflectance ${f3(reflectance[0])}`]];
  rows.push([`Its ${SPACE[s].name} in the condition`, `${escapeHtml(asText(got))} (ΔE<sub>WLab</sub> from the target ${deltaEWlab(got, target).toExponential(1)})`]);
  rows.push(['Spread over the conditions looked in', `${f2(spreadOf(reflectance, c, look))}; the material of section 1: ${f2(spreadOf(m.reflectance, c, look))}`]);
  $('estResult').innerHTML = `<div class="table-wrap"><table class="kv"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>`;
  $('estSpectra').innerHTML = spectrumPlot('The estimate', [
    { values: m.reflectance, color: 'var(--quiet)', width: 1.4, label: `${m.name} (section 1)` },
    ...(e ? [{ values: e.characteristic, color: 'var(--accent2)', width: 1.4, dash: '5 3', label: 'the characteristic reflectance used' }] : []),
    { values: reflectance, color: 'var(--accent)', width: 2.4, label: 'the estimate' },
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// Section 5: to the Objects lab

function allMaterials(): Material[] {
  const m = material(), c = matched();
  return [
    m,
    ...oneFamily.map((r, i) => ({ name: `${m.name}, metamer ${i + 1} for ${c.label}`, reflectance: r })),
    ...(manyFamily ? manyFamily.family.map((r, i) => ({ name: `${m.name}, metamer ${i + 1} for ${manyFamily!.label}`, reflectance: r })) : []),
    ...(estimate ? [estimate] : []),
  ];
}
$('copyAll').addEventListener('click', () => copy(writeMaterials(allMaterials(), 'rows'), $<HTMLButtonElement>('copyAll')));
$('downloadAll').addEventListener('click', () => download('metamers.csv', writeMaterials(allMaterials(), 'rows'), 'text/csv'));

// ---------------------------------------------------------------------------------------------------------------

function renderAll(): void { renderOne(); renderMany(); renderEstimate(); }
function materialChanged(): void { setTargetFromMaterial(); renderAll(); }

$('set').addEventListener('input', async () => { await showSet(); materialChanged(); });
$('material').addEventListener('input', materialChanged);
for (const id of ['observer', 'light']) $(id).addEventListener('input', materialChanged);
for (const id of ['count', 'blacks', 'lookObservers', 'lookLights', 'moreConditions']) $(id).addEventListener('change', renderAll);
$('reroll').addEventListener('click', () => { seed++; renderOne(); renderMany(); });
$('seenIn').addEventListener('input', renderOnePlot);
for (const id of ['est0', 'est1', 'est2']) $(id).addEventListener('input', renderEstimate);
$('estFromMaterial').addEventListener('click', () => { setTargetFromMaterial(); renderEstimate(); });

void showSet('10GY 5/10').then(materialChanged);

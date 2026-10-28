// Lab E: lighting. A test light against a reference light over a library of objects and observers: how far objects
// move between the two in WLab (the thesis's IRE), which move most, and the Planckian and daylight references that
// come closest; beside them the light's CCT and the color rendering indices (CIE 13.3 Ra, CIE 224 and TM-30 Rf, TM-30
// Rg), for one test light or many at once.
// Bundled into labs/lighting.html by scripts/build-web.mjs.

import {
  categoricalObserver, cct, cie2006, daylight, deltaEsOf, fluorescents, illuminants, ire, observers, planckian, resample, wlabsOf,
  type IlluminantName, type Observer, type SampleSet, type Spectrum,
} from '../../src/index.ts';
import { cri, fidelity, fidelityReference, type Fidelity } from './rendering.ts';
import { CAMERA_CREDIT, cameraObservers } from './cameras.ts';
import { fromDisk } from './fetchdata.ts';
import { hueTurn } from './shifts.ts';
import { $, download, escapeHtml, histogram, LIGHT_LABEL, linePlot, optIn, parseTable, scatter, spectrumPlot } from './kit.ts';
import { OBJECT_SETS, objectsOf, ownSet, type ObjectSet } from './library.ts';
import { readObjectFile } from './objectfile.ts';

const message = (e: unknown) => (e as Error).message;
const meanOf = (v: ArrayLike<number>) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s / v.length; };
const f2 = (v: number) => v.toFixed(2), f3 = (v: number) => v.toFixed(3);
const pct = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(100 * v)}%`);

/** A short fingerprint of spectra or curves, so that results are reused while what they were computed from is unchanged. */
function fingerprint(curves: readonly (readonly number[])[]): string {
  let h = 2166136261;
  for (const c of curves) for (const v of c) h = Math.imul(h ^ Math.round(v * 1e6), 16777619);
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------------------------------------------
// Lights

interface Light { key: string; label: string; spd: Spectrum; group?: string }

const builtIn = (k: IlluminantName): Light => ({ key: k, label: LIGHT_LABEL[k], spd: illuminants[k] });
const FL_KIND = (n: number) => (n <= 6 ? 'standard fluorescent' : n <= 9 ? 'broadband fluorescent' : 'tri-band fluorescent');
const FLUORESCENT: Light[] = Object.entries(fluorescents).map(([k, spd]) => ({ key: k, label: `${k} (${FL_KIND(Number(k.slice(1)))})`, spd, group: FL_KIND(Number(k.slice(1))) }));
const LEDS: Light[] = (Object.keys(illuminants) as IlluminantName[]).filter((k) => k.startsWith('LED-')).map((k) => ({ ...builtIn(k), group: 'CIE LED' }));

const range = (a: number, b: number, s: number) => Array.from({ length: Math.round((b - a) / s) + 1 }, (_, i) => a + s * i);
const PLANCK = range(1750, 12000, 250), DAY = range(4000, 14000, 250);
/** The references of sections 4 and 6: every Planckian light, then every daylight, as in the thesis's tables. */
const REFS: (Light & { kind: 'planck' | 'day'; t: number })[] = [
  ...PLANCK.map((t) => ({ key: `planck${t}`, label: `Planckian ${t} K`, spd: planckian(t), kind: 'planck' as const, t })),
  ...DAY.map((t) => ({ key: `day${t}`, label: `daylight ${t} K`, spd: daylight(t), kind: 'day' as const, t })),
];

/** The first light of a table of numbers (wavelength, then power), with how many there were. */
function readOneLight(text: string): { spd: Spectrum; name: string; count: number } {
  const t = parseTable(text, 1);
  const spd = resample(t.nm, t.columns[0]);
  if (spd.some((v) => v < 0) || !spd.some((v) => v > 0)) throw new Error('a light needs positive power and none below 0');
  return { spd, name: /^Column \d+$/.test(t.names[0]) ? 'your light' : t.names[0], count: t.columns.length };
}

/** The lights of a table of numbers: one per column after the wavelength, named by the header or by `source`. */
function readLights(text: string, source: string): Light[] {
  const t = parseTable(text, 1);
  return t.columns.map((c, k) => {
    const spd = resample(t.nm, c);
    const unnamed = /^Column \d+$/.test(t.names[k]);
    const name = !unnamed ? t.names[k] : t.columns.length > 1 ? `${source}, light ${k + 1}` : source;
    if (spd.some((v) => v < 0) || !spd.some((v) => v > 0)) throw new Error(`${name}: a light needs positive power and none below 0`);
    return { key: `yours:${fingerprint([spd])}`, label: `${name} (yours)`, spd, group: 'other' };
  });
}

/** A reference found from the test light: the one rendering the objects most alike (lowest IRE), or at its CCT. */
type Closest = 'any' | 'planck' | 'day' | 'yours';
type AtCct = 'cri' | 'fidelity';
interface Picked { light?: Light; closest?: Closest; atCct?: AtCct; yours?: Light[] }

/**
 * A light picker: the common lights, the CIE fluorescent lights, daylight or Planckian at a temperature, or your own
 * (pasted or from a file). With `found`, it also offers references found from the test light, which `get()` returns as
 * a choice to resolve rather than a light: the one rendering the objects most alike (the lowest IRE, section 4) among
 * the Planckian and daylight lights or among lights of your own, or the reference of the color rendering indices at
 * the test light's CCT (section 5).
 */
function lightPicker(host: HTMLElement, start: string, onChange: () => void, found = false): { get(): Picked } {
  host.innerHTML = `
    <div class="row">
      <label>Light <select data-k="light" autocomplete="off"></select></label>
      <label data-k="kelvinBox" hidden><span data-k="kelvinLabel">Temperature</span>
        <input type="number" data-k="kelvin" min="1000" max="25000" step="50" value="4000"> K</label>
    </div>
    <p class="note" data-k="kelvinNote" hidden></p>
    <div data-k="ownBox" hidden>
      <div class="row"><label>From a file <input type="file" data-k="file" accept=".txt,.csv,.tsv"></label></div>
      <textarea data-k="paste" spellcheck="false" placeholder="nm, my lamp&#10;380, 2.1&#10;385, 2.3&#10;…"></textarea>
      <p class="note" data-k="ownNote"></p>
    </div>`;
  const el = <T extends HTMLElement>(k: string) => host.querySelector(`[data-k="${k}"]`) as T;
  const light = el<HTMLSelectElement>('light');
  const group = (label: string, options: HTMLOptionElement[]) => { const g = document.createElement('optgroup'); g.label = label; g.append(...options); return g; };
  const ONE = 'Wavelength in nm and relative power, any scale; comma, tab or space separated, header row optional, at least 420 to 680 nm. A file\'s numbers appear in the box. Read in this page; they go nowhere.';
  const MANY = 'Your candidate references: wavelength in nm in the first column and one light per column (a header row can name them), relative power at any scale, at least 420 to 680 nm. A file\'s numbers appear in the box. Read in this page; they go nowhere.';
  light.replaceChildren(
    ...(found ? [group('Found from the test light', [
      new Option('The Planckian or daylight light with the lowest IRE (section 4)', 'closest:any'),
      new Option('The Planckian light with the lowest IRE (section 4)', 'closest:planck'),
      new Option('The daylight with the lowest IRE (section 4)', 'closest:day'),
      new Option('The one of your own lights with the lowest IRE…', 'closest:yours'),
      new Option('At the test light\'s CCT: the color rendering index\'s reference (section 5)', 'cct:cri'),
      new Option('At the test light\'s CCT: the reference of CIE 224 and TM-30 (section 5)', 'cct:fidelity'),
    ])] : []),
    group('Common lights', (Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k) => new Option(LIGHT_LABEL[k], k))),
    group('CIE fluorescent lights', FLUORESCENT.map((l) => new Option(l.label, `fl:${l.key}`))),
    group('Others', [new Option('Daylight at a temperature…', 'daylight'),
      new Option('Planckian at a temperature…', 'planckian'), new Option('Your own light (paste or file)…', 'paste')]),
  );
  light.value = start;
  const sync = () => {
    const day = light.value === 'daylight', planck = light.value === 'planckian';
    el('kelvinBox').hidden = el('kelvinNote').hidden = !day && !planck;
    if (day || planck) {
      el('kelvinLabel').textContent = day ? 'Correlated color temperature (CCT)' : 'Temperature';
      el<HTMLInputElement>('kelvin').min = day ? '4000' : '1000';
      el('kelvinNote').textContent = day
        ? 'CIE daylight for this CCT, from 4000 to 25000 K: its white lies near that of a blackbody at that temperature (5000 K gives D50).'
        : 'A blackbody (Planckian) radiator at this temperature; about 2700 K is a household incandescent bulb, 2856 K is CIE illuminant A.';
    }
    el('ownBox').hidden = light.value !== 'paste' && light.value !== 'closest:yours';
    if (light.value === 'paste' && !el('ownNote').dataset.read) el('ownNote').textContent = ONE;
    if (light.value === 'closest:yours' && !el('ownNote').dataset.read) el('ownNote').textContent = MANY;
    onChange();
  };
  host.addEventListener('input', sync);
  host.addEventListener('change', sync);
  el<HTMLInputElement>('file').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    el<HTMLTextAreaElement>('paste').value = await file.text();
    sync();
  });
  sync();
  return {
    get(): Picked {
      const v = light.value, kelvin = Number(el<HTMLInputElement>('kelvin').value);
      const note = el('ownNote');
      if (v === 'closest:yours') {
        const text = el<HTMLTextAreaElement>('paste').value;
        if (!text.trim()) { delete note.dataset.read; note.textContent = MANY; throw new Error('give your candidate reference lights in the box (pasted or from a file)'); }
        const yours = readLights(text, 'your light');
        note.dataset.read = '1';
        note.textContent = `Read: ${yours.length} candidate reference${yours.length > 1 ? 's' : ''} (${yours.map((l) => l.label.replace(/ \(yours\)$/, '')).join(', ')}).`;
        return { closest: 'yours', yours };
      }
      if (v.startsWith('closest:')) return { closest: v.slice(8) as Closest };
      if (v.startsWith('cct:')) return { atCct: v.slice(4) as AtCct };
      if (v.startsWith('fl:')) return { light: FLUORESCENT.find((l) => l.key === v.slice(3))! };
      if (v === 'daylight') {
        if (!(kelvin >= 4000 && kelvin <= 25000)) throw new Error('give a daylight CCT from 4000 to 25000 K');
        return { light: { key: `day${kelvin}`, label: `daylight ${kelvin} K`, spd: daylight(kelvin) } };
      }
      if (v === 'planckian') {
        if (!(kelvin >= 1000 && kelvin <= 25000)) throw new Error('give a temperature from 1000 to 25000 K');
        return { light: { key: `planck${kelvin}`, label: `Planckian ${kelvin} K`, spd: planckian(kelvin) } };
      }
      if (v === 'paste') {
        const { spd, name, count } = readOneLight(el<HTMLTextAreaElement>('paste').value);
        note.dataset.read = '1';
        note.textContent = count > 1 ? `The first of the ${count} lights given: ${name}.` : `Read: ${name}.`;
        return { light: { key: `yours:${fingerprint([spd])}`, label: name === 'your light' ? name : `${name} (yours)`, spd } };
      }
      return { light: builtIn(v as IlluminantName) };
    },
  };
}

let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(() => void render(), 0); };
const pickTest = lightPicker($('test'), 'fl:F11', schedule);
const pickRef = lightPicker($('reference'), 'closest:any', schedule, true);

// ---------------------------------------------------------------------------------------------------------------
// Section 6's test lights

interface LightSet { id: string; title: string; about: string; lights(): Light[] }
let yourLights: Light[] = [], fileLights: Light[] = [], pastedLights: Light[] = [];
const LIGHT_SETS: LightSet[] = [
  {
    id: 'fluorescent', title: 'The CIE fluorescent lights F1 to F12 (12 lights)',
    about: 'Standard halophosphate lamps (F1 to F6), broadband lamps (F7 to F9) and narrow tri-band lamps (F10 to F12), the fluorescent lamp types of CIE 15.',
    lights: () => FLUORESCENT,
  },
  {
    id: 'led', title: `The CIE LED lights (${LEDS.length} lights)`,
    about: 'The CIE\'s typical LED lamps (CIE 015:2018): five blue-pumped phosphor whites from about 2700 to 6600 K, a phosphor white with a red LED, a mix of red, green and blue LEDs, and two violet-pumped phosphor whites.',
    lights: () => LEDS,
  },
  {
    id: 'standard', title: 'The CIE standard illuminants A, C, D50, D65 and E (5 lights)',
    about: 'Incandescent light, older and newer daylight and equal energy: lights a reference is often made from.',
    lights: () => (['A', 'C', 'D50', 'D65', 'E'] as IlluminantName[]).map((k) => ({ ...builtIn(k), group: 'other' })),
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
const DEFAULT_LIGHTS = ['fluorescent', 'led'];
$('lightSets').innerHTML = LIGHT_SETS.map((s) => `<label><input type="checkbox" name="lights" value="${s.id}"${DEFAULT_LIGHTS.includes(s.id) ? ' checked' : ''}
  autocomplete="off"><span><b>${escapeHtml(s.title)}</b><span class="about">${escapeHtml(s.about)}</span></span></label>`).join('');
$('lightSets').addEventListener('change', schedule);
const syncYourLights = () => {
  yourLights = [...fileLights, ...pastedLights];
  const box = document.querySelector<HTMLInputElement>('#lightSets input[value=yours]');
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
    } catch (err) { notes.push(`${file.name}: cannot read it (${message(err)})`); }
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
    $('lightPasteNote').textContent = `Cannot read the pasted lights: ${message(err)}.`;
  }
  syncYourLights();
});

function testLights(): Light[] {
  const seen = new Set<string>(), out: Light[] = [];
  const on = [...document.querySelectorAll<HTMLInputElement>('#lightSets input:checked')].map((i) => i.value);
  for (const s of LIGHT_SETS.filter((s) => on.includes(s.id))) for (const l of s.lights()) if (!seen.has(l.key)) { seen.add(l.key); out.push(l); }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The objects and observers: the defaults, or the reader's own choice when opted in

interface ObserverSet { id: string; title: string; about: string; credit?: string; observers(): Promise<readonly Observer[]> }

// the observers the thesis computed its IRE over
let commonObservers: Observer[] | undefined;
const COMMON_OBSERVERS = () => (commonObservers ??= [observers.cie1931, observers.cie1964,
  ...range(1, 10, 1).flatMap((f) => range(20, 80, 10).map((a) => cie2006(f, a)))]);
let categorical: Observer[] | undefined;

/** The reader's own observers, from files and the paste box: one observer per file or paste, its columns its sensors. */
let yourObservers: Observer[] = [], fileObservers: Observer[] = [], pastedObserver: Observer[] = [];
const readObserver = (text: string, name: string): Observer => {
  const t = parseTable(text, 3);
  return { name, curves: t.columns.map((c) => resample(t.nm, c)) as unknown as Observer['curves'] };
};

const OBSERVER_SETS: ObserverSet[] = [
  {
    id: 'common', title: 'Common observers (72)',
    about: 'CIE 1931 (2°), CIE 1964 (10°) and the CIE 2006 observers for field sizes 1° to 10° and ages 20 to 80 in steps of 10 years, so that a light is judged across the variety of color-normal vision.',
    observers: async () => COMMON_OBSERVERS(),
  },
  {
    id: 'cie', title: 'The CIE standard observers (4)',
    about: 'CIE 1931 (2°), CIE 1964 (10°) and the CIE 2006 cone fundamentals (2° and 10°, 32 years): the observers lighting metrics are usually computed for. The CIE 2015 color-matching functions are a linear mix of the 2006 cone fundamentals and give the same results.',
    observers: async () => [observers.cie1931, observers.cie1964, observers.cie2006_2, observers.cie2006_10],
  },
  {
    id: 'categorical', title: 'The 10 categorical observers at 2° and 10° (20)',
    about: 'Ten groups of color-normal observers that together stand for observers at large, each with its own age, lens and macular density and photopigments.',
    credit: 'The categorical observers of Asano and Fairchild, used with permission.',
    observers: async () => (categorical ??= range(1, 10, 1).flatMap((c) => [categoricalObserver(c, 2), categoricalObserver(c, 10)])),
  },
  {
    id: 'cameras', title: 'The 52 open cameras',
    about: 'Cameras\' red, green and blue sensitivities, as observers: how far objects move between two lights for a camera, which a white balance alone cannot undo.',
    credit: CAMERA_CREDIT,
    observers: () => cameraObservers(),
  },
  {
    id: 'yours', title: 'Your own observers',
    about: 'From files or pasted below: wavelength in nm, then three or more sensitivity curves (color-matching functions, cone fundamentals, for example an individual\'s from a custom-observer measurement platform, or a camera\'s sensors), any scale, at least 420 to 680 nm; one observer per file. Read in this page; they go nowhere.',
    observers: async () => {
      if (!yourObservers.length) throw new Error('give your own observers below (a file or pasted), or untick "Your own observers"');
      return yourObservers;
    },
  },
];
const DEFAULT_OBJECTS = ['cie-ces99'], DEFAULT_OBSERVERS = ['common'];

/** The sets the reader loaded from files, after the library's. */
let ownSets: ObjectSet[] = [];
const allSets = () => [...OBJECT_SETS, ...ownSets];
const box = (name: string, id: string, title: string, about: string, checked: boolean, credit = '') => `<label><input type="checkbox"
  name="${name}" value="${escapeHtml(id)}"${checked ? ' checked' : ''} autocomplete="off"><span><b>${escapeHtml(title)}</b><span class="about">${escapeHtml(about)}</span>${credit}</span></label>`;

/** The object and observer checkboxes; `on` gives the object sets to tick (the defaults when the page opens). */
function buildSets(on: readonly string[] = DEFAULT_OBJECTS): void {
  const where = (s: ObjectSet) => (s.builtIn ? '' : fromDisk() ? ' Not available in a page opened from a file on disk.' : ' Loaded when chosen.');
  $('objectSets').innerHTML = allSets().map((s) => box('objects', s.id, `${s.title} (${s.count.toLocaleString('en')})`, s.description, on.includes(s.id),
    s.credit ? `<span class="credit">${escapeHtml(s.credit)} Terms: ${escapeHtml(s.license)}. <a href="${s.url}">Source</a>.${where(s)}</span>` : `<span class="credit">${escapeHtml(s.license)}.</span>`)).join('');
  if (!$('observerSets').childElementCount) {
    $('observerSets').innerHTML = OBSERVER_SETS.map((s) => box('observers', s.id, s.title, s.about, DEFAULT_OBSERVERS.includes(s.id),
      s.credit ? `<span class="credit">${escapeHtml(s.credit)}${s.id === 'cameras' ? (fromDisk() ? ' Not available in a page opened from a file on disk.' : ' Loaded when chosen.') : ''}</span>` : '')).join('');
  }
}
const ticked = (name: string) => [...document.querySelectorAll<HTMLInputElement>(`#setsBox input[name=${name}]:checked`)].map((i) => i.value);

$<HTMLInputElement>('ownFiles').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])], notes: string[] = [], added: string[] = [];
  for (const file of files) {
    try {
      const { objects, note } = readObjectFile(await file.text());
      const id = `own:${file.name}:${fingerprint(objects.reflectances)}`;
      ownSets = [...ownSets.filter((s) => s.id !== id), ownSet(id, file.name, objects, `Your file: ${note}`)];
      added.push(id);
      notes.push(`${file.name}: ${note}`);
    } catch (err) { notes.push(`${file.name}: cannot read it (${message(err)})`); }
  }
  $('ownNote').textContent = notes.join(' ');
  buildSets([...ticked('objects'), ...added]);
  schedule();
});
const syncYourObservers = () => {
  yourObservers = [...fileObservers, ...pastedObserver];
  const b = document.querySelector<HTMLInputElement>('#setsBox input[name=observers][value=yours]');
  if (b && yourObservers.length) b.checked = true;
  schedule();
};
$<HTMLInputElement>('observerFiles').addEventListener('change', async (e) => {
  const notes: string[] = [];
  fileObservers = [];
  for (const file of [...((e.target as HTMLInputElement).files ?? [])]) {
    try {
      const o = readObserver(await file.text(), `${file.name} (yours)`);
      fileObservers.push(o);
      notes.push(`${file.name}: ${o.curves.length} sensors`);
    } catch (err) { notes.push(`${file.name}: cannot read it (${message(err)})`); }
  }
  $('observerNote').textContent = notes.length ? `${notes.join('; ')}.` : '';
  syncYourObservers();
});
$('observerPaste').addEventListener('input', () => {
  const text = $<HTMLTextAreaElement>('observerPaste').value;
  try {
    pastedObserver = text.trim() ? [readObserver(text, 'your pasted observer')] : [];
    $('observerPasteNote').textContent = pastedObserver.length ? `Pasted: an observer of ${pastedObserver[0].curves.length} sensors.` : '';
  } catch (err) {
    pastedObserver = [];
    $('observerPasteNote').textContent = `Cannot read the pasted observer: ${message(err)}.`;
  }
  syncYourObservers();
});
function resetSets(): void {
  document.querySelectorAll<HTMLInputElement>('#setsBox input[type=checkbox]').forEach((i) => {
    i.checked = (i.name === 'objects' ? DEFAULT_OBJECTS : DEFAULT_OBSERVERS).includes(i.value);
  });
}

interface Sets { objects: SampleSet & { sets: readonly ObjectSet[] }; observers: readonly Observer[]; observerTitles: string[]; key: string }

async function chosenSets(): Promise<Sets> {
  const objects = await objectsOf(ticked('objects'), allSets());
  const chosen = OBSERVER_SETS.filter((s) => ticked('observers').includes(s.id));
  if (!chosen.length) throw new Error('choose at least one set of observers');
  const seen = new Set<string>(), obs: Observer[] = [];
  for (const list of await Promise.all(chosen.map((s) => s.observers()))) {
    for (const o of list) { const k = `${o.name}|${fingerprint(o.curves)}`; if (!seen.has(k)) { seen.add(k); obs.push(o); } }
  }
  const custom = $<HTMLInputElement>('chooseSets').checked;
  $('setsNow').textContent = custom
    ? `Your choice: ${objects.reflectances.length.toLocaleString('en')} objects (${objects.sets.map((s) => s.title).join('; ')}) and ${obs.length} observer${obs.length > 1 ? 's' : ''} (${chosen.map((s) => s.title).join('; ')}).`
    : 'The IRE uses the CIE\'s 99 color evaluation samples (those of TM-30-18), chosen from about 105,000 measured objects to span the colors of real objects evenly (natural objects, skin, textiles, paints, plastics, printed colors and color systems), seen by 72 common observers: CIE 1931, CIE 1964 and the CIE 2006 observers for field sizes 1° to 10° and ages 20 to 80. The other sets, all 1,600 corrected Munsell colors among them, are among the choices below.';
  return {
    objects, observers: obs, observerTitles: chosen.map((s) => s.title),
    key: `${objects.sets.map((s) => s.id).join('+')}|${[...seen].join('+')}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The sweep of sections 4 and 6: each test light's IRE against every Planckian and daylight reference

/** The mean ΔE_WLab between two packed WLab sets of the same objects (as from `wlabsOf`). */
function meanDelta(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let j = 0; j < a.length; j += 3) {
    const x = a[j] - b[j], y = a[j + 1] - b[j + 1], z = a[j + 2] - b[j + 2];
    s += Math.sqrt(x * x + y * y + z * z);
  }
  return s / (a.length / 3);
}

/**
 * The references' WLab of every object, one array per observer (every reference in REFS's order), kept for the objects
 * and observers they were computed for, so that a new test light needs only its own WLab: 32-bit (far finer than the
 * 0.001 the tables show), and only while they fit in about 64 MB (the defaults take about 54 MB).
 */
let kept: { key: string; w: Float32Array[] } | undefined;
const KEEP_BYTES = 64e6;

/**
 * The IRE of each test light against each reference of REFS, observer by observer (each reference's WLab computed once
 * for every test light, or taken from those kept), reporting progress after each observer; undefined if a newer run
 * took over.
 */
async function ireSweep(tests: readonly Spectrum[], sets: Sets, progress: (done: number) => Promise<boolean>): Promise<number[][] | undefined> {
  const out = tests.map(() => new Array<number>(REFS.length).fill(0)), objs = sets.objects, J3 = 3 * objs.reflectances.length;
  const keep = sets.observers.length * REFS.length * J3 * 4 <= KEEP_BYTES;
  if (!keep) kept = undefined;
  else if (kept?.key !== sets.key) kept = { key: sets.key, w: [] };
  for (let i = 0; i < sets.observers.length; i++) {
    const o = sets.observers[i], tw = tests.map((t) => wlabsOf(o, t, objs));
    // an observer's references are kept only once all are computed, so that a run cut short leaves none half done
    const had = kept?.w[i], w = had ?? (keep ? new Float32Array(REFS.length * J3) : undefined);
    for (let r = 0; r < REFS.length; r++) {
      let rw: ArrayLike<number>;
      if (w) {
        if (!had) w.set(wlabsOf(o, REFS[r].spd, objs), r * J3);
        rw = w.subarray(r * J3, (r + 1) * J3);
      } else rw = wlabsOf(o, REFS[r].spd, objs);
      for (let k = 0; k < tests.length; k++) out[k][r] += meanDelta(tw[k], rw);
    }
    if (w && !had) kept!.w[i] = w;
    if (!(await progress(i + 1))) return undefined;
  }
  return out.map((row) => row.map((v) => v / sets.observers.length));
}

type Curve = [number, number][];
interface Curves { planck: Curve; day: Curve }
const curvesOf = (row: number[]): Curves => ({
  planck: REFS.flatMap((r, i) => (r.kind === 'planck' ? [[r.t, row[i]] as [number, number]] : [])),
  day: REFS.flatMap((r, i) => (r.kind === 'day' ? [[r.t, row[i]] as [number, number]] : [])),
});
const lowest = (c: Curve) => c.reduce((b, p) => (p[1] < b[1] ? p : b));

/** The reference a "closest" choice names, from a test light's curves. */
function closestOf(c: Curves, which: Closest): Light {
  const [p, d] = [lowest(c.planck), lowest(c.day)];
  const kind = which === 'any' ? (d[1] < p[1] ? 'day' : 'planck') : which;
  const t = kind === 'planck' ? p[0] : d[0];
  return REFS.find((r) => r.kind === kind && r.t === t)!;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 3: how far objects move between the test light and the reference light

const TOP = 15;
let moveCsv = '', moveName = '';
let lastMove: { test: Light; ref: Light; sets: Sets; per: { a: Float64Array; b: Float64Array; d: Float64Array }[]; top: number[] } | undefined;

function drawMove(test: Light, ref: Light, refNote: string, sets: Sets): void {
  const objs = sets.objects, obs = sets.observers, J = objs.reflectances.length;
  const per = obs.map((o) => { const a = wlabsOf(o, test.spd, objs), b = wlabsOf(o, ref.spd, objs); return { a, b, d: deltaEsOf(a, b) }; });
  // each object's mean over the observers, and its shares of ΣΔE² in lightness, chroma and hue (turned to its hue
  // under the reference, for each observer)
  const mean = new Float64Array(J), largest = new Float64Array(J), at = new Int32Array(J);
  const sq = Array.from({ length: J }, () => [0, 0, 0, 0]);
  per.forEach(({ a, b, d }, i) => {
    for (let j = 0; j < J; j++) {
      mean[j] += d[j] / obs.length;
      if (d[j] > largest[j]) { largest[j] = d[j]; at[j] = i; }
      const dl: [number, number, number] = [a[3 * j] - b[3 * j], a[3 * j + 1] - b[3 * j + 1], a[3 * j + 2] - b[3 * j + 2]];
      const turn = hueTurn([b[3 * j], b[3 * j + 1], b[3 * j + 2]]);
      if (turn) { const t = turn(dl); sq[j][0] += t[0] ** 2; sq[j][1] += t[1] ** 2; sq[j][2] += t[2] ** 2; } else { sq[j][0] += dl[0] ** 2; sq[j][3] += dl[1] ** 2 + dl[2] ** 2; }
    }
  });
  const all: number[] = [];
  per.forEach((p) => p.d.forEach((v) => all.push(v)));
  all.sort((x, y) => x - y);
  const q = (p: number) => all[Math.min(all.length - 1, Math.round(p * (all.length - 1)))];
  const ire = meanOf(all);
  let wi = 0, wj = 0;
  per.forEach((p, i) => p.d.forEach((v, j) => { if (v > per[wi].d[wj]) { wi = i; wj = j; } }));
  const row = (k: string, v: string, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><th>${k}</th><td>${v}</td></tr>`;
  const same = ire < 1e-9
    ? `<p class="flag"><b>The same rendering.</b> Every object has the same WLab under the two lights for every observer, as
      when the two spectra are the same up to scale.</p>` : '';
  $('move').innerHTML = `<div class="table-wrap"><table class="kv"><tbody>
    ${row('Test light', escapeHtml(test.label))}
    ${row('Reference light', `${escapeHtml(ref.label)}${refNote ? ` (${escapeHtml(refNote)})` : ''}`)}
    ${row('Objects', `${J.toLocaleString('en')}: ${objs.sets.map((s) => `${escapeHtml(s.title)} (${s.count.toLocaleString('en')})`).join('; ')}`)}
    ${row('Observers', `${obs.length}: ${escapeHtml(sets.observerTitles.join('; '))}`)}
    ${row('IRE, the mean ΔE<sub>WLab</sub>', `<span class="big">${f3(ire)}</span>`, 'own')}
    ${row('Median', f3(q(0.5)))}
    ${row('90th percentile', f3(q(0.9)))}
    ${row('Largest', `${f3(per[wi].d[wj])}: ${escapeHtml(objs.names[wj])}, for ${escapeHtml(obs[wi].name)}`)}
    </tbody></table></div>${same}
    <p class="note">Over the ${all.length.toLocaleString('en')} WLab differences, one for each object and each observer.</p>`;
  const sorted = Float64Array.from(mean).sort();
  $('moveHist').innerHTML = histogram([Array.from(sorted)], ['each object\'s mean over the observers'], ['var(--accent)'],
    { xLabel: 'ΔE_WLab between the two lights (the last bin holds everything above)', yLabel: 'objects' });
  const order = Array.from(mean, (_, j) => j).sort((x, y) => mean[y] - mean[x]), top = order.slice(0, TOP);
  $('movers').innerHTML = `<div class="table-wrap"><table class="bylight movers"><thead>
    <tr><th></th><th class="sep" colspan="3">ΔE<sub>WLab</sub> over the observers</th><th class="sep" colspan="3">share of ΣΔE<sup>2</sup> in</th></tr>
    <tr><th>Object</th><th class="sep">mean</th><th>largest</th><th style="text-align: left">for</th><th class="sep">lightness</th><th>chroma</th><th>hue</th></tr></thead>
    <tbody>${top.map((j) => {
      const s = sq[j], tot = s[0] + s[1] + s[2] + s[3];
      // an object with no chroma under the reference (for some observer) has chroma and hue told apart for none
      const shares = tot < 1e-18 ? '<td class="sep">–</td><td>–</td><td>–</td>'
        : s[3] > 0 ? `<td class="sep">${pct(s[0] / tot)}</td><td colspan="2">${pct((s[1] + s[2] + s[3]) / tot)} (chroma and hue)</td>`
          : `<td class="sep">${pct(s[0] / tot)}</td><td>${pct(s[1] / tot)}</td><td>${pct(s[2] / tot)}</td>`;
      return `<tr><td>${escapeHtml(objs.names[j])}</td><td class="sep">${f3(mean[j])}</td><td>${f3(largest[j])}</td>
        <td class="where">${escapeHtml(obs[at[j]].name)}</td>${shares}</tr>`;
    }).join('')}</tbody></table></div>`;
  // the observer choice of the plane plot, kept across recomputes when the observer is still there
  const sel = $<HTMLSelectElement>('planeObserver'), was = sel.value;
  sel.replaceChildren(...obs.map((o, i) => new Option(o.name, String(i))));
  sel.value = was && Number(was) < obs.length ? was : '0';
  lastMove = { test, ref, sets, per, top };
  drawPlane();
  $('byObserver').innerHTML = `<div class="table-wrap"><table class="bylight"><thead>
    <tr><th></th><th class="sep" colspan="5">ΔE<sub>WLab</sub> over the objects</th></tr>
    <tr><th>Observer</th><th class="sep">mean</th><th>median</th><th>90th percentile</th><th>largest</th><th>where it is largest</th></tr></thead>
    <tbody>${per.map((p, i) => {
      const o = Array.from(p.d, (_, j) => j).sort((x, y) => p.d[x] - p.d[y]);
      const qq = (f: number) => p.d[o[Math.min(J - 1, Math.round(f * (J - 1)))]];
      return `<tr><td>${escapeHtml(obs[i].name)}</td><td class="sep">${f3(meanOf(p.d))}</td><td>${f3(qq(0.5))}</td><td>${f3(qq(0.9))}</td>
        <td>${f3(p.d[o[J - 1]])}</td><td class="where">${escapeHtml(objs.names[o[J - 1]])}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  moveCsv = [`# How far each object moves between ${test.label} and ${ref.label}: ΔE_WLab, each observer through its own Wpt normalization under each light. IRE ${ire.toFixed(6)}`,
    ['object', 'mean over the observers', 'largest', 'observer of the largest', ...obs.map((o) => o.name)].map(cell).join(','),
    ...Array.from({ length: J }, (_, j) => [cell(objs.names[j]), mean[j].toFixed(6), largest[j].toFixed(6), cell(obs[at[j]].name),
      ...per.map((p) => p.d[j].toFixed(6))].join(','))].join('\n') + '\n';
  moveName = `${slug(test.label)}-against-${slug(ref.label)}`;
  $<HTMLButtonElement>('downloadMove').disabled = false;
}

/** The objects that move most, in the aw–bw plane of one observer: from where they are under the reference to the test light. */
function drawPlane(): void {
  if (!lastMove) return;
  const { per, top, sets } = lastMove, i = Number($<HTMLSelectElement>('planeObserver').value) || 0, { a, b } = per[i];
  const J = sets.objects.reflectances.length, names = sets.objects.names;
  const pts = Array.from({ length: J }, (_, j) => [b[3 * j + 1], b[3 * j + 2]]);
  const ends = top.map((j) => [a[3 * j + 1], a[3 * j + 2]]);
  const far = Math.max(10, ...pts.flat().map(Math.abs), ...ends.flat().map(Math.abs)) * 1.05;
  $('plane').innerHTML = scatter({
    xLabel: 'aw', yLabel: 'bw', x: [-far, far], y: [-far, far], square: true, arrows: true,
    sets: [
      { pts, color: 'var(--line)', label: 'every object, under the reference' },
      { pts: top.map((j) => pts[j]), color: 'var(--accent)', label: `the ${top.length} that move most`, ring: true,
        titles: top.map((j) => `${names[j]}: ΔE_WLab ${f2(per[i].d[j])} for ${sets.observers[i].name}`) },
    ],
    links: top.map((j, k) => [...pts[j], ...ends[k]]),
  });
}
$('planeObserver').addEventListener('change', drawPlane);
$('downloadMove').addEventListener('click', () => { if (moveCsv) download(`${moveName}.csv`, moveCsv, 'text/csv'); });

// ---------------------------------------------------------------------------------------------------------------
// Section 4: the test light's IRE against every Planckian and daylight reference

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
let curvesCsv = '', curvesName = '';

function drawCurves(test: Light, c: Curves, sets: Sets): void {
  const series = [
    { pts: c.planck, color: 'var(--accent)', label: 'against Planckian references', tips: c.planck.map(([t, v]) => `Planckian ${t} K: IRE ${f3(v)}`) },
    { pts: c.day, color: 'var(--accent2)', dash: '5 3', label: 'against daylight references', tips: c.day.map(([t, v]) => `daylight ${t} K: IRE ${f3(v)}`) },
  ];
  const t = cct(test.spd).cct;
  $('curves').innerHTML = linePlot({
    xLabel: 'color temperature of the reference (K)', yLabel: `IRE of ${test.label}`, series,
    marks: t >= PLANCK[0] && t <= DAY[DAY.length - 1] ? [{ x: t, label: `CCT ${Math.round(t)} K` }] : [],
  });
  const [p, d] = [lowest(c.planck), lowest(c.day)];
  $('closestTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Test light</th><th class="sep">CCT</th>
    <th class="sep">closest Planckian</th><th>IRE</th><th class="sep">closest daylight</th><th>IRE</th></tr></thead><tbody><tr>
    <td>${escapeHtml(test.label)}</td><td class="sep">${Math.round(t)} K</td>
    <td class="sep">${p[0]} K</td><td>${f3(p[1])}</td><td class="sep">${d[0]} K</td><td>${f3(d[1])}</td></tr></tbody></table></div>`;
  curvesCsv = [`# IRE of ${test.label} against Planckian and daylight references; ${sets.objects.reflectances.length} objects, ${sets.observers.length} observers`,
    'reference,temperature (K),IRE', ...c.planck.map(([t, v]) => `Planckian,${t},${v.toFixed(6)}`), ...c.day.map(([t, v]) => `daylight,${t},${v.toFixed(6)}`)].join('\n') + '\n';
  curvesName = `${slug(test.label)}-IRE-by-temperature`;
  $<HTMLButtonElement>('downloadCurves').disabled = false;
}
$('downloadCurves').addEventListener('click', () => { if (curvesCsv) download(`${curvesName}.csv`, curvesCsv, 'text/csv'); });

/** The IRE of the test light against each of your candidate references (section 2), the lowest first marked; the lowest. */
function drawYours(test: Light, yours: Light[], sets: Sets): Light {
  const v = yours.map((l) => ire(test.spd, l.spd, sets.observers, sets.objects));
  const best = v.reduce((b, x, i) => (x < v[b] ? i : b), 0);
  $('yoursTable').innerHTML = `<h3>Your candidate references</h3><div class="table-wrap"><table><thead><tr><th>Reference</th><th class="sep">CCT</th>
    <th class="sep">IRE</th></tr></thead><tbody>${yours.map((l, i) => `<tr${i === best ? ' class="own"' : ''}><td>${escapeHtml(l.label)}</td>
    <td class="sep">${Math.round(cct(l.spd).cct)} K</td><td class="sep">${f3(v[i])}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">The IRE of the test light against each of the lights given in section 2; the lowest, in bold, is the reference of
    section 3.</p>`;
  return yours[best];
}

// ---------------------------------------------------------------------------------------------------------------
// Section 5: the color rendering indices, from the test light's CCT

let samples: { tcs: SampleSet; ces: SampleSet } | undefined;
const samplesNow = async () => (samples ??= { tcs: await objectsOf(['cie-tcs14']), ces: await objectsOf(['cie-ces99']) });

/** The reference the color rendering index makes for a CCT: Planckian below 5000 K, CIE daylight at and above. */
const criReference = (t: number): Light => (t >= 5000
  ? { key: `cri-day${t.toFixed(2)}`, label: `daylight ${Math.round(t)} K`, spd: daylight(t) }
  : { key: `cri-planck${t.toFixed(2)}`, label: `Planckian ${Math.round(t)} K`, spd: planckian(t) });
const fidelityLight = (t: number): Light => { const f = fidelityReference(t); return { key: `fid${t.toFixed(2)}`, label: f.name, spd: f.spd }; };

/** TM-30's color vector graphic: each hue bin's mean shift from the reference, drawn out from a circle of the reference. */
function vectorGraphic(f: Fidelity): string {
  const S = 320, c = S / 2, R = 110, X = (x: number) => (c + R * x).toFixed(1), Y = (y: number) => (c - R * y).toFixed(1);
  const pts = f.bins.filter((b) => b.count).map((b) => {
    const th = Math.atan2(b.ref[1], b.ref[0]), cr = Math.hypot(b.ref[0], b.ref[1]);
    const u = [Math.cos(th), Math.sin(th)];
    return { u, t: [u[0] + (b.test[0] - b.ref[0]) / cr, u[1] + (b.test[1] - b.ref[1]) / cr] };
  });
  const spokes = Array.from({ length: 16 }, (_, j) => { const a = (j * 22.5 * Math.PI) / 180; return `<line x1="${c}" y1="${c}" x2="${X(1.45 * Math.cos(a))}" y2="${Y(1.45 * Math.sin(a))}" stroke="var(--line)"/>`; }).join('');
  const id = `cvg${Math.random().toString(36).slice(2, 8)}`;
  return `<svg viewBox="0 0 ${S} ${S}" width="100%" style="max-width: ${S}px" role="img" aria-label="TM-30 color vector graphic">
    <defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker></defs>
    ${spokes}<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="var(--quiet)" stroke-dasharray="4 3"/>
    <polygon points="${pts.map((p) => `${X(p.t[0])},${Y(p.t[1])}`).join(' ')}" fill="var(--accent)" fill-opacity="0.12" stroke="var(--accent)" stroke-width="1.5"/>
    ${pts.map((p) => `<line x1="${X(p.u[0])}" y1="${Y(p.u[1])}" x2="${X(p.t[0])}" y2="${Y(p.t[1])}" stroke="var(--accent)" marker-end="url(#${id})"/>`).join('')}
    <text x="${c}" y="${S - 6}" text-anchor="middle">dashed: the reference; solid: the test light</text></svg>`;
}

let indicesCsv = '', indicesName = '';

/**
 * Section 5: the test light's CCT and color rendering indices, each beside its reference and the IRE of the test light
 * against that reference; and, once section 4 has its curves, the lowest IRE among the Planckian and daylight lights.
 */
function drawIndices(test: Light, sets: Sets, s: { tcs: SampleSet; ces: SampleSet }, curves?: Curves): void {
  const r = cri(test.spd, s.tcs), f = fidelity(test.spd, s.ces);
  const refC = criReference(r.cct), refF = fidelityLight(f.cct);
  const ireC = ire(test.spd, refC.spd, sets.observers, sets.objects), ireF = ire(test.spd, refF.spd, sets.observers, sets.objects);
  const sgn = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(4)}`;
  const where = Math.abs(r.duv) < 5e-5 ? 'on the Planckian locus' : r.duv > 0 ? 'above the Planckian locus, toward green' : 'below the Planckian locus, toward magenta';
  const low = curves && (() => { const [p, d] = [lowest(curves.planck), lowest(curves.day)]; return p[1] <= d[1] ? { t: p[0], v: p[1], kind: 'Planckian' } : { t: d[0], v: d[1], kind: 'daylight' }; })();
  $('indices').innerHTML = `<p><b>${escapeHtml(test.label)}</b>: CCT <span class="big">${Math.round(r.cct)} K</span>, from its chromaticity;
    Duv ${sgn(r.duv)} (${where}).</p>
    <div class="table-wrap"><table class="indices"><thead><tr><th>Measure</th><th class="sep">Value</th><th class="sep">Its reference</th>
    <th class="sep">IRE against<br>that reference</th></tr></thead><tbody>
    <tr class="own"><td>Color rendering index Ra<span class="what">CIE 13.3</span></td><td class="sep">${r.ra.toFixed(1)}</td>
      <td class="sep">${escapeHtml(refC.label)}, at the CCT<span class="what">chromaticity distance DC ${r.dc.toExponential(1)}</span></td><td class="sep">${f3(ireC)}</td></tr>
    <tr class="own"><td>Color fidelity index R<sub>f</sub><span class="what">CIE 224, TM-30</span></td><td class="sep">${f.rf.toFixed(1)}</td>
      <td class="sep" rowspan="2">${escapeHtml(refF.label)}, at the CCT</td><td class="sep" rowspan="2">${f3(ireF)}</td></tr>
    <tr class="own"><td>Gamut index R<sub>g</sub><span class="what">TM-30</span></td><td class="sep">${f.rg.toFixed(1)}</td></tr>
    <tr><td>Lowest IRE<span class="what">section 4</span></td><td class="sep">–</td>
      <td class="sep">${low ? `${low.kind} ${low.t} K<span class="what">the Planckian or daylight light with the lowest IRE</span>` : 'computing…'}</td><td class="sep">${low ? f3(low.v) : ''}</td></tr>
    </tbody></table></div>
    <p class="note">The IRE column measures, with the objects and observers of section 3, how far objects move between the test
    light and each reference; the last row is the reference with the lowest IRE, for comparison.</p>`;
  $('riTable').innerHTML = `<div class="table-wrap"><table class="bylight"><thead><tr><th>Test color sample</th><th class="sep">R<sub>i</sub></th></tr></thead>
    <tbody>${s.tcs.names.map((n, i) => `<tr${i < 8 ? '' : ' class="extra"'}><td>${escapeHtml(n)}</td><td class="sep">${r.r[i].toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`;
  $('cvg').innerHTML = vectorGraphic(f);
  $('bins').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Hue bin</th><th class="sep">samples</th><th class="sep">R<sub>f</sub></th>
    <th>chroma shift</th><th>hue shift</th></tr></thead><tbody>${f.bins.map((b, j) => `<tr><td>${j + 1} (${(22.5 * j).toFixed(1)}° to ${(22.5 * (j + 1)).toFixed(1)}°)</td>
    <td class="sep">${b.count}</td><td class="sep">${b.count ? b.rf.toFixed(0) : '–'}</td><td>${b.count ? `${b.rcs >= 0 ? '+' : '−'}${Math.abs(100 * b.rcs).toFixed(0)}%` : '–'}</td>
    <td>${b.count ? `${b.rhs >= 0 ? '+' : '−'}${Math.abs(b.rhs).toFixed(2)}` : '–'}</td></tr>`).join('')}</tbody></table></div>`;
  indicesCsv = [`# Color rendering indices of ${test.label}`, 'quantity,value',
    `CCT (K),${r.cct.toFixed(2)}`, `Duv,${r.duv.toFixed(6)}`, `Ra,${r.ra.toFixed(3)}`, ...r.r.map((v, i) => `R${i + 1},${v.toFixed(3)}`),
    `CIE 1995 reference,${refC.label}`, `DC,${r.dc.toExponential(3)}`, `Rf,${f.rf.toFixed(3)}`, `Rg,${f.rg.toFixed(3)}`, `CIE 2017 and TM-30 reference,"${refF.label}"`,
    ...f.bins.map((b, j) => `bin ${j + 1} Rf / chroma shift / hue shift,${b.rf.toFixed(3)} / ${b.rcs.toFixed(4)} / ${b.rhs.toFixed(4)}`),
    ...f.rfi.map((v, i) => `Rf of CES${i + 1},${v.toFixed(3)}`)].join('\n') + '\n';
  indicesName = `${slug(test.label)}-color-rendering-indices`;
  $<HTMLButtonElement>('downloadIndices').disabled = false;
}
$('downloadIndices').addEventListener('click', () => { if (indicesCsv) download(`${indicesName}.csv`, indicesCsv, 'text/csv'); });

// ---------------------------------------------------------------------------------------------------------------
// Section 6: many test lights at once, as in the thesis's table

const GROUP_COLORS: Record<string, string> = {
  'standard fluorescent': '#8a6d00', 'broadband fluorescent': '#1f8a5b', 'tri-band fluorescent': '#c0306a', 'CIE LED': '#2f74c0', other: '#7a3fb0',
};
let manyCsv = '';

function drawMany(lights: Light[], curves: Curves[], sets: Sets, s: { tcs: SampleSet; ces: SampleSet }): void {
  if (!lights.length) {
    $('many').innerHTML = '<p class="note">Choose at least one set of test lights.</p>';
    clear(['manyPlots', 'manyScatter']);
    $<HTMLButtonElement>('downloadMany').disabled = true;
    return;
  }
  const idx = lights.map((l) => { const r = cri(l.spd, s.tcs), f = fidelity(l.spd, s.ces); return { cct: r.cct, ra: r.ra, rf: f.rf, rg: f.rg }; });
  const low = curves.map((c) => Math.min(lowest(c.planck)[1], lowest(c.day)[1]));
  // each light's name on one line and what it is (the label's parentheses) under it, in small type
  const name = (label: string) => {
    const m = /^(.*?) \((.*)\)$/.exec(label);
    return m ? `${escapeHtml(m[1])}<span class="what">${escapeHtml(m[2])}</span>` : escapeHtml(label);
  };
  $('many').innerHTML = `<div class="table-wrap"><table class="many"><thead>
    <tr><th></th><th class="sep"></th><th class="sep" colspan="2">Planckian with<br>the lowest IRE</th>
      <th class="sep" colspan="2">Daylight with<br>the lowest IRE</th><th class="sep" colspan="3">Color rendering<br>indices</th></tr>
    <tr><th>Test light</th><th class="sep">CCT</th><th class="sep">at</th><th>IRE</th><th class="sep">at</th><th>IRE</th>
      <th class="sep">Ra</th><th>R<sub>f</sub></th><th>R<sub>g</sub></th></tr></thead><tbody>${lights.map((l, k) => {
    const [p, d] = [lowest(curves[k].planck), lowest(curves[k].day)];
    const it = (v: number, other: number) => (v <= other ? `<i>${f3(v)}</i>` : f3(v));
    return `<tr><td>${name(l.label)}</td><td class="sep">${Math.round(idx[k].cct)} K</td>
      <td class="sep">${p[0]} K</td><td>${it(p[1], d[1])}</td><td class="sep">${d[0]} K</td><td>${it(d[1], p[1])}</td>
      <td class="sep">${idx[k].ra.toFixed(1)}</td><td>${idx[k].rf.toFixed(1)}</td><td>${idx[k].rg.toFixed(1)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  const groups = [...new Set(lights.map((l) => l.group ?? 'other'))];
  const against = (key: 'rf' | 'ra', label: string) => {
    const xs = idx.map((v) => v[key]), lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.06 || 1;
    return scatter({
      xLabel: label, yLabel: 'lowest IRE', x: [lo - pad, hi + pad], y: [0, Math.max(...low) * 1.08],
      sets: groups.map((g) => {
        const at = lights.map((l, k) => k).filter((k) => (lights[k].group ?? 'other') === g);
        return { pts: at.map((k) => [xs[k], low[k]]), color: GROUP_COLORS[g] ?? GROUP_COLORS.other, label: g === 'other' ? 'other lights' : `${g} lights`,
          titles: at.map((k) => `${lights[k].label}: ${label} ${xs[k].toFixed(1)}, lowest IRE ${f3(low[k])}`) };
      }),
    });
  };
  $('manyScatter').innerHTML = `<div>${against('rf', 'Rf (CIE 224, TM-30)')}</div><div>${against('ra', 'Ra (CIE 13.3)')}</div>`;
  const legend = groups.map((g) => `<span class="key"><svg width="24" height="10" aria-hidden="true"><line x1="1" x2="23" y1="5" y2="5"
    stroke="${GROUP_COLORS[g] ?? GROUP_COLORS.other}" stroke-width="2"/></svg>${escapeHtml(g === 'other' ? 'other lights' : `${g} lights`)}</span>`).join('');
  const top = Math.max(...curves.flatMap((c) => [...c.planck, ...c.day].map((p) => p[1]))) * 1.05;
  const plot = (kind: 'planck' | 'day') => linePlot({
    title: kind === 'planck' ? 'Planckian references' : 'Daylight references', xLabel: 'color temperature of the reference (K)', yLabel: 'IRE', y: top, legend,
    series: lights.map((l, k) => ({
      pts: curves[k][kind], color: GROUP_COLORS[l.group ?? 'other'] ?? GROUP_COLORS.other, label: l.label,
      tips: curves[k][kind].map(([t, v]) => `${l.label} against ${kind === 'planck' ? 'Planckian' : 'daylight'} ${t} K: IRE ${f3(v)}`),
    })),
  });
  $('manyPlots').innerHTML = `<div>${plot('planck')}</div><div>${plot('day')}</div>`;
  manyCsv = [`# IRE of each test light against Planckian and daylight references; ${sets.objects.reflectances.length} objects, ${sets.observers.length} observers; with each light's CCT, Ra, Rf and Rg`,
    'test light,CCT (K),Ra,Rf,Rg,reference,temperature (K),IRE',
    ...lights.flatMap((l, k) => {
      const head = `"${l.label}",${idx[k].cct.toFixed(1)},${idx[k].ra.toFixed(2)},${idx[k].rf.toFixed(2)},${idx[k].rg.toFixed(2)}`;
      return [...curves[k].planck.map(([t, v]) => `${head},Planckian,${t},${v.toFixed(6)}`), ...curves[k].day.map(([t, v]) => `${head},daylight,${t},${v.toFixed(6)}`)];
    })].join('\n') + '\n';
  $<HTMLButtonElement>('downloadMany').disabled = false;
}
$('downloadMany').addEventListener('click', () => { if (manyCsv) download('IRE-of-many-test-lights.csv', manyCsv, 'text/csv'); });

// ---------------------------------------------------------------------------------------------------------------
// The page

let run = 0;
let done4: { key: string; curves: Curves } | undefined, done6: { key: string; lights: Light[]; curves: Curves[] } | undefined;

/** The two lights at the same luminance (CIE 1931 ȳ), as the thesis plots its test lights: spikes stand out as they are. */
function drawLights(test: Light, ref: Light | undefined): void {
  const k = (s: Spectrum) => 100 / s.reduce((a, v, i) => a + v * observers.cie1931.curves[1][i], 0);
  $('lightPlot').innerHTML = spectrumPlot('The test light (solid) and the reference light (dashed), at the same luminance', [
    { values: test.spd.map((v) => v * k(test.spd)), color: 'var(--accent)', label: test.label },
    ...(ref ? [{ values: ref.spd.map((v) => v * k(ref.spd)), color: 'var(--accent2)', dash: '5 3', label: ref.label }] : []),
  ]);
}

function clear(ids: string[]): void { for (const id of ids) $(id).replaceChildren(); }

async function render(): Promise<void> {
  const me = ++run, status = $('status');
  let test: Light, ref: Picked;
  try {
    test = pickTest.get().light!;
    ref = pickRef.get();
  } catch (e) {
    status.className = 'error';
    status.textContent = `Cannot read the light: ${message(e)}.`;
    clear(['lightPlot', 'move', 'moveHist', 'movers', 'plane', 'byObserver', 'curves', 'closestTable']);
    return;
  }
  status.className = 'note';
  status.textContent = '';
  let sets: Sets, lights6: Light[], s: { tcs: SampleSet; ces: SampleSet };
  const slow = setTimeout(() => { if (me === run) $('setsNow').textContent = 'Loading the chosen objects and observers…'; }, 150);
  try {
    sets = await chosenSets();
    lights6 = testLights();
    s = await samplesNow();
  } catch (e) {
    if (me !== run) return;
    clear(['moveHist', 'movers', 'plane', 'byObserver', 'curves', 'closestTable', 'yoursTable', 'indices', 'riTable', 'cvg', 'bins', 'many', 'manyPlots', 'manyScatter', 'setsNow']);
    $('move').innerHTML = `<p class="error">${escapeHtml(message(e))}.</p>`;
    done4 = done6 = undefined;
    return;
  } finally { clearTimeout(slow); }
  if (me !== run) return;
  // the reference: given, or found from the test light at once (at its CCT, or among your lights), or after section 4
  $('yoursTable').replaceChildren();
  let refLight = ref.light, refNote = '';
  if (ref.atCct) {
    const t = cct(test.spd).cct;
    refLight = ref.atCct === 'cri' ? criReference(t) : fidelityLight(t);
    refNote = ref.atCct === 'cri' ? 'the color rendering index\'s reference at the test light\'s CCT' : 'the reference of CIE 224 and TM-30 at the test light\'s CCT';
  } else if (ref.closest === 'yours') {
    refLight = drawYours(test, ref.yours!, sets);
    refNote = 'of your lights, the one with the lowest IRE';
  }
  drawLights(test, refLight);
  if (refLight) drawMove(test, refLight, refNote, sets);
  drawIndices(test, sets, s);
  const k4 = `${sets.key}|${fingerprint([test.spd])}`, k6 = `${sets.key}|${lights6.map((l) => `${l.key}:${fingerprint([l.spd])}`).join('+')}`;
  const need4 = done4?.key !== k4, need6 = done6?.key !== k6 && lights6.length > 0;
  const fromCurves = (c: Curves) => { const r = closestOf(c, ref.closest as 'any' | 'planck' | 'day'); drawLights(test, r); drawMove(test, r, 'the closest by IRE', sets); };
  if (!refLight && !need4) fromCurves(done4!.curves);
  if (!refLight && need4) {
    $('move').innerHTML = '<p class="note">Finding the closest reference (section 4)…</p>';
    clear(['moveHist', 'movers', 'plane', 'byObserver']);
    $<HTMLButtonElement>('downloadMove').disabled = true;
  }
  if (need4) { clear(['curves', 'closestTable']); $<HTMLButtonElement>('downloadCurves').disabled = true; }
  if (need6) { clear(['many', 'manyPlots', 'manyScatter']); $<HTMLButtonElement>('downloadMany').disabled = true; }
  if (!need4 && done4) { drawCurves(test, done4.curves, sets); drawIndices(test, sets, s, done4.curves); }
  if (!need6) { if (done6 && lights6.length) drawMany(done6.lights, done6.curves, sets, s); else if (!lights6.length) drawMany([], [], sets, s); }
  const tests = [...(need4 ? [test.spd] : []), ...(need6 ? lights6.map((l) => l.spd) : [])];
  if (!tests.length) return;
  const progress = $('sweepProgress'), total = sets.observers.length;
  // the page gets its turn after about 40 ms of work (with the references kept, many observers fit in one slice)
  let slice = performance.now();
  const rows = await ireSweep(tests, sets, async (n) => {
    if (performance.now() - slice < 40) return true;
    progress.textContent = `Computing sections 4${need6 ? ' and 6' : ''}: ${n} of ${total} observers…`;
    await new Promise((r) => setTimeout(r, 0));
    slice = performance.now();
    return me === run;
  });
  if (!rows || me !== run) return;
  progress.textContent = '';
  if (need4) {
    done4 = { key: k4, curves: curvesOf(rows[0]) };
    drawCurves(test, done4.curves, sets);
    drawIndices(test, sets, s, done4.curves);
    if (!refLight) fromCurves(done4.curves);
  }
  if (need6) {
    done6 = { key: k6, lights: lights6, curves: rows.slice(need4 ? 1 : 0).map(curvesOf) };
    drawMany(lights6, done6.curves, sets, s);
  }
}

buildSets();
optIn($<HTMLInputElement>('chooseSets'), $('setsBox'), resetSets, schedule);
$('setsBox').addEventListener('change', schedule);

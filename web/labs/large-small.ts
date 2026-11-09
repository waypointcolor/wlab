// Lab J: large and small color differences. WLab, whose distances read like ΔE00, beside its large-scale form LSWLab,
// whose distances read like ΔE*ab: their chroma against Wpt's (section 1), the corrected Munsell colors in each beside
// CIELAB (section 2), and the differences of pairs from neighbors to far apart (section 3).
// Bundled into labs/large-small.html by scripts/build-web.mjs.

import { observers, wlabToLswlab, wlabToRgb, wptNormalization, wptToWlab, type ObserverName, type Vec3, type WptNormalization } from '../../src/index.ts';
import { LIGHTS, type LightName } from './lights.ts';
import { hueOf, hueSpread, MUNSELL_HUES, relativeSpread, stepEvenness } from './hue.ts';
import { $, escapeHtml, LIGHT_LABEL, linePlot, OBSERVER_LABEL, scatter, sequential } from './kit.ts';
import { differencesOf, munsellPairs, placeAll, stress, type Placed } from './scales.ts';

const f1 = (v: number) => v.toFixed(1);
const CMF_OBSERVERS: ObserverName[] = ['cie1931', 'cie1964', 'cie2015', 'cie2015_10'];
$<HTMLSelectElement>('observer').replaceChildren(...CMF_OBSERVERS.map((k) => new Option(OBSERVER_LABEL[k], k)));
$<HTMLSelectElement>('light').replaceChildren(...(Object.keys(LIGHT_LABEL) as LightName[]).map((k) => new Option(LIGHT_LABEL[k], k)));
$<HTMLSelectElement>('observer').value = 'cie1931';
$<HTMLSelectElement>('light').value = 'C';
$<HTMLSelectElement>('value').replaceChildren(...[2, 3, 4, 5, 6, 7, 8, 9].map((v) => new Option(String(v), String(v))));
$<HTMLSelectElement>('value').value = '5';

// the chips placed once per condition
const cache = new Map<string, { norm: WptNormalization; chips: Placed[] }>();
function condition(): { norm: WptNormalization; chips: Placed[]; label: string } {
  const o = $<HTMLSelectElement>('observer').value as ObserverName, l = $<HTMLSelectElement>('light').value as LightName, key = `${o}/${l}`;
  if (!cache.has(key)) { const norm = wptNormalization(observers[o], LIGHTS[l]); cache.set(key, { norm, chips: placeAll(norm) }); }
  return { ...cache.get(key)!, label: `${OBSERVER_LABEL[o]} under ${l}` };
}

const chromaOf = (x: Vec3) => Math.hypot(x[1], x[2]);
/** A chip's color on an sRGB screen: the material it is, under D65. */
const screenColor = (p: Placed) => `rgb(${wlabToRgb(p.wl, 'srgb').map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))).join(',')})`;

// ---------------------------------------------------------------------------------------------------------------
// Section 1: chroma in WLab and LSWLab against chroma in Wpt

const HUES: [number, string, string][] = [[30, 'red', '#c0306a'], [90, 'yellow', '#a07a00'], [160, 'green', '#1f8a5b'], [270, 'blue', '#2f74c0']];
function curves(norm: WptNormalization): void {
  // Wpt's W for a WLab lightness of 50; each hue's chroma out to the most vivid Munsell chip of Value 5 within 20° of it
  const W = 100 * ((50 + 16) / 116) ** 3;
  const v5 = condition().chips.filter((p) => p.chip.value === 5).map((p) => { const w = norm.wptOf(p.chip.reflectance); return { c: chromaOf(w), h: hueOf(w[1], w[2]) }; });
  const series = HUES.flatMap(([h, name, color]) => {
    const near = v5.filter((x) => Math.abs(((x.h - h + 540) % 360) - 180) <= 20), top = Math.max(...near.map((x) => x.c));
    const at = Array.from({ length: 41 }, (_, i) => (top * i) / 40).map((c) => { const wl = wptToWlab([W, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]); return { c, w: chromaOf(wl), ls: chromaOf(wlabToLswlab(wl)) }; });
    return [
      { pts: at.map((a): [number, number] => [a.c, a.w]), color, label: `WLab, ${name} (${h}°)`, tips: at.map((a) => `Wpt chroma ${f1(a.c)}: WLab chroma ${f1(a.w)}`) },
      { pts: at.map((a): [number, number] => [a.c, a.ls]), color, dash: '5 3', label: `LSWLab, ${name}`, tips: at.map((a) => `Wpt chroma ${f1(a.c)}: LSWLab chroma ${f1(a.ls)}`) },
    ];
  });
  $('curves').innerHTML = `<div>${linePlot({ xLabel: 'chroma in Wpt', yLabel: 'chroma in WLab and LSWLab', title: 'Chroma, at a lightness Lw of 50', series })}</div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 2: the Munsell colors of one Value in WLab, LSWLab and CIELAB

const SPACES = [['wl', 'WLab', 'aw', 'bw'], ['ls', 'LSWLab', 'aw', 'bw (LSWLab)'], ['lab', 'CIELAB', 'a*', 'b*']] as const;
type SpaceKey = (typeof SPACES)[number][0];

function munsell(chips: Placed[], label: string): void {
  const value = Number($<HTMLSelectElement>('value').value);
  const at = chips.filter((p) => p.chip.value === value);
  const key = (h: string, c: number) => at.findIndex((p) => p.chip.hue === h && p.chip.chroma === c);
  const links: [number, number][] = [];
  for (const h of MUNSELL_HUES) {
    const row = at.map((p, k) => [p, k] as const).filter(([p]) => p.chip.hue === h).sort((x, y) => x[0].chip.chroma - y[0].chip.chroma);
    row.forEach(([, k], n) => { if (n) links.push([row[n - 1][1], k]); });
  }
  for (const c of new Set(at.map((p) => p.chip.chroma))) {
    MUNSELL_HUES.forEach((h, n) => { const a = key(h, c), b = key(MUNSELL_HUES[(n + 1) % MUNSELL_HUES.length], c); if (a >= 0 && b >= 0) links.push([a, b]); });
  }
  const colors = at.map(screenColor), titles = at.map((p) => `${p.chip.hue} ${value}/${p.chip.chroma}`);
  $('munPlots').innerHTML = SPACES.map(([k, name, xl, yl]) => {
    const coords = at.map((p) => [p[k][1], p[k][2]]), far = Math.max(10, ...coords.flat().map(Math.abs)) * 1.08;
    return `<div>${scatter({
      xLabel: xl, yLabel: `${yl}${k === 'wl' ? ' (WLab)' : k === 'lab' ? ' (CIELAB)' : ''}`, x: [-far, far], y: [-far, far], square: true, outline: true, dot: 3,
      sets: [{ pts: coords, color: 'var(--quiet)', label: name, colors, titles }], links: links.map(([a, b]) => [...coords[a], ...coords[b]]),
    })}</div>`;
  }).join('');
  // rings, steps and hue, at this Value and over every Value
  const measures = (v: number) => {
    const set = chips.filter((p) => p.chip.value === v);
    const per = (k: SpaceKey) => {
      const rings = [...new Set(set.map((p) => p.chip.chroma))].map((c) => set.filter((p) => p.chip.chroma === c)).filter((r) => r.length >= 4)
        .map((r) => relativeSpread(r.map((p) => chromaOf(p[k]))));
      const spokes = MUNSELL_HUES.map((h) => set.filter((p) => p.chip.hue === h).sort((a, b) => a.chip.chroma - b.chip.chroma)).filter((s) => s.length >= 2);
      const steps = spokes.map((s) => stepEvenness(s.map((p) => p.chip.chroma), s.map((p) => chromaOf(p[k])))).filter((x) => !Number.isNaN(x));
      const hue = spokes.map((s) => hueSpread(s.map((p) => hueOf(p[k][1], p[k][2]))).rms);
      return { rings, steps, hue };
    };
    return Object.fromEntries(SPACES.map(([k]) => [k, per(k)])) as Record<SpaceKey, ReturnType<typeof per>>;
  };
  const here = measures(value), all = [2, 3, 4, 5, 6, 7, 8, 9].map(measures);
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const overAll = (k: SpaceKey, m: 'rings' | 'steps' | 'hue') => mean(all.flatMap((x) => x[k][m]));
  const row = (name: string, m: 'rings' | 'steps' | 'hue', unit: string) => `<tr><th>${name}</th>${SPACES.map(([k, n]) => `<td>${n} <span class="big">${f1(mean(here[k][m]))}${unit}</span></td>`).join('')}
    <td class="note">Values 2 to 9: ${SPACES.map(([k, n]) => `${n} ${f1(overAll(k, m))}${unit}`).join(', ')}</td></tr>`;
  $('munSummary').innerHTML = `<div class="table-wrap"><table class="kv"><tbody>
    <tr><th>Condition</th><td colspan="4">${escapeHtml(label)}, Value ${value}</td></tr>
    ${row('Rings', 'rings', '%')}${row('Steps', 'steps', '%')}${row('Hue', 'hue', '°')}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Section 3: differences, from neighbors to far apart

function differences(chips: Placed[]): void {
  const { near, far } = munsellPairs(chips), dn = differencesOf(near), df = differencesOf(far);
  const COMPARE = [['wlab', 'e00', 'ΔE<sub>WLab</sub> against ΔE<sub>00</sub>'], ['lswlab', 'ab', 'ΔE<sub>LSWLab</sub> against ΔE*<sub>ab</sub>'],
    ['wlab', 'ab', 'ΔE<sub>WLab</sub> against ΔE*<sub>ab</sub>'], ['lswlab', 'e00', 'ΔE<sub>LSWLab</sub> against ΔE<sub>00</sub>']] as const;
  const cells = (d: typeof dn, a: keyof typeof dn, b: keyof typeof dn) => { const s = stress(d[a], d[b]); return `<td class="sep">${f1(s.stress)}</td><td>${s.scale.toFixed(2)}</td>`; };
  $('stressTable').innerHTML = `<div class="table-wrap"><table class="many"><thead>
    <tr><th></th><th class="sep" colspan="2">Neighbors (${near.length.toLocaleString('en')})</th><th class="sep" colspan="2">Random pairs (${far.length.toLocaleString('en')})</th></tr>
    <tr><th>Differences</th><th class="sep">STRESS</th><th>scale</th><th class="sep">STRESS</th><th>scale</th></tr></thead>
    <tbody>${COMPARE.map(([a, b, name], i) => `<tr${i === 2 ? ' class="sepRow"' : ''}><td>${name}</td>${cells(dn, a, b)}${cells(df, a, b)}</tr>`).join('')}</tbody></table></div>`;
  const plot = (x: number[], y: number[], xl: string, yl: string, colors?: string[]) => {
    const top = Math.max(...x, ...y) * 1.04;
    return `<div>${scatter({ xLabel: xl, yLabel: yl, x: [0, top], y: [0, top], square: true, dot: 1.6,
      sets: [{ pts: x.map((v, i) => [v, y[i]]), color: 'var(--accent)', label: 'random pairs', colors }], links: [[0, 0, top, top]] })}</div>`;
  };
  const vivid = far.map(([a, b]) => (chromaOf(a.lab) + chromaOf(b.lab)) / 2), most = Math.max(...vivid);
  $('pairPlots').innerHTML = plot(df.e00, df.wlab, 'ΔE00', 'ΔE_WLab') + plot(df.ab, df.lswlab, 'ΔE*ab', 'ΔE_LSWLab')
    + plot(df.wlab, df.lswlab, 'ΔE_WLab', 'ΔE_LSWLab', vivid.map((v) => sequential(v / most)));
}

function render(): void {
  const { norm, chips, label } = condition();
  curves(norm);
  munsell(chips, label);
  differences(chips);
}
for (const id of ['observer', 'light']) $(id).addEventListener('input', render);
$('value').addEventListener('input', () => { const { chips, label } = condition(); munsell(chips, label); });
render();

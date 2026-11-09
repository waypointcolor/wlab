// Lab F: uniformity and hue. Section 1, constant hue: chips of one WLab hue at every lightness and chroma, each split
// against the same CIELAB lightness and chroma at constant CIELAB hue in a chosen observing condition. Section 2, the
// Munsell loci of constant Hue and Chroma in WLab beside CIELAB, with how far each Hue strays in hue angle. Section 3,
// the object-color solid of two conditions: their cross-sections at a WLab lightness overlaid, their areas, and the
// solid in 3D. Section 4, checks against published data, waits for their licenses.
// Bundled into labs/uniformity.html by scripts/build-web.mjs.

import {
  illuminants, inGamut, observers, toPolar, wlabToRgb, wptNormalization, wptToWlab, type IlluminantName,
  type ObserverName, type RgbSpace, type Vec3, type WptNormalization,
} from '../../src/index.ts';
import { LIGHTS, type LightName } from './lights.ts';
import {
  areaOf, COMPARED_LABEL, crossSection, fromSpace, hueOf, hueSpread, inSpace, MUNSELL_HUES, munsellChips, optimalWpts, relativeSpread, sliceWpts,
  stepEvenness,
  type Compared,
} from './hue.ts';
import { $, cloud3d, conditionPicker, escapeHtml, fmtTick, LIGHT_LABEL, niceStep, OBSERVER_LABEL, scatter, type Condition } from './kit.ts';

const p3 = typeof CSS !== 'undefined' && CSS.supports('color', 'color(display-p3 1 0 0)')
  && matchMedia('(color-gamut: p3)').matches;
const f1 = (v: number) => v.toFixed(1);

// sections 1 and 2 compare with CIELAB, so their observers are the CIE color-matching functions
const CMF_OBSERVERS: ObserverName[] = ['cie1931', 'cie1964', 'cie2015', 'cie2015_10'];
const norms = new Map<string, WptNormalization>();
const normOf = (o: ObserverName, l: LightName) => {
  const k = `${o}/${l}`;
  let n = norms.get(k);
  if (!n) { n = wptNormalization(observers[o], LIGHTS[l]); norms.set(k, n); }
  return n;
};
/** An observer and a light select for sections 1 and 2, opening on CIE 1931 under C. */
function fillCondition(obsId: string, lightId: string): void {
  $<HTMLSelectElement>(obsId).replaceChildren(...CMF_OBSERVERS.map((k) => new Option(OBSERVER_LABEL[k], k)));
  $<HTMLSelectElement>(lightId).replaceChildren(...(Object.keys(LIGHT_LABEL) as LightName[]).map((k) => new Option(LIGHT_LABEL[k], k)));
  $<HTMLSelectElement>(obsId).value = 'cie1931';
  $<HTMLSelectElement>(lightId).value = 'C';
}
const conditionOf = (obsId: string, lightId: string) => {
  const o = $<HTMLSelectElement>(obsId).value as ObserverName, l = $<HTMLSelectElement>(lightId).value as LightName;
  return { norm: normOf(o, l), label: `${OBSERVER_LABEL[o]} under ${l}` };
};

/** A display color (0 to 255 per channel, clipped) of a WLab value: the material it stands for, under D65. */
const screenColor = (wl: Vec3) => `rgb(${wlabToRgb(wl, 'srgb').map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))).join(',')})`;

// ---------------------------------------------------------------------------------------------------------------
// Section 1: constant hue

function constantHue(): void {
  const H = Number($<HTMLInputElement>('hue').value);
  const anchorAt = $<HTMLSelectElement>('anchor').value;
  const space = $<HTMLSelectElement>('space').value as RgbSpace;
  const cmp = $<HTMLSelectElement>('compare').value as Compared, name = COMPARED_LABEL[cmp];
  const { norm, label } = conditionOf('hueObserver', 'hueLight');
  $('hueVal').textContent = `${H}°`;
  const Ls = Array.from({ length: 19 }, (_, i) => 95 - 5 * i);
  const Cs = Array.from({ length: 31 }, (_, i) => 5 * i);
  type Chip = { L: number; C: number; wl: Vec3; rgb: Vec3; lab: Vec3 };
  const chips: Chip[] = [];
  for (const L of Ls) for (const C of Cs) {
    const wl: Vec3 = [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
    const rgb = wlabToRgb(wl, space);
    if (!inGamut(rgb)) continue;
    chips.push({ L, C, wl, rgb, lab: inSpace(cmp, wl, norm) });
  }
  const cmax = Math.max(...chips.map((c) => c.C));
  const top = chips.filter((c) => c.C === cmax).sort((a, b) => (anchorAt === 'dark' ? a.L - b.L : b.L - a.L))[0];
  const hab = toPolar(top.lab)[2];
  const cols = cmax / 5 + 1, chip = 24, gap = 2, x0 = 44, y0 = 8;
  const width = x0 + cols * (chip + gap) + 8, height = y0 + Ls.length * (chip + gap) + 34;
  const canvas = $<HTMLCanvasElement>('plane');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d', space === 'display-p3' && p3 ? { colorSpace: 'display-p3' } : undefined)!;
  ctx.scale(dpr, dpr);
  const css = (v: Vec3) => {
    const c = v.map((x) => Math.min(1, Math.max(0, x)));
    return space === 'display-p3' && p3 ? `color(display-p3 ${c.join(' ')})` : `rgb(${c.map((x) => Math.round(255 * x)).join(',')})`;
  };
  const ink = getComputedStyle(document.body).color;
  ctx.font = '11px system-ui, sans-serif';
  Ls.forEach((L, r) => {
    const y = y0 + r * (chip + gap);
    ctx.fillStyle = css(wlabToRgb([L, 0, 0], space));
    ctx.fillRect(x0, y - gap / 2, cols * (chip + gap), chip + gap);
    if (L % 20 === 15) { ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.fillText(String(L), x0 - 6, y + chip / 2 + 4); }
  });
  const gaps: number[] = [];
  for (const c of chips) {
    const x = x0 + (c.C / 5) * (chip + gap) + gap / 2, y = y0 + Ls.indexOf(c.L) * (chip + gap);
    const [Ll, Cab] = toPolar(c.lab);
    const labHeld: Vec3 = [Ll, Cab * Math.cos((hab * Math.PI) / 180), Cab * Math.sin((hab * Math.PI) / 180)];
    // the compared space's half as the material it stands for in the condition, shown as that material under D65 like
    // the other half
    const rgbHeld = wlabToRgb(fromSpace(cmp, labHeld, norm), space);
    // the compared space's half upper left, WLab's lower right
    ctx.fillStyle = css(rgbHeld);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + chip, y); ctx.lineTo(x, y + chip); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(c.rgb);
    ctx.beginPath(); ctx.moveTo(x + chip, y); ctx.lineTo(x + chip, y + chip); ctx.lineTo(x, y + chip); ctx.closePath(); ctx.fill();
    if (!inGamut(rgbHeld)) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(x + chip * 0.28, y + chip * 0.28, 1.8, 0, 7); ctx.fill(); }
    if (c === top) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x - 1.5, y - 1.5, chip + 3, chip + 3); }
    if (c.C >= 10) gaps.push(((toPolar(c.lab)[2] - hab + 540) % 360) - 180);
  }
  ctx.fillStyle = ink; ctx.textAlign = 'center';
  for (let k = 0; k < cols; k += 2) ctx.fillText(String(5 * k), x0 + k * (chip + gap) + gap / 2 + chip / 2, height - 18);
  ctx.fillText('chroma (WLab)', x0 + (cols * (chip + gap)) / 2, height - 4);
  ctx.save(); ctx.translate(12, y0 + (Ls.length * (chip + gap)) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('lightness', 0, 0); ctx.restore();
  $('planeNote').textContent = `WLab hue ${H}°, against ${name} hue ${Math.round(hab)}° for ${label}. Across the chips of WLab chroma 10 and up, `
    + `their ${name} hue runs ${Math.min(...gaps).toFixed(1)}° to ${Math.max(...gaps).toFixed(1)}° from the anchor's. `
    + `A dot marks a ${name} half outside the screen's colors.`;
}

$<HTMLSelectElement>('space').replaceChildren(new Option('sRGB', 'srgb'), ...(p3 ? [new Option('Display P3 (wide gamut)', 'display-p3')] : []));
fillCondition('hueObserver', 'hueLight');
for (const id of ['hue', 'anchor', 'space', 'compare', 'hueObserver', 'hueLight']) $(id).addEventListener('input', constantHue);
document.querySelectorAll<HTMLButtonElement>('button[data-h]').forEach((b) =>
  b.addEventListener('click', () => { $<HTMLInputElement>('hue').value = b.dataset.h!; constantHue(); }));

// ---------------------------------------------------------------------------------------------------------------
// Section 2: Munsell loci

// the reference condition of WLab, drawn dashed behind each plot: how far a pattern moves from it is what the tour shows
const MUN_REFERENCE = { observer: 'cie1931' as ObserverName, light: 'C' as LightName, label: 'CIE 1931 under C, the reference (dashed)' };
type Placed = { wl: Vec3; lab: Vec3; cam: Vec3 };
/** Where the chips of one Value sit in WLab, CIELAB and CAM16-UCS, in one condition. */
const placeChips = (value: number, norm: WptNormalization): Placed[] => munsellChips().filter((c) => c.value === value)
  .map((c) => { const wl = norm.wlabOf(c.reflectance); return { wl, lab: inSpace('cielab', wl, norm), cam: inSpace('cam16', wl, norm) }; });
type Spaces = { w: number; l: number; m: number };
/** While touring, each plot's axes are fixed, to the farthest chip in any condition of the tour. */
let tourRange: Spaces | undefined;

function munsell(): void {
  const { norm, label } = conditionOf('munObserver', 'munLight');
  const value = Number($<HTMLSelectElement>('munValue').value);
  const at = munsellChips().filter((c) => c.value === value);
  const pts = placeChips(value, norm).map((p, k) => ({ c: at[k], ...p }));
  const ref = placeChips(value, normOf(MUN_REFERENCE.observer, MUN_REFERENCE.light)), ghost = $<HTMLInputElement>('munGhost').checked;
  const colors = pts.map((p) => screenColor(p.wl));
  const titles = pts.map((p) => `${p.c.hue} ${value}/${p.c.chroma}`);
  const key = (h: string, ch: number) => pts.findIndex((p) => p.c.hue === h && p.c.chroma === ch);
  // spokes: each Hue's chips by Chroma, from neutral; rings: each Chroma's chips by Hue, where neighbors exist
  const pairs: [number, number][] = [];
  for (const h of MUNSELL_HUES) {
    const row = pts.map((p, k) => [p, k] as const).filter(([p]) => p.c.hue === h).sort((x, y) => x[0].c.chroma - y[0].c.chroma);
    row.forEach(([, k], n) => { if (n) pairs.push([row[n - 1][1], k]); });
  }
  const rings: [number, number][] = [];
  for (const ch of [...new Set(pts.map((p) => p.c.chroma))]) {
    MUNSELL_HUES.forEach((h, n) => {
      const a = key(h, ch), b = key(MUNSELL_HUES[(n + 1) % MUNSELL_HUES.length], ch);
      if (a >= 0 && b >= 0) rings.push([a, b]);
    });
  }
  const plot = (space: keyof Spaces, xy: (p: Placed) => [number, number], xl: string, yl: string) => {
    const coords = pts.map(xy), back = ghost ? ref.map(xy) : [];
    const far = tourRange?.[space] ?? Math.max(10, ...coords.flat().map(Math.abs), ...back.flat().map(Math.abs)) * 1.08;
    return scatter({
      xLabel: xl, yLabel: yl, x: [-far, far], y: [-far, far], square: true, outline: true, dot: 3.2,
      sets: [{ pts: coords, color: 'var(--quiet)', label: 'Munsell chips', colors, titles }],
      links: [...pairs, ...rings].map(([a, b]) => [...coords[a], ...coords[b]]),
      ghostLinks: ghost ? [...pairs, ...rings].map(([a, b]) => [...back[a], ...back[b]]) : undefined, ghostLabel: MUN_REFERENCE.label,
    });
  };
  $('munPlots').innerHTML = `<div>${plot('w', (p) => [p.wl[1], p.wl[2]], 'aw', 'bw (WLab)')}</div>
    <div>${plot('l', (p) => [p.lab[1], p.lab[2]], 'a*', 'b* (CIELAB)')}</div>
    <div>${plot('m', (p) => [p.cam[1], p.cam[2]], 'a′', 'b′ (CAM16-UCS)')}</div>`;
  // how far the chips move from the reference condition, each space in its own units
  const moved = (k: keyof Placed) => pts.reduce((s, p, j) => s + Math.hypot(...p[k].map((v, d) => v - ref[j][k][d])), 0) / pts.length;
  // every Value's chips placed once, in the three spaces
  const VALUES = [2, 3, 4, 5, 6, 7, 8, 9];
  const placed = new Map(VALUES.map((v) => { const ps = placeChips(v, norm); return [v, munsellChips().filter((c) => c.value === v).map((c, k) => ({ c, p: ps[k] }))]; }));
  const SPACES = [['w', 'WLab', 'wl'], ['l', 'CIELAB', 'lab'], ['m', 'CAM16-UCS', 'cam']] as const;
  type Key = 'w' | 'l' | 'm';
  const chromaOf = (x: Vec3) => Math.hypot(x[1], x[2]);
  // the spokes: how far each Hue's chips stray in hue angle, and how evenly their chroma grows, in each space
  type Spoke = { h: string; n: number } & Record<Key, ReturnType<typeof hueSpread> & { steps: number }>;
  const spokesAt = (v: number) => MUNSELL_HUES.map((h): Spoke | undefined => {
    const cs = placed.get(v)!.filter((x) => x.c.hue === h).sort((a, b) => a.c.chroma - b.c.chroma);
    if (cs.length < 2) return undefined;
    const of = (k: keyof Placed) => ({ ...hueSpread(cs.map((x) => hueOf(x.p[k][1], x.p[k][2]))), steps: stepEvenness(cs.map((x) => x.c.chroma), cs.map((x) => chromaOf(x.p[k]))) });
    return { h, n: cs.length, w: of('wl'), l: of('lab'), m: of('cam') };
  }).filter((r): r is Spoke => !!r);
  // the rings: how far each Chroma's chips, round the Hues, are from one chroma (relative RMS, so every space's scale
  // reads alike); a ring needs four Hues or more
  type Ring = { ch: number; n: number } & Record<Key, number>;
  const ringsAt = (v: number) => [...new Set(placed.get(v)!.map((x) => x.c.chroma))].sort((a, b) => a - b).map((ch): Ring | undefined => {
    const cs = placed.get(v)!.filter((x) => x.c.chroma === ch);
    if (cs.length < 4) return undefined;
    const of = (k: keyof Placed) => relativeSpread(cs.map((x) => chromaOf(x.p[k])));
    return { ch, n: cs.length, w: of('wl'), l: of('lab'), m: of('cam') };
  }).filter((r): r is Ring => !!r);
  const rows = spokesAt(value), mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const all = VALUES.flatMap(spokesAt);
  const ringRows = ringsAt(value), allRings = VALUES.flatMap(ringsAt);
  const worst = (k: Key) => rows.reduce((b, r) => (r[k].rms > b[k].rms ? r : b));
  const worstRing = (k: Key) => ringRows.reduce((b, r) => (r[k] > b[k] ? r : b));
  const pct = (v: number) => (Number.isNaN(v) ? '–' : `${f1(v)}%`);
  const row = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  $('munSummary').innerHTML = `<div class="table-wrap"><table class="kv"><tbody>
    ${row('Condition', escapeHtml(label))}
    ${row(`Mean move of a chip from CIE 1931 under C, Value ${value}`, `WLab <span class="big">${f1(moved('wl'))}</span> ΔE<sub>WLab</sub>, CIELAB <span class="big">${f1(moved('lab'))}</span> ΔE*<sub>ab</sub>, CAM16-UCS <span class="big">${f1(moved('cam'))}</span> ΔE′`)}
    ${row(`RMS of hue angle along a Hue, Value ${value}`, `${SPACES.map(([k, n]) => `${n} <span class="big">${f1(mean(rows.map((r) => r[k].rms)))}°</span>`).join(', ')} (mean over ${rows.length} Hues)`)}
    ${row('The same, Values 2 to 9', `${SPACES.map(([k, n]) => `${n} ${f1(mean(all.map((r) => r[k].rms)))}°`).join(', ')} (over ${all.length} Hue and Value spokes)`)}
    ${row(`Largest, Value ${value}`, SPACES.map(([k, n]) => `${n} ${worst(k).h} (${f1(worst(k)[k].rms)}°)`).join('; '))}
    ${ringRows.length ? `${row(`Relative RMS of chroma round a Chroma ring, Value ${value}`, `${SPACES.map(([k, n]) => `${n} <span class="big">${pct(mean(ringRows.map((r) => r[k])))}</span>`).join(', ')} (mean over ${ringRows.length} rings)`)}
    ${row('The same, Values 2 to 9', `${SPACES.map(([k, n]) => `${n} ${pct(mean(allRings.map((r) => r[k])))}`).join(', ')} (over ${allRings.length} Chroma and Value rings)`)}
    ${row(`Largest, Value ${value}`, SPACES.map(([k, n]) => `${n} /${worstRing(k).ch} (${pct(worstRing(k)[k])})`).join('; '))}` : ''}
    </tbody></table></div>`;
  $('munTable').innerHTML = `<div class="table-wrap"><table class="many"><thead>
    <tr><th></th><th class="sep"></th>${SPACES.map(([, n]) => `<th class="sep" colspan="3">${n}</th>`).join('')}</tr>
    <tr><th>Hue</th><th class="sep">chips</th>${SPACES.map(() => '<th class="sep">spread</th><th>RMS</th><th>steps</th>').join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.h}</td><td class="sep">${r.n}</td>${SPACES.map(([k]) => `<td class="sep">${f1(r[k].range)}°</td><td>${f1(r[k].rms)}°</td><td>${pct(r[k].steps)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  $('munRingTable').innerHTML = `<div class="table-wrap"><table class="many"><thead>
    <tr><th>Chroma</th><th class="sep">chips</th>${SPACES.map(([, n]) => `<th class="sep">${n}</th>`).join('')}</tr></thead>
    <tbody>${ringRows.map((r) => `<tr><td>/${r.ch}</td><td class="sep">${r.n}</td>${SPACES.map(([k]) => `<td class="sep">${pct(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

fillCondition('munObserver', 'munLight');
$<HTMLSelectElement>('munValue').replaceChildren(...[2, 3, 4, 5, 6, 7, 8, 9].map((v) => new Option(String(v), String(v))));
$<HTMLSelectElement>('munValue').value = '5';
$('munGhost').addEventListener('input', munsell);

// the tour: every light, every observer, or both, one after another with the delay chosen, the axes fixed for the tour
let tourTimer: ReturnType<typeof setTimeout> | undefined;
function stopTour(): void {
  clearTimeout(tourTimer);
  tourTimer = undefined;
  tourRange = undefined;
  $('munTour').textContent = 'Tour the conditions';
  $('munTourStatus').textContent = '';
}
function startTour(): void {
  const obs = $<HTMLSelectElement>('munObserver'), light = $<HTMLSelectElement>('munLight'), set = $<HTMLSelectElement>('munTourSet').value;
  const lights = [...light.options].map((o) => o.value), observerKeys = [...obs.options].map((o) => o.value);
  const list = (set === 'observers' ? observerKeys.map((o) => [o, light.value]) : set === 'lights' ? lights.map((l) => [obs.value, l])
    : observerKeys.flatMap((o) => lights.map((l) => [o, l]))) as [ObserverName, LightName][];
  const value = Number($<HTMLSelectElement>('munValue').value);
  const far = (k: keyof Placed) => Math.max(10, ...[...list, [MUN_REFERENCE.observer, MUN_REFERENCE.light] as const]
    .flatMap(([o, l]) => placeChips(value, normOf(o, l)).flatMap((p) => [Math.abs(p[k][1]), Math.abs(p[k][2])]))) * 1.08;
  tourRange = { w: far('wl'), l: far('lab'), m: far('cam') };
  // starting from the condition shown
  let k = Math.max(0, list.findIndex(([o, l]) => o === obs.value && l === light.value));
  $('munTour').textContent = 'Stop the tour';
  const step = () => {
    [obs.value, light.value] = list[k];
    $('munTourStatus').textContent = `${k + 1} of ${list.length}`;
    munsell();
    k = (k + 1) % list.length;
    // read at every step, so that a new delay takes effect at the next condition
    tourTimer = setTimeout(step, Number($<HTMLSelectElement>('munTourDelay').value) * 1000);
  };
  step();
}
$('munTour').addEventListener('click', () => (tourTimer ? stopTour() : startTour()));
$('munTourSet').addEventListener('input', () => { if (tourTimer) { stopTour(); startTour(); } });
// choosing a condition or a Value by hand ends the tour
for (const id of ['munObserver', 'munLight', 'munValue']) $(id).addEventListener('input', () => { if (tourTimer) stopTour(); munsell(); });

// ---------------------------------------------------------------------------------------------------------------
// Section 3: the object-color solid

let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(solid, 0); };
const pickA = conditionPicker($('solidA'), { observer: 'cie1931', light: 'C' }, schedule);
const pickB = conditionPicker($('solidB'), { observer: 'cie1931', light: 'F11' }, schedule);
const LIGHTNESSES = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const COLORS = ['var(--accent)', 'var(--accent2)'];

/** Two outlines in the aw, bw plane, on one scale. */
function outlines(sets: { pts: [number, number][]; color: string; label: string }[], title: string): string {
  const W = 440, H = 440, m = 40, far = niceStep(Math.max(...sets.flatMap((s) => s.pts.flat().map(Math.abs))) / 3) * 3.2;
  const X = (v: number) => m + ((v + far) / (2 * far)) * (W - 2 * m), Y = (v: number) => H - m - ((v + far) / (2 * far)) * (H - 2 * m);
  const step = niceStep(far / 2), ticks: number[] = [];
  for (let t = -Math.floor(far / step) * step; t <= far; t += step) ticks.push(+t.toFixed(6));
  const grid = ticks.map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${m}" y2="${H - m}" stroke="var(--line)"/><line x1="${m}" x2="${W - m}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/>
    <text x="${X(t)}" y="${H - m + 14}" text-anchor="middle">${fmtTick(t)}</text><text x="${m - 6}" y="${Y(t) + 4}" text-anchor="end">${fmtTick(t)}</text>`).join('');
  const paths = sets.map((s) => `<path d="${s.pts.map(([a, b], k) => `${k ? 'L' : 'M'}${X(a).toFixed(1)} ${Y(b).toFixed(1)}`).join('')}Z" fill="none" stroke="${s.color}" stroke-width="2"/>`).join('');
  const legend = sets.map((s) => `<span class="key"><svg width="24" height="10" aria-hidden="true"><line x1="1" x2="23" y1="5" y2="5" stroke="${s.color}" stroke-width="2"/></svg>${escapeHtml(s.label)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(title)}"><text class="title" x="${m}" y="16">${escapeHtml(title)}</text>
    ${grid}<text x="${W - m}" y="${H - m - 6}" text-anchor="end">aw</text><text x="${m + 4}" y="${m + 12}">bw</text>${paths}</svg><div class="legend">${legend}</div>`;
}

let lastSolid: { a: Condition; b: Condition; slicesA: ReturnType<typeof sliceWpts>; slicesB: ReturnType<typeof sliceWpts> } | undefined;

function solid(): void {
  let a: Condition, b: Condition;
  try { a = pickA.get(); b = pickB.get(); } catch (e) {
    $('solidStatus').textContent = `Cannot read the conditions: ${(e as Error).message}.`;
    return;
  }
  $('solidStatus').textContent = '';
  lastSolid = { a, b, slicesA: sliceWpts(a.observer, a.light), slicesB: sliceWpts(b.observer, b.light) };
  drawSection();
  const area = (s: ReturnType<typeof sliceWpts>, l: number) => areaOf(crossSection(s, l));
  $('solidTable').innerHTML = `<div class="table-wrap"><table class="many"><thead>
    <tr><th></th><th class="sep" colspan="3">Area of the cross-section (aw, bw units²)</th></tr>
    <tr><th>Lw</th><th class="sep">A: ${escapeHtml(a.label)}</th><th>B: ${escapeHtml(b.label)}</th><th>B / A</th></tr></thead>
    <tbody>${LIGHTNESSES.map((l) => { const x = area(lastSolid!.slicesA, l), y = area(lastSolid!.slicesB, l);
      return `<tr><td>${l}</td><td class="sep">${x.toFixed(0)}</td><td>${y.toFixed(0)}</td><td>${(y / x).toFixed(3)}</td></tr>`; }).join('')}</tbody></table></div>`;
  draw3d();
}

function drawSection(): void {
  if (!lastSolid) return;
  const l = Number($<HTMLSelectElement>('solidL').value);
  $('solidSection').innerHTML = outlines([
    { pts: crossSection(lastSolid.slicesA, l), color: COLORS[0], label: `A: ${lastSolid.a.label}` },
    { pts: crossSection(lastSolid.slicesB, l), color: COLORS[1], label: `B: ${lastSolid.b.label}` },
  ], `Cross-sections at Lw ${l}`);
}

function draw3d(): void {
  if (!lastSolid) return;
  const which = $<HTMLSelectElement>('solidWhich').value === 'b' ? lastSolid.slicesB : lastSolid.slicesA;
  const wls = optimalWpts(which).map((w) => wptToWlab(w));
  cloud3d($<HTMLCanvasElement>('solid3d'), {
    sets: [{ pts: wls.map(([l, x, y]) => [x, y, l - 50]), color: 'var(--quiet)', colors: wls.map(screenColor) }],
    axes: ['aw', 'bw', 'Lw − 50'], dot: 1.6,
  });
}

$<HTMLSelectElement>('solidL').replaceChildren(...LIGHTNESSES.map((l) => new Option(String(l), String(l))));
$<HTMLSelectElement>('solidL').value = '50';
$('solidL').addEventListener('input', drawSection);
$('solidWhich').addEventListener('input', draw3d);

// redrawn when the page turns dark or light, for the ink of the labels
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { constantHue(); munsell(); draw3d(); });
constantHue();
munsell();
solid();

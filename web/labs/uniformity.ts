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
import {
  areaOf, COMPARED_LABEL, crossSection, fromSpace, hueOf, hueSpread, inSpace, MUNSELL_HUES, munsellChips, optimalWpts, sliceWpts,
  type Compared,
} from './hue.ts';
import { $, cloud3d, conditionPicker, escapeHtml, fmtTick, LIGHT_LABEL, niceStep, OBSERVER_LABEL, scatter, type Condition } from './kit.ts';

const p3 = typeof CSS !== 'undefined' && CSS.supports('color', 'color(display-p3 1 0 0)')
  && matchMedia('(color-gamut: p3)').matches;
const f1 = (v: number) => v.toFixed(1);

// sections 1 and 2 compare with CIELAB, so their observers are the CIE color-matching functions
const CMF_OBSERVERS: ObserverName[] = ['cie1931', 'cie1964', 'cie2015', 'cie2015_10'];
const norms = new Map<string, WptNormalization>();
const normOf = (o: ObserverName, l: IlluminantName) => {
  const k = `${o}/${l}`;
  let n = norms.get(k);
  if (!n) { n = wptNormalization(observers[o], illuminants[l]); norms.set(k, n); }
  return n;
};
/** An observer and a light select for sections 1 and 2, opening on CIE 1931 under C. */
function fillCondition(obsId: string, lightId: string): void {
  $<HTMLSelectElement>(obsId).replaceChildren(...CMF_OBSERVERS.map((k) => new Option(OBSERVER_LABEL[k], k)));
  $<HTMLSelectElement>(lightId).replaceChildren(...(Object.keys(LIGHT_LABEL) as IlluminantName[]).map((k) => new Option(LIGHT_LABEL[k], k)));
  $<HTMLSelectElement>(obsId).value = 'cie1931';
  $<HTMLSelectElement>(lightId).value = 'C';
}
const conditionOf = (obsId: string, lightId: string) => {
  const o = $<HTMLSelectElement>(obsId).value as ObserverName, l = $<HTMLSelectElement>(lightId).value as IlluminantName;
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

function munsell(): void {
  const { norm, label } = conditionOf('munObserver', 'munLight');
  const value = Number($<HTMLSelectElement>('munValue').value);
  const at = munsellChips().filter((c) => c.value === value);
  const pts = at.map((c) => { const wl = norm.wlabOf(c.reflectance); return { c, wl, lab: inSpace('cielab', wl, norm), cam: inSpace('cam16', wl, norm) }; });
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
  const plot = (xy: (k: number) => [number, number], xl: string, yl: string) => {
    const coords = pts.map((_, k) => xy(k)), far = Math.max(10, ...coords.flat().map(Math.abs)) * 1.08;
    return scatter({
      xLabel: xl, yLabel: yl, x: [-far, far], y: [-far, far], square: true, outline: true, dot: 3.2,
      sets: [{ pts: coords, color: 'var(--quiet)', label: 'Munsell chips', colors, titles }],
      links: [...pairs, ...rings].map(([a, b]) => [...coords[a], ...coords[b]]),
    });
  };
  $('munPlots').innerHTML = `<div>${plot((k) => [pts[k].wl[1], pts[k].wl[2]], 'aw', 'bw (WLab)')}</div>
    <div>${plot((k) => [pts[k].lab[1], pts[k].lab[2]], 'a*', 'b* (CIELAB)')}</div>
    <div>${plot((k) => [pts[k].cam[1], pts[k].cam[2]], 'a′', 'b′ (CAM16-UCS)')}</div>`;
  // how far each Hue's chips stray in hue angle, at this Value and over every Value, in WLab, CIELAB and CAM16-UCS
  type Spread = { h: string; n: number; w: ReturnType<typeof hueSpread>; l: ReturnType<typeof hueSpread>; m: ReturnType<typeof hueSpread> };
  const spreadAt = (v: number) => MUNSELL_HUES.map((h): Spread | undefined => {
    const cs = munsellChips().filter((c) => c.value === v && c.hue === h);
    if (cs.length < 2) return undefined;
    const wl = cs.map((c) => norm.wlabOf(c.reflectance)), angles = (xs: Vec3[]) => xs.map((x) => hueOf(x[1], x[2]));
    return {
      h, n: cs.length, w: hueSpread(angles(wl)), l: hueSpread(angles(wl.map((w) => inSpace('cielab', w, norm)))),
      m: hueSpread(angles(wl.map((w) => inSpace('cam16', w, norm)))),
    };
  }).filter((r): r is Spread => !!r);
  const rows = spreadAt(value), mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const all = [2, 3, 4, 5, 6, 7, 8, 9].flatMap(spreadAt);
  const SPACES = [['w', 'WLab'], ['l', 'CIELAB'], ['m', 'CAM16-UCS']] as const;
  const worst = (k: 'w' | 'l' | 'm') => rows.reduce((b, r) => (r[k].rms > b[k].rms ? r : b));
  const row = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  $('munSummary').innerHTML = `<div class="table-wrap"><table class="kv"><tbody>
    ${row('Condition', escapeHtml(label))}
    ${row(`RMS of hue angle along a Hue, Value ${value}`, `${SPACES.map(([k, n]) => `${n} <span class="big">${f1(mean(rows.map((r) => r[k].rms)))}°</span>`).join(', ')} (mean over ${rows.length} Hues)`)}
    ${row('The same, Values 2 to 9', `${SPACES.map(([k, n]) => `${n} ${f1(mean(all.map((r) => r[k].rms)))}°`).join(', ')} (over ${all.length} Hue and Value spokes)`)}
    ${row(`Largest, Value ${value}`, SPACES.map(([k, n]) => `${n} ${worst(k).h} (${f1(worst(k)[k].rms)}°)`).join('; '))}
    </tbody></table></div>`;
  $('munTable').innerHTML = `<div class="table-wrap"><table class="many"><thead>
    <tr><th></th><th class="sep"></th>${SPACES.map(([, n]) => `<th class="sep" colspan="2">${n}</th>`).join('')}</tr>
    <tr><th>Hue</th><th class="sep">chips</th>${SPACES.map(() => '<th class="sep">spread</th><th>RMS</th>').join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.h}</td><td class="sep">${r.n}</td>${SPACES.map(([k]) => `<td class="sep">${f1(r[k].range)}°</td><td>${f1(r[k].rms)}°</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

fillCondition('munObserver', 'munLight');
$<HTMLSelectElement>('munValue').replaceChildren(...[2, 3, 4, 5, 6, 7, 8, 9].map((v) => new Option(String(v), String(v))));
$<HTMLSelectElement>('munValue').value = '5';
for (const id of ['munObserver', 'munLight', 'munValue']) $(id).addEventListener('input', munsell);

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

// Lab B: colors from one observing condition in WLab, and the differences between pairs.
// Bundled into labs/differences.html by scripts/build-web.mjs.

import {
  deltaE00, deltaEWlab, labToXyz, munsell1600, wlabToRgb, observers, sensorResponses, sensorWhiteOf, toPolar, wptNormalizationN, wptToWlab,
  xyzToLab,
  type Vec3, type WptNormalizationN,
} from '../../src/index.ts';
import { $, conditionPicker, download, escapeHtml, histogram, scatter, type Condition } from './kit.ts';
import { parseRows, readBoxes as readRows, type Row } from './rows.ts';

let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(render, 0); };
const pick1 = conditionPicker($('cond1'), { observer: 'cie1931', light: 'D65' }, schedule);
const message = (e: unknown) => (e as Error).message;
let lastCsv = '';

const times = (m: readonly (readonly number[])[], v: readonly number[]) => m.map((r) => r.reduce((s, a, i) => s + a * v[i], 0)) as Vec3;


const readBoxes = (n: number) => readRows($<HTMLTextAreaElement>('names').value, $<HTMLTextAreaElement>('colors1').value, $<HTMLTextAreaElement>('colors2').value, n);
const labInput = () => $<HTMLSelectElement>('valueType').value === 'cielab';
const CIE_CMFS = [observers.cie1931, observers.cie1964, observers.cie2015, observers.cie2015_10] as Condition['observer'][];

function render(): void {
  let c1: Condition, c2: Condition, n1: WptNormalizationN, n2: WptNormalizationN;
  const fail = (id: string, e: unknown, what: string) => {
    $(id).className = 'error';
    $(id).textContent = `${what}: ${message(e)}.`;
    for (const k of ['summary', 'table', 'plotAB', 'plotLC', 'plotHist', 'plotCmp']) $(k).replaceChildren();
    lastCsv = '';
  };
  try { c1 = pick1.get(); n1 = wptNormalizationN(c1.observer, c1.light); $('status1').className = 'note'; $('status1').textContent = c1.label; } catch (e) { fail('status1', e, 'Cannot build this condition'); return; }
  // CIELAB can be chosen only with a CIE color-matching observer; once chosen, it stays (with its message) rather than
  // having its numbers read as responses
  const labOption = $<HTMLSelectElement>('valueType').options[1];
  labOption.disabled = !CIE_CMFS.includes(c1.observer);
  labOption.textContent = labOption.disabled ? 'CIELAB: L*, a*, b* (only with a CIE color-matching observer)' : 'CIELAB: L*, a*, b*';
  c2 = c1; n2 = n1;
  if (!$<HTMLTextAreaElement>('colors1').value.trim()) {
    $('pairsStatus').className = 'note';
    $('pairsStatus').textContent = 'Paste colors, import a file, or try one of the examples.';
    for (const k of ['summary', 'table', 'plotAB', 'plotLC', 'plotHist', 'plotCmp']) $(k).replaceChildren();
    return;
  }
  // CIELAB values become XYZ (white Y = 100) with the condition's white; they need a CIE color-matching observer
  const lab = labInput();
  if (lab && !CIE_CMFS.includes(c1.observer)) { fail('pairsStatus', new Error('CIELAB values need one of the CIE color-matching observers: CIE 1931 (2°), CIE 1964 (10°), CIE 2015 (2° or 10°); for the CIE 2006 cones, choose CIE 2015 with the same field size, its color-matching functions'), 'Cannot read the colors'); return; }
  let rows: Row[];
  try { rows = readBoxes(lab ? 3 : n1.sensors); } catch (e) { fail('pairsStatus', e, 'Cannot read the colors'); return; }
  if (lab) {
    const toXyz = (v: number[]) => labToXyz(v as Vec3, n1.white as Vec3) as number[];
    rows = rows.map((r) => ({ ...r, first: toXyz(r.first), second: r.second ? toXyz(r.second) : undefined }));
  }

  const k = lab ? 1 : 100 / Number($<HTMLSelectElement>('scale').value);
  const wlab = (n: WptNormalizationN, v: readonly number[]) => wptToWlab(times(n.toWpt, v.map((x) => x * k)));
  // ΔE00 as an instrument reports it: CIELAB of the measurements in this condition (CIE color-matching observers only)
  const cielab = CIE_CMFS.includes(c1.observer);
  const out = rows.map((r) => {
    const w1 = wlab(n1, r.first), w2 = r.second ? wlab(n2, r.second) : undefined;
    const d = w2 ? deltaEWlab(w1, w2) : undefined;
    const d00 = w2 && cielab ? deltaE00(xyzToLab(r.first.map((x) => x * k) as Vec3, n1.white as Vec3), xyzToLab(r.second!.map((x) => x * k) as Vec3, n1.white as Vec3)) : undefined;
    return { name: r.name, w1, w2, d, d00 };
  });
  const pairs = out.filter((o) => o.d !== undefined);
  $('pairsStatus').className = 'note';
  $('pairsStatus').textContent = `${rows.length} row${rows.length > 1 ? 's' : ''}: ${pairs.length} pair${pairs.length === 1 ? '' : 's'}, ${rows.length - pairs.length} single color${rows.length - pairs.length === 1 ? '' : 's'}.`;

  // summary
  const stats = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return { mean: s.reduce((a, b) => a + b, 0) / s.length, median: s[Math.floor((s.length - 1) / 2)], max: s[s.length - 1] }; };
  if (pairs.length) {
    const s = stats(pairs.map((p) => p.d!));
    const s00 = cielab ? stats(pairs.map((p) => p.d00!)) : undefined;
    $('summary').innerHTML = `ΔE<sub>WLab</sub> over ${pairs.length} pair${pairs.length > 1 ? 's' : ''}: mean ${s.mean.toFixed(2)}, median
      ${s.median.toFixed(2)}, largest ${s.max.toFixed(2)}.${s00 ? ` ΔE<sub>00</sub> in this condition: mean ${s00.mean.toFixed(2)}, median ${s00.median.toFixed(2)}, largest ${s00.max.toFixed(2)}.` : ''}`;
  } else $('summary').textContent = 'No pairs: WLab of single colors only.';

  // table
  // a chip: the material's display color from its WLab (as under D65), clipped where it is outside sRGB
  const chip = (w?: Vec3) => {
    if (!w) return '';
    const rgb = wlabToRgb(w);
    const outside = rgb.some((v) => v < -0.002 || v > 1.002);
    const c = rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
    return `<span class="chip" style="background:rgb(${c.join(',')})"${outside ? ' title="outside sRGB: shown clipped"' : ''}></span>`;
  };
  // columns: the differences first, then L, a, b of both colors, then their chroma and hue
  const f = (x: number) => (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);              // no "-0.00"
  // each group (the differences, each color's L a b, each color's c h) starts with a vertical line: class "sep"
  const cellsOf = (vals: string[]) => vals.map((v, i) => `<td${i ? '' : ' class="sep"'}>${v}</td>`).join('');
  const labCells = (w?: Vec3) => cellsOf(w ? w.map(f) : ['', '', '']);
  const ch = (w?: Vec3) => {
    if (!w) return cellsOf(['', '']);
    const [, c, h] = toPolar(w);
    return cellsOf([f(c), c < 0.005 ? '—' : h.toFixed(1)]);                          // a neutral has no hue
  };
  const head = (names: string[], n: string) => names.map((x, i) => `<th${i ? '' : ' class="sep"'}>${x}<sub>w</sub> ${n}</th>`).join('');
  $('table').innerHTML = `<table><thead><tr><th>Name</th><th>Colors</th><th class="sep">ΔE<sub>WLab</sub></th>${cielab ? '<th title="CIELAB of the measurements in the observing condition above, as a spectrophotometer or colorimeter reports">ΔE<sub>00</sub></th>' : ''}
    ${head(['L', 'a', 'b'], '1')}${head(['L', 'a', 'b'], '2')}${head(['c', 'h'], '1')}${head(['c', 'h'], '2')}</tr></thead>
    <tbody>${out.map((o) => `<tr><td>${escapeHtml(o.name)}</td><td>${chip(o.w1)}${chip(o.w2)}</td>
      <td class="sep">${o.d === undefined ? '' : o.d.toFixed(2)}</td>${cielab ? `<td>${o.d00 === undefined ? '' : o.d00.toFixed(2)}</td>` : ''}
      ${labCells(o.w1)}${labCells(o.w2)}${ch(o.w1)}${ch(o.w2)}</tr>`).join('')}</tbody></table>`;
  const polar = (w?: Vec3) => (w ? toPolar(w).slice(1).map((x) => x.toFixed(4)) : ['', '']);
  lastCsv = [['name', 'DeltaE_WLab', ...(cielab ? ['DeltaE00_this_condition'] : []), 'Lw1', 'aw1', 'bw1', 'Lw2', 'aw2', 'bw2', 'cw1', 'hw1', 'cw2', 'hw2'],
    ...out.map((o) => [o.name, o.d === undefined ? '' : o.d.toFixed(4), ...(cielab ? [o.d00 === undefined ? '' : o.d00.toFixed(4)] : []),
      ...o.w1.map((x) => x.toFixed(4)), ...(o.w2 ? o.w2.map((x) => x.toFixed(4)) : ['', '', '']), ...polar(o.w1), ...polar(o.w2)])]
    .map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';

  // plots
  const firsts = out.map((o) => o.w1), seconds = out.filter((o) => o.w2).map((o) => o.w2!);
  const lim = Math.max(10, ...[...firsts, ...seconds].flatMap((w) => [Math.abs(w[1]), Math.abs(w[2])])) * 1.1;
  const titles2 = out.filter((o) => o.w2).map((o) => `${o.name}, second color: L_w ${o.w2![0].toFixed(1)}, a_w ${o.w2![1].toFixed(1)}, b_w ${o.w2![2].toFixed(1)}; ΔE_WLab ${o.d!.toFixed(2)}`);
  const titles = out.map((o) => `${o.name}: L_w ${o.w1[0].toFixed(1)}, a_w ${o.w1[1].toFixed(1)}, b_w ${o.w1[2].toFixed(1)}`
    + (o.d === undefined ? '' : `; ΔE_WLab ${o.d.toFixed(2)}`));
  const sets = (f: (w: Vec3) => number[]) => [
    { pts: firsts.map(f), color: 'var(--accent)', label: 'first color', ring: true, titles },
    ...(seconds.length ? [{ pts: seconds.map(f), color: 'var(--accent2)', label: 'second color', titles: titles2 }] : []),
  ];
  const links = (f: (w: Vec3) => number[]) => pairs.map((p) => [...f(p.w1), ...f(p.w2!)]);
  const ab = (w: Vec3) => [w[1], w[2]];
  const lc = (w: Vec3) => [toPolar(w)[1], w[0]];
  $('plotAB').innerHTML = scatter({ xLabel: 'a_w', yLabel: 'b_w', x: [-lim, lim], y: [-lim, lim], square: true, sets: sets(ab), links: links(ab), arrows: true });
  const cmax = Math.max(10, ...[...firsts, ...seconds].map((w) => toPolar(w)[1])) * 1.1;
  $('plotLC').innerHTML = scatter({ xLabel: 'c_w (chroma)', yLabel: 'L_w', x: [0, cmax], sets: sets(lc), links: links(lc), arrows: true });
  $('plotHist').innerHTML = pairs.length
    ? histogram([pairs.map((p) => p.d!).sort((a, b) => a - b), ...(cielab ? [pairs.map((p) => p.d00!).sort((a, b) => a - b)] : [])],
      ['ΔE_WLab', ...(cielab ? ['ΔE00 (this condition)'] : [])], ['var(--accent)', 'var(--accent2)'], { xLabel: 'color difference (the last bin holds everything above)', yLabel: 'pairs' })
    : '<p class="note">No pairs.</p>';
  $('cmpCard').hidden = !(cielab && pairs.length);
  if (cielab && pairs.length) {
    const m = Math.max(...pairs.flatMap((p) => [p.d!, p.d00!])) * 1.05 || 1;
    $('plotCmp').innerHTML = scatter({
      xLabel: 'ΔE_WLab', yLabel: 'ΔE00 (this condition)', x: [0, m], y: [0, m], square: true, links: [[0, 0, m, m]],
      sets: [{ pts: pairs.map((p) => [p.d!, p.d00!]), color: 'var(--accent)', label: 'pair (the line: equal values)',
        titles: pairs.map((p) => `${p.name}: ΔE_WLab ${p.d!.toFixed(2)}, ΔE00 ${p.d00!.toFixed(2)}`) }],
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Examples, made from the Munsell colors in the condition chosen above

function example(kind: 'chroma' | 'value'): void {
  let c1: Condition;
  try { c1 = pick1.get(); } catch (e) { $('pairsStatus').className = 'error'; $('pairsStatus').textContent = message(e); return; }
  const { names, reflectances } = munsell1600(true);
  const scale = 100 / Number($<HTMLSelectElement>('scale').value);
  const lab = labInput(), white = sensorWhiteOf(c1.observer, c1.light) as Vec3;
  if (lab && !CIE_CMFS.includes(c1.observer)) { $('pairsStatus').className = 'error'; $('pairsStatus').textContent = 'CIELAB values need one of the CIE color-matching observers: CIE 1931 (2°), CIE 1964 (10°), CIE 2015 (2° or 10°).'; return; }
  // the examples are written in the form chosen: CIELAB with the condition's white, or responses at the chosen scale
  const fmt = (v: readonly number[]) => (lab ? xyzToLab(v as Vec3, white).map((x) => x.toFixed(4)) : v.map((x) => (x / scale).toPrecision(6))).join(', ');
  const rows: { name: string; first: string; second: string }[] = [];
  // a color and the next Chroma (or Value) step of the same hue
  const index = new Map(names.map((n, i) => [n, i]));
  for (let i = 0; i < names.length && rows.length < 24; i += 29) {
    const m = names[i].match(/^(\S+) ([\d.]+)\/([\d.]+)$/);
    if (!m) continue;
    const next = kind === 'chroma' ? `${m[1]} ${m[2]}/${Number(m[3]) + 2}` : `${m[1]} ${Number(m[2]) + 1}/${m[3]}`;
    const j = index.get(next);
    if (j === undefined) continue;
    rows.push({ name: `${names[i]} → ${next}`, first: fmt(sensorResponses(reflectances[i], c1.observer, c1.light)), second: fmt(sensorResponses(reflectances[j], c1.observer, c1.light)) });
  }
  fill(rows.map((r) => r.name), rows.map((r) => r.first), rows.map((r) => r.second));
}

/** Puts names and colors (one line each) into the three boxes. */
function fill(names: string[], first: string[], second: string[]): void {
  $<HTMLTextAreaElement>('names').value = names.join('\n');
  $<HTMLTextAreaElement>('colors1').value = first.join('\n');
  $<HTMLTextAreaElement>('colors2').value = second.join('\n');
  schedule();
}

// a single file (a name, then 3 or 6 values per row) fills the three boxes
$<HTMLInputElement>('importFile').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const rows = parseRows(await f.text(), labInput() ? 3 : pick1.get().observer.curves.length);
    const v = (c: readonly number[]) => c.join(', ');
    fill(rows.map((r) => r.name), rows.map((r) => v(r.first)), rows.every((r) => !r.second) ? [] : rows.map((r) => (r.second ? v(r.second) : '')));
  } catch (err) {
    $('pairsStatus').className = 'error';
    $('pairsStatus').textContent = `Cannot import ${f.name}: ${message(err)}.`;
  }
});

// the three boxes scroll together, so that line n stays side by side
const boxes = ['names', 'colors1', 'colors2'].map((id) => $<HTMLTextAreaElement>(id));
boxes.forEach((b) => {
  b.addEventListener('input', schedule);
  b.addEventListener('scroll', () => boxes.forEach((o) => { if (o !== b && o.scrollTop !== b.scrollTop) o.scrollTop = b.scrollTop; }));
});

$('exChroma').addEventListener('click', () => example('chroma'));
$('exValue').addEventListener('click', () => example('value'));
$('scale').addEventListener('change', schedule);
function syncValueType(): void {
  const lab = labInput();
  $('scaleBox').hidden = lab;
  $('cielabNote').hidden = !lab;
  $('colors1Label').textContent = lab ? 'First colors (L*, a*, b*)' : 'First colors';
  $('colors2Label').textContent = lab ? 'Second colors (L*, a*, b*)' : 'Second colors';
}
$('valueType').addEventListener('change', () => { syncValueType(); schedule(); });
syncValueType();
$('downloadCsv').addEventListener('click', () => { if (lastCsv) download('wlab-differences.csv', lastCsv, 'text/csv'); });

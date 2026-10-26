// Lab A: the Wpt normalization of any sensors and light, its four steps, and the MAT to another condition.
// Bundled into labs/normalization.html by scripts/build-web.mjs.

import {
  cat, deltaEWlab, mat, mulMV, munsell1600, munsellBase, observers, resample, responses, wptNormalization, wptToWlab,
  type Mat3, type SampleSet, type Vec3, type WptNormalization,
} from '../../src/index.ts';
import {
  $, conditionPicker, copy, download, escapeHtml, fmtTick, formatMatrix, matrixTable, MATRIX_FORMATS, niceStep, parseTable,
  type Condition, type MatrixFormat,
} from './kit.ts';

const fmtSel = $<HTMLSelectElement>('fmt');
fmtSel.replaceChildren(...MATRIX_FORMATS.map(([k, l]) => new Option(l, k)));

let source: { cond: Condition; n: WptNormalization } | undefined;
let destination: { cond: Condition; mat: Mat3; reverse: Mat3 } | undefined;
const matrices: Record<string, { m: Mat3; name: string } | undefined> = {};

// one render for a burst of changes (a timer rather than an animation frame, which never comes in a hidden tab)
let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(render, 0); };
const pickA = conditionPicker($('condA'), { observer: 'cie1931', light: 'D65' }, schedule);
const pickB = conditionPicker($('condB'), { observer: 'cie1931', light: 'A' }, schedule);

const fmt3 = (v: readonly number[], d = 3) => `(${v.map((x) => x.toFixed(d)).join(', ')})`;
const message = (e: unknown) => (e as Error).message;

function render(): void {
  for (const k of Object.keys(matrices)) matrices[k] = undefined;
  source = undefined;
  const status = $('statusA');
  try {
    const cond = pickA.get();
    source = { cond, n: wptNormalization(cond.observer, cond.light) };
    status.className = 'note';
    status.textContent = `Building the normalization of ${cond.label}.`;
  } catch (e) {
    status.className = 'error';
    status.textContent = `Cannot build the normalization: ${message(e)}.`;
    for (const id of ['toWpt', 'fromWpt', 'white', 'step1', 'step2', 'step3', 'step4']) $(id).replaceChildren();
    renderMat();
    return;
  }
  const { cond, n } = source;
  matrices.toWpt = { m: n.toWpt, name: 'toWpt' };
  matrices.fromWpt = { m: n.fromWpt, name: 'fromWpt' };
  $('toWpt').innerHTML = matrixTable(n.toWpt);
  $('fromWpt').innerHTML = matrixTable(n.fromWpt);
  $('white').textContent = `White, the responses of a perfect white scaled so that the second is 100: ${fmt3(n.white, 4)}. `
    + 'In Wpt it is (100, 0, 0) for every condition.';

  drawSteps(cond, n);
  renderMat();
}

function drawSteps(cond: Condition, n: WptNormalization): void {
  const { rotation, scale, level, fit } = n.steps;
  const w1 = mulMV(rotation, n.white);
  $('step1').innerHTML = `<p>A rotation turns white, ${fmt3(n.white)}, into ${fmt3(w1)}: all of white on the first
    axis, so the other two axes carry only color.</p>${matrixTable(rotation)}`;
  $('step2').innerHTML = `<p>The first axis is scaled by ${scale.toPrecision(6)}, so that white is W = 100 in every
    condition: (100, 0, 0).</p>`;

  // the base set after steps 1 and 2: u along white, v and z across it
  const resp = munsellBase.reflectances.map((r) => responses(r, cond.observer, cond.light));
  const turned = resp.map((c) => { const [u, v, z] = mulMV(rotation, c); return [u * scale, v, z] as Vec3; });
  const hue = turned.map(([, v, z]) => ((Math.atan2(z, v) * 180) / Math.PI + 360) % 360);
  const before = turned.map(([u]) => u);
  const after = turned.map(([u, v, z]) => u - level[0] * v - level[1] * z);
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  $('step3').innerHTML = `<p>The 40 base colors share one Munsell Value, so they should share one W. Here they spread
    over ${spread(before).toFixed(2)} in W; a shear along the plane W = ${level[0].toFixed(4)} v + ${level[1].toFixed(4)} z
    + ${level[2].toFixed(3)} levels them to a spread of ${spread(after).toFixed(2)}.</p>`
    + scatter({
      xLabel: 'hue angle in the plane across white (°)', yLabel: 'W', x: [0, 360], xTicks: [0, 90, 180, 270, 360],
      sets: [
        { pts: before.map((u, i) => [hue[i], u]), color: 'var(--accent2)', label: 'before leveling' },
        { pts: after.map((u, i) => [hue[i], u]), color: 'var(--accent)', label: 'after leveling' },
      ],
    });

  const fitted = turned.map(([, v, z]) => [fit[0][0] * v + fit[0][1] * z, fit[1][0] * v + fit[1][1] * z]);
  const ref = munsellBase.referencePT.map(([p, t]) => [p, t]);
  const rms = Math.sqrt(fitted.reduce((s, [p, t], i) => s + (p - ref[i][0]) ** 2 + (t - ref[i][1]) ** 2, 0) / fitted.length);
  const lim = Math.max(...[...fitted, ...ref].flat().map(Math.abs)) * 1.1;
  $('step4').innerHTML = `<p>A 2 × 2 fit turns the other two axes into Wpt's p and t, matching the base colors' reference
    p, t (CIE 1931 observer under illuminant C) as closely as one linear map can: they land within ${rms.toFixed(3)}
    (root mean square) of the reference.</p>${matrixTable(fit.map((r) => [...r]) as unknown as Mat3, 6)}`
    + scatter({
      xLabel: 'p', yLabel: 't', x: [-lim, lim], y: [-lim, lim], square: true,
      links: fitted.map(([p, t], i) => [p, t, ref[i][0], ref[i][1]]),
      sets: [
        { pts: ref, color: 'var(--quiet)', label: 'reference', ring: true },
        { pts: fitted, color: 'var(--accent)', label: 'this condition' },
      ],
    });
}

function renderMat(): void {
  destination = undefined;
  matrices.mat = matrices.matReverse = undefined;
  const status = $('statusB');
  const clear = () => { for (const id of ['mat', 'matReverse', 'matStats', 'matHist', 'matWorst']) $(id).replaceChildren(); lastCsv = ''; };
  if (!source) { clear(); status.textContent = ''; return; }
  let cond: Condition, nb: WptNormalization;
  try {
    cond = pickB.get();
    nb = wptNormalization(cond.observer, cond.light);
  } catch (e) {
    status.className = 'error';
    status.textContent = `Cannot build the destination: ${message(e)}.`;
    clear();
    return;
  }
  const na = source.n;
  const M = mat(na, nb);
  const reverse = mat(nb, na);
  destination = { cond, mat: M, reverse };
  matrices.mat = { m: M, name: 'M' };
  matrices.matReverse = { m: reverse, name: 'Mreverse' };
  status.className = 'note';
  status.textContent = `From ${source.cond.label} to ${cond.label}.`;
  $('mat').innerHTML = matrixTable(M);
  $('matReverse').innerHTML = matrixTable(reverse);
  if ($<HTMLSelectElement>('direction').value === 'reverse') evaluate(nb, na, reverse, true);
  else evaluate(na, nb, M, false);
}

// ---------------------------------------------------------------------------------------------------------------
// How well the MAT predicts, against CATs, over a set of materials

let lastCsv = '';

/**
 * The CATs that apply between two conditions. A CAT adapts within one observer: Bradford and CAT02 are defined on
 * CIE XYZ, so they apply only to the CIE color-matching functions; for cone fundamentals and other sensors the CAT is
 * von Kries scaling in the sensors' own space. Between different observers no CAT applies.
 */
function catsFor(a: Condition['observer'], b: Condition['observer']): { name: string; method: 'bradford' | 'cat02' | 'xyz' }[] | string {
  const same = a === b || a.curves.every((c, i) => c.every((v, j) => v === b.curves[i][j]));
  if (!same) return 'Not applicable: the two conditions have different observers, and a CAT does not change the observer; only the MAT carries colors across.';
  if (([observers.cie1931, observers.cie1964, observers.cie2015, observers.cie2015_10] as Condition['observer'][]).includes(a)) {
    return [{ name: 'Bradford CAT', method: 'bradford' }, { name: 'CAT02', method: 'cat02' }, { name: 'von Kries (XYZ scaling)', method: 'xyz' }];
  }
  return [{ name: /^(CIE 2006|Categorical)/.test(a.name) ? 'von Kries (cone scaling)' : 'von Kries (sensor scaling)', method: 'xyz' }];
}

function testSet(): SampleSet & { label: string } {
  const which = $<HTMLSelectElement>('testSet').value;
  if (which === 'base') return { ...munsellBase, label: 'the 40 base colors' };
  if (which === 'paste') {
    const t = parseTable($<HTMLTextAreaElement>('testPaste').value, 1);
    const percent = Math.max(...t.columns.flat()) > 1.5;
    return {
      names: t.names, reflectances: t.columns.map((c) => resample(t.nm, percent ? c.map((x) => x / 100) : c)),
      label: `your ${t.columns.length} reflectance${t.columns.length > 1 ? 's' : ''}${percent ? ' (read as percent)' : ''}`,
    };
  }
  return { ...munsell1600(true), label: '1,560 Munsell colors' };
}

/** How well M predicts the responses of condition nb from those of na (for the reverse direction, na and nb are the
 * destination and the source). */
function evaluate(na: WptNormalization, nb: WptNormalization, M: Mat3, reverse: boolean): void {
  const status = $('testStatus');
  let set: SampleSet & { label: string };
  try {
    set = testSet();
  } catch (e) {
    status.className = 'error';
    status.textContent = `Cannot read the materials: ${message(e)}.`;
    for (const id of ['matStats', 'matHist', 'matWorst']) $(id).replaceChildren();
    lastCsv = '';
    return;
  }
  const cats = catsFor(na.observer, nb.observer);
  const predictors = [{ name: reverse ? 'Reverse MAT' : 'MAT', T: M }, ...(typeof cats === 'string' ? [] : cats.map((c) => ({ name: c.name, T: cat(na.white, nb.white, c.method) })))];
  const errors = set.reflectances.map((r) => {
    const xa = responses(r, na.observer, na.light);
    const actual = nb.wlabOf(r);
    return predictors.map(({ T }) => deltaEWlab(wptToWlab(mulMV(nb.toWpt, mulMV(T, xa))), actual));
  });
  status.className = 'note';
  status.textContent = `Predicting the ${reverse ? 'source from the destination' : 'destination from the source'}, over ${set.label}.`;

  const column = (k: number) => errors.map((e) => e[k]).sort((a, b) => a - b);
  const pct = (v: number[], p: number) => v[Math.min(v.length - 1, Math.round(p * (v.length - 1)))];
  const rows = predictors.map(({ name }, k) => {
    const v = column(k);
    const cells = [v.reduce((s, x) => s + x, 0) / v.length, pct(v, 0.5), pct(v, 0.9), v[v.length - 1]];
    return `<tr><td>${name}</td>${cells.map((x) => `<td>${x.toFixed(2)}</td>`).join('')}</tr>`;
  });
  if (typeof cats === 'string') rows.push(`<tr><td>Any CAT</td><td colspan="4" style="text-align:left;white-space:normal">${cats}</td></tr>`);
  $('matStats').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Predicted by</th><th>mean</th><th>median</th>
    <th>90th percentile</th><th>max</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <p class="note">ΔE<sub>WLab</sub> between the predicted and the true destination.</p>`;
  $('matHist').innerHTML = predictors.length > 1
    ? histogram([column(0), column(1)], [predictors[0].name, predictors[1].name], ['var(--accent)', 'var(--accent2)'])
    : histogram([column(0)], [predictors[0].name], ['var(--accent)']);

  const order = errors.map((e, i) => i).sort((a, b) => errors[b][0] - errors[a][0]).slice(0, 8);
  $('matWorst').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Material</th>${predictors.map((p) => `<th>${p.name}</th>`).join('')}</tr></thead>
    <tbody>${order.map((i) => `<tr><td>${escapeHtml(set.names[i])}</td>${errors[i].map((x) => `<td>${x.toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  lastCsv = [['material', ...predictors.map((p) => `${p.name} DeltaE_WLab`)], ...errors.map((e, i) => [set.names[i], ...e.map((x) => x.toFixed(4))])]
    .map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
}

/** Overlaid histograms of sorted values, one color per set. */
function histogram(sets: number[][], labels: string[], colors: string[]): string {
  const W = 440, H = 230, l0 = 40, top = 12, pw = W - l0 - 12, ph = H - top - 46;
  const hi = Math.max(...sets.map((v) => v[Math.min(v.length - 1, Math.round(0.98 * (v.length - 1)))])) || 1;
  const width = niceStep(hi / 12), bins = Math.ceil(hi / width) + 1;
  const counts = sets.map((v) => { const c = new Array<number>(bins).fill(0); for (const x of v) c[Math.min(bins - 1, Math.floor(x / width))]++; return c; });
  const cmax = Math.max(...counts.flat()) || 1;
  const X = (b: number) => l0 + (b / bins) * pw, Y = (c: number) => top + ph - (c / cmax) * ph;
  const bw = pw / bins;
  const bars = counts.map((c, s) => c.map((n, b) => n ? `<rect x="${(X(b) + (s * bw) / sets.length).toFixed(1)}" y="${Y(n).toFixed(1)}"
    width="${(bw / sets.length - 1).toFixed(1)}" height="${(top + ph - Y(n)).toFixed(1)}" fill="${colors[s]}"/>` : '').join('')).join('');
  const yt = niceStep(cmax / 4);
  const ticks = []; for (let t = 0; t <= cmax; t += yt) ticks.push(t);
  const xt = []; for (let b = 0; b <= bins; b += Math.max(1, Math.round(bins / 6))) xt.push(b);
  const legend = labels.map((l, s) => `<span class="key"><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" fill="${colors[s]}"/></svg>${l}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Histogram of the prediction errors">
    ${ticks.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    ${bars}
    ${xt.map((b) => `<text x="${X(b)}" y="${top + ph + 16}" text-anchor="middle">${fmtTick(b * width)}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${top + ph + 34}" text-anchor="middle">ΔE_WLab (the last bin holds everything above)</text>
    <text x="${l0 + 4}" y="${top + 10}">materials</text></svg><div class="legend">${legend}</div>`;
}

$('direction').addEventListener('change', schedule);
$('testSet').addEventListener('change', () => { $('testPasteBox').hidden = $<HTMLSelectElement>('testSet').value !== 'paste'; schedule(); });
$('testPaste').addEventListener('input', schedule);
$('downloadCsv').addEventListener('click', () => { if (lastCsv) download('mat-evaluation.csv', lastCsv, 'text/csv'); });

function scatter(o: {
  xLabel: string; yLabel: string; x: [number, number]; y?: [number, number]; xTicks?: number[]; square?: boolean;
  sets: { pts: number[][]; color: string; label: string; ring?: boolean }[]; links?: number[][];
}): string {
  const W = 440, H = o.square ? 400 : 250, l0 = 46, top = 10, pw = W - l0 - 12, ph = H - top - 44;
  const ys = o.sets.flatMap((s) => s.pts.map((p) => p[1]));
  let [y0, y1] = o.y ?? [Math.min(...ys), Math.max(...ys)];
  if (!o.y) { const pad = (y1 - y0) * 0.08 || 0.5; y0 -= pad; y1 += pad; }
  const X = (v: number) => l0 + ((v - o.x[0]) / (o.x[1] - o.x[0])) * pw;
  const Y = (v: number) => top + ph - ((v - y0) / (y1 - y0)) * ph;
  const ystep = niceStep((y1 - y0) / 4);
  const yt = []; for (let t = Math.ceil(y0 / ystep) * ystep; t <= y1 + 1e-9; t += ystep) yt.push(+t.toFixed(10));
  const xstep = niceStep((o.x[1] - o.x[0]) / 4);
  const xt = o.xTicks ?? (() => { const a = []; for (let t = Math.ceil(o.x[0] / xstep) * xstep; t <= o.x[1] + 1e-9; t += xstep) a.push(+t.toFixed(10)); return a; })();
  const dots = o.sets.map((s) => s.pts.map(([x, y]) => s.ring
    ? `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="4" fill="none" stroke="${s.color}" stroke-width="1.3"/>`
    : `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.8" fill="${s.color}"/>`).join('')).join('');
  const links = (o.links ?? []).map(([a, b, c, d]) => `<line x1="${X(a)}" y1="${Y(b)}" x2="${X(c)}" y2="${Y(d)}" stroke="var(--quiet)" stroke-opacity="0.6"/>`).join('');
  const legend = o.sets.map((s) => `<span class="key"><svg width="12" height="12" aria-hidden="true">${s.ring
    ? `<circle cx="6" cy="6" r="4" fill="none" stroke="${s.color}" stroke-width="1.3"/>` : `<circle cx="6" cy="6" r="3" fill="${s.color}"/>`}</svg>${escapeHtml(s.label)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(o.yLabel)} against ${escapeHtml(o.xLabel)}">
    ${yt.map((t) => `<line x1="${l0}" x2="${l0 + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/><text x="${l0 - 6}" y="${Y(t) + 4}" text-anchor="end">${fmtTick(t)}</text>`).join('')}
    ${xt.map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + ph}" stroke="var(--line)" stroke-opacity="0.6"/><text x="${X(t)}" y="${top + ph + 16}" text-anchor="middle">${fmtTick(t)}</text>`).join('')}
    <text x="${l0 + pw / 2}" y="${top + ph + 34}" text-anchor="middle">${escapeHtml(o.xLabel)}</text>
    <text x="${l0 + 4}" y="${top + 12}">${escapeHtml(o.yLabel)}</text>
    ${links}${dots}</svg><div class="legend">${legend}</div>`;
}

document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((b) => b.addEventListener('click', () => {
  const m = matrices[b.dataset.copy!];
  if (m) void copy(formatMatrix(m.m, m.name, fmtSel.value as MatrixFormat), b);
}));

$('downloadJson').addEventListener('click', () => {
  if (!source) return;
  const { cond, n } = source;
  const out = {
    condition: cond.label, wavelengths: '380 to 780 nm, 5 nm', white: n.white, toWpt: n.toWpt, fromWpt: n.fromWpt,
    steps: n.steps, ...(destination ? { destination: destination.cond.label, mat: destination.mat, reverseMat: destination.reverse } : {}),
  };
  download('wpt-normalization.json', JSON.stringify(out, null, 2), 'application/json');
});

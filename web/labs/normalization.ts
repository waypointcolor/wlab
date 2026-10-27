// Lab A: the Wpt normalization of any sensors (three or more) and light, the MAT to another condition (three
// sensors), how well it predicts, and the normalization's four steps.
// Bundled into labs/normalization.html by scripts/build-web.mjs.

import {
  cat, deltaEWlab, mat, mulMV, munsell1600, munsellBase, observers, responses, sensorResponses, wptNormalization,
  wptNormalizationN, wptToWlab, type Mat3, type SampleSet, type WptNormalization, type WptNormalizationN,
} from '../../src/index.ts';
import {
  $, conditionPicker, copy, download, escapeHtml, formatMatrix, histogram, matrixTable, MATRIX_FORMATS, scatter,
  type Condition, type MatrixFormat,
} from './kit.ts';
import { readReflectances, type Layout } from './shifts.ts';

const fmtSel = $<HTMLSelectElement>('fmt');
fmtSel.replaceChildren(...MATRIX_FORMATS.map(([k, l]) => new Option(l, k)));

let source: { cond: Condition; n: WptNormalizationN; n3?: WptNormalization } | undefined;
let destination: { cond: Condition; mat: Mat3; reverse: Mat3 } | undefined;
const matrices: Record<string, { m: readonly (readonly number[])[]; name: string } | undefined> = {};

// one render for a burst of changes (a timer rather than an animation frame, which never comes in a hidden tab)
let pending: ReturnType<typeof setTimeout> | undefined;
const schedule = () => { clearTimeout(pending); pending = setTimeout(() => { render(); syncCopyButtons(); }, 0); };
// a Copy button only where there is a matrix to copy: with more than three sensors there is no way back from Wpt and
// no MAT, and a condition that cannot be built has none
const syncCopyButtons = () => document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((b) => { b.hidden = !matrices[b.dataset.copy!]; });
const pickA = conditionPicker($('condA'), { observer: 'cie1931', light: 'D65' }, schedule);
const pickB = conditionPicker($('condB'), { observer: 'cie1931', light: 'A' }, schedule);
const pickC = conditionPicker($('condC'), { observer: 'cie1964', light: 'A' }, schedule);

const fmtV = (v: readonly number[], d = 3) => `(${v.map((x) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d)).join(', ')})`;
const message = (e: unknown) => (e as Error).message;
const times = (m: readonly (readonly number[])[], v: readonly number[]) => m.map((r) => r.reduce((s, a, i) => s + a * v[i], 0));

function render(): void {
  for (const k of Object.keys(matrices)) matrices[k] = undefined;
  source = undefined;
  const status = $('statusA');
  try {
    const cond = pickA.get();
    const n = wptNormalizationN(cond.observer, cond.light);
    source = { cond, n, n3: n.sensors === 3 ? wptNormalization(cond.observer, cond.light) : undefined };
    status.className = 'note';
    status.textContent = `Building the normalization of ${cond.label}${n.sensors === 3 ? '' : ` (${n.sensors} sensors)`}.`;
  } catch (e) {
    status.className = 'error';
    status.textContent = `Cannot build the normalization: ${message(e)}.`;
    for (const id of ['toWpt', 'fromWpt', 'white', 'step1', 'step2', 'step3', 'step4']) $(id).replaceChildren();
    renderMat();
    return;
  }
  const { cond, n, n3 } = source;
  // with more than three sensors there is no MAT: section 3 is one sentence
  $('matSection').hidden = !n3;
  $('matNone').hidden = !!n3;
  matrices.toWpt = { m: n.toWpt, name: 'toWpt' };
  $('toWpt').innerHTML = matrixTable(n.toWpt);
  if (n3) {
    matrices.fromWpt = { m: n3.fromWpt, name: 'fromWpt' };
    $('fromWpt').innerHTML = matrixTable(n3.fromWpt);
  } else {
    $('fromWpt').innerHTML = `<p class="note">With ${n.sensors} sensors the normalization goes one way, from the ${n.sensors}
      responses to Wpt's three coordinates (a 3 × ${n.sensors} matrix): there is no way back to the responses, and no MAT.
      The extra sensors are what make the material color equivalency better.</p>`;
  }
  $('white').textContent = `White, the responses of a perfect white scaled so that the second is 100: ${fmtV(n.white, 4)}. `
    + 'In Wpt it is (100, 0, 0) for every condition.';

  // section 4: this condition's steps, side by side with a second condition's when comparing
  const shown: { cond: Condition; n: WptNormalizationN }[] = [{ cond, n }];
  const comparing = $<HTMLInputElement>('compare').checked;
  $('condCBox').hidden = !comparing;
  if (comparing) {
    try {
      const second = pickC.get();
      shown.push({ cond: second, n: wptNormalizationN(second.observer, second.light) });
      $('statusC').className = 'note';
      $('statusC').textContent = '';
    } catch (e) {
      $('statusC').className = 'error';
      $('statusC').textContent = `Cannot build the second condition: ${message(e)}.`;
    }
  }
  drawSteps(shown);
  renderMat();
}

/** What the four steps do to the base set in one condition. */
interface Steps { cond: Condition; n: WptNormalizationN; before: number[]; after: number[]; hue: number[]; fitted: number[][]; rms: number }

function stepsOf(cond: Condition, n: WptNormalizationN): Steps {
  // the base set after steps 1 and 2 (u along white, the others across it), and in Wpt
  const resp = munsellBase.reflectances.map((r) => sensorResponses(r, cond.observer, cond.light));
  const wpt = resp.map((c) => times(n.toWpt, c));
  const fitted = wpt.map((w) => [w[1], w[2]]);
  const ref = munsellBase.referencePT;
  return {
    cond, n, fitted,
    before: resp.map((c) => times(n.steps.rotation, c)[0] * n.steps.scale),
    after: wpt.map((w) => w[0]),
    hue: wpt.map(([, p, t]) => ((Math.atan2(t, p) * 180) / Math.PI + 360) % 360),
    rms: Math.sqrt(fitted.reduce((s, [p, t], i) => s + (p - ref[i][0]) ** 2 + (t - ref[i][1]) ** 2, 0) / fitted.length),
  };
}

/** The four steps of one condition, or of two side by side on the same axes. */
function drawSteps(list: { cond: Condition; n: WptNormalizationN }[]): void {
  const all = list.map(({ cond, n }) => stepsOf(cond, n));
  const ref = munsellBase.referencePT.map(([p, t]) => [p, t]);
  // the same axes for every condition shown
  const ws = all.flatMap((s) => [...s.before, ...s.after]);
  const pad = (Math.max(...ws) - Math.min(...ws)) * 0.08 || 0.5;
  const wRange: [number, number] = [Math.min(...ws) - pad, Math.max(...ws) + pad];
  const lim = Math.max(...[...all.flatMap((s) => s.fitted), ...ref].flat().map(Math.abs)) * 1.1;
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  const side = (parts: string[]) => (all.length > 1
    ? `<div class="pair">${parts.map((p, i) => `<div><h4>${escapeHtml(all[i].cond.label)}</h4>${p}</div>`).join('')}</div>`
    : parts[0]);

  $('step1').innerHTML = side(all.map(({ n }) => `<p>A rotation turns white, ${fmtV(n.white)}, into ${fmtV(times(n.steps.rotation, n.white))}: all
    of white on the first axis, so the other ${n.sensors - 1} axes carry only color.</p>${matrixTable(n.steps.rotation)}`));
  $('step2').innerHTML = side(all.map(({ n }) => `<p>The first axis is scaled by ${n.steps.scale.toPrecision(6)}, so that white is
    W = 100 in every condition: (100, 0, 0).</p>`));
  $('step3').innerHTML = side(all.map(({ n, before, after, hue }) => {
    const others = n.sensors - 1, level = n.steps.level;
    const plane = `${level.slice(0, others).map((a, k) => `${a.toFixed(4)} c${k + 2}`).join(' + ')} + ${level[others].toFixed(3)}`;
    return `<p>The 40 base colors share one Munsell Value, so they should share one W. Here they spread over
      ${spread(before).toFixed(2)} in W; a shear along W = ${plane} (c2 … c${n.sensors} the other axes) levels them to a
      spread of ${spread(after).toFixed(2)}.</p>`
      + scatter({
        xLabel: 'hue angle in Wpt (°)', yLabel: 'W', x: [0, 360], xTicks: [0, 90, 180, 270, 360], y: wRange,
        sets: [
          { pts: before.map((u, i) => [hue[i], u]), color: 'var(--accent2)', label: 'before leveling', titles: munsellBase.names.map((nm, i) => nm + ': W ' + before[i].toFixed(2)) },
          { pts: after.map((u, i) => [hue[i], u]), color: 'var(--accent)', label: 'after leveling', titles: munsellBase.names.map((nm, i) => nm + ': W ' + after[i].toFixed(2)) },
        ],
      });
  }));
  $('step4').innerHTML = side(all.map(({ n, fitted, rms }) => {
    const others = n.sensors - 1;
    return `<p>A 2 × ${others} fit turns the other ${others} axes into Wpt's p and t${others > 2 ? ' (a non-square regression)' : ''},
      matching the base colors' reference p, t (CIE 1931 observer under illuminant C) as closely as one linear map can:
      they land within ${rms.toFixed(3)} (root mean square) of the reference.</p>${matrixTable(n.steps.fit, 6)}`
      + scatter({
        xLabel: 'p', yLabel: 't', x: [-lim, lim], y: [-lim, lim], square: true,
        links: fitted.map(([p, t], i) => [p, t, ref[i][0], ref[i][1]]),
        sets: [
          { pts: ref, color: 'var(--quiet)', label: 'reference', ring: true, titles: munsellBase.names.map((nm) => nm + ', reference') },
          { pts: fitted, color: 'var(--accent)', label: 'this condition', titles: munsellBase.names.map((nm, i) => nm + ': p ' + fitted[i][0].toFixed(2) + ', t ' + fitted[i][1].toFixed(2)) },
        ],
      });
  }));
  $('steps').classList.toggle('compare', all.length > 1);
}

function renderMat(): void {
  destination = undefined;
  matrices.mat = matrices.matReverse = undefined;
  const status = $('statusB');
  const clear = () => { for (const id of ['mat', 'matReverse', 'matStats', 'matHist', 'matWorst']) $(id).replaceChildren(); lastCsv = ''; };
  if (!source) { clear(); status.textContent = ''; return; }
  if (!source.n3) {
    clear();
    status.className = 'note';
    status.textContent = `A MAT needs three sensors in both conditions; the condition above has ${source.n.sensors}.`;
    return;
  }
  let cond: Condition, nb: WptNormalization;
  try {
    cond = pickB.get();
    if (cond.observer.curves.length !== 3) throw new Error(`a MAT needs three sensors in both conditions; this one has ${cond.observer.curves.length}`);
    nb = wptNormalization(cond.observer, cond.light);
  } catch (e) {
    status.className = 'error';
    status.textContent = `Cannot build the destination: ${message(e)}.`;
    clear();
    return;
  }
  const na = source.n3;
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
    const { materials, percent } = readReflectances($<HTMLTextAreaElement>('testPaste').value, $<HTMLSelectElement>('testOrient').value as Layout);
    return {
      names: materials.map((m) => m.name), reflectances: materials.map((m) => m.reflectance),
      label: `your ${materials.length} reflectance${materials.length > 1 ? 's' : ''}${percent ? ' (read as percent)' : ''}`,
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

$('direction').addEventListener('change', schedule);
$('compare').addEventListener('change', schedule);
$('testSet').addEventListener('change', () => { $('testPasteBox').hidden = $<HTMLSelectElement>('testSet').value !== 'paste'; schedule(); });
$('testPaste').addEventListener('input', schedule);
$('testOrient').addEventListener('change', schedule);
$('downloadCsv').addEventListener('click', () => { if (lastCsv) download('mat-evaluation.csv', lastCsv, 'text/csv'); });

document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((b) => b.addEventListener('click', () => {
  const m = matrices[b.dataset.copy!];
  if (m) void copy(formatMatrix(m.m, m.name, fmtSel.value as MatrixFormat), b);
}));

$('downloadJson').addEventListener('click', () => {
  if (!source) return;
  const { cond, n, n3 } = source;
  const out = {
    condition: cond.label, wavelengths: '380 to 780 nm, 5 nm', sensors: n.sensors, white: n.white, toWpt: n.toWpt,
    ...(n3 ? { fromWpt: n3.fromWpt } : {}),
    steps: n.steps, ...(destination ? { destination: destination.cond.label, mat: destination.mat, reverseMat: destination.reverse } : {}),
  };
  download('wpt-normalization.json', JSON.stringify(out, null, 2), 'application/json');
});

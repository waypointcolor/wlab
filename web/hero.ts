// The landing page's opening animation: the 99 color evaluation samples in WLab (left) and CIELAB (right), in 3D, each
// condition (a viewer under a light) in turn, the dots gliding from one to the next, with open circles where each
// sample sits for the reference (CIE 1931 under illuminant C); under them the viewer's curves, the light, and the
// samples' reflectances. No controls: it pauses while the pointer is over it, and starts paused (with a play button)
// for readers who ask for reduced motion. The computations are in hero-data.ts.

import { wlabToRgb, type Spectrum, type Vec3 } from '../src/index.ts';
import { LIGHTS, type LightName } from './labs/lights.ts';
import { conditionOrder, place, REFERENCE, samples, viewers, xyzCurves, type Placement, type Viewer } from './hero-data.ts';

const LIGHT_NAME: Partial<Record<LightName, string>> = {
  A: 'illuminant A (incandescent)', C: 'illuminant C (older daylight)', D50: 'illuminant D50 (graphic arts)', D65: 'illuminant D65 (daylight)',
  E: 'illuminant E (equal energy)', F2: 'F2 (cool white fluorescent)', F11: 'F11 (tri-band fluorescent)', 'RGB-D65': 'RGB-D65 (an RGB LED mixed to D65\'s white)',
  'Thouslite-D65': 'a measured D65 booth light', 'Thouslite-D50': 'a measured D50 booth light',
};
const lightName = (l: LightName) => LIGHT_NAME[l] ?? `${l} (white LED)`;
const HOLD = 1500, GLIDE = 900;

const el = (id: string) => document.getElementById(id)!;
const NS = 'http://www.w3.org/2000/svg';

/** How the 3D plots are seen: turned about the lightness axis (yaw) and tilted from looking straight down (pitch). */
interface View { yaw: number; pitch: number }
const TOP_VIEW: View = { yaw: 0, pitch: Math.PI / 2 };

interface Plot {
  svg: SVGSVGElement; frame: SVGGElement; rings: SVGCircleElement[]; lines: SVGLineElement[]; dots: SVGCircleElement[];
  ref: Vec3[]; cur: Vec3[]; lim: number; names: [string, string, string];
  draw(view: View): void;
}

const S = 340, M = 26;
const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent: Element): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
};

/**
 * A 3D plot of lightness, a and b (in that space's own units, so lightness 0 to 100 and a and b to ±lim): the
 * reference's open circles, one dot per sample to move, and a line from each circle to its dot, over a floor grid at
 * lightness 0 with the lightness axis up its middle. Seen from straight above (the a–b plane) until the view turns.
 */
function makePlot(svg: SVGSVGElement, ref: Vec3[], colors: string[], names: [string, string, string], lim: number): Plot {
  svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
  svg.innerHTML = '';
  const frame = mk('g', {}, svg);
  const rings = ref.map(() => mk('circle', { r: '4.2', fill: 'none', stroke: 'var(--quiet)', 'stroke-opacity': '0.75', 'stroke-width': '1' }, svg));
  const lines = ref.map(() => mk('line', { stroke: 'var(--ink)', 'stroke-opacity': '0.55', 'stroke-width': '1' }, svg));
  const dots = ref.map((_, i) => mk('circle', { r: '3.2', fill: colors[i], stroke: 'var(--ink)', 'stroke-opacity': '0.35', 'stroke-width': '0.6' }, svg));
  // the lightness the box spans: the reference samples' range, to the nearest 10 outward
  const ls = ref.map((p) => p[0]), lo = Math.floor(Math.min(...ls) / 10) * 10, hi = Math.ceil(Math.max(...ls) / 10) * 10, mid = (lo + hi) / 2;
  const step = lim > 60 ? 40 : 20, ticks: number[] = [];
  for (let t = -Math.floor(lim / step) * step; t <= lim; t += step) ticks.push(t);
  const plot: Plot = {
    svg, frame, rings, lines, dots, ref, cur: ref.map((p) => [...p] as Vec3), lim, names,
    draw(view: View) {
      // world: x = a, y = b, z = lightness about the middle of the samples' range; turned by yaw about z, tilted by pitch
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
      const raw = (a: number, b: number, l: number): [number, number] => {
        const x = a * cy - b * sy, y = a * sy + b * cy;
        return [x, y * sp + (l - mid) * cp];
      };
      // fit the box of a and b to ±lim and lightness over the samples' range into the square
      const corners = [-lim, lim].flatMap((a) => [-lim, lim].flatMap((b) => [lo, hi].map((l) => raw(a, b, l))));
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      const k = Math.min((S - 2 * M) / (Math.max(...xs) - Math.min(...xs)), (S - 2 * M) / (Math.max(...ys) - Math.min(...ys)));
      const cx0 = (Math.max(...xs) + Math.min(...xs)) / 2, cy0 = (Math.max(...ys) + Math.min(...ys)) / 2;
      const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
      const P = (l: number, a: number, b: number): [number, number] => {
        const [x, y] = raw(clamp(a), clamp(b), Math.max(lo - 15, Math.min(hi + 15, l)));
        return [S / 2 + (x - cx0) * k, S / 2 - (y - cy0) * k];
      };
      const seg = (p: [number, number], q: [number, number]) => `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
      const floor = ticks.map((t) => seg(P(lo, t, -lim), P(lo, t, lim)) + seg(P(lo, -lim, t), P(lo, lim, t))).join('');
      const axis0 = seg(P(lo, 0, -lim), P(lo, 0, lim)) + seg(P(lo, -lim, 0), P(lo, lim, 0));
      const showL = view.pitch < 1.4;
      const lAxis = showL ? seg(P(lo, 0, 0), P(hi, 0, 0)) : '';
      const text = (p: [number, number], s: string, anchor = 'middle', dy = 4) => `<text x="${p[0].toFixed(1)}" y="${(p[1] + dy).toFixed(1)}" text-anchor="${anchor}">${s}</text>`;
      frame.innerHTML = `<path d="${floor}" stroke="var(--line)" stroke-opacity="0.5" fill="none"/>
        <path d="${axis0}${lAxis}" stroke="var(--line)" fill="none"/>
        ${ticks.map((t) => text(P(lo, t, -lim), String(t), "middle", 14) + text(P(lo, -lim, t), String(t), "end", 4)).join('')}
        ${text(P(lo, lim, 0), names[1], "start", -4)}${text(P(lo, 0, lim), names[2], "start", -4)}
        ${showL ? [lo, hi].map((l) => text(P(l, 0, 0), l === hi ? `${names[0]} ${l}` : String(l), "start", 0)).join('') : ''}`;
      this.ref.forEach((p, i) => {
        const r = P(p[0], p[1], p[2]), d = P(this.cur[i][0], this.cur[i][1], this.cur[i][2]);
        rings[i].setAttribute('cx', r[0].toFixed(1)); rings[i].setAttribute('cy', r[1].toFixed(1));
        lines[i].setAttribute('x1', r[0].toFixed(1)); lines[i].setAttribute('y1', r[1].toFixed(1));
        lines[i].setAttribute('x2', d[0].toFixed(1)); lines[i].setAttribute('y2', d[1].toFixed(1));
        dots[i].setAttribute('cx', d[0].toFixed(1)); dots[i].setAttribute('cy', d[1].toFixed(1));
      });
    },
  };
  return plot;
}

function movePlot(p: Plot, from: Vec3[], to: Vec3[], t: number, view: View): void {
  p.cur = from.map((f, i) => [0, 1, 2].map((j) => f[j] + t * (to[i][j] - f[j])) as Vec3);
  p.draw(view);
}

/**
 * A small plot of curves over wavelength (380 to 730 nm), scaled to fill it from the lowest value (or 0) to the highest,
 * under a title in the page's own type (the viewer's or the light's name), so that it stays readable at the plot's
 * small size. The baseline is drawn at 0: matched color-matching functions can dip a little below it.
 */
function curvesPlot(title: string, curves: { values: readonly number[]; color: string; width?: number }[], keys: [string, string][] = []): string {
  const W = 300, H = 120, l0 = 10, top = 8, pw = W - 2 * l0, ph = H - top - 28, n = 71;
  const all = curves.flatMap((c) => c.values.slice(0, n)), hi = Math.max(...all) || 1, lo = Math.min(0, ...all);
  const X = (i: number) => l0 + (i / (n - 1)) * pw, Y = (v: number) => top + ph - ((v - lo) / (hi - lo)) * ph;
  const paths = curves.map((c) => `<path d="${c.values.slice(0, n).map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('')}" fill="none" stroke="${c.color}" stroke-width="${c.width ?? 1.6}"/>`).join('');
  const key = keys.map(([t, c], k) => `<text x="${W - l0 - (keys.length - 1 - k) * 22}" y="${top + 10}" text-anchor="end" style="fill:${c};font-weight:600">${t}</text>`).join('');
  // a thin spectrum bar between the plot and the wavelengths, as on the other plots of the site
  const id = `heroRainbow${++rainbows}`;
  return `<div class="cap">${title}</div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${title}">
    <defs><linearGradient id="${id}">${RAINBOW}</linearGradient></defs>
    <line x1="${l0}" x2="${l0 + pw}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="var(--line)"/>
    <rect x="${l0}" y="${top + ph + 3}" width="${pw}" height="5" fill="url(#${id})"/>
    ${[400, 500, 600, 700].map((t) => `<text x="${X((t - 380) / 5)}" y="${top + ph + 19}" text-anchor="middle">${t}</text>`).join('')}
    ${paths}${key}</svg>`;
}

/** The colors of the spectrum from 380 to 730 nm (the stops the site's other spectrum bars use). */
const RAINBOW = ([[0, '#4b0063'], [0.057, '#7a00c4'], [0.143, '#3f00ff'], [0.229, '#0046ff'], [0.314, '#00c0ff'], [0.371, '#00ff6a'],
  [0.457, '#7fff00'], [0.543, '#e6ff00'], [0.571, '#ffef00'], [0.629, '#ff9b00'], [0.714, '#ff3000'], [0.8, '#ff0000'], [0.914, '#b30000'], [1, '#6e0000']] as const)
  .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
let rainbows = 0;

const SENSOR_COLORS = ['#c0306a', '#1f8a5b', '#2f74c0'];

export function startHero(): void {
  const host = document.getElementById('hero');
  if (!host) return;
  const { reflectances } = samples(), vs = viewers();
  const refViewer = vs.find((v) => v.name === REFERENCE.viewer)!;
  const ref = place(refViewer, REFERENCE.light, reflectances);
  const colors = ref.wlab.map((w) => `rgb(${wlabToRgb(w, 'srgb').map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))).join(',')})`);
  const lim = (pts: Vec3[]) => { const r = Math.max(...pts.flatMap((p) => [Math.abs(p[1]), Math.abs(p[2])])) * 1.08; const s = r > 60 ? 20 : 10; return Math.ceil(r / s) * s; };
  const lab = makePlot(el('heroLab') as unknown as SVGSVGElement, ref.lab, colors, ['L*', 'a*', 'b*'], lim(ref.lab));
  const wl = makePlot(el('heroWlab') as unknown as SVGSVGElement, ref.wlab, colors, ['Lw', 'aw', 'bw'], lim(ref.wlab));
  // one view for both plots: a drag on either turns both (sideways about lightness, up and down to tilt); a double
  // click goes back to the view from above
  const view: View = { ...TOP_VIEW };
  const redraw = () => { lab.draw(view); wl.draw(view); };
  redraw();
  for (const p of [lab, wl]) {
    let at: [number, number] | undefined;
    p.svg.style.touchAction = 'none';
    p.svg.style.cursor = 'grab';
    p.svg.addEventListener('pointerdown', (e) => { at = [e.clientX, e.clientY]; p.svg.setPointerCapture(e.pointerId); p.svg.style.cursor = 'grabbing'; });
    p.svg.addEventListener('pointermove', (e) => {
      if (!at) return;
      view.yaw += (e.clientX - at[0]) * 0.01;
      view.pitch = Math.max(0, Math.min(Math.PI / 2, view.pitch - (e.clientY - at[1]) * 0.01));
      at = [e.clientX, e.clientY];
      redraw();
    });
    const end = () => { at = undefined; p.svg.style.cursor = 'grab'; };
    p.svg.addEventListener('pointerup', end);
    p.svg.addEventListener('pointercancel', end);
    p.svg.addEventListener('dblclick', () => { Object.assign(view, TOP_VIEW); redraw(); });
  }
  // the button under the animation does what a double click does: back to the view from above
  document.getElementById('heroReset')?.addEventListener('click', () => { Object.assign(view, TOP_VIEW); redraw(); });
  el('heroRefl').innerHTML = curvesPlot('The 99 samples (reflectance)', reflectances.map((r, i) => ({ values: r, color: colors[i], width: 0.8 })));

  const lights = (Object.keys(LIGHTS) as LightName[]);
  const order: [Viewer, LightName][] = [[refViewer, REFERENCE.light], ...conditionOrder(vs, lights, Date.now() % 100000).map(([i, l]) => [vs[i], l] as [Viewer, LightName])];
  let k = 0, shown: Placement = ref, from: Placement = ref, to: Placement = ref, phase: 'hold' | 'glide' = 'hold', since = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches, hovering = false, visible = true;

  const describe = (v: Viewer, l: LightName, p: Placement) => {
    const isRef = v === refViewer && l === REFERENCE.light;
    el('heroLabMove').innerHTML = isRef ? 'The open circles: where each sample sits for the reference.' : `Mean move from the reference: ΔE<sub>00</sub> ${p.moveLab.toFixed(2)}`;
    el('heroWlabMove').innerHTML = isRef ? 'The open circles: where each sample sits for the reference.' : `Mean move from the reference: ΔE<sub>WLab</sub> ${p.moveWlab.toFixed(2)}`;
    const ofRef = isRef ? ' (the reference)' : '';
    const spd: Spectrum = LIGHTS[l];
    // the color-matching functions that give the CIELAB: the CIE observers' own, or a viewer's sensors matched to XYZ
    const title = v.kind === 'standard' ? `${v.name}${ofRef}` : `${v.name}, matched to XYZ`;
    el('heroCurves').innerHTML = curvesPlot(title, xyzCurves(v, spd).map((c, i) => ({ values: c, color: SENSOR_COLORS[i] })),
      ['x̄', 'ȳ', 'z̄'].map((n, i) => [n, SENSOR_COLORS[i]]));
    el('heroLight').innerHTML = curvesPlot(`${lightName(l)}${ofRef}`, [{ values: spd, color: 'var(--accent2)', width: 2 }]);
  };
  describe(refViewer, REFERENCE.light, ref);

  const play = el('heroPlay') as HTMLButtonElement;
  const setPaused = (p: boolean) => { paused = p; play.textContent = p ? 'Play' : 'Pause'; };
  if (paused) { play.hidden = false; setPaused(true); }
  play.addEventListener('click', () => setPaused(!paused));
  host.addEventListener('pointerenter', () => { hovering = true; });
  host.addEventListener('pointerleave', () => { hovering = false; });
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(host);

  let last = performance.now();
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const frame = (now: number) => {
    const dt = now - last;
    last = now;
    if (!paused && !hovering && visible) {
      since += dt;
      if (phase === 'hold' && since >= HOLD) {
        k = (k + 1) % order.length;
        const [v, l] = order[k];
        from = shown;
        to = place(v, l, reflectances, ref);
        describe(v, l, to);
        phase = 'glide';
        since = 0;
      } else if (phase === 'glide') {
        const t = ease(Math.min(1, since / GLIDE));
        movePlot(lab, from.lab, to.lab, t, view);
        movePlot(wl, from.wlab, to.wlab, t, view);
        if (since >= GLIDE) { shown = to; phase = 'hold'; since = 0; }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

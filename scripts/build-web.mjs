// Bundle the web pages, each into one self-contained HTML file that opens from disk with a double-click and can also
// be hosted as it is:
//   web/robustness-report.html     (web/app.ts)                 the robustness report
//   web/wlab-onramp.html           (web/landing.ts)             the landing page with the two demos (index.html of the onramp package)
//   web/labs/index.html                                         the Waypoint Labs hub
//   web/labs/normalization.html    (web/labs/normalization.ts)  Lab A: Wpt normalization and MATs
//   web/labs/differences.html      (web/labs/differences.ts)    Lab B: WLab and color differences
//   web/labs/objects.html          (web/labs/objects.ts)        Lab C: materials across lights and observers
//   web/labs/observer.html         (web/labs/observer.ts)       Lab D: observers for observing conditions, and their profiles
//
// A template's <!--APP--> becomes the bundled script, <!--LABS-CSS--> the shared stylesheet of the labs, and
// <!--PSYCHTOOLBOX-NOTICE--> the notice of LICENSE-psychtoolbox.txt (for pages that carry the CIE 2006 tables). Every
// page gets the Waypoint color logo (web/assets/waypointcolor-logo.svg) as its favicon, in place of <!--FAVICON-->, and
// <!--LOGO--> becomes the logo itself, inline; <!--LABS-LOGO--> becomes the Waypoint Labs logo
// (web/assets/waypointlabs-logo.svg), inline.
//
// The data files the labs load when they are chosen (scripts in web/labs/fetchdata.ts) are copied beside the pages,
// into web/labs/data/: the object sets (data/objects/) and the camera sensitivities with their license
// (data/observers/cameras.json, LICENSE-rawtoaces-data.txt).
//
//   npm run build:web

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

for (const dir of ['objects', 'observers']) mkdirSync(`web/labs/data/${dir}`, { recursive: true });
for (const f of readdirSync('data/objects').filter((f) => f.endsWith('.json'))) copyFileSync(`data/objects/${f}`, `web/labs/data/objects/${f}`);
copyFileSync('data/observers/cameras.json', 'web/labs/data/observers/cameras.json');
copyFileSync('LICENSE-rawtoaces-data.txt', 'web/labs/data/observers/LICENSE-rawtoaces-data.txt');

const pages = [
  { entry: 'web/app.ts', template: 'web/robustness.template.html', out: 'web/robustness-report.html' },
  { entry: 'web/landing.ts', template: 'web/landing.template.html', out: 'web/wlab-onramp.html' },
  { template: 'web/labs/index.template.html', out: 'web/labs/index.html' },
  { entry: 'web/labs/normalization.ts', template: 'web/labs/normalization.template.html', out: 'web/labs/normalization.html' },
  { entry: 'web/labs/differences.ts', template: 'web/labs/differences.template.html', out: 'web/labs/differences.html' },
  { entry: 'web/labs/objects.ts', template: 'web/labs/objects.template.html', out: 'web/labs/objects.html' },
  { entry: 'web/labs/observer.ts', template: 'web/labs/observer.template.html', out: 'web/labs/observer.html' },
];
const labsCss = `<style>\n${readFileSync('web/labs/labs.css', 'utf8')}</style>`;
const logo = readFileSync('web/assets/waypointcolor-logo.svg', 'utf8').trim();
const favicon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(logo)}">`;
const logoInline = logo.replace(/ width="\d+" height="\d+"/, ' class="logo" role="img" aria-label="Waypoint color"');
const labsLogo = readFileSync('web/assets/waypointlabs-logo.svg', 'utf8').trim()
  .replace(/ width="\d+" height="\d+"/, ' class="labs-logo" role="img" aria-label="Waypoint Labs"');
const notice = `<!--\n${readFileSync('LICENSE-psychtoolbox.txt', 'utf8').trim().replace(/--/g, '- -')}\n-->`;
const cameraNotice = `<!--
The camera spectral sensitivities in this page are from rawtoaces-data (Academy Software Foundation,
https://github.com/AcademySoftwareFoundation/rawtoaces-data), licensed under the Apache License 2.0, whose text follows.
Changed: the R, G, B columns of each camera file put in wlab's layout (data/observers/cameras.json) and rounded to 6
significant digits.

${readFileSync('LICENSE-rawtoaces-data.txt', 'utf8').trim().replace(/--/g, '- -')}
-->`;
for (const { entry, template, out } of pages) {
  let page = readFileSync(template, 'utf8').replace('<!--LABS-CSS-->', () => labsCss).replace('<!--PSYCHTOOLBOX-NOTICE-->', () => notice)
    .replace('<!--FAVICON-->', () => favicon).replace('<!--LOGO-->', () => logoInline)
    .replace('<!--LABS-LOGO-->', () => labsLogo);
  if (entry) {
    const result = await build({
      entryPoints: [entry], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
    });
    const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    page = page.replace('<!--APP-->', () => `<script>${js}</script>`);
    if (js.includes('rawtoaces-data')) page = page.replace('</body>', () => `${cameraNotice}\n</body>`);
  }
  writeFileSync(out, page);
  console.log(`wrote ${out} (${Math.round(page.length / 1024)} kB)`);
}

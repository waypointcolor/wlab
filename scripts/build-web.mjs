// Bundle the web pages, each into one self-contained HTML file that opens from disk with a double-click and can also
// be hosted as it is:
//   web/robustness-report.html     (web/app.ts)                 the robustness report
//   web/wlab-onramp.html           (web/landing.ts)             the landing page with the two demos (index.html of the onramp package)
//   web/labs/index.html                                         the Waypoint Labs hub
//   web/labs/normalization.html    (web/labs/normalization.ts)  Lab A: Wpt normalization and MATs
//
// A template's <!--APP--> becomes the bundled script and <!--LABS-CSS--> the shared stylesheet of the labs.
//
//   npm run build:web

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const pages = [
  { entry: 'web/app.ts', template: 'web/robustness.template.html', out: 'web/robustness-report.html' },
  { entry: 'web/landing.ts', template: 'web/landing.template.html', out: 'web/wlab-onramp.html' },
  { template: 'web/labs/index.template.html', out: 'web/labs/index.html' },
  { entry: 'web/labs/normalization.ts', template: 'web/labs/normalization.template.html', out: 'web/labs/normalization.html' },
];
const labsCss = `<style>\n${readFileSync('web/labs/labs.css', 'utf8')}</style>`;
for (const { entry, template, out } of pages) {
  let page = readFileSync(template, 'utf8').replace('<!--LABS-CSS-->', () => labsCss);
  if (entry) {
    const result = await build({
      entryPoints: [entry], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
    });
    const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    page = page.replace('<!--APP-->', () => `<script>${js}</script>`);
  }
  writeFileSync(out, page);
  console.log(`wrote ${out} (${Math.round(page.length / 1024)} kB)`);
}

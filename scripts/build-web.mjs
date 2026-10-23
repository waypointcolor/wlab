// Bundle the web pages, each into one self-contained HTML file that opens from disk with a double-click and can also
// be hosted as it is:
//   web/robustness-report.html  (web/app.ts)      the robustness report
//   web/wlab-onramp.html        (web/landing.ts)  the landing page with the two demos (index.html of the onramp package)
//
//   npm run build:web

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const pages = [
  ['web/app.ts', 'web/robustness.template.html', 'web/robustness-report.html'],
  ['web/landing.ts', 'web/landing.template.html', 'web/wlab-onramp.html'],
];
for (const [entry, template, out] of pages) {
  const result = await build({
    entryPoints: [entry], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const page = readFileSync(template, 'utf8').replace('<!--APP-->', () => `<script>${js}</script>`);
  writeFileSync(out, page);
  console.log(`wrote ${out} (${Math.round(page.length / 1024)} kB)`);
}

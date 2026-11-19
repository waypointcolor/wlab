// Write web/demo-camera.json: the one camera of the landing page's animation, taken unchanged from
// data/observers/cameras.json (rawtoaces-data, Apache License 2.0), with the credit and license of that file. The
// landing page bundles this one rather than fetching all 52.
//
// The camera is the one of the 52 whose sensors come closest to the CIE 1931 (2°) color-matching functions: the
// smallest residual of the least-squares 3 × 3 fit (cmfFit in web/hero-data.ts), 22.7 % of the curves' size against
// 23.0 % to 33.1 % for the rest (Max, 2026-11-19).
//
//   node scripts/demo-camera.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const NAME = 'Canon EOS 200D II';
const all = JSON.parse(readFileSync('data/observers/cameras.json', 'utf8'));
const c = all.cameras.find((x) => x.name === NAME);
if (!c) throw new Error(`no camera named ${NAME}`);
const out = {
  source: all.source, license: all.license, changes: `${all.changes} One of its ${all.count} cameras.`,
  camera: { name: c.name, measured_by: c.measured_by, curves: c.curves },
};
writeFileSync('web/demo-camera.json', `${JSON.stringify(out)}\n`);
console.log(`wrote web/demo-camera.json (${c.name})`);

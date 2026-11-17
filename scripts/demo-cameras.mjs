// Write web/demo-cameras.json: the few cameras of the landing page's animation, taken unchanged from
// data/observers/cameras.json (rawtoaces-data, Apache License 2.0), with the credit and license of that file. The
// landing page bundles these few rather than fetching all 52.
//
//   node scripts/demo-cameras.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const NAMES = [
  'ARRI D21', 'Canon EOS 5D Mark IV', 'Canon EOS R5', 'Fujifilm GFX 100', 'Nikon D850', 'Panasonic DC-GX9',
  'Sony ILCE-7M4', 'Sony DSC-RX100M4',
];
const all = JSON.parse(readFileSync('data/observers/cameras.json', 'utf8'));
const cameras = NAMES.map((n) => {
  const c = all.cameras.find((x) => x.name === n);
  if (!c) throw new Error(`no camera named ${n}`);
  return { name: c.name, measured_by: c.measured_by, curves: c.curves };
});
const out = { source: all.source, license: all.license, changes: `${all.changes} ${cameras.length} of its ${all.count} cameras.`, cameras };
writeFileSync('web/demo-cameras.json', `${JSON.stringify(out)}\n`);
console.log(`wrote web/demo-cameras.json (${cameras.length} cameras)`);

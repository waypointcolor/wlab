// Write web/labs/display-data.json: Lab I's built-in displays, read from iccDEV's spectral display profiles
// (Testing/Display/LCDDisplay.xml and Rec2020rgbSpectral.xml, BSD 3-Clause, International Color Consortium) by the
// page's own reader, so that the page bundles a few numbers rather than the XML. Values are rounded to 8 significant
// digits.
//
//   node scripts/displays.ts <path to iccDEV's Testing/Display>

import { readFileSync, writeFileSync } from 'node:fs';
import { displayFromXml } from '../web/labs/display.ts';

const dir = process.argv[2];
if (!dir) throw new Error('give the path to iccDEV\'s Testing/Display');
const round = (v: number[]) => v.map((x) => Number(x.toPrecision(8)));
const FILES: [string, string, string][] = [
  ['LCDDisplay.xml', 'LCD display', 'iccDEV, Testing/Display/LCDDisplay.xml (International Color Consortium, BSD 3-Clause): the emission of an LCD, every 1 nm.'],
  ['Rec2020rgbSpectral.xml', 'Rec. 2020 laser display', 'iccDEV, Testing/Display/Rec2020rgbSpectral.xml (International Color Consortium, BSD 3-Clause): the Rec. 2020 primaries as single lines at 630, 532 and 467 nm, with the Rec. 2020 tone curve.'],
];
const displays = FILES.map(([file, name, source]) => {
  const d = displayFromXml(readFileSync(`${dir}/${file}`, 'utf8'), source);
  return {
    name, source, nm: [d.nm[0], d.nm[d.nm.length - 1], d.nm.length],
    primaries: d.primaries.map(round), black: round(d.black), curves: d.curves.map(round),
  };
});
writeFileSync('web/labs/display-data.json', `${JSON.stringify({ displays })}\n`);
console.log(`wrote web/labs/display-data.json (${displays.map((d) => d.name).join(', ')})`);

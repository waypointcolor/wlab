// Lab I's built-in displays (web/labs/display-data.json, written by scripts/displays.ts from iccDEV's spectral display
// profiles).

import data from './display-data.json' with { type: 'json' };
import { gridOf, type Display } from './display.ts';

export const BUILT_IN_DISPLAYS: Display[] = data.displays.map((d) => ({
  name: d.name, source: d.source, nm: gridOf(d.nm[0], d.nm[1], d.nm[2]),
  primaries: d.primaries as Display['primaries'], black: d.black, curves: d.curves as Display['curves'],
}));

// The object library: the sets of reflectances the labs compute their metrics over, each with where it comes from,
// what it is for and its license. The corrected Munsell colors are built into the package, and the CIE's 99 color
// evaluation samples (those of TM-30-18), its 14 test color samples (of the color rendering index), the PMCC and the
// natural objects measured in Japan into the pages (with
// the Munsell colors, the default objects); the others are in data/objects/, one JSON file per set, and
// are loaded only when chosen. The pages bundle the index of every set (data/objects/sets.json, written by the build
// repository's tools/library/index_sets.py), to describe each one.

import { munsell1600, type SampleSet } from '../../src/index.ts';
import ces99 from '../../data/objects/cie-ces99.json' with { type: 'json' };
import tcs14 from '../../data/objects/cie-tcs14.json' with { type: 'json' };
import natural from '../../data/objects/morimoto-natural-objects.json' with { type: 'json' };
import pmcc from '../../data/objects/pmcc.json' with { type: 'json' };
import index from '../../data/objects/sets.json' with { type: 'json' };
import { loadData } from './fetchdata.ts';

export type Objects = SampleSet & { categories: readonly string[] };

export interface ObjectSet {
  id: string;
  title: string;
  /** what the set is and what it is good for, in a sentence or two */
  description: string;
  count: number;
  /** who to credit and under what terms */
  credit: string;
  url: string;
  license: string;
  /** built into the page (no loading) */
  builtIn: boolean;
  load(): Promise<Objects>;
}

interface SetFile { id: string; count: number; scale: number; names: string[]; categories: string[]; data: string }
interface SetMeta { id: string; title: string; description: string; source: string; url: string; license: string; changes: string; count: number; file: string }

/** The reflectances of a set file: little-endian int16 at 1/scale, base64, 81 values (380 to 780 nm) per object. */
export function decodeSet(f: SetFile): Objects {
  const bin = atob(f.data), view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  if (bin.length !== f.count * 81 * 2 || f.names.length !== f.count) throw new Error(`the object set ${f.id} is damaged`);
  return {
    names: f.names, categories: f.categories,
    reflectances: f.names.map((_, j) => Array.from({ length: 81 }, (_, i) => view.getInt16((j * 81 + i) * 2, true) / f.scale)),
  };
}

// the sets built into the pages, by id: no loading
const BUILT_IN: Record<string, SetFile> = {
  'cie-ces99': ces99 as SetFile, 'cie-tcs14': tcs14 as SetFile, pmcc: pmcc as SetFile, 'morimoto-natural-objects': natural as SetFile,
};
const fromIndex = (m: SetMeta): ObjectSet => {
  const own = BUILT_IN[m.id];
  let decoded: Objects | undefined;
  return {
    id: m.id, title: m.title, description: m.description, count: m.count, url: m.url, license: m.license, builtIn: !!own,
    credit: `${m.source} ${m.changes}`,
    load: async () => (own ? (decoded ??= decodeSet(own)) : decodeSet(await loadData(`objects/${m.file}`) as SetFile)),
  };
};

const munsell: ObjectSet = {
  id: 'munsell1600', title: 'The corrected Munsell colors', builtIn: true,
  description: 'The 1,600 glossy chips of a Munsell Book of Color, measured by the University of Eastern Finland and '
    + 'corrected to the Munsell renotation: every hue, lightness and chroma of one maker\'s pigments.',
  count: 1600, url: 'https://sites.uef.fi/spectral/?p=423', license: 'credit both sources',
  credit: 'Measurements © University of Eastern Finland; corrected by M. W. Derhak and R. S. Berns, "Analysis and '
    + 'correction of the Joensuu Munsell glossy spectral database," Proc. 20th Color and Imaging Conference (2012).',
  load: async () => ({ ...munsell1600(), categories: munsell1600().names.map((n) => n.replace(/^[\d.]+([A-Z]+).*$/, '$1')) }),
};

/**
 * Whether a Munsell color is one of the 271 of the 2014 Wpt animations (makeMunAnim.m): the ten hues 10R, 10YR, …
 * 10RP at every Value with Chroma 4 to 16 in steps of 2, and the neutrals at every half Value.
 */
export function inAnimationSet(name: string): boolean {
  const m = /^(\S+) ([\d.]+)\/(\d*)$/.exec(name);
  if (!m) return false;
  const [hue, v, c] = [m[1], Number(m[2]), Number(m[3] || 0)];
  return hue === 'N' ? Number.isInteger(2 * v) : /^10[A-Z]+$/.test(hue) && c > 2 && c % 2 === 0;
}

const munsellReduced: ObjectSet = {
  id: 'munsell271', title: 'A selection of corrected Munsell colors', builtIn: true,
  description: 'From the corrected Munsell colors, one hue of each of the ten families (10R, 10YR, … 10RP) at every '
    + 'Value with Chroma 4 to 16 in steps of 2, and the 19 neutrals (the colors of the 2014 Wpt animations): 271 '
    + 'colors spanning the Munsell solid without outweighing the other sets as the full 1,600 would.',
  count: 271, url: munsell.url, license: munsell.license, credit: munsell.credit,
  load: async () => {
    const all = munsell1600(), keep = all.names.map(inAnimationSet);
    const names = all.names.filter((_, i) => keep[i]);
    return { names, reflectances: all.reflectances.filter((_, i) => keep[i]), categories: names.map((n) => n.replace(/^[\d.]+([A-Z]+).*$/, '$1')) };
  },
};

const ORDER = ['cie-ces99', 'cie-tcs14', 'pmcc', 'morimoto-natural-objects', 'nist-skin', 'munsell-soil-chart'];
const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);

/** Every set in the library, the built-in ones first. */
export const OBJECT_SETS: readonly ObjectSet[] = [munsellReduced, munsell, ...(index as SetMeta[]).map(fromIndex).sort((a, b) => rank(a.id) - rank(b.id))];

/** A set the reader loaded from a file: already in the page. */
export function ownSet(id: string, title: string, objects: Objects, note: string): ObjectSet {
  return {
    id, title, description: note, count: objects.reflectances.length, url: '', license: 'your own data, used in this page only',
    credit: '', builtIn: true, load: async () => objects,
  };
}

/** The objects of the chosen sets, as one set; names carry the set's title when more than one is chosen. */
export async function objectsOf(ids: readonly string[], from: readonly ObjectSet[] = OBJECT_SETS): Promise<SampleSet & { sets: readonly ObjectSet[] }> {
  const sets = from.filter((s) => ids.includes(s.id));
  if (!sets.length) throw new Error('choose at least one set of objects');
  const loaded = await Promise.all(sets.map((s) => s.load()));
  const names: string[] = [], reflectances: (readonly number[])[] = [];
  sets.forEach((s, k) => loaded[k].names.forEach((n, j) => {
    names.push(sets.length > 1 ? `${n} (${s.title})` : n);
    reflectances.push(loaded[k].reflectances[j]);
  }));
  return { names, reflectances, sets };
}

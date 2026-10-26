// Reading the colors of Lab B: names, first colors and second colors in three boxes (line n of each belongs
// together), or one file of rows. No browser code, so that the tests can use it directly.

/** A color is one value per sensor of the condition (three, or more; three for CIELAB). */
export interface Row { name: string; first: number[]; second?: number[] }

/** One color or one pair per row: an optional name, then n or 2n numbers; a first row that is not numbers is a header. */
export function parseRows(text: string, n: number): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const rows: Row[] = [];
  lines.forEach((line, k) => {
    const cells = line.split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : line.includes(',') ? ',' : /\s+/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const named = Number.isNaN(Number(cells[0])) || cells[0] === '';
    const nums = (named ? cells.slice(1) : cells).filter((c) => c !== '').map(Number);
    if (nums.some((v) => Number.isNaN(v))) {
      if (k === 0) return;                                                     // a header row
      throw new Error(`row ${k + 1}: not a number after the name`);
    }
    if (nums.length !== n && nums.length !== 2 * n) throw new Error(`row ${k + 1}: give ${n} values (one color) or ${2 * n} (a pair), not ${nums.length}`);
    rows.push({
      name: named ? cells[0] : `${nums.length === 2 * n ? 'Pair' : 'Color'} ${rows.length + 1}`,
      first: nums.slice(0, n), second: nums.length === 2 * n ? nums.slice(n, 2 * n) : undefined,
    });
  });
  if (!rows.length) throw new Error('paste at least one row');
  return rows;
}

/** Lines of a box, without trailing empty lines. */
export function linesOf(text: string): string[] {
  const l = text.split(/\r?\n/).map((s) => s.trim());
  while (l.length && !l[l.length - 1]) l.pop();
  return l;
}

/** n values per line (an empty line is no color); a first line that is not numbers is a header and is skipped. */
export function colorLines(text: string, what: string, n: number): (number[] | undefined)[] {
  const out = linesOf(text).map((line, k) => {
    if (!line) return undefined;
    const v = line.split(/[\s,;]+/).filter((c) => c !== '').map(Number);
    if (v.some((x) => Number.isNaN(x))) {
      if (k === 0) return null;
      throw new Error(`${what}, line ${k + 1}: not a number`);
    }
    if (v.length !== n) throw new Error(`${what}, line ${k + 1}: give ${n} values (one per sensor), not ${v.length}`);
    return v;
  });
  return (out[0] === null ? out.slice(1) : out) as (number[] | undefined)[];
}

/**
 * The rows of the three boxes: line n of each belongs together. A missing second color (an empty line, or missing
 * lines at the end) makes a single color; missing names get one ("Pair 3", "Color 4").
 */
export function readBoxes(namesText: string, firstText: string, secondText: string, n: number): Row[] {
  const first = colorLines(firstText, 'First colors', n), second = colorLines(secondText, 'Second colors', n);
  let names = linesOf(namesText);
  if (names.length === first.length + 1 && /^names?$/i.test(names[0])) names = names.slice(1);
  if (second.length > first.length) throw new Error(`the second colors have ${second.length} lines for ${first.length} first colors`);
  if (names.length > first.length) throw new Error(`there are ${names.length} names for ${first.length} colors`);
  return first.map((c, i) => {
    if (!c) throw new Error(`First colors, line ${i + 1}: empty`);
    return { name: names[i] || `${second[i] ? 'Pair' : 'Color'} ${i + 1}`, first: c, second: second[i] };
  });
}

// How Lab B reads its colors (web/labs/rows.ts): three boxes whose lines belong together, or one file of rows.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRows, readBoxes } from '../web/labs/rows.ts';

test('three boxes: line n of each belongs together; headers are skipped; a missing second color makes a single color', () => {
  const rows = readBoxes(
    'Names\nBrand red\nSub 1\nWhite',
    'X, Y, Z\n21.1, 12.9, 4.8\n20.9 12.8 4.9\n95.04;100;108.88',
    'X, Y, Z\n21.6, 13.0, 4.62\n21.0, 12.7, 4.7',
    3,
  );
  assert.deepEqual(rows.map((r) => r.name), ['Brand red', 'Sub 1', 'White']);
  assert.deepEqual(rows[0].first, [21.1, 12.9, 4.8]);
  assert.deepEqual(rows[1].first, [20.9, 12.8, 4.9]);                       // spaces separate too
  assert.deepEqual(rows[2].first, [95.04, 100, 108.88]);                    // and semicolons
  assert.deepEqual(rows[0].second, [21.6, 13.0, 4.62]);
  assert.equal(rows[2].second, undefined);                                  // no third line: a single color
});

test('an empty line in the second box makes a single color; missing names are given', () => {
  const rows = readBoxes('', '1,2,3\n4,5,6\n7,8,9', '1,2,3\n\n7,8,9\n', 3);
  assert.deepEqual(rows.map((r) => r.name), ['Pair 1', 'Color 2', 'Pair 3']);
  assert.equal(rows[1].second, undefined);
  const named = readBoxes('only one', '1,2,3\n4,5,6', '', 3);
  assert.deepEqual(named.map((r) => r.name), ['only one', 'Color 2']);
});

test('one value per sensor: four sensors take four values', () => {
  const rows = readBoxes('a', '1, 2, 3, 4', '5, 6, 7, 8', 4);
  assert.deepEqual(rows[0].first, [1, 2, 3, 4]);
  assert.deepEqual(rows[0].second, [5, 6, 7, 8]);
  assert.throws(() => readBoxes('', '1, 2, 3', '', 4), /line 1: give 4 values \(one per sensor\), not 3/);
});

test('the boxes say what is wrong', () => {
  assert.throws(() => readBoxes('', '1,2,3\nx,2,3', '', 3), /First colors, line 2: not a number/);
  assert.throws(() => readBoxes('', '1,2,3', '1,2,3\n4,5,6', 3), /the second colors have 2 lines for 1 first colors/);
  assert.throws(() => readBoxes('a\nb', '1,2,3', '', 3), /there are 2 names for 1 colors/);
  assert.throws(() => readBoxes('', '1,2,3\n\n4,5,6', '', 3), /First colors, line 2: empty/);
  assert.throws(() => readBoxes('', '1,2', '', 3), /give 3 values/);
});

test('one file: a name, then one or two colors; a header row is skipped', () => {
  const rows = parseRows('name,X1,Y1,Z1,X2,Y2,Z2\nBrand red,21.1,12.9,4.80,21.6,13.0,4.62\n"Sub 2",20.9,12.8,4.9\n1\t2\t3\t4\t5\t6', 3);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Brand red');
  assert.deepEqual(rows[0].second, [21.6, 13.0, 4.62]);
  assert.equal(rows[1].name, 'Sub 2');                                      // quotes removed
  assert.equal(rows[1].second, undefined);
  assert.equal(rows[2].name, 'Pair 3');                                     // no name: one is given
  assert.deepEqual(parseRows('a 1 2 3 4 5 6 7 8', 4)[0].second, [5, 6, 7, 8]);
  assert.throws(() => parseRows('a,1,2,3,4', 3), /row 1: give 3 values \(one color\) or 6 \(a pair\), not 4/);
  assert.throws(() => parseRows('# only a comment', 3), /paste at least one row/);
});

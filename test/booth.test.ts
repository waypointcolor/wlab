// The site's measured booth lights match the colorimetry their measurement file reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observers, whiteOf } from '../src/index.ts';
import { BOOTH_LIGHTS, EXTRA_LIGHTS, LIGHTS } from '../web/labs/lights.ts';
import { THOUSLITE_REPORTED } from '../web/labs/thouslite-data.ts';

test('the Thouslite booth lights have the chromaticities their measurement file reports', () => {
  (['Thouslite-D65', 'Thouslite-D50'] as const).forEach((k, i) => {
    assert.equal(BOOTH_LIGHTS[k].length, 81);
    const [X, Y, Z] = whiteOf(observers.cie1931, LIGHTS[k]), s = X + Y + Z;
    assert.ok(Math.abs(X / s - THOUSLITE_REPORTED.x[i]) < 2e-4, `${k} x ${X / s}`);
    assert.ok(Math.abs(Y / s - THOUSLITE_REPORTED.y[i]) < 2e-4, `${k} y ${Y / s}`);
  });
  assert.deepEqual([...EXTRA_LIGHTS], ['RGB-D65', 'Thouslite-D65', 'Thouslite-D50']);
});

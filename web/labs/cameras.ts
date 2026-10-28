// The cameras the labs offer as sensors: the open spectral sensitivities of rawtoaces-data (Academy Software
// Foundation, Apache License 2.0). The pages bundle only their names (data/observers/cameras-index.json); the curves,
// data/observers/cameras.json, are loaded the first time a camera is chosen. Pages that name them also carry the
// license (scripts/build-web.mjs adds it to any page whose script holds their credit).

import type { Observer } from '../../src/index.ts';
import index from '../../data/observers/cameras-index.json' with { type: 'json' };
import { loadData } from './fetchdata.ts';

export interface Camera { name: string; measuredBy: string }

/** Every camera, in the data's order (by maker, then model). */
export const CAMERAS: readonly Camera[] = index.cameras.map((c) => ({ name: c.name, measuredBy: c.measured_by }));

/** Who to credit for the cameras, and under what terms. */
export const CAMERA_CREDIT = `${index.source} ${index.license}. ${index.changes}`;

let observers: Observer[] | undefined;

/** The cameras as observers (each name ending in "(camera)"), loading their curves the first time. */
export async function cameraObservers(): Promise<readonly Observer[]> {
  if (!observers) {
    const data = await loadData('observers/cameras.json') as { cameras: { name: string; curves: number[][] }[] };
    if (data.cameras.length !== CAMERAS.length) throw new Error('the camera data do not match their index');
    observers = data.cameras.map((c) => ({ name: `${c.name} (camera)`, curves: c.curves as unknown as Observer['curves'] }));
  }
  return observers;
}

let failed: string | undefined;
const waiting = new Set<() => void>();

/**
 * The cameras as observers if their curves are loaded. Otherwise it starts loading them (once), calls `then` when the
 * load ends, and throws: that they are loading, or why they could not be loaded. A failed load is not tried again
 * until `retryCameras()`, so that a page that cannot load them does not keep asking.
 */
export function camerasNow(then: () => void): readonly Observer[] {
  if (observers) return observers;
  if (failed) throw new Error(failed);
  if (!waiting.size) {
    const done = () => { const w = [...waiting]; waiting.clear(); w.forEach((f) => f()); };
    cameraObservers().then(done, (e: unknown) => { failed = (e as Error).message; done(); });
  }
  waiting.add(then);
  throw new Error('the camera sensitivities are loading');
}

/** After a failed load: try again the next time they are asked for (when the reader changes the choice). */
export const retryCameras = () => { failed = undefined; };

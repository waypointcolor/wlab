// The data files the labs load when they are chosen, not with the page: the object sets and the camera
// sensitivities, published in data/ beside the pages (the site's labs/data/; web/labs/data/ in this repository, copied
// there by scripts/build-web.mjs). Each file is fetched once and kept.

type Fetcher = (path: string) => Promise<unknown>;

let fetcher: Fetcher = async (path) => {
  const r = await fetch(new URL(`data/${path}`, document.baseURI));
  if (!r.ok) throw new Error(`${path} (${r.status})`);
  return r.json();
};
const cache = new Map<string, Promise<unknown>>();

/** Another way to read the data files (the tests read them from disk); clears what was loaded. */
export function setFetcher(f: Fetcher): void { fetcher = f; cache.clear(); }

/** True for a page opened from a file on disk, where a browser lets it load nothing beside it. */
export const fromDisk = () => typeof location !== 'undefined' && location.protocol === 'file:';

/** A data file, by its path under data/ (for example "objects/pmcc.json"); a failed load is tried again next time. */
export function loadData(path: string): Promise<unknown> {
  let p = cache.get(path);
  if (!p) {
    p = fetcher(path).catch((e: unknown) => {
      cache.delete(path);
      throw new Error(fromDisk()
        ? 'this page was opened from a file on disk, where it can load only what is built into it: open it on the website (or through a local web server) for the other sets and the cameras'
        : `cannot load ${(e as Error).message}`);
    });
    cache.set(path, p);
  }
  return p;
}

/** Whether a data file is already loaded (or loading). */
export const isLoaded = (path: string) => cache.has(path);

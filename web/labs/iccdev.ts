// iccDEV's own command-line tools, compiled to WebAssembly (vendor/iccdev), run on files kept in memory. A tool is
// loaded the first time it is used (its loader script, then its .wasm), so a page pays for it only when it runs it.
// The same `run` serves the browser (`browserLoader`) and the tests in Node.js (`test/iccdev-node.ts`).

/** The tools Lab I uses, by the name of their loader (`<name>.js`, `<name>.wasm`). */
export type Tool = 'iccFromXml' | 'iccApplyNamedCmm' | 'iccV5DspObsToV4Dsp' | 'iccDumpProfile';

interface EmModule {
  FS: { writeFile(path: string, data: Uint8Array | string): void; readFile(path: string): Uint8Array };
  callMain(args: string[]): number;
}
/** Emscripten's module factory: one fresh instance (its own memory and files) per call. */
export type Factory = (options: Record<string, unknown>) => Promise<EmModule>;
/** Where a tool's factory comes from, and the options its instances need (the .wasm's location or bytes). */
export interface Loader { factory(tool: Tool): Promise<Factory>; options(tool: Tool): Record<string, unknown> }

export interface RunResult {
  /** the tool's exit code (0 when it succeeded) */
  code: number;
  /** what it printed, standard output and errors together, in order */
  output: string;
  /** the files asked for, as the tool left them (undefined for one it did not write) */
  files: Record<string, Uint8Array | undefined>;
}

/**
 * Run one of iccDEV's tools as on the command line: write `files` into a fresh instance's memory, call it with `args`,
 * and read back the files named in `want`. Each run gets a fresh instance, so runs never see each other's files.
 */
export async function run(loader: Loader, tool: Tool, args: string[], files: Record<string, Uint8Array | string> = {}, want: string[] = []): Promise<RunResult> {
  const lines: string[] = [];
  const make = await loader.factory(tool);
  const mod = await make({ ...loader.options(tool), noInitialRun: true, print: (s: string) => lines.push(s), printErr: (s: string) => lines.push(s) });
  for (const [name, data] of Object.entries(files)) mod.FS.writeFile(name, data);
  let code: number;
  try {
    code = mod.callMain(args);
  } catch (e) {
    // a tool that calls exit() ends by throwing Emscripten's ExitStatus, which carries the code
    const status = (e as { status?: number }).status;
    if (typeof status !== 'number') throw e;
    code = status;
  }
  const out: Record<string, Uint8Array | undefined> = {};
  for (const name of want) {
    try { out[name] = mod.FS.readFile(name); } catch { out[name] = undefined; }
  }
  return { code, output: lines.join('\n'), files: out };
}

/** In the page: the loaders sit in `base` (the labs' `iccdev/` folder); each defines a global createModule. */
export function browserLoader(base = 'iccdev/'): Loader {
  const factories = new Map<Tool, Promise<Factory>>();
  // one loader at a time: each sets the same global, read as soon as its script has run
  let queue: Promise<unknown> = Promise.resolve();
  const load = (tool: Tool) => { const p = queue.then(() => loadOne(tool)); queue = p.catch(() => undefined); return p; };
  const loadOne = (tool: Tool) => new Promise<Factory>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${base}${tool}.js`;
    script.onload = () => {
      const w = window as unknown as { createModule?: Factory };
      const f = w.createModule;
      w.createModule = undefined; // a top-level var: it cannot be deleted, only overwritten
      if (f) resolve(f); else reject(new Error(`${tool}.js did not define createModule`));
    };
    script.onerror = () => reject(new Error(`could not load ${base}${tool}.js`));
    document.head.append(script);
  });
  return {
    factory(tool) {
      if (!factories.has(tool)) factories.set(tool, load(tool));
      return factories.get(tool)!;
    },
    options: (tool) => ({ locateFile: (file: string) => `${base}${file.endsWith('.wasm') ? `${tool}.wasm` : file}` }),
  };
}

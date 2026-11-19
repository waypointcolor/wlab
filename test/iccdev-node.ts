// The vendored iccDEV WebAssembly tools (vendor/iccdev) loaded in Node.js for the tests, the same modules the page
// loads. The package is an ES module package, so each loader (a CommonJS-style script that sets module.exports) is
// evaluated in a function scope of its own, and its .wasm handed over as bytes.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Factory, Loader, Tool } from '../web/labs/iccdev.ts';

const dir = fileURLToPath(new URL('../vendor/iccdev/', import.meta.url));
const factories = new Map<Tool, Factory>();

export const nodeLoader: Loader = {
  async factory(tool) {
    if (!factories.has(tool)) {
      const source = readFileSync(`${dir}${tool}.js`, 'utf8');
      const module = { exports: {} as unknown };
      // eslint-disable-next-line no-new-func
      new Function('module', 'exports', 'require', '__filename', '__dirname', source)(module, module.exports, createRequire(import.meta.url), `${dir}${tool}.js`, dir);
      factories.set(tool, module.exports as Factory);
    }
    return factories.get(tool)!;
  },
  options: (tool) => ({ wasmBinary: readFileSync(`${dir}${tool}.wasm`) }),
};

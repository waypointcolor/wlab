# iccDEV's tools as WebAssembly (four of them)

Lab I (Profiles) runs iccDEV's own tools in the page. These are four of the seventeen modules of the `iccdev` npm
package, version 2.3.28 (https://registry.npmjs.org/iccdev/-/iccdev-2.3.28.tgz, integrity
`sha512-ryVENcChLph5GABPlHKrKGx2UVCcR1Plawj8VXcCybgr1QPbSLLca0sAvPjM0WDJOgkqyRUOT27U0Fzc+5ascQ==`), built by the
International Color Consortium's CI from https://github.com/InternationalColorConsortium/iccDEV (IccProfLib
2.3.2.5+d7e0bb0) and published 8 November 2026. They are copied unchanged:

| Tool | Files |
| --- | --- |
| iccFromXml | `iccFromXml.js`, `iccFromXml.wasm` |
| iccApplyNamedCmm | `iccApplyNamedCmm.js`, `iccApplyNamedCmm.wasm` |
| iccV5DspObsToV4Dsp | `iccV5DspObsToV4Dsp.js`, `iccV5DspObsToV4Dsp.wasm` |
| iccDumpProfile | `iccDumpProfile.js`, `iccDumpProfile.wasm` |

Each `.js` is Emscripten's loader (`createModule`, modularized, for the web and Node.js); the page loads a tool only
when Lab I first needs it, from `labs/iccdev/`, so no other page carries them.

License: BSD 3-Clause, the International Color Consortium ([LICENSE.txt](LICENSE.txt)). The tools are compiled with
third-party libraries whose notices are kept with them, as the package's
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) asks, in [third-party-licenses/](third-party-licenses/). The web
build publishes this folder's license files beside the tools.

To update: download the package's tarball, check its integrity against the registry's, and copy the same eight files
and the notices.

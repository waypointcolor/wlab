# wlab

**Wpt (Waypoint), WLab (Waypoint Lab) and material adjustment transforms (MATs) in TypeScript.**

A CIELAB value holds for one light and one standard observer. WLab describes the *material* instead: every light and
every observer, standard or custom (a CIE 2015 or age-dependent observer, a camera), goes through its own Wpt
normalization into one common representation, and the straight-line distance ΔE<sub>WLab</sub> works like a familiar
ΔE. It predicts the color difference the reference observer (CIE 1931, under illuminant C) would see between two
materials, wherever they were measured. A Wpt MAT carries measurements from one light and/or observer to another by
way of the material.

The method is explained, without math, in the guide *WLab and Wpt: Color Without the Fine Print*, whose Technical
annex gives every equation; this package implements that annex and reproduces the guide's numbers. The guide, its
companion package and the web pages built on `wlab` are at [github.com/waypointcolor/wpt-onramp](https://github.com/waypointcolor/wpt-onramp), and the pages
are online at [waypointcolor.github.io/wpt-onramp](https://waypointcolor.github.io/wpt-onramp/).

## Use

```ts
import { wptNormalization, deltaEWlab, deltaE00, xyzToLab, responses, resample, mat } from 'wlab';

// a reflectance: 81 values, 380 to 780 nm in 5 nm steps (resample() takes any range and interval)
const standard = resample(nm, standardValues);
const sample = resample(nm, sampleValues);

// one Wpt normalization per observing condition (observer + light)
const booth = wptNormalization('cie1931', 'D50');
const store = wptNormalization('cie1931', 'F11');

deltaEWlab(booth.wlabOf(standard), booth.wlabOf(sample));   // the difference in the booth
deltaEWlab(store.wlabOf(standard), store.wlabOf(sample));   // ... and under the store's fluorescent light

// a custom light or observer works the same way
const led = wptNormalization('cie1964', resample(ledNm, ledPower));

// a MAT: predict D65 colorimetry from measurements made under illuminant A
const m = mat(wptNormalization('cie1931', 'A'), wptNormalization('cie1931', 'D65'));
```

### API

| Function | What it does |
| --- | --- |
| `wptNormalization(observer, light, base?)` | The Wpt normalization of an observing condition: `toWpt`, `fromWpt` (3 × 3), `white`, `wptOf(reflectance)`, `wlabOf(reflectance)` |
| `wptToWlab(wpt)`, `wlabToWpt(wlab)` | WLab from Wpt and back (exact inverse) |
| `toPolar(v)`, `fromPolar(v)` | Lightness, chroma, hue angle (degrees) and back; WLab keeps the Wpt hue angle |
| `deltaEWlab(a, b)` | ΔE<sub>WLab</sub> (ΔE<sub>w</sub> in the WLab paper) |
| `mat(source, destination)` | Wpt MAT between two normalizations (M = A<sub>dst</sub><sup>−1</sup> A<sub>src</sub>) |
| `cat(sourceWhite, destinationWhite, 'bradford' \| 'cat02' \| 'xyz')` | A von Kries-type CAT with full adaptation, for comparison |
| `responses(reflectance, observer, light)`, `whiteOf(observer, light)` | Sensor responses (XYZ for the CIE observers), white Y = 100 |
| `xyzToLab`, `labToXyz`, `deltaEab`, `deltaE00` | CIELAB and its color differences, for comparison |
| `rgbToWlab(rgb, space)`, `wlabToRgb(wlab, space)`, `rgbToXyz`, `xyzToRgb`, `inGamut` | Display colors in `srgb`, `display-p3`, `a98-rgb` (Adobe RGB) or `rec2020` (the CSS Color 4 names), through the D65 Wpt normalization: WLab of the material that would give the same XYZ under D65 for the CIE 1931 observer |
| `resample(nm, values)` | Any spectrum onto the 380–780 nm, 5 nm grid (linear, ends held) |
| `observers`, `illuminants`, `munsellBase`, `wavelengths` | CIE 1931, 1964 and 2015 observers; illuminants A, C, D50, D65, E, F2, F11; the 40 Munsell base samples |

Observers can be custom: `{ name, curves: [c1, c2, c3] }`, each curve 81 values (color-matching functions, cone
fundamentals or camera sensors). Lights are any 81-value spectrum or the name of a CIE illuminant.

## The robustness report in a browser

`web/robustness-report.html` is one self-contained page: paste the spectral reflectance of a standard and its samples,
choose the lights and observers that matter (including your own measured lights), and read ΔE<sub>WLab</sub> for each
sample under each condition, plus ΔE<sub>00</sub> under the reference condition. It opens from disk with a
double-click; nothing is sent anywhere. "Load the guide's example" reproduces the table in the guide's
"For buyers and managers". No tolerances are built in.

## Build and test

```bash
npm install
npm run check        # typecheck, then the tests
npm run build        # dist/ (JavaScript and type declarations)
npm run build:web    # web/robustness-report.html
```

The tests (Node 22.18 or later runs them straight from TypeScript) compare every result with values computed by the
Python implementation of the companion package, `test/vectors.json`: the Wpt matrices for 21 conditions, Wpt, WLab
and CIELAB of 200 Munsell samples under D65 and A, ΔE<sub>00</sub> and ΔE<sub>WLab</sub>, MATs and CATs,
resampling and the guide's sanity checks, all within 10<sup>−9</sup>. `src/data.ts` and the vectors are written by
`export_wlab_ts.py` in the build repository of the companion package.

## References

- M. W. Derhak and R. S. Berns, "Introducing Wpt (Waypoint): a color equivalency representation for defining a
  material adjustment transform", *Color Research & Application* 40(6):535–549, 2015.
- M. W. Derhak and R. S. Berns, "Introducing WLab: going from Wpt (Waypoint) to a uniform material color equivalency
  space", *Color Research & Application* 40(6):550–563, 2015.
- M. W. Derhak, *Spectrally Based Material Color Equivalency: Modeling and Manipulation*, PhD dissertation,
  Rochester Institute of Technology, 2015.

## License

The code is under the BSD 3-Clause License (`LICENSE`). The CIE data in `src/data.ts` are under CC BY-SA 4.0, and the
Munsell reflectances have their own credits; see `DATA.md`.

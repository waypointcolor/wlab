# Data in this package

`src/data.ts` holds, on one grid (380 to 780 nm in 5 nm steps):

- the CIE 1931 (2°), CIE 1964 (10°), CIE 2015 (2°) and CIE 2015 (10°) color-matching functions (the 2015 ones
  cone-fundamental-based);
- the CIE 2006 (CIE 170-1) L, M, S cone fundamentals for 2° and 10° (32 years), the functions the CIE publishes as
  open datasets (cited below): the CIE's values unchanged, on the 5 nm grid, with 0 at 380 and 385 nm and for the S
  cones above 615 nm, where the CIE's files have none;
- the tables of the CIE 2006 model (`cie2006Tables`), from which `cie2006()` computes cone fundamentals for any age
  and field size and `categoricalObserver()` the categorical observers: the relative macular density (CIE
  170-1:2006, Table 6.4), the log low-density absorbances of the L, M and S photopigments (Stockman and Sharpe), and
  the two components of the ocular media density (CIE 170-1:2006, Table 6.10), all as published in the CVRL database
  (http://www.cvrl.org/). They are prepared from the copies in Psychtoolbox-3
  (https://github.com/Psychtoolbox-3/Psychtoolbox-3, `PsychColorimetricData/PsychColorimetricMatFiles`:
  `den_mac_bone.mat`, `T_log10coneabsorbance_ss.mat`, `den_lens_cie_1.mat`, `den_lens_cie_2.mat`), distributed under
  the MIT license reproduced in [LICENSE-psychtoolbox.txt](LICENSE-psychtoolbox.txt): sampled at 5 nm from 390 to
  780 nm, the macular density divided by its 2° peak of 0.35 and rounded to 4 decimals, the lens components extended
  linearly below 400 nm and set to 0 above 700 nm, the S absorbance set to 0 from 620 nm (where the model does not
  use it). Prepared this way they are exactly the tables of the Wpt toolbox's `cie2006cmfs.m`. The model at 32 years
  matches the CIE's own 2° and 10° functions in shape to 0.002 from 400 nm on;
- the ages and the eight physiological deviations of the 10 categorical observers, from the individual observer toolbox
  (`CatObsPfctr.csv`, `cie2006cmfsEx.m`): Y. Asano and M. D. Fairchild, "Categorical observers for metamerism," *Color
  Research & Application* (2020), built on Y. Asano, M. D. Fairchild and L. Blondé, "Individual colorimetric observer
  model," *PLoS ONE* (2016). Used with the permission of Yuta Asano (October 2026). At 2° the model gives exactly
  the ten categorical observers Asano published (`YutaCatCF_380-780-5nm.mat`); other field sizes come from the same
  model;
- the CIE scotopic luminous efficiency function V′(λ), the rods' sensitivity (CIE 018:2019, Table 2), from an unchanged
  copy of the CIE's file sampled at 5 nm; with the CIE 2006 10° cones it makes the four-sensor observer for mesopic
  vision (`observersN.cie2006_10_rods`);
- the CIE illuminants A, C, D50, D65, E, F2 and F11 (D50 computed from the CIE daylight components at 5000 K, as in
  the original Wpt code, rather than at the CIE's 5003 K);
- all twelve CIE fluorescent illuminants F1 to F12 (`fluorescents`; CIE 15), from the same table as F2 and F11;
- the CIE illuminants representing typical LED lamps (LED-B1 to LED-B5, LED-BH1, LED-RGB1, LED-V1 and LED-V2; CIE
  015:2018, Tables 12.1 and 12.2), from an unchanged copy of the CIE's file;
- the 40 Munsell colors of Value 5 and Chroma 6 that carry the Wpt normalization, and their reference p and t
  (CIE 1931 observer, illuminant C).

They are written by `export_wlab_ts.py` in the build repository of the companion package of the guide *WLab and Wpt:
Color Without the Fine Print*, from the same tables its Octave, Python and spreadsheet implementations use.
`web/example.ts` holds the guide's buyer example (a Munsell red and two made-up submissions), this package's own data
under the BSD 3-Clause License. So is `web/demo-data.ts`, the landing page's demo data: the buyer example, a made-up
white LED, and the Smurf and Unitary Blue patches of a Preferred Memory Colour Chart (PMCC; M. R. Luo, "The new preferred memory color (PMC) chart," *Color Research & Application* 49(6), 564-576 (2024), DOI [10.1002/col.22940](https://doi.org/10.1002/col.22940)), measured by Maxim W. Derhak from 380 to 730 nm at 10 nm, each with a twin that matches it exactly for the CIE 1931 observer under D65 (made by
`make_pmcc_twin.py` in the build repository).

## The object library (`data/objects/`)

Sets of reflectances the labs compute their metrics over, one JSON file per set: its source, license and the changes
made, the names and categories of its objects, and their reflectances on the package's grid as little-endian 16-bit
integers at 1/10000 (base64). `sets.json` indexes them (each set's metadata, without its data): the pages bundle only
the index, to describe every set, and `web/labs/library.ts` fetches a set's file from the site (`labs/data/objects/`,
copied there by the web build) when it is chosen. The corrected Munsell colors are built into the package, and the
CIE's 99 samples (those of TM-30-18), the PMCC and the natural objects into the labs' pages. Lab D's default objects
are 271 of the
Munsell colors (those of the 2014 Wpt animations, `makeMunAnim.m`: the ten hues 10R to 10RP at every Value and Chroma
4 to 16 in steps of 2, and the 19 neutrals; chosen from the package's set by name), the CIE's 99, the PMCC and the
359 natural objects; all work in a page opened from disk. Written from the downloaded files by the scripts in the build repository's `tools/library/`
(`library_check.py` and `stage_ces.py` read and check each set; `library_to_wlab.py` and `pmcc_to_wlab.py` write
these files; `index_sets.py` writes the indexes).

- `cie-ces99.json`: the 99 test samples of CIE 224:2017 (the color evaluation samples of ANSI/IES TM-30-18), from the
  CIE's 5 nm file `CIE_srf_cfi.csv` (DOI [10.25039/CIE.DS.8svs5rqd](https://doi.org/10.25039/CIE.DS.8svs5rqd) for the
  1 nm dataset), sha256 checked against the CIE's. CC BY-SA 4.0, International Commission on Illumination (CIE); the
  values stored to 1/10000.
- `pmcc.json`: the 30 patches of a Preferred Memory Colour Chart (M. R. Luo, "The new preferred memory color (PMC)
  chart," *Color Research & Application* 49(6), 564-576 (2024), DOI
  [10.1002/col.22940](https://doi.org/10.1002/col.22940)), measured by Maxim W. Derhak from 380 to 730 nm at 10 nm:
  this package's own data, under the BSD 3-Clause License, as the landing page's two PMCC patches are. Interpolated
  to 5 nm, the 730 nm value held to 780 nm (written by `tools/library/pmcc_to_wlab.py`).
- `morimoto-natural-objects.json`: T. Morimoto, C. Zhang, K. Fukuda and K. Uchikawa, "Spectral dataset of daylights
  and surface properties of natural objects measured in Japan," version 1.2, Zenodo (2021), DOI
  [10.5281/zenodo.5217752](https://doi.org/10.5281/zenodo.5217752): 359 reflectances, as given (5 nm). CC BY 4.0.
- `nist-skin.json`: C. Cooksey, D. Allen and B. Tsai, "Reference Data Set of Human Skin Reflectance," *J. Res. NIST*
  122:26 (2017), data version 3, DOI [10.18434/M38597](https://doi.org/10.18434/M38597). NIST open license
  (https://www.nist.gov/open/license): credit NIST and note changes. Changed here: the average of each person's three
  spectra, resampled from 3 nm to 5 nm, 380 to 780 nm only.
- `munsell-soil-chart.json`: "Munsell soil color chart: a spectral reflectance dataset," version 1.1, Zenodo (2023),
  DOI [10.5281/zenodo.8346858](https://doi.org/10.5281/zenodo.8346858): the 443 chips of the 2009 edition, sampled
  every 5 nm from 1 nm. CC BY 4.0.

Each file keeps its own license; the CIE set's ShareAlike terms apply to it alone.

## Camera sensitivities (`data/observers/cameras.json`)

The red, green and blue spectral sensitivities of 52 digital cameras, from rawtoaces-data, the data repository of the
RAW to ACES Utility (Academy Software Foundation, https://github.com/AcademySoftwareFoundation/rawtoaces-data, commit
e9b8503cf8a0641f40e5345d9757bde60c15f423, `data/camera/`), each file of which states its license, the Apache License
2.0, reproduced in [LICENSE-rawtoaces-data.txt](LICENSE-rawtoaces-data.txt). 44 were measured by Weta Digital with its
"lightsaber" system (they include the Physlight set of Winquist et al., 2022), 7 by the Academy of Motion Picture Arts
and Sciences and 1 by the National Physical Laboratory. Changed here: each file's R, G, B columns, already on the
package's grid, put in one file and rounded to 6 significant digits (written by `tools/library/cameras_to_wlab.py` in
the build repository). `web/labs/cameras.ts` offers them as sensors in the labs: the pages bundle only their names
(`cameras-index.json`) and fetch `cameras.json` from the site (`labs/data/observers/`, beside its license) when a camera
is chosen; the web build adds the license to every page that names them.

## CIE data: CC BY-SA 4.0

The CIE publishes its colorimetric data tables as open datasets under the [Creative Commons Attribution-ShareAlike 4.0
International License (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/). The CIE data in
`src/data.ts` are therefore licensed under CC BY-SA 4.0. The CIE datasets, as the CIE asks them to be cited:

- CIE 2019, Colour-matching functions of CIE 1931 standard colorimetric observer, CIE, Vienna, AT, DOI [10.25039/CIE.DS.xvudnb9b](https://doi.org/10.25039/CIE.DS.xvudnb9b)
- CIE 2019, CIE 1964 colour-matching functions, 10 degree observer, CIE, Vienna, AT, DOI [10.25039/CIE.DS.sqksu2n5](https://doi.org/10.25039/CIE.DS.sqksu2n5)
- CIE 2015, CIE cone-fundamental-based spectral tristimulus values for 2° field size, CIE, Vienna, AT, DOI [10.25039/CIE.DS.548rw69q](https://doi.org/10.25039/CIE.DS.548rw69q)
- CIE 2015, CIE cone-fundamental-based spectral tristimulus values for 10° field size, CIE, Vienna, AT, DOI [10.25039/CIE.DS.dm6qiig7](https://doi.org/10.25039/CIE.DS.dm6qiig7)
- CIE 2018, CIE standard illuminant A - 1 nm, CIE, Vienna, AT, DOI [10.25039/CIE.DS.8jsxjrsn](https://doi.org/10.25039/CIE.DS.8jsxjrsn)
- CIE 2018, Relative spectral power distributions of CIE illuminant C, CIE, Vienna, AT, DOI [10.25039/CIE.DS.mjdd2enu](https://doi.org/10.25039/CIE.DS.mjdd2enu)
- CIE 2019, CIE standard illuminant D65, CIE, Vienna, AT, DOI [10.25039/CIE.DS.hjfjmt59](https://doi.org/10.25039/CIE.DS.hjfjmt59)
- CIE 2018, Components of the relative spectral distribution of daylight used in the calculation of relative spectral power distributions of CIE daylight illuminants of different correlated colour temperatures, CIE, Vienna, AT, DOI [10.25039/CIE.DS.w7zunnny](https://doi.org/10.25039/CIE.DS.w7zunnny)
- CIE 2018, Relative spectral power distributions of illuminants representing typical fluorescent lamps, CIE, Vienna, AT, DOI [10.25039/CIE.DS.ukaymjdn](https://doi.org/10.25039/CIE.DS.ukaymjdn)
- CIE 2018, Relative spectral power distributions of illuminants representing typical LED lamps, CIE, Vienna, AT, DOI [10.25039/CIE.DS.vgssnyfg](https://doi.org/10.25039/CIE.DS.vgssnyfg)
- CIE 2019, CIE spectral luminous efficiency for scotopic vision, CIE, Vienna, AT, DOI [10.25039/CIE.DS.gr6w4b5g](https://doi.org/10.25039/CIE.DS.gr6w4b5g)
- CIE 2006, CIE 2006 LMS cone fundamentals for 2° field size in terms of energy, CIE, Vienna, AT, DOI [10.25039/CIE.DS.tijidesg](https://doi.org/10.25039/CIE.DS.tijidesg)
- CIE 2006, CIE 2006 LMS cone fundamentals for 10° field size in terms of energy, CIE, Vienna, AT, DOI [10.25039/CIE.DS.nxsqeri8](https://doi.org/10.25039/CIE.DS.nxsqeri8)

The values were not downloaded from these datasets: they come from the tables used by the original Wpt code (CIE 15
and CIE 170-2:2015). The datasets are cited because they are the CIE's published, licensed form of the same tables.
Illuminant E (equal energy) is constant and needs no source.

## The Munsell reflectances

- **Measurements.** The Color Research Laboratory of the University of Joensuu (now the University of Eastern Finland,
  UEF) measured the 1,600 glossy chips of a Munsell Book of Color manufactured in 1976, with a Perkin-Elmer Lambda 18
  spectrophotometer, from 380 to 780 nm at 1 nm. UEF publishes these measurements as "Munsell colors glossy (all)
  (Spectrofotometer measured)", https://sites.uef.fi/spectral/?p=423, © University of Eastern Finland.
- **Correction.** M. W. Derhak and R. S. Berns corrected each spectrum so that its colorimetry matches the Munsell
  renotation data: "Analysis and correction of the Joensuu Munsell glossy spectral database," Proc. 20th Color and
  Imaging Conference (IS&T, 2012), pp. 191-194.
- **Here.** The 40 samples of Value 5 and Chroma 6 from the corrected set, at 5 nm from 380 to 780 nm. When using
  them, please credit both the UEF measurements and the 2012 correction paper.

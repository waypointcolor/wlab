# Data in this package

`src/data.ts` holds, on one grid (380 to 780 nm in 5 nm steps):

- the CIE 1931 (2°), CIE 1964 (10°), CIE 2015 (2°) and CIE 2015 (10°) color-matching functions (the 2015 ones
  cone-fundamental-based);
- the CIE illuminants A, C, D50, D65, E, F2 and F11 (D50 computed from the CIE daylight components at 5000 K, as in
  the original Wpt code, rather than at the CIE's 5003 K);
- the 40 Munsell colors of Value 5 and Chroma 6 that carry the Wpt normalization, and their reference p and t
  (CIE 1931 observer, illuminant C).

They are written by `export_wlab_ts.py` in the build repository of the companion package of the guide *WLab and Wpt:
Color Without the Fine Print*, from the same tables its Octave, Python and spreadsheet implementations use.
`web/example.ts` holds the guide's buyer example (a Munsell red and two made-up submissions), this package's own data
under the BSD 3-Clause License. So is `web/demo-data.ts`, the landing page's demo data: the buyer example, a made-up
white LED, and the Smurf and Unitary Blue patches of a Preferred Memory Colour Chart (PMCC; M. R. Luo, "The new preferred memory color (PMC) chart," *Color Research & Application* 49(6), 564-576 (2024), DOI [10.1002/col.22940](https://doi.org/10.1002/col.22940)), measured by Maxim W. Derhak from 380 to 730 nm at 10 nm, each with a twin that matches it exactly for the CIE 1931 observer under D65 (made by
`make_pmcc_twin.py` in the build repository).

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

# Current-school exam estimate: Sibiu city pilot

The estimator now accepts the child's current school (not the destination
high school). The national relationship between overall V–VIII school average
and each exam subject remains the baseline. A Sibiu school adds its mean 2025
subject residual relative to that baseline, shrunk by `n / (n + 30)`.
Schools with fewer than 20 eligible pupils use the national estimate.
Unknown schools and the default selection also use the national estimate.

This compares exam performance conditional on school grades rather than
ranking schools by their raw exam average. A 9.00 can therefore produce
different estimates at different schools. It is an association, not a causal
measure of teaching quality, nor a guarantee about an individual pupil.
The correction is a constant per subject, not a separately fitted school
curve; sparse grade ranges and changes of school remain limitations.
The shrinkage strength and minimum count are conservative pilot choices,
not optimized on the held-out year.

Corrections enter before precision-weighted blending with a simulare, so a
simulare reduces the school's influence. Means are clamped to 1–10. The
national spread, incomplete-record uncertainty and future drift remain in
place: this pilot does not claim narrower school-specific intervals.
Candidates taking a mother-tongue paper remain unsupported, explicitly in
the UI. A school teaching in German may consequently have insufficient
eligible data even with many pupils overall.

## Sources and reproducibility

Ministry of Education open data, CC-BY 4.0:

- [2024–2025 school directory](https://data.gov.ro/dataset/retea-scolara):
  join `Cod SIIIR unitate` to exam `COD SIIIR`; require `Judet PJ = SB` and
  **`Localitate unitate = SIBIU`**, not merely an urban school in Sibiu county.
- [2025 examination results](https://data.gov.ro/dataset/rezultate_evaluare_2025):
  training, 1,302 eligible pupils in the city.
- 2026 examination results: held-out evaluation, 1,245 eligible pupils;
  exact resource URLs are recorded in fixture `.url` sidecars and
  `pipeline/src/evnat/index.ts`.

The committed fixtures retain only school identifiers and numeric results,
without candidate identifiers or demographic information. Eligibility is the
same as the national calibration: complete results, recorded V–VIII average,
no mother-tongue paper. The directory subset contains schools observed in
these cohorts; schools without eligible results can use the default option.
Names and codes reflect the 2024–2025 directory; later reorganizations have
not been mapped to predecessor schools.

With downloaded exam workbooks in `pipeline/raw/evnat/`:

```
node --import tsx pipeline/src/evnat/sibiu.ts --extract /path/to/retea-scolara-2024-2025.xlsx
node --import tsx pipeline/src/evnat/sibiu.ts --emit
```

Emission uses only the 2025 fixture. The app bundles the resulting small
TypeScript table and makes no external requests. Tests regenerate the fit
offline and evaluate the separate 2026 fixture.

## Held-out results

2026 city cohort, full recorded V–VIII average, no simulare:

| Model | RMSE (points) | Mean prediction error | Interval coverage |
| --- | ---: | ---: | ---: |
| National baseline | 0.918 | −0.228 | 88.5% |
| School pilot | 0.838 | +0.072 | 91.5% |

Coverage is for the nominal 80% interval. These city-wide results support
trying the pilot; they do not establish calibration separately for each
school, earlier school grades, simulare inputs, or future cohorts.

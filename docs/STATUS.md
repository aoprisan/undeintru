# Status

## Official simulation data — populated 2026-09-15

The published app now uses **official Sibiu computerized-allocation results**:

| Year | Courses | Offered seats | Provenance |
| --- | ---: | ---: | --- |
| 2026 | 117 | 3,474 | official |
| 2025 | 74 | 2,344 | official |

The complete ministry JSON responses, their county HTML pages, the scripts
that show how the pages load the responses, and source URL sidecars live in
`pipeline/fixtures/admitere/`. The app receives only normalized static JSON;
it makes no third-party runtime requests.

`pipeline/src/parse/specialization.ts` validates the county/year source URL,
required fields, seats, duplicate codes, track, attendance form, dual status,
and cutoff values. Text passes through Romanian diacritic normalization and
cutoffs through the existing truncating media parser. Bilingual and dual
courses remain distinguishable. Published null cutoffs remain null; a
published cutoff is retained even when some seats were unfilled.

The 2026 option codes were reassigned. Historical model matching now uses
school code and course details instead of assuming the same option code means
the same course each year. Ambiguous course identities are omitted. There are
27 unambiguous matching courses with binding cutoffs in both years. The source's
`uma` previous-year column contains inconsistencies and is not used; historical
cutoffs come from each year's own `um` field.

Reproduce offline:

```
node --import tsx pipeline/src/cli.ts archive
node --import tsx pipeline/src/cli.ts emit
```

`just archive` and `just emit` are the corresponding recipes. Run `just check`
and `just build` before submitting changes. Where `just` is unavailable, run
its npm typecheck, ESLint, test, and build commands directly.

## Coverage limits

- Sibiu only; other counties have not been populated.
- Two real allocation years. The earlier synthetic datasets were removed from
  publication so generated history cannot influence real-school predictions.
- The 2023–2024 landing pages remain reachable, but their news pages no longer
  link to allocation tables. A search-indexed 2024 allocation page returned
  HTTP 404. No earlier seat counts or course lists have been reconstructed from
  a later year's previous-cutoff column.
- These are computerized allocation tables. Aptitude-gated programs and later
  admission rounds are not included by the source snapshots.
- Admission-model calibration tests remain synthetic. Two real seasons provide
  one annual transition, insufficient for a held-out real admission backtest.
- The old HTML-table parser remains an explicit stub. The current static portal
  has empty HTML table bodies populated from JSON, handled by the new importer.

## Existing application and exam-data pipeline

The static TypeScript PWA, shared schema, deterministic synthetic generators,
admission and marks models, offline cache, and emission validation are in place.
See [MODEL.md](MODEL.md), [MARKS.md](MARKS.md), and [UI.md](UI.md).

School-to-exam calibration uses 143,183 real EN 2025 records. The two- and
three-subject media formulas reproduce all 152,235 published 2025 averages.
The marks-model out-of-sample test uses real EN 2026 fixtures. These data and
calibrations are independent of the newly populated admission cutoffs.

## Prediction review fixes

- Occupied seats are validated and published. The 56 current rows with vacancies
  are excluded from numeric admission probabilities and threshold-cleared counts.
- Missing cutoff and unknown occupancy no longer imply an open course.
- The estimator takes overall annual averages, equally weighted, and explicitly
  refuses mother-tongue-paper candidates; direct official media entry remains.
- Grade V–VIII flows select the corresponding admission year. Annual cutoff
  variance accumulates over the forecast horizon.
- Regression tests cover occupancy, missing marks, four-year uncertainty, the
  overall-average calibration input, and unsupported mother-tongue candidates.

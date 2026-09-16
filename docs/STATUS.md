# Status

## Official simulation data — populated 2026-09-16

The published app now uses **official computerized-allocation results for all 41 counties and București**:

| Year | Courses | Offered seats | Provenance |
| --- | ---: | ---: | --- |
| 2026 | 5,201 | 153,152 | official |
| 2025 | 3,581 | 118,801 | official |

The complete ministry JSON responses, their county HTML pages, the scripts
that show how the pages load the responses, and source URL sidecars live in
`pipeline/fixtures/admitere/`. The app receives only normalized static JSON;
it makes no third-party runtime requests.

`pipeline/src/parse/specialization.ts` validates the county/year source URL,
required fields, nonnegative seat counts, duplicate codes, track, attendance form, dual status,
and cutoff values. Text passes through Romanian diacritic normalization and
cutoffs through the existing truncating media parser. Bilingual and dual
courses remain distinguishable. Published occupied counts above the offered
capacity are preserved (for example, 79 allocations for 78 places at București
Gheorghe Lazăr in 2025). Published null cutoffs remain null; a
published cutoff is retained even when some seats were unfilled.

The 2026 option codes were reassigned. Historical model matching now uses
school code and course details instead of assuming the same option code means
the same course each year. Ambiguous course identities are omitted. For Sibiu there are
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

- All 42 county codes are covered in both 2025 and 2026.
- Two real allocation years. The earlier synthetic datasets were removed from
  publication so generated history cannot influence real-school predictions.
- The 2023–2024 landing pages remain reachable, but their news pages no longer
  link to allocation tables. A search-indexed 2024 allocation page returned
  HTTP 404. No earlier seat counts or course lists have been reconstructed from
  a later year's previous-cutoff column.
- These are computerized allocation tables. Aptitude-gated programs and later
  admission rounds are not included by the source snapshots.
- A 2025-only forecast has now been scored against 1,504 matched 2026 cutoffs:
  46.68% coverage of nominal 80% intervals. Two real seasons cannot independently
  validate a spread learned from annual changes; see `docs/MODEL.md`.
- Short-history uncertainty retains prior floors and incorporates observed
  county shocks. Synthetic held-out tests improve under larger shared shocks;
  real calibration of the revised 2027 forecasts remains unverified.
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

- Occupied seats are validated and published. The 56 current Sibiu rows with vacancies
  are excluded from numeric admission probabilities and threshold-cleared counts.
- Missing cutoff and unknown occupancy no longer imply an open course.
- The estimator takes overall annual averages, equally weighted, and explicitly
  refuses mother-tongue-paper candidates; direct official media entry remains.
- Grade V–VIII flows select the corresponding admission year. Annual cutoff
  variance accumulates over the forecast horizon.
- Regression tests cover occupancy, missing marks, four-year uncertainty, the
  overall-average calibration input, and unsupported mother-tongue candidates.

## Interface reliability and evidence wording — 2026-09-16

- Admission bands are labelled as indicative; the explanation distinguishes
  the model's nominal 80% interval from the measured 46.68% held-out coverage.
  Revised 2027 bands are explicitly described as independently unvalidated.
  The strongest displayed label is now “favorabil în model”, not “aproape sigur”.
- County changes hide old results while loading. Only the latest request may
  publish data or errors; failed loads offer retry and allow another selection.
- Offline regression tests cover stale successes, stale failures, and retry.
  Browser checks exercised delayed responses, HTTP failure, mark changes during
  failure, successful retry, and desktop/360px mobile layouts.
- A further archive check found a search-indexed 2024 Brașov allocation page,
  but direct retrieval timed out, as did the 2023 Sibiu allocation page.
  No additional historical snapshots were verified or published.

## Input and publication integrity — 2026-09-16

- Direct admission averages must be within 1–10. Decimal digits are truncated
  to integer hundredths before scoring; values such as 9.86 retain their exact
  hundredth, while 9.855 becomes 9.85.
- Downloaded county datasets must match the requested index entry's county,
  year, provenance, and row count as well as the shared schema.
- Emission stages a complete generation on the destination filesystem before
  replacing the output directory. Installation failures restore the previous
  directory; if restoration itself fails, the staging directory retains the
  backup under `previous` for manual recovery. Successful emission removes
  obsolete files. Run emission against build inputs, not a live serving
  directory: the portable two-rename swap has a brief gap and does not provide
  crash-atomic publication.
- Offline regression tests cover input bounds and truncation, index mismatches,
  staging failure, installation rollback, and removal of obsolete files.

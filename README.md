# undeintru

La ce licee poate intra copilul tău — a static PWA that answers one question for
Romanian parents: given an admission media, how likely is their kid to get into
each high school this year?

No backend, no analytics, no third-party calls. The app is a static bundle plus
JSON files; everything it knows comes from published admitere.edu.ro data that a
pipeline in this repo downloads, parses and validates ahead of time.

## Layout

```
app/                    Vite vanilla-ts PWA (no framework)
  src/main.ts           the whole interface — see docs/UI.md
  src/data/schema.ts    the shared data contract — see below
  src/data/counties.ts  county codes to names ("SB" -> "Sibiu")
  src/model/predict.ts  the admission model — see docs/MODEL.md
  src/model/marks.ts    the marks model — see docs/MARKS.md
  src/fonts/            self-hosted woff2 subsets, so there is no font CDN
  public/data/v1/       published JSON, written by `just emit`
pipeline/               Node 22 + tsx + vitest
  src/fetch.ts          proxy-aware, throttled, caching downloader
  src/crawl.ts          discovery-first crawl of the archive
  src/parse/            HTML -> rows, written against committed fixtures
  src/normalize.ts      pages -> pipeline/normalized/<year>/<county>.json
  src/emit.ts           normalized -> app/public/data/v1/, schema-validated
  src/evnat/            REAL exam results from data.gov.ro — see below
  src/mock/             synthetic data generator, for validating the model
  fixtures/             committed sample pages the parser is written against
  fixtures/evnat/       committed real candidates, with source sidecars
  raw/                  downloaded pages (gitignored)
```

## Commands

```
just dev                 Vite dev server
just build               production build -> app/dist
just harvest SB          fetch every comparable year and stage fixtures (see below)
just fetch 2024 SB       download the SB/2024 pages into pipeline/raw/
just normalize 2024 SB   parse pipeline/raw/ into normalized rows
just mock SB             write SYNTHETIC data (see "Synthetic data" below)
just emit                validate and publish to app/public/data/v1/
just evnat-verify 2025   recheck every published media against ours
just evnat-calibrate     re-fit the school-record -> exam-mark table
just evnat-sample        regenerate the committed real-data fixtures
just typecheck
just lint
just test
just check               typecheck + lint + test
```

`just check` is what CI runs, and it is the definition of done.

## Two rules the code enforces

**Media de admitere, since 2023, is the mean of the Evaluarea Națională
grades, kept to two decimals and truncated — not rounded.** 9.855 is 9.85.
Rounding moves a candidate across a cutoff and changes the answer the app
gives, so the arithmetic is done in integer hundredths
(`pipeline/src/util/media.ts`) and the truncation is tested directly. The
schema rejects any media with more than two decimals, so an untruncated value
cannot be published.

It is the mean of **two** grades for most candidates and of **three** for
those schooled in a minority language, who sit *Limba și literatura maternă*
as a third written paper. That is 5.9% of the country and the majority in
Harghita (86%) and Covasna (69%). The repo did not know this until the real
results were checked against it; `just evnat-verify` now reproduces all
152,235 published 2025 medias exactly, and would fail loudly if either branch
drifted.

**Cutoffs from different years are not comparable across 2023.** The formula
changed that year — before it, the gimnaziu average was folded in. Every row,
every file and every index entry carries its `year`, the schema refuses a file
whose rows disagree with it, and `areYearsComparable()` exists so any future
cross-year feature has to opt in deliberately. There is no cross-year logic yet.

## The prediction model

The app does not just show last year's cutoff — it turns a media into a
probability of getting in next year. Cutoffs move every year, so last year's
number answers a different question from the one parents are actually asking.

The model treats next year's cutoff as `last year's cutoff + noise`, with the
spread estimated from the pooled year-over-year changes across the county. The
point prediction is deliberately not extrapolated from recent movement; the
model's whole contribution is the uncertainty band, and the app shows a coarse
band ("probabil", "incert") rather than a false-precision percentage.

Validated against synthetic data with known ground truth: calibrated within 2.9
percentage points, 80% intervals covering 83.5%, and a 31% better Brier score
than treating last year's cutoff as a hard threshold. Full specification,
measurements and limits in [`docs/MODEL.md`](docs/MODEL.md).

## Predicting the exam mark itself

A kid in class V–VII has no media de admitere yet, and reading the school
media off the catalog as if it were one is wrong in a known direction and by a
known amount: across the 143,183 candidates in the published 2025 results,
taking the gimnaziu average as the exam media runs **1.96 points hot**. The
average kid with a school 9 scored **6.95**.

`app/src/model/marks.ts` predicts the Evaluarea Națională media from what a
parent actually has: the kid's current grade (V–VIII), the overall annual averages
across all subjects so far, and optionally the simulare marks for 8th
graders. Its calibration is **measured, not assumed** — a table of what
candidates at each school level actually scored, built from the ministry's own
published results. Uncertainty grows with every year still to run before the
exam, so the answer for a 5th grader is honest about being vaguer than one for
an 8th grader with a simulare in hand, and the estimated media chains into the
admission model with its spread attached, pulling every probability toward
"incert" exactly as much as the estimate deserves.

Calibrated on 2025 and scored against the **2026** cohort — a different year,
so genuinely out of sample — it is off by +0.24 on average with 80% intervals
covering 80.8%. The version it replaced used two guessed calibration lines and
was off by +1.19 with its "80%" intervals covering 43.4%: a point optimistic,
in the one direction that tells a parent their kid clears a cutoff they do not.
Two things the real data said that no prior had: the inflation is much larger
at the bottom of the scale than anyone assumed, and matematică is *not*
uniformly harsher than română — the curves cross just below a school 7. Full
specification, measurements and limits in [`docs/MARKS.md`](docs/MARKS.md).

## Real data, and what is still synthetic

The published cutoffs are now official Sibiu computerized-allocation results:
117 courses in 2026 and 74 in 2025, from the ministry's static archive. The
complete source snapshots and URL sidecars are committed under
`pipeline/fixtures/admitere/`. The importer preserves bilingual and dual
courses and missing cutoffs. The 27 unambiguous course matches that filled in both
years supply the model's observed changes; course codes were reassigned
in 2026, so matching uses school and course details.

| | source | real? |
| --- | --- | --- |
| Cutoffs per school and specialization, SB 2025–2026 | static.admitere.edu.ro | **yes**, 191 course-year records |
| School→exam calibration | data.gov.ro, EN 2025 | **yes**, 143,183 candidates |
| The media formula, both branches | verified against EN 2025 | **yes**, all 152,235 rows |
| Marks-model backtest in CI | data.gov.ro, EN 2026 | **yes**, out of sample |

The synthetic 2023–2024 datasets have been removed from publication. Earlier
complete official allocation tables have not been recovered. Two seasons
provide limited history; this is not a validation of admission probabilities
against a held-out real year. Aptitude-gated and later-round admissions are
outside the downloaded tables.

`pipeline/src/evnat/` reads the ministry's published Evaluarea Națională
workbooks (CC-BY 4.0). They are .xlsx, one sheet, 135 MB inflated, so it ships
a small streaming XLSX reader rather than a dependency — zip central directory,
deflate, and just enough SpreadsheetML for the file that exists. Everything it
does not implement throws rather than returning a half-read sheet.

## The interface

One question, one chart. Every cutoff in the county sits on a fixed media scale
of 5 to 10 — drawn as a ruler in the header, and again in every row of the list
— and the child's media is a single blue rule running down the whole page. A
row's bar is the 80% interval the next cutoff can land in; the filled part is
how much of that interval the media is above, so the model's uncertainty is the
thing you see rather than a number to take on trust.

Probability is drawn as ink rather than colour (solid where the media clears,
hatched where it does not), which leaves exactly one saturated colour on the
page for the family's own number, and keeps the reading intact in greyscale or
with colour blindness. Red appears in two places only: the synthetic-data
banner, and a failure.

The typefaces are self-hosted in `app/src/fonts/` and precached — no font CDN,
because "no third-party calls" is a promise and a blocked CDN is a blank page.
Full rationale in [`docs/UI.md`](docs/UI.md).

## Synthetic data

`just mock SB` generates deterministic, seeded synthetic cutoffs and feeds them
through the same normalize → emit path as real data, so the schema, the index
and the app are all genuinely exercised. It exists because the real source is
unreachable (see below) and an unrun model is a hypothesis.

Every synthetic dataset is stamped `provenance: 'synthetic'`, is forbidden by
the schema from citing any source URL, uses school names no Romanian county has
(Alfa, Beta, Gama…), and makes the app render a prominent warning banner. A
generated cutoff that reads as official is the worst failure this app can have,
so the marking is enforced at every layer rather than left to a README.

**The data currently published in `app/public/data/v1/` is official.**
Running `just mock` and `just emit` replaces it with explicitly synthetic data.

## Diacritics

admitere.edu.ro publishes Romanian text with the Turkish *cedilla* letters
ş/ţ (U+015F/U+0163) rather than the correct *comma-below* ș/ț
(U+0219/U+021B). They look alike and compare unequal, so "Şaguna" and "Șaguna"
would be two different schools. Everything entering the dataset goes through
`normalizeText()` (`pipeline/src/util/diacritics.ts`), which folds cedilla and
combining forms to comma-below, strips invisibles, collapses whitespace and
returns NFC.

## The data contract

`app/src/data/schema.ts` is the single definition of the emitted shape, imported
by both packages (`pipeline/src/schema.ts` re-exports it). It is dependency-free
on purpose — `app/` must not pull in third-party runtime code. `emit` validates
every dataset *before* writing any of them, so a bad parse cannot half-publish.

One row:

```ts
{ year, county, schoolCode, schoolName, specId, specLabel,
  profile, filiera, limba, seats, lastMedia, vocational }
```

`lastMedia` is `null` when a specialization published no cutoff.
`vocational` marks filiera vocationala, where an aptitude exam gates admission
and the cutoff does not mean "any kid above this got in".

## Fixtures, and why the parser is written against them

The parser is written against real pages committed in `pipeline/fixtures/`,
never against imagined markup. Each fixture has a `<name>.html.url` sidecar
recording where it came from. When a page does not match, the parser throws
`PageStructureError` **with the URL** rather than skipping the row — save that
page as a fixture and extend the parser.

## Offline by contract

Tests and CI never touch the network. `assertNetworkAllowed()` throws when
`CI=true` or `UNDEINTRU_OFFLINE=1` (which `vitest.config.ts` sets for the whole
suite), so a stray import cannot reach the live site from a test run.
`just fetch` is the only recipe that makes requests: one every 2 seconds, with
already-downloaded pages served from `pipeline/raw/`.

Node's built-in `fetch` ignores `HTTPS_PROXY`. The downloader dispatches through
undici's `EnvHttpProxyAgent` so it works behind a proxy.

## Shipping a change to people who already have the app

The service worker precaches the whole app — that is what makes it work offline,
and also what hides a new deploy: a returning visitor is served the previous
build from cache while the new worker installs behind it. Workbox takes over as
soon as it is ready (`skipWaiting`, `clientsClaim`), but taking over does not
re-render a page that was already built from the old cache, so **one reload
after a deploy still shows the old app**.

`app/src/sw-update.ts` closes that gap: when a new worker takes control of the
page, it reloads once. Verified against two builds served in sequence — without
it the page stayed on the old build after a reload; with it, it picks up the new
one on its own. To check a deploy by hand, add a query string
(`.../undeintru/?v=2`): it misses the precache and goes to the network.

## Status

See [`docs/STATUS.md`](docs/STATUS.md) for current coverage and limitations.

## Populating the real cutoffs

Rebuild the complete committed official snapshots offline:

```
node --import tsx pipeline/src/cli.ts archive
node --import tsx pipeline/src/cli.ts emit
```

Or use `just archive` then `just emit`. Source URLs, column mappings, counts,
and refresh instructions are in
[`pipeline/fixtures/admitere/README.md`](pipeline/fixtures/admitere/README.md).
The static portal serves JSON behind an empty HTML table; the JSON importer
is fixture-tested. The older `harvest` / `normalize` HTML-only workflow remains
available for other archive formats, but its HTML table parser is still a stub.

### Prediction review fixes

Occupied-seat counts are retained. Courses with vacancies show historical
availability without a numeric probability and do not count as cleared
competitive thresholds. Missing marks with unknown occupancy are unavailable.
The current Sibiu data has 56 courses with vacancies and 61 competitive rows.

The marks estimator requests overall annual averages, uses their arithmetic
mean, and requires confirmation that the pupil does not take the mother-tongue
paper. Its calibration excludes those candidates; they can enter an official
admission average directly. Partial records and simulare adjustments remain
prior-based, with an explicitly indicative interval.

For estimated marks the admission year follows the selected grade. The cutoff
model accumulates variance across annual increments, so an h-year forecast
uses sqrt(h) times the one-year standard deviation. Direct media entry resets
the forecast to the next available admission cycle.

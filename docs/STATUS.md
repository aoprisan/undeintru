# Status

## Done

**Phase 0 — scaffold.** npm workspaces (`app`, `pipeline`), shared
`tsconfig.base.json` with strict TS, ESLint flat config on
`strictTypeChecked`, the justfile, `.gitignore`, and a GitHub Actions workflow
that runs `just check`, builds, and deploys `app/dist` to Pages on push to
`main`.

**Phase 1 — everything that does not need the live site.**

| Piece | State |
| --- | --- |
| `app/src/data/schema.ts` — shared contract, validators | done, 17 tests |
| `pipeline/src/util/media.ts` — 2023 formula, truncation | done, 16 tests |
| `pipeline/src/util/diacritics.ts` — cedilla to comma-below, NFC | done, 13 tests |
| `pipeline/src/fetch.ts` — proxy-aware, throttled, caching downloader | done, 12 tests |
| `pipeline/src/crawl.ts` — discovery-first crawl | written, never run |
| `pipeline/src/normalize.ts` — page loading, dedup, deterministic sort | done |
| `pipeline/src/emit.ts` — validate-then-publish, index | done, 7 tests |
| `pipeline/src/parse/repartizare.ts` — HTML to rows | **not implemented** |
| `pipeline/fixtures/` — 2024/SB sample pages | **empty** |

**Phase 2 — the prediction model, validated on synthetic data.**

| Piece | State |
| --- | --- |
| `app/src/model/predict.ts` — cutoff distribution, admission probability | done, 29 tests |
| `pipeline/src/mock/` — seeded synthetic generator with ground truth | done, 16 tests |
| Backtest: calibration, interval coverage, Brier vs. baseline | done — see [MODEL.md](MODEL.md) |
| App: probability bands, prediction interval, synthetic-data banner | done |

**Phase 3 — the marks model: predicting the exam media from the school
record.**

| Piece | State |
| --- | --- |
| `app/src/model/marks.ts` — grades V–VIII → predicted EN media + interval | done, 23 tests |
| `pipeline/src/mock/students.ts` — seeded synthetic students, ground truth | done |
| `predict()` accepts an uncertain media and chains the two models | done |
| Backtest: coverage, bias, MAE vs. reading the catalog | done — see [MARKS.md](MARKS.md) |
| App: estimator panel (grade, yearly medii, simulare) feeding the table | done |

**Phase 4 — the interface.** Rebuilt from scratch around the shared media
scale: the ruler of county cutoffs, the per-row prediction intervals, and the
single line for the child's own media that runs down the whole list. Grouping,
ordering, search and filiera filters, the four states of a row (estimate, no
cutoff, aptitude exam, no history), self-hosted type, dark mode and the reduced
-motion path are all in `app/src/main.ts` and `app/src/style.css`. Rationale in
[UI.md](UI.md).

**Phase 5 — real exam results.** The marks model no longer runs on priors.

| Piece | State |
| --- | --- |
| `pipeline/src/evnat/xlsx.ts` — streaming XLSX reader, no dependencies | done, reads the 135 MB sheet |
| `pipeline/src/evnat/dataset.ts` — published rows → validated records | done |
| `pipeline/src/evnat/calibrate.ts` — school record → exam mark, measured | done |
| `pipeline/fixtures/evnat/` — real committed samples, both with sidecars | done |
| `util/media.ts` — the *limba maternă* three-subject rule | done, found in real data |
| Marks calibration re-measured on 143,183 real 2025 candidates | done — see [MARKS.md](MARKS.md) |
| Out-of-sample backtest on 2024 and 2026 | done, in CI against 2026 |

`just check` is green: 166 tests, typecheck and lint clean in both packages.

Two real defects were found by the synthetic data:

- The schema's two-decimal check was `Math.round(m * 100) !== m * 100`, which
  **rejects a legitimate 8.96** because `8.96 * 100` is 896.0000000000001. It
  now compares with a tolerance, and a test sweeps all 901 valid medias.
- The model's first spread estimator combined separately-estimated `tau` and
  `sigma`, leaving it overconfident — 80% intervals covered only 74%. Estimating
  from pooled one-step-ahead errors instead brought coverage to 83.5%.

And two more were found by the real exam results, which is the whole argument
for going and getting them:

- **The media formula was missing a third of a formula.** Candidates schooled
  in a minority language sit *Limba și literatura maternă* as a third written
  paper, and their media is the mean of **three** grades, not two. Nothing in
  the repo knew this. It is 9,052 of the 152,235 candidates with a published
  media in 2025 — 5.9% nationally, 86% in Harghita and 69% in Covasna — and
  9,024 of them come out with a different media under the two-subject rule.
  `just evnat-verify` now reproduces all 152,235 published medias exactly.
- **The marks model was a point optimistic and wildly overconfident.** Its
  calibration was two straight lines nobody had ever checked. Scored against
  the 2025 cohort they were +1.19 hot, with "80%" intervals covering 43.4%.
  Replacing them with the measured table brings the 2026 out-of-sample figures
  to +0.24 and 80.8%.

## Still blocked: the cutoffs, on admitere.edu.ro

**This is now the only thing blocked, and the reason has changed.** The
sandbox no longer refuses egress — `www.edu.ro`, `example.com` and
`data.gov.ro` all resolve and answer, which is how the real exam results in
Phase 5 got here. `admitere.edu.ro` is unreachable on its own account:

```
$ dig +short admitere.edu.ro
193.231.32.120

$ curl -sS --max-time 20 https://admitere.edu.ro/
curl: (28) Connection timed out after 20001 milliseconds

$ nc -vz -w 5 193.231.32.120 443
nc: connectx to 193.231.32.120 port 443 (tcp) failed: Operation timed out
```

Ports 80 and 443 both time out, and a fetch from an unrelated network returns
`ECONNREFUSED` on the same address. `evaluare.edu.ro` shares the host and
behaves identically. The name resolves and the route exists; the host is not
answering. It is off-season for the admission portal, which the ministry has
historically taken down between cycles, but this is inference — what is
certain is that nothing reaches it from here.

So there are still no repartizare pages, no fixtures, and no parser, and the
cutoffs published in `app/public/data/v1/` remain **synthetic** — generated,
marked `provenance: 'synthetic'` at every layer, and shown behind a warning
banner in the app. They say nothing about real schools.

The marks model is a different story: it is calibrated on real, published
national results, and the app says so where it shows an estimate.

### What is real and what is not, as of now

| | source | real? |
| --- | --- | --- |
| Cutoffs per school and specialization | admitere.edu.ro | **no** — synthetic, bannered |
| School→exam calibration | data.gov.ro, EN 2025 | **yes**, 143,183 candidates |
| The media formula, both branches | verified against EN 2025 | **yes**, all 152,235 rows |
| Marks-model backtest in CI | data.gov.ro, EN 2026 | **yes**, out of sample |

## Why the parser is a stub rather than a guess

A parser written against markup nobody has seen typechecks, passes tests
written against the same guess, goes green in CI, and produces confidently
wrong cutoffs. In this app that means telling a parent their kid can enter a
school they cannot.

So `parseRepartizarePage()` throws `ParserNotImplementedError` naming the URL it
was asked to parse and what to do about it. A ratchet in
`pipeline/test/parse.repartizare.test.ts` enforces the state: while
`pipeline/fixtures/` is empty it asserts the parser is *not* implemented, and
the moment a fixture is committed that branch stops running and the
fixture-driven cases take over — so a fixture landing without a parser fails the
suite instead of passing silently.

## Picking it up

On a machine that can reach the site, one command does the whole network half:

```
scripts/populate.sh                      # SB, 2023-2026, three fixtures per year
scripts/populate.sh SB 2024 --discover   # print the URLs and stop, download nothing
```

It needs Node 22 and nothing else (`just harvest` is the same thing for people
who have `just`). What it does, in order:

1. **Discovery, per year.** Starts at the origin, prints every candidate link
   for the year, then every candidate link for the county, and only then
   downloads — one request every 2 seconds, cached pages skipped. Links to a
   subdomain of the entry host are followed; the portal has historically served
   the tables from one.
2. **Descent.** Follows links from each county page that stay in that page's
   own directory or below it, because the listings have been split across
   several pages before. It never follows the navigation back up.
3. **The record.** Writes `pipeline/raw/harvest.json` mapping each county-year
   to its cached URLs, so `just normalize` parses those pages and not the
   archive index it also cached.
4. **Fixtures.** Copies three pages per year into `pipeline/fixtures/` byte for
   byte, each with a `.url` sidecar: the largest page, the smallest non-trivial
   one and the median, which is the best available guess at "structurally
   different" before a parser exists. `--fixtures <n>` changes the count,
   `--all-fixtures` stages every page, `--stage-only` re-stages from the cache
   without touching the network.

A year that cannot be discovered is reported at the end with the links the
crawler did see, and the other years still run. Every year failing exits
non-zero.

Then, on any machine:

5. Open the staged files and confirm they are repartizare tables rather than
   navigation. Commit them and push. The ratchet in
   `pipeline/test/parse.repartizare.test.ts` now makes `just check` fail until
   the parser exists — that is intended.
6. Implement `parseRepartizarePage()` in `pipeline/src/parse/repartizare.ts`
   against those files, with a test per fixture asserting real rows. Route every
   text field through `normalizeText()` and every media cell through
   `parseMediaCell()`; both are already tested. Use `toFiliera()` for the
   filiera column.
7. `just normalize <year> SB` for each year, `just emit`, `just check`.

If discovery cannot find a year link or a county link, `DiscoveryFailedError`
prints every link it did see. That is a signal the site moved, not a reason to
hardcode a URL template.

## Keeping the exam-results side current

When the ministry publishes a new year (they land on data.gov.ro a few months
after the exam, and 2024, 2025 and 2026 are all up):

1. Add its resource URL to `EVNAT_SOURCES` in `pipeline/src/evnat/index.ts`.
   Look it up on data.gov.ro — the URLs carry opaque UUIDs and cannot be
   guessed from a template.
2. `just evnat-verify <year>` — confirms our media arithmetic still reproduces
   the ministry's for every candidate. If it does not, the formula is wrong,
   not the data.
3. `just evnat-calibrate <year>` — prints the new table. Paste it into
   `app/src/model/marks.ts` and update the count and year alongside it.
4. `just evnat-sample` — refreshes the committed fixtures.
5. `just check`.

The out-of-sample numbers in [MARKS.md](MARKS.md) are the reason to bother:
applying the 2025 table to 2026 candidates costs +0.24 of bias, and to 2024
candidates +0.43. That is the size of a year's drift in exam difficulty, and
it is what re-calibrating buys back.

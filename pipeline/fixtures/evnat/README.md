# Evaluarea Națională 2025 — open data

Real candidate results, published by the Ministry of Education as open data on
[data.gov.ro](https://data.gov.ro/dataset/rezultate_evaluare_2025) under
**CC-BY 4.0**. Unlike admitere.edu.ro (see [`../../../docs/STATUS.md`](../../../docs/STATUS.md)),
this host is reachable, so this is the first *real* data in the repo.

The published workbook is one sheet, `export`, 159,229 rows and 21 columns,
one row per candidate:

```
COD UNIC CANDIDAT, SEX, MEDIU, COD SIIIR,
STATUS ROMANA, STATUS LIMBA MATERNA, STATUS MATEMATICA,
NOTA ROMANA, NOTA LIMBA MATERNA, NOTA MATEMATICA,
CONTESTATIE ..., NOTA CONTESTATIE ...,
NOTA FINALA ROMANA, NOTA FINALA LB MATERNA, NOTA FINALA MATEMATICA,
MEDIA, MEDIA V-VIII
```

## What is committed here, and why only a sample

The workbooks are ~16 MB each — too big to commit, and one download away.
What is committed is two small samples, both written by
`pipeline/src/evnat/index.ts` (`just evnat-sample`), both deterministic: rows
are sorted and picked at even intervals, never randomly, so re-running
produces the same file.

### `evnat-2025-sample.csv` — the media arithmetic

**660 real rows**, four columns.

The rows are not a random sample. They are chosen to exercise the media
arithmetic where it can actually go wrong, in equal parts:

| rows | branch | property |
| --- | --- | --- |
| 220 | two-subject | the mean lands *between* hundredths — truncation bites |
| 110 | two-subject | the mean is exact — truncation must not shave a hundredth |
| 220 | three-subject | the mean lands between hundredths |
| 110 | three-subject | the mean is exact |

Every row carries the ministry's own published `MEDIA` alongside the grades, so
the test asserts our arithmetic against *their* answer, not against ours.

`COD UNIC CANDIDAT` is dropped. The test needs grades, not candidates, and a
per-candidate identifier is not something this repo has any reason to carry.
The same goes for the backtest sample below.

### `evnat-2026-backtest.csv` — the marks model

**4,000 real rows** — `media_v_viii` alongside each candidate's final marks
and media — spread evenly across the school-record range.

These are **2026** candidates, while the calibration in
`app/src/model/marks.ts` was measured on **2025**. That is deliberate: it
makes the check in `pipeline/test/evnat.test.ts` an out-of-sample test of the
model against real kids from a year it never saw, rather than a restatement of
its own fit. It runs offline on every `just test`.

## The claim this fixture stands in for

The sample is what CI runs. The full-file check was run once, out of band, over
every row of the published workbook:

```
two-subject rows  : 143,183   reproduced 143,183   failed 0
three-subject rows:   9,052   reproduced   9,052   failed 0
total             : 152,235
```

and 9,024 of those 9,052 three-subject rows come out **different** under the
two-subject formula — which is the whole reason
`computeMediaAdmitere` grew a third argument. To re-run it yourself:

```
just evnat-verify 2025   # downloads the workbook, checks all 152,235 rows
```

That recipe is network-only and is never run by tests or CI, exactly like
`just fetch`. It exits non-zero on any mismatch: disagreeing with the
ministry's own arithmetic means our formula is wrong, and every cutoff
comparison downstream is wrong with it.

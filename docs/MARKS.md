# The marks model

## The question

The admission model ([MODEL.md](MODEL.md)) answers "will this media get my kid
in this year". But a kid in class V–VII has no media, and even an 8th grader
only gets one after the exam. The question those families actually have is
one step earlier: **what media is my kid likely to get at Evaluarea
Națională?**

The tempting answer — read the school media off the catalog — is wrong, and
the published results say by exactly how much. Across the 143,183 candidates
in the 2025 national file, taking the gimnaziu average as the exam media runs
**1.96 points hot**. A parent who reads "media 9 la școală" as "media 9 la
evaluare" is planning around schools their kid will miss by a mile: the
average candidate with a school 9 scored **6.95**.

## Inputs

Chosen because every parent can read them off the catalog:

- the grade the kid is in now (V–VIII),
- the yearly school media (medie anuală) in **română** and **matematică** for
  each grade so far,
- optionally, for 8th graders, the **simulare** marks.

## Specification

### The calibration is measured

The centre of the model is a table of what candidates with a given school
record actually scored, built from the Ministry of Education's published
Evaluarea Națională results (data.gov.ro, CC-BY 4.0) by
`pipeline/src/evnat/calibrate.ts`. Regenerate it with `just evnat-calibrate`.

Candidates counted: present at both common papers, with a school average on
file, and **not** sitting a *limba maternă* paper — that last group takes a
different română syllabus and averages 6.22 against 7.35, so folding them in
would bend the română curve for a reason that has nothing to do with school
grades. That leaves 143,183 of the 2025 cohort.

| school record | română | matematică | n |
| --- | --- | --- | --- |
| 6.00 | 2.40 | 3.09 | 186 |
| 6.50 | 3.04 | 3.46 | 1,027 |
| 7.00 | 3.88 | 3.84 | 2,739 |
| 7.50 | 4.78 | 4.24 | 4,798 |
| 8.00 | 5.68 | 4.76 | 7,164 |
| 8.50 | 6.59 | 5.45 | 9,882 |
| 9.00 | 7.49 | 6.38 | 13,265 |
| 9.50 | 8.36 | 7.54 | 18,681 |
| 10.00 | 9.28 | 9.04 | 15,892 |

(The shipped table is on a 0.25 grid; this is every other knot.)

Two things in it are worth stating out loud, because both contradict what the
model used to assume:

- **The inflation is far larger than a straight reading suggests.** A school
  8.0 is not "a bit under 8" at the exam. It is a **5.68 in română and a 4.76
  in matematică** — below the line for a good half of the county's
  specializations.
- **Matematică is not uniformly harsher.** The two curves *cross* just below
  7. A kid at 6.5 does better in matematică (3.46) than in română (3.04); a
  kid at 9 does much worse (6.38 against 7.49). The old model encoded
  "matematică is harsher everywhere" as a fixed slope, and that is simply not
  what the country's results look like.

### Why a table rather than a fitted line

Română is near-linear against the school record and a line fits it (rmse
0.9718 linear, 0.9717 quadratic — no gain worth having). Matematică is not:
flat at the bottom, steep at the top. A quadratic lowers its rmse from 1.3415
to 1.2902 and then **turns back upward below 7**, predicting a higher exam
mark for a school 5 than for a school 7. A cubic misbehaves differently.

So the estimator interpolates the measured means between knots and **clamps**
outside them. It cannot invert, cannot run negative, and every value in it is
an average of real candidates rather than a coefficient fitted through them.

### Uncertainty

The measured spread around each knot is the whole conditional spread for a
kid with a *complete* V–VIII record — 0.52 in română for a straight-10 kid,
1.28 mid-scale, and it varies enough with the record to be read from the table
rather than fixed. Three adjustments sit on top:

- **Record incompleteness.** `MEDIA V-VIII` is already an average of four
  years, so the table's spread is a four-year spread. A parent holding fewer
  years has a noisier summary of the same kid, and `recordIncompletenessVar`
  widens the answer by the difference — zero for a flat four-year record,
  largest for a single year.
- **Drift.** A kid who has not reached grade 8 will change before the exam;
  every remaining year adds variance, computed from which grades were observed
  and with what weight.
- **Exam day.** `EXAM_DAY_SHARE = 0.45` of the measured variance is treated as
  irreducible, and a simulare can only sharpen the rest.

A simulare is a second independent reading, combined precision-weighted
against the reducible part only, with an uplift (`SIMULARE_UPLIFT = 0.35`)
because real exam marks land above the simulare on average.

The two subjects combine into the media with correlated errors — `SUBJECT_RHO
= 0.443`, **measured** as the correlation of the two subjects' residuals about
the table above, rather than the 0.35 it was previously guessed at. The
estimated media and its spread chain straight into the admission model:
`predict()` accepts a `mediaSd`, adds the variances, and every probability is
pulled toward 0.5 exactly as much as the media is uncertain.

### What the model refuses to do

- **Extrapolate a trend in the kid's grades.** Same reasoning as the cutoff
  model: a slope fitted to three or four yearly medii is mostly noise. The
  trajectory enters as *uncertainty* (drift variance), not as a direction.
- **Extrapolate the calibration past the data.** Below the lowest knot the
  published file thins to a few dozen candidates; the table clamps instead.
- **Accept simulare marks from anyone not in grade 8**, a media for a grade
  the kid has not reached, duplicate grades, or marks off the 1..10 scale —
  all throw `MarksError`.

## Validation against real candidates

The calibration was measured on **2025**. The scores below are against the
whole published cohort of three separate years, feeding each candidate's
school average in as their record and comparing with the media they actually
got. **2024 and 2026 are out of sample**; 2026 is the one that matters, being
the year *after* the data the model learned from — which is exactly the
position the app is in when a parent uses it.

| year | | mean error | MAE | 80% coverage | MAE of reading the catalog |
| --- | --- | --- | --- | --- | --- |
| 2024 | out of sample | +0.43 | 0.89 | 75.8% | 2.40 |
| 2025 | in sample | −0.00 | 0.76 | 83.2% | 1.96 |
| **2026** | **out of sample** | **+0.24** | **0.79** | **80.8%** | 2.22 |

Against the version this replaced, whose calibration was two guessed lines:

| | mean error | MAE | 80% coverage |
| --- | --- | --- | --- |
| guessed lines (2025, in sample) | **+1.19** | 1.26 | **43.4%** |
| measured table (2026, out of sample) | +0.24 | 0.79 | 80.8% |

The old model was a point hot and its "80%" interval was really a 43% one.
Both errors pointed the same way — toward telling a parent their kid clears a
cutoff they do not.

The residual **+0.24 in 2026 and +0.43 in 2024 is real year-to-year movement
in exam difficulty**, not noise: marks were lower in both years than in 2025.
That is the honest size of the error from calibrating on one year and applying
it to another, and it is the reason to re-run `just evnat-calibrate` when a
new year is published.

A committed sample of 4,000 real 2026 candidates lives in
`pipeline/fixtures/evnat/evnat-2026-backtest.csv`, so `just test` scores the
model against real, out-of-sample candidates offline on every run
(`pipeline/test/evnat.test.ts`).

## Validation of the machinery

`pipeline/test/marks.test.ts` scores the model against synthetic students
(`pipeline/src/mock/students.ts`), 2,500 per configuration. Since the
calibration is now measured, the synthetic world is anchored to the real one:
synthetic kids lose what real kids lost, with the real spread. What remains
synthetic is the *trajectory* — drift between grades, yearly catalog noise,
what a simulare is worth — because the published file carries one school
number per candidate and cannot speak to any of it.

| Current grade | 80% coverage | Bias | MAE | MAE of reading the catalog | mean sd |
| --- | --- | --- | --- | --- | --- |
| V | 83.6% | −0.05 | 0.84 | 2.01 | 1.13 |
| VI | 82.2% | −0.05 | 0.81 | 2.01 | 1.06 |
| VII | 81.7% | +0.01 | 0.81 | 2.06 | 1.02 |
| VIII | 81.0% | −0.02 | 0.78 | 2.04 | 1.00 |
| VIII + simulare | 82.2% | +0.02 | 0.56 | 2.07 | 0.74 |

Coverage sits at or slightly above the nominal 80% everywhere — wide is the
intended direction of error — and the mean spread falls monotonically from
class V to an 8th grader with a simulare, which the suite asserts directly.

## What is still not established

**The per-subject link.** The published file records `MEDIA V-VIII`, the
gimnaziu average **over all subjects** — one number per candidate. It does not
record per-subject school medii. So the table is indexed by a kid's *overall*
average, while the model is handed their română and matematică medii
separately, and applying one to the other assumes the two track each other.
That is this model's last unmeasured joint. For a kid whose subject medii are
lopsided the two predictions will be further apart than the data can vouch
for. Closing it needs a source pairing per-subject school medii with exam
marks, which no published dataset currently is.

**Per-school and per-county inflation.** The table is a single national
calibration, and generosity varies by school. The misspecification test makes
the cost concrete: give the synthetic schools **half a point more generosity
than the calibration expects** and the model overpredicts by +0.75 while
coverage falls from 81% to **64.9%**. A kid at a soft-grading school will be
overestimated, in the dangerous direction. Calibrating per county is possible
from the same file — it carries a SIIIR code — but only worth shipping if it
survives a held-out year, which is the next thing to try.

**Anything about the simulare, drift, or yearly catalog noise.** All three are
priors. None is measurable from the published results.

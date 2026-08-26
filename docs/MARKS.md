# The marks model

## The question

The admission model ([MODEL.md](MODEL.md)) answers "will this media get my kid
in this year". But a kid in class V–VII has no media, and even an 8th grader
only gets one after the exam. The question those families actually have is
one step earlier: **what media is my kid likely to get at Evaluarea
Națională?**

The tempting answer — read the school media off the catalog — is wrong in a
known direction. School grades run higher than exam marks, by roughly a point
in română and considerably more in matematică, and the gap widens as the
grades drop. A parent who takes "media 9 la școală" as "media 9 la evaluare"
is planning around schools their kid is unlikely to reach.

## Inputs

Chosen because every parent can read them off the catalog, and because the
eventual real datasets contain exactly what is needed to calibrate them —
admission listings publish each candidate's school record next to their exam
marks:

- the grade the kid is in now (V–VIII),
- the yearly school media (medie anuală) in **română** and **matematică** for
  each grade so far,
- optionally, for 8th graders, the **simulare** marks.

## Specification

Per subject, the exam mark is modelled through a latent ability on the exam
scale:

```
school[y]    = inv(ability[y]) + yearly noise      (the catalog is a noisy,
                                                    inflated reading)
ability[y+1] = ability[y] + drift                  (kids change)
exam         = ability[8] + exam-day noise
```

`inv` is the inverse of a linear calibration `exam = intercept + slope *
school` with slope above 1 and intercept negative — the inflation shrinks
toward the top of the scale and widens below it:

| Subject | slope | intercept | school 10 → | school 8 → | school 6 → |
| --- | --- | --- | --- | --- | --- |
| română | 1.15 | −1.9 | 9.6 | 7.3 | 5.0 |
| matematică | 1.45 | −5.0 | 9.5 | 6.6 | 3.7 |

The yearly medii are combined with recency weights (each year counts double
the one before it), and the predictive spread is **derived from the
structure** rather than guessed per grade:

- catalog noise shrinks as more years are observed (`yearSd`, on the school
  scale, mapped through the slope);
- drift variance grows with every year between the observed medii and the
  grade-8 exam — computed exactly from which grades were observed and with
  what weight, so one grade-5 media carries three full years of drift and an
  8th grader's own media carries none;
- exam-day noise (`examSd`) never shrinks.

A simulare, when present, is a second independent reading of the same
ability, combined precision-weighted, with a documented uplift
(`SIMULARE_UPLIFT = 0.35`) because real exam marks land above the simulare on
average.

The two subjects combine into the media with correlated errors
(`SUBJECT_RHO = 0.35` — a good or bad exam day tends to be shared), and the
estimated media plus its spread chain straight into the admission model:
`predict()` accepts a `mediaSd`, adds the variances, and every probability is
pulled toward 0.5 exactly as much as the media is uncertain.

### What the model refuses to do

- **Extrapolate a trend in the kid's grades.** Same reasoning as the cutoff
  model: a slope fitted to three or four yearly medii is mostly noise. The
  trajectory enters as *uncertainty* (drift variance), not as a direction.
- **Accept simulare marks from anyone not in grade 8**, a media for a grade
  the kid has not reached, duplicate grades, or marks off the 1..10 scale —
  all throw `MarksError`.

### Priors, not measurements

Every constant above is a documented prior. None has met real data — the
calibration anchors come from published national aggregates (school averages
vs. exam averages), not from fitted pairs. The real repartizare data pairs
each candidate's school record with their exam marks, which is precisely the
regression needed to replace these numbers; that re-estimation is the first
thing to do once the crawl is unblocked.

## Validation

Run by `just test` (`pipeline/test/marks.test.ts`), against synthetic
students (`pipeline/src/mock/students.ts`) generated from exactly the process
the model assumes, 2 500 kids per configuration, scored against their
realized exam media:

| Current grade | 80% interval coverage | Bias | MAE | MAE of reading the catalog |
| --- | --- | --- | --- | --- |
| V | 85.0% | +0.02 | 0.53 | 1.20 |
| VI | 83.0% | −0.01 | 0.49 | 1.19 |
| VII | 81.6% | +0.00 | 0.46 | 1.19 |
| VIII | 82.2% | −0.01 | 0.43 | 1.18 |
| VIII + simulare | 79.8% | −0.01 | 0.40 | 1.18 |

- **Coverage** sits at or slightly above the nominal 80% everywhere — wide is
  the intended direction of error.
- The **naive rule** (average the school medii and call that the exam media)
  runs about **1.2 points hot**; the model roughly **halves the absolute
  error and removes the bias**, which is its entire reason to exist.
- Uncertainty behaves: the mean predictive sd falls from 0.76 (class V) to
  0.55 (class VIII) to 0.50 (with a simulare), and the suite asserts the
  monotonicity directly.

## What this validation does *not* establish

The same honesty clause as the admission model, and it bites harder here: the
generator implements the model's own assumptions, so these numbers validate
the machinery, not accuracy about real kids. The misspecification test makes
the main risk concrete: give the synthetic schools **half a point more
generosity than the calibration assumes**, and the model overpredicts by
+0.61 while interval coverage collapses from 82% to **55%**.

That is the expected failure mode with real data — grade inflation varies by
school and by county, and a single national calibration line will be wrong
somewhere. The fixes, in order, once real (school record, exam mark) pairs
exist:

1. Re-fit `slope`/`intercept`/`examSd` per subject from the real pairs; check
   the residuals are straight enough for a line.
2. Check coverage the same way the suite does; if it is materially below 80%,
   widen `yearSd`/`examSd` before shipping anything.
3. If per-school or per-county inflation is visible and stable, calibrate at
   that level — but only if it survives a held-out backtest.

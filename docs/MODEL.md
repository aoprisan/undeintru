# The prediction model

## The question

A parent does not want to know last year's cutoff. They want to know whether
their kid's media will get them in **this** year. Those are different
questions, and the second one has no certain answer — cutoffs move every year.

Showing last year's number and letting people draw their own conclusion quietly
answers the first question while appearing to answer the second. This model
answers the second one explicitly, as a probability.

## Specification

For specialization `s` in year `y`, with cutoff `c`:

```
c[s][y] = c[s][y-1] + m[y] + e[s][y]
```

| Term | Meaning |
| --- | --- |
| `m[y]` | County-wide shift. Exam difficulty and cohort size move every cutoff in a county together. |
| `e[s][y]` | Specialization-level noise: a school gaining or losing favour, staff changes, seat changes. |

Both are modelled as **zero-mean**. That is a deliberate choice, not an
oversight: cutoffs do not trend in a knowable direction, and a model that
extrapolated last year's swing would be confidently wrong every time the swing
reversed. So the point prediction is simply last year's cutoff, and the model's
entire contribution is the uncertainty band around it:

```
cutoff[s][target] ~ Normal(c[s][last], sd²)
P(admitted | media) = Phi((media - c[s][last]) / sd)
```

### Estimating `sd`

`sd` comes from the **pooled one-step-ahead errors** — every observed
`c[s][y] - c[s][y-1]` across all specializations and all consecutive year
pairs. Each such delta is one realisation of exactly the error the model will
make next year, since it contains both the county shift and the spec noise.

The obvious alternative — estimate `tau` and `sigma` separately, then combine
as `sqrt(tau² + sigma²)` — was tried first and is worse. A MAD over the three
or four county shifts a short history provides is badly biased low. Measured on
synthetic data with a true `sd` of 0.251:

| Estimator | Fitted `sd` | Coverage of the nominal 80% interval |
| --- | --- | --- |
| `sqrt(tau² + sigma²)`, both estimated separately | 0.229 | **74%** — overconfident |
| Pooled one-step errors, no correction | 0.242 | 77% — still overconfident |
| Pooled one-step errors, small-sample correction | 0.279 | **83.5%** |

The correction is `sqrt(k / (k-1))` for `k` observed year pairs, because `k`
shifts sample the shift spread with `k-1` degrees of freedom.

The final estimator runs slightly **wide**. That is the intended direction: a
family acting on an over-confident "yes" loses a school place, while a vague
answer only costs them certainty they never had.

Estimating from pooled deltas needs at least three distinct year pairs. With a
single pair every delta shares one county shift, so their spread measures
`sigma` alone and silently drops `tau` — precisely the overconfidence this is
designed to avoid. Below that threshold the model retains documented prior **floors** and reports
`evidence: 'prior'`, which the UI surfaces. Specialization noise cannot fall
below 0.25; county-shift uncertainty cannot fall below 0.20. The latter can
increase to the root mean square of observed annual median shifts about zero,
using only transitions with at least eight matched courses. This keeps large
shared shocks in the uncertainty estimate without predicting that their
direction will repeat. A quiet season cannot establish low future volatility.
These floors and the eight-course guard are safeguards, not fitted calibration.

### What the model refuses to do

- **Cross the 2023 formula change.** Cutoffs before and after are on different
  scales. `fitCutoffModel` throws rather than mix them.
- **Predict filiera vocationala.** An aptitude exam gates admission there, so
  the media is not the deciding number. Returns `unavailable`.
- **Guess for a specialization that did not fill.** Returns `open` — there was
  no binding cutoff, not a low one.

## Validation

Run by `just test` (`pipeline/test/model.test.ts`), against synthetic data from
a known generating process. 40 independent worlds, six years each, fit on the
first five, scored against the held-out sixth.

**Calibration** — of the candidates the model gave a 60–80% chance, how many
actually got in:

| Predicted | Observed | n |
| --- | --- | --- |
| 6.3% | 5.5% | 1880 |
| 29.6% | 26.8% | 841 |
| 50.0% | 48.3% | 775 |
| 70.4% | 67.5% | 839 |
| 93.0% | 93.6% | 1646 |

Worst gap: **2.9 percentage points**.

**Interval coverage**: 83.5% of actual cutoffs fell inside the nominal 80%
interval.

**Against the naive rule** (treat last year's cutoff as a hard yes/no
threshold, which is what the app would do without a model):

| | Brier score |
| --- | --- |
| Model | 0.1210 |
| Last year's cutoff as a threshold | 0.1764 |

A **31% improvement**. The naive rule is confidently wrong precisely near the
cutoff, which is exactly where families need the answer.

**Parameter recovery**: the fitted per-year county shifts land within 0.08 of
the shifts actually applied, and `sigma` is recovered within 25–30% across a
range of true values.

## What this validation does *not* establish

The data is synthetic and drawn from the same process the model assumes. That
makes the results a fair test of the **machinery** — the estimator recovers
what it is given, the intervals cover what they claim, the probabilities are
calibrated, it beats the naive baseline.

It says nothing about accuracy on Romanian high schools. The metrics above measure synthetic validation, not real-world accuracy.

The suite makes that limit concrete rather than leaving it as a caveat. One
test deliberately misspecifies the world by giving cutoffs a real upward drift
the model assumes away; coverage drops from 83.5% to **67.6%**. That is the
failure mode to watch for once real data exists: if cutoffs turn out to trend,
the intervals will be too narrow and biased low, and the model needs a drift
term.

## Re-validating against real data

Once several years of real cutoffs are in hand:

1. Re-run the backtest with real history in place of the generator: fit on all
   but the most recent year, score against it.
2. Check calibration and coverage the same way. If coverage is materially below
   80%, the spread is too narrow — look for drift or for county shifts larger
   than the pooled estimate suggests.
3. Re-estimate `SIGMA_PRIOR` and `TAU_PRIOR` from the real spread; they are
   currently deliberately wide guesses.
4. If cutoffs do trend, add a drift term — but only if it survives a backtest,
   not because a plot looks like it slopes.

## Published real history (2026-09-16)

The app now fits on official 2025 and 2026 allocation tables for all 42 county codes. Option
codes were reassigned in 2026, so cross-year matching uses school code plus
course label, profile, track, and teaching language (including bilingual and
dual variants in the label). Case and cedilla differences are normalized;
ambiguous identities are excluded. Within one year, the official option code
still identifies the row used for prediction.

In Sibiu there are 27 unambiguous matched courses filled in both years, supplying
one annual transition. Across all counties there are 1,504 such pairs. The
2026 outcomes can test a 2025-only prior forecast, but cannot both fit an
annual spread and validate it on an independent later year. Technical
course names changed substantially and are not guessed to be equivalent.
The archive's previous-year column is not used; each cutoff comes from its
own year's allocation response.

## Vacancy and horizon semantics

A published lowest admitted mark is a competitive cutoff only when the course
filled. `occupiedSeats < seats` returns historical availability (`open`) without
a probability. Such rows are excluded from fitted annual changes and from the
UI's cleared-threshold count. Missing marks without occupancy evidence return
`unavailable`, never an inferred vacancy.

The one-year spread is multiplied by `sqrt(targetYear - baseYear)`, consistent
with independent annual increments in the stated random walk. The interface
carries the selected school grade into the admission year. Future course
availability and annual-independence assumptions remain uncertain.


## Short-history improvement and real-data audit (2026-09-16)

Run `node --import tsx pipeline/src/audit-model.ts` (or `just model-audit`).
The offline audit fits **only 2025** and scores against 2026, using the same
unambiguous course matching as fitting. Vocational, missing-cutoff and vacant
courses are excluded. It does not use 2026 outcomes to fit the scored forecast.
Across 42 counties and 1,504 eligible pairs, the original prior's nominal 80%
interval covers **46.68%**; mean absolute cutoff error is **0.6414** points.
The new and old models have identical forecasts with just one observed year,
so this is evidence of the prior's limits, not a claimed real-data improvement.
Changing courses and courses that become vacant are outside this score.

The audit also prints each county's 2027 spread, fitted on both seasons.
Those forecasts incorporate the observed shock through the new short-history
rule, but have no independent real outcomes yet. Counties share national exam
conditions: 42 counties are not 42 independent annual shocks.

`pipeline/test/short-history.test.ts` compares the revised estimator with the
previous short-history formula on 200 deterministic synthetic worlds per
scenario, training on two seasons and scoring only the third. The baseline
recomputes its residual MAD from the same training rows. Brier scores measure
threshold clearing on a fixed grid of five candidate marks around each base
cutoff, restricted to the grading scale; they are not applicant-level accuracy.

| True county-shift SD | Old coverage | New coverage | Old Brier | New Brier |
| --- | ---: | ---: | ---: | ---: |
| 0.12 | 85.17% | 89.41% | 0.07446 | 0.07511 |
| 0.40 | 57.29% | 72.83% | 0.14254 | 0.13907 |
| 0.80 | 36.17% | 62.92% | 0.23239 | 0.20992 |

The safeguard improves coverage and probability scores under larger shared
shocks, at a small sharpness cost in quiet worlds. It still undercovers in the
volatile scenarios. It is not a guarantee of calibrated probabilities, and
retains the prior-evidence warning. The longer-history pooled estimator and
its existing synthetic validation are unchanged. Duplicate history years now
raise `ModelError` rather than silently changing which transitions are fitted.

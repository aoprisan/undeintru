/**
 * The prediction model.
 *
 * The question a parent actually has is not "what was the cutoff last year"
 * but "will this media get my kid in *this* year". Last year's cutoff answers
 * the first question and is routinely mistaken for an answer to the second.
 * This module makes the difference explicit: it predicts a distribution over
 * next year's cutoff and turns a media into a probability, rather than a
 * yes/no read off a stale number.
 *
 * ## The model
 *
 * For specialization `s` in year `y`, with cutoff `c`:
 *
 *     c[s][y] = c[s][y-1] + m[y] + e[s][y]
 *
 * - `m[y]` is a **county-wide shift** for that year. Exam difficulty and
 *   cohort size move every cutoff in a county together, so this term is shared.
 * - `e[s][y]` is **specialization-level noise** — a school gaining or losing
 *   favour, a teacher leaving, seats changing.
 *
 * Both are modelled as zero-mean. That is a deliberate choice: cutoffs do not
 * trend in a knowable direction, and a model that extrapolated last year's
 * swing would be confidently wrong every time the swing reversed. So the point
 * prediction for next year is simply **last year's cutoff**, and the whole
 * contribution of the model is the *uncertainty band* around it:
 *
 *     predicted cutoff ~ Normal(c[s][last], tau^2 + sigma^2)
 *     P(admitted | media) = Phi((media - c[s][last]) / sd)
 *
 * `tau` (county shift) and `sigma` (spec noise) are estimated from history
 * with robust statistics — median and MAD, not mean and standard deviation,
 * because a handful of specializations swing wildly every year and would
 * otherwise dominate the estimate.
 *
 * ## What this model does not do
 *
 * It does not use data from before {@link MEDIA_FORMULA_EPOCH_YEAR}: the media
 * formula changed, so those cutoffs are on a different scale and mixing them
 * in would silently corrupt every estimate. `fitCutoffModel` throws rather
 * than let that happen.
 *
 * It refuses to predict for filiera vocationala, where an aptitude exam gates
 * admission and the media is not the deciding number.
 */

import {
  areYearsComparable,
  MEDIA_FORMULA_EPOCH_YEAR,
  type AdmissionRow,
  type CountyDataset,
} from '../data/schema.js';

/**
 * Fallback spread of specialization-level noise, in media points, used when
 * there is not enough history to estimate it.
 *
 * These are priors, not measurements. They are deliberately wide: an
 * over-confident interval is worse than a vague one, because it turns "maybe"
 * into "yes" for a family making an irreversible choice. Re-estimate them from
 * real data once several years are available.
 */
export const SIGMA_PRIOR = 0.25;
/** Fallback spread of the county-wide year shift. See {@link SIGMA_PRIOR}. */
export const TAU_PRIOR = 0.2;

/** z for a two-sided 80% interval. */
const Z_80 = 1.2815515655446004;

/** Minimum spread, so a freak run of identical cutoffs cannot yield sd = 0. */
const MIN_SD = 0.02;

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

/** Stable identity for a specialization across years. */
export function specKey(row: Pick<AdmissionRow, 'schoolCode' | 'specId'>): string {
  return `${row.schoolCode}/${row.specId}`;
}

// --- statistics -------------------------------------------------------------

/** Median of a non-empty list. Returns `null` for an empty one. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo === undefined || hi === undefined ? null : (lo + hi) / 2;
}

/**
 * Robust scale estimate: the median absolute deviation, rescaled by 1.4826 so
 * it matches the standard deviation for normally distributed data.
 *
 * Used instead of the standard deviation because a few specializations swing
 * hard every year, and squaring their deviations would let them set the width
 * of everyone else's interval.
 */
export function robustScale(values: readonly number[]): number | null {
  const centre = median(values);
  if (centre === null) return null;
  const mad = median(values.map((v) => Math.abs(v - centre)));
  return mad === null ? null : 1.4826 * mad;
}

/**
 * Standard normal CDF, via the Abramowitz & Stegun 7.1.26 error function
 * approximation (absolute error < 1.5e-7 — far below anything that matters
 * for a probability shown to two significant figures).
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// --- fitting ----------------------------------------------------------------

/** The county-wide shift observed between two consecutive years. */
export interface ObservedShift {
  /** The later year of the pair. */
  readonly year: number;
  /** Median change in cutoff across every specialization present in both years. */
  readonly shift: number;
  /** How many specializations the median was taken over. */
  readonly specCount: number;
}

export interface FittedModel {
  readonly county: string;
  /** The year being predicted. */
  readonly targetYear: number;
  /** The most recent observed year — the base for every point prediction. */
  readonly baseYear: number;
  /** Specialization-level noise. */
  readonly sigma: number;
  /** County-wide year-shift spread. */
  readonly tau: number;
  /** Total predictive spread, `sqrt(tau^2 + sigma^2)`. */
  readonly sd: number;
  /** County-wide shifts actually observed in the history, oldest first. */
  readonly observedShifts: readonly ObservedShift[];
  /**
   * `estimated` when both spreads came from the data; `prior` when history was
   * too short and {@link SIGMA_PRIOR} / {@link TAU_PRIOR} were used instead.
   * A prediction resting on priors is much weaker and the UI says so.
   */
  readonly evidence: 'estimated' | 'prior';
  /** Rows of the base year, by {@link specKey}. */
  readonly base: ReadonlyMap<string, AdmissionRow>;
}

/**
 * Fit the model to a county's history.
 *
 * @param history one dataset per year for a single county, in any order.
 * @param targetYear the year to predict; must be after the latest observed year.
 * @throws ModelError on an empty history, mixed counties, a target year that is
 *   not in the future, or any year outside the current media-formula epoch.
 */
export function fitCutoffModel(
  history: readonly CountyDataset[],
  targetYear: number,
): FittedModel {
  if (history.length === 0) throw new ModelError('cannot fit a model with no history');

  const counties = new Set(history.map((d) => d.county));
  if (counties.size > 1) {
    throw new ModelError(
      `history mixes counties (${[...counties].sort().join(', ')}); fit one county at a time`,
    );
  }

  const years = history.map((d) => d.year);
  for (const year of years) {
    if (!areYearsComparable(year, targetYear)) {
      throw new ModelError(
        `year ${year} is not comparable with ${targetYear}: the media formula changed in ` +
          `${MEDIA_FORMULA_EPOCH_YEAR}, so cutoffs either side of it are on different scales`,
      );
    }
  }

  const sorted = [...history].sort((a, b) => a.year - b.year);
  const latest = sorted[sorted.length - 1];
  if (!latest) throw new ModelError('cannot fit a model with no history');
  if (targetYear <= latest.year) {
    throw new ModelError(
      `targetYear ${targetYear} must be after the latest observed year ${latest.year}`,
    );
  }

  // Year-over-year changes, per specialization, for each consecutive pair.
  const observedShifts: ObservedShift[] = [];
  const residuals: number[] = [];
  /**
   * Every year-over-year change, pooled and *not* recentred per year.
   *
   * This is the key quantity: a delta `c[s][y] - c[s][y-1]` is exactly one
   * realisation of the error the model will make predicting next year, since
   * it contains both the county shift and the spec noise. Estimating the
   * predictive spread from these directly is much better than estimating
   * `tau` and `sigma` separately and combining them — a MAD over the three or
   * four county shifts a short history provides is biased badly low, and the
   * resulting intervals come out too narrow.
   */
  const oneStepErrors: number[] = [];

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr || curr.year !== prev.year + 1) continue; // only adjacent years

    const prevByKey = new Map(prev.rows.map((r) => [specKey(r), r]));
    const deltas: number[] = [];
    for (const row of curr.rows) {
      const before = prevByKey.get(specKey(row));
      // A spec that did not fill has no cutoff, so it contributes no delta.
      if (!before || before.lastMedia === null || row.lastMedia === null) continue;
      if (row.vocational || before.vocational) continue; // aptitude-gated, different process
      deltas.push(row.lastMedia - before.lastMedia);
    }

    const shift = median(deltas);
    if (shift === null) continue;
    observedShifts.push({ year: curr.year, shift, specCount: deltas.length });
    for (const d of deltas) {
      residuals.push(d - shift);
      oneStepErrors.push(d);
    }
  }

  // sigma: spread of what is left once the shared year shift is removed.
  const sigmaEstimate = residuals.length >= 8 ? robustScale(residuals) : null;
  // tau: spread of the year shifts themselves. Reported for diagnostics; it is
  // too noisy on a short history to drive the interval on its own.
  const shiftValues = observedShifts.map((s) => s.shift);
  const tauEstimate = shiftValues.length >= 3 ? robustScale(shiftValues) : null;

  /*
   * The predictive spread comes from the pooled one-step-ahead errors, which
   * needs at least a few distinct year pairs to be meaningful: with a single
   * observed pair every delta shares one county shift, so their spread
   * measures `sigma` alone and silently drops `tau` — precisely the
   * overconfidence this is meant to avoid.
   *
   * The pooled spread still understates `tau` slightly, because k observed
   * shifts sample its spread with k-1 degrees of freedom. The correction below
   * is small but it is the difference between 80% intervals that cover 80% and
   * ones that cover 74%.
   */
  const shiftCount = observedShifts.length;
  const pooled = shiftCount >= 3 ? robustScale(oneStepErrors) : null;
  const corrected =
    pooled === null ? null : pooled * Math.sqrt(shiftCount / Math.max(1, shiftCount - 1));

  const sigma = sigmaEstimate ?? SIGMA_PRIOR;
  const tau = tauEstimate ?? TAU_PRIOR;
  const sd = Math.max(MIN_SD, corrected ?? Math.hypot(tau, sigma));

  return {
    county: latest.county,
    targetYear,
    baseYear: latest.year,
    sigma,
    tau,
    sd,
    observedShifts,
    evidence: corrected !== null ? 'estimated' : 'prior',
    base: new Map(latest.rows.map((r) => [specKey(r), r])),
  };
}

// --- prediction -------------------------------------------------------------

export type Prediction =
  | {
      readonly kind: 'estimate';
      /** P(this media is at or above next year's cutoff), in [0, 1]. */
      readonly probability: number;
      /** Point prediction for next year's cutoff. */
      readonly cutoff: number;
      /** 80% prediction interval for the cutoff. */
      readonly interval: readonly [number, number];
      readonly sd: number;
    }
  | {
      /** The specialization did not fill last year, so the cutoff did not bind. */
      readonly kind: 'open';
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: 'vocational' | 'no-history';
    };

/**
 * Predict whether `media` clears a specialization's cutoff in the target year.
 *
 * @param media the candidate's media de admitere, or `null` to ask only about
 *   the cutoff (the probability is then computed for the cutoff itself, which
 *   is 0.5 by construction — callers usually pass a real media).
 */
export function predict(model: FittedModel, key: string, media: number | null): Prediction {
  const row = model.base.get(key);
  if (!row) return { kind: 'unavailable', reason: 'no-history' };
  if (row.vocational) return { kind: 'unavailable', reason: 'vocational' };
  if (row.lastMedia === null) return { kind: 'open' };

  const cutoff = row.lastMedia;
  const sd = model.sd;
  const probability = media === null ? 0.5 : normalCdf((media - cutoff) / sd);

  return {
    kind: 'estimate',
    probability,
    cutoff,
    interval: [cutoff - Z_80 * sd, cutoff + Z_80 * sd],
    sd,
  };
}

/** Plain-language band for a probability, for the UI. */
export type Chance = 'sigur' | 'probabil' | 'incert' | 'putin probabil' | 'improbabil';

/**
 * Bucket a probability into a band.
 *
 * The bands are deliberately coarse. Showing "73%" implies a precision the
 * model does not have, especially while the spreads rest on priors.
 */
export function chanceBand(probability: number): Chance {
  if (probability >= 0.9) return 'sigur';
  if (probability >= 0.7) return 'probabil';
  if (probability >= 0.3) return 'incert';
  if (probability >= 0.1) return 'putin probabil';
  return 'improbabil';
}

/**
 * Validation of the prediction model.
 *
 * ## What this suite can and cannot establish
 *
 * The data here is synthetic, drawn from the same process the model assumes.
 * That makes these tests a fair check of the **machinery**: does the estimator
 * recover parameters it was given, do the intervals have the coverage they
 * advertise, is the probability calibrated, does it beat the naive rule the
 * app would otherwise use.
 *
 * It cannot establish that the model is accurate about Romanian high schools.
 * Nothing here has met a real cutoff. The last block deliberately misspecifies
 * the generating process to show what that costs, which is the closest an
 * offline suite can get to honesty about the gap.
 */

import { describe, expect, it } from 'vitest';

import { generateHistory } from '../src/mock/generate.js';
import { Rng } from '../src/mock/rng.js';
import {
  chanceBand,
  fitCutoffModel,
  median,
  ModelError,
  normalCdf,
  predict,
  robustScale,
  specKey,
  SIGMA_PRIOR,
  TAU_PRIOR,
} from '../src/model.js';
import type { CountyDataset } from '../src/schema.js';

const COUNTY = 'SB';

function history(seed: number, years: readonly number[], opts = {}): CountyDataset[] {
  return [...generateHistory({ seed, county: COUNTY, years, ...opts }).datasets];
}

// --- statistical helpers ----------------------------------------------------

describe('statistics', () => {
  it('median handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('robustScale approximates the standard deviation for normal data', () => {
    const rng = new Rng(7);
    const sample = Array.from({ length: 4000 }, () => rng.normal(5, 2));
    expect(robustScale(sample)).toBeGreaterThan(1.8);
    expect(robustScale(sample)).toBeLessThan(2.2);
  });

  it('robustScale ignores a handful of wild outliers that would wreck an SD', () => {
    const rng = new Rng(11);
    const sample = Array.from({ length: 1000 }, () => rng.normal(0, 1));
    const contaminated = [...sample, ...Array.from({ length: 30 }, () => 500)];
    const scale = robustScale(contaminated);
    expect(scale).toBeGreaterThan(0.85);
    expect(scale).toBeLessThan(1.15);
  });

  it('normalCdf matches known quantiles', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 5);
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 5);
    expect(normalCdf(1.2815515655446004)).toBeCloseTo(0.9, 5);
    expect(normalCdf(6)).toBeGreaterThan(0.999999);
  });
});

// --- guards -----------------------------------------------------------------

describe('fitCutoffModel guards', () => {
  it('refuses a history that straddles the 2023 formula change', () => {
    const modern = history(1, [2023, 2024]);
    const ancient: CountyDataset = { ...modern[0]!, year: 2021 };
    expect(() => fitCutoffModel([ancient, ...modern], 2025)).toThrow(ModelError);
    expect(() => fitCutoffModel([ancient, ...modern], 2025)).toThrow(
      /not comparable|media formula changed/,
    );
  });

  it('refuses a history mixing counties', () => {
    const sb = history(2, [2023, 2024]);
    const cj: CountyDataset = { ...sb[1]!, county: 'CJ' };
    expect(() => fitCutoffModel([sb[0]!, cj], 2025)).toThrow(/mixes counties/);
  });

  it('refuses an empty history', () => {
    expect(() => fitCutoffModel([], 2025)).toThrow(/no history/);
  });

  it('refuses a target year that is not in the future', () => {
    const h = history(3, [2023, 2024]);
    expect(() => fitCutoffModel(h, 2024)).toThrow(/must be after the latest observed year/);
    expect(() => fitCutoffModel(h, 2022)).toThrow();
  });
});

// --- prediction semantics ---------------------------------------------------

describe('predict', () => {
  const h = history(4, [2023, 2024, 2025, 2026]);
  const model = fitCutoffModel(h, 2027);
  const latest = h[h.length - 1]!;

  it('reports the target and base years it is working from', () => {
    expect(model.targetYear).toBe(2027);
    expect(model.baseYear).toBe(2026);
    expect(model.county).toBe(COUNTY);
  });

  it('refuses to predict for filiera vocationala, where an exam gates entry', () => {
    const vocational = latest.rows.find((r) => r.vocational);
    expect(vocational).toBeDefined();
    expect(predict(model, specKey(vocational!), 9.5)).toEqual({
      kind: 'unavailable',
      reason: 'vocational',
    });
  });

  it('reports a specialization that did not fill as open rather than guessing', () => {
    const unfilled = latest.rows.find((r) => r.lastMedia === null && !r.vocational);
    expect(unfilled).toBeDefined();
    expect(predict(model, specKey(unfilled!), 6)).toEqual({ kind: 'open' });
  });

  it('reports an unknown specialization as having no history', () => {
    expect(predict(model, 'NOPE/NOPE', 9)).toEqual({ kind: 'unavailable', reason: 'no-history' });
  });

  it('is monotone: a higher media never lowers the probability', () => {
    const row = latest.rows.find((r) => r.lastMedia !== null && !r.vocational)!;
    const key = specKey(row);
    let previous = -1;
    for (let media = 5; media <= 10; media += 0.25) {
      const p = predict(model, key, media);
      expect(p.kind).toBe('estimate');
      if (p.kind !== 'estimate') continue;
      expect(p.probability).toBeGreaterThanOrEqual(previous);
      previous = p.probability;
    }
  });

  it('gives exactly even odds at the predicted cutoff', () => {
    const row = latest.rows.find((r) => r.lastMedia !== null && !r.vocational)!;
    const p = predict(model, specKey(row), row.lastMedia);
    expect(p.kind).toBe('estimate');
    // Not exactly 0.5: normalCdf is an approximation with error below 1.5e-7,
    // which is orders of magnitude finer than anything shown to a user.
    if (p.kind === 'estimate') expect(Math.abs(p.probability - 0.5)).toBeLessThan(1.5e-7);
  });

  it('produces an 80% interval centred on the point prediction', () => {
    const row = latest.rows.find((r) => r.lastMedia !== null && !r.vocational)!;
    const p = predict(model, specKey(row), 9);
    if (p.kind !== 'estimate') throw new Error('expected an estimate');
    expect(p.cutoff).toBe(row.lastMedia);
    expect((p.interval[0] + p.interval[1]) / 2).toBeCloseTo(p.cutoff, 10);
    expect(p.interval[1] - p.interval[0]).toBeCloseTo(2 * 1.2815515655446004 * p.sd, 10);
  });

  it('falls back to documented priors when history is too short to estimate', () => {
    const short = fitCutoffModel(history(5, [2023, 2024]), 2025);
    expect(short.evidence).toBe('prior');
    expect(short.tau).toBe(TAU_PRIOR);
  });

  it('estimates both spreads from data once there is enough history', () => {
    const long = fitCutoffModel(history(6, [2023, 2024, 2025, 2026, 2027, 2028]), 2029);
    expect(long.evidence).toBe('estimated');
    expect(long.sigma).not.toBe(SIGMA_PRIOR);
    expect(long.tau).not.toBe(TAU_PRIOR);
  });
});

describe('chanceBand', () => {
  it('is coarse on purpose, and ordered', () => {
    expect(chanceBand(0.98)).toBe('sigur');
    expect(chanceBand(0.75)).toBe('probabil');
    expect(chanceBand(0.5)).toBe('incert');
    expect(chanceBand(0.2)).toBe('putin probabil');
    expect(chanceBand(0.02)).toBe('improbabil');
  });
});

// --- parameter recovery -----------------------------------------------------

describe('parameter recovery', () => {
  const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];

  it('recovers the county-wide shift that was actually applied each year', () => {
    const { datasets, truth } = generateHistory({
      seed: 42,
      county: COUNTY,
      years: YEARS,
      tau: 0.15,
      sigma: 0.2,
      specCount: 120,
    });
    const model = fitCutoffModel(datasets, 2031);

    expect(model.observedShifts).toHaveLength(truth.shifts.length);
    model.observedShifts.forEach((observed, i) => {
      const actual = truth.shifts[i]!;
      expect(observed.year).toBe(actual.year);
      // The estimate is a median over ~100 noisy deltas, so it lands close but
      // not exactly -- and truncation to two decimals biases it very slightly.
      expect(Math.abs(observed.shift - actual.shift)).toBeLessThan(0.08);
    });
  });

  it('recovers sigma, the specialization-level noise', () => {
    for (const sigma of [0.12, 0.25, 0.4]) {
      const { datasets } = generateHistory({
        seed: 99,
        county: COUNTY,
        years: YEARS,
        tau: 0.1,
        sigma,
        specCount: 120,
      });
      const model = fitCutoffModel(datasets, 2031);
      expect(model.sigma).toBeGreaterThan(sigma * 0.75);
      expect(model.sigma).toBeLessThan(sigma * 1.3);
    }
  });

  it('widens its total spread as the underlying noise grows', () => {
    const fit = (sigma: number): number =>
      fitCutoffModel(
        generateHistory({ seed: 5, county: COUNTY, years: YEARS, tau: 0.1, sigma, specCount: 120 })
          .datasets,
        2031,
      ).sd;
    expect(fit(0.1)).toBeLessThan(fit(0.3));
    expect(fit(0.3)).toBeLessThan(fit(0.6));
  });
});

// --- backtesting ------------------------------------------------------------

interface Sample {
  readonly probability: number;
  readonly baseline: number;
  readonly admitted: boolean;
}

interface Backtest {
  readonly samples: readonly Sample[];
  /** Whether the 80% interval contained the year's actual cutoff. */
  readonly covered: readonly boolean[];
}

/**
 * Hold out the final year, fit on everything before it, and score the
 * predictions against what actually happened in that year.
 */
function backtest(worlds: number, options: Record<string, unknown> = {}): Backtest {
  const samples: Sample[] = [];
  const covered: boolean[] = [];
  const years = [2023, 2024, 2025, 2026, 2027, 2028];

  for (let w = 0; w < worlds; w += 1) {
    const { datasets } = generateHistory({
      seed: 1000 + w,
      county: COUNTY,
      years,
      specCount: 60,
      ...options,
    });
    const heldOut = datasets[datasets.length - 1]!;
    const model = fitCutoffModel(datasets.slice(0, -1), heldOut.year);
    const actual = new Map(heldOut.rows.map((r) => [specKey(r), r]));
    const rng = new Rng(50_000 + w);

    for (const key of model.base.keys()) {
      const truth = actual.get(key);
      if (!truth || truth.lastMedia === null) continue;

      const point = predict(model, key, null);
      if (point.kind !== 'estimate') continue;
      covered.push(truth.lastMedia >= point.interval[0] && truth.lastMedia <= point.interval[1]);

      // Candidate medias spread around the predicted cutoff, so the samples
      // land across the whole probability range rather than piling up at 0/1.
      for (let k = 0; k < 4; k += 1) {
        const media = rng.normal(point.cutoff, 0.45);
        // Discard rather than clamp a draw outside the grading scale. Clamping
        // would pile draws onto the bound exactly, and every one of those lands
        // in the p = 0.5 bucket while always counting as admitted -- an
        // artefact of the sampling that would read as model miscalibration.
        if (media < 1 || media > 10) continue;
        const p = predict(model, key, media);
        if (p.kind !== 'estimate') continue;
        samples.push({
          probability: p.probability,
          // What the app would say without a model: last year's cutoff as a
          // hard yes/no threshold.
          baseline: media >= p.cutoff ? 1 : 0,
          admitted: media >= truth.lastMedia,
        });
      }
    }
  }

  return { samples, covered };
}

const brier = (samples: readonly Sample[], pick: (s: Sample) => number): number =>
  samples.reduce((acc, s) => acc + (pick(s) - (s.admitted ? 1 : 0)) ** 2, 0) / samples.length;

describe('backtest against a held-out year', () => {
  const { samples, covered } = backtest(40);

  it('produces a large, well-spread sample to score against', () => {
    expect(samples.length).toBeGreaterThan(5000);
    // Predictions must not all bunch at the extremes, or calibration is vacuous.
    const middle = samples.filter((s) => s.probability > 0.2 && s.probability < 0.8);
    expect(middle.length / samples.length).toBeGreaterThan(0.3);
  });

  it('is calibrated: predicted probabilities match observed frequencies', () => {
    const bins = [0, 0.2, 0.4, 0.6, 0.8, 1];
    for (let i = 0; i < bins.length - 1; i += 1) {
      const lo = bins[i]!;
      const hi = bins[i + 1]!;
      const bucket = samples.filter((s) => s.probability >= lo && s.probability < hi);
      if (bucket.length < 200) continue;

      const predicted = bucket.reduce((a, s) => a + s.probability, 0) / bucket.length;
      const observed = bucket.filter((s) => s.admitted).length / bucket.length;
      // Within 5 percentage points across every populated bucket.
      expect(Math.abs(predicted - observed)).toBeLessThan(0.05);
    }
  });

  it('has 80% intervals that actually cover about 80% of outcomes', () => {
    const rate = covered.filter(Boolean).length / covered.length;
    expect(covered.length).toBeGreaterThan(1000);
    expect(rate).toBeGreaterThan(0.78);
    expect(rate).toBeLessThan(0.9);
  });

  it('errs wide rather than narrow — the safe direction for this decision', () => {
    // Estimating the predictive spread from a handful of year pairs lands
    // slightly conservative. That is deliberate: a family acting on an
    // over-confident "yes" loses a school place, while a vague answer only
    // costs them certainty they never actually had.
    const rate = covered.filter(Boolean).length / covered.length;
    expect(rate).toBeGreaterThanOrEqual(0.8);
  });

  it('beats the naive rule of treating last year’s cutoff as a hard threshold', () => {
    const model = brier(samples, (s) => s.probability);
    const naive = brier(samples, (s) => s.baseline);
    expect(model).toBeLessThan(naive);
    // Not a rounding-error win: the naive rule is confidently wrong near the
    // cutoff, which is exactly where families need the answer.
    expect(naive - model).toBeGreaterThan(0.02);
  });

  it('never claims certainty it cannot have near the cutoff', () => {
    const nearCutoff = samples.filter((s) => s.probability > 0.35 && s.probability < 0.65);
    expect(nearCutoff.length).toBeGreaterThan(500);
    // In this band, real outcomes must genuinely go both ways.
    const rate = nearCutoff.filter((s) => s.admitted).length / nearCutoff.length;
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.7);
  });
});

// --- the honest caveat ------------------------------------------------------

describe('misspecification: what synthetic validation cannot promise', () => {
  it('loses interval coverage when cutoffs actually trend, which the model assumes away', () => {
    // The model treats year-over-year movement as zero-mean. Give the world a
    // real upward drift and the intervals start missing high -- documenting the
    // limit rather than hiding it. This is the failure mode to watch for once
    // real data exists.
    const drifting = backtest(40, { drift: 0.35, tau: 0.05 });
    const rate = drifting.covered.filter(Boolean).length / drifting.covered.length;
    expect(rate).toBeLessThan(0.72);
  });

  it('stays calibrated when the world matches its assumptions', () => {
    const matched = backtest(20, { drift: 0 });
    const rate = matched.covered.filter(Boolean).length / matched.covered.length;
    expect(rate).toBeGreaterThan(0.72);
  });
});

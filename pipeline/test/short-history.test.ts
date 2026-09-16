import { describe, expect, it } from 'vitest';
import { generateHistory } from '../src/mock/generate.js';
import { fitCutoffModel, normalCdf, predict, SIGMA_PRIOR, specKey, TAU_PRIOR, Z_80, uniqueCourses, median, robustScale, hasVacancies } from '../src/model.js';
import type { CountyDataset } from '../src/schema.js';

function shiftedHistory(shift: number, count = 20): CountyDataset[] {
  const base = generateHistory({ seed: 7, county: 'SB', years: [2025], specCount: count }).datasets[0]!;
  // Distinct course identities and no censoring, to isolate a county shock.
  const rows = base.rows.map((row, i) => ({ ...row, specLabel: `Course ${i}`,
    vocational: false, lastMedia: 7, occupiedSeats: row.seats }));
  return [{ ...base, rows }, { ...base, year: 2026,
    rows: rows.map((row) => ({ ...row, year: 2026, lastMedia: 7 + shift })) }];
}

describe('short-history uncertainty', () => {
  it('does not collapse uncertainty after one quiet season', () => {
    const model = fitCutoffModel(shiftedHistory(0), 2027);
    expect(model.sd).toBeCloseTo(Math.hypot(SIGMA_PRIOR, TAU_PRIOR));
    expect(model.evidence).toBe('prior');
  });

  it('retains shared shocks without extrapolating their direction', () => {
    for (const shift of [-0.8, 0.8]) {
      const model = fitCutoffModel(shiftedHistory(shift), 2027);
      expect(model.tau).toBeCloseTo(0.8);
      expect(model.sd).toBeCloseTo(Math.hypot(0.8, SIGMA_PRIOR));
      const row = [...model.base.values()][0]!;
      const result = predict(model, specKey(row), row.lastMedia);
      if (result.kind !== 'estimate') throw new Error('Expected estimate');
      expect(result.cutoff).toBe(row.lastMedia);
      expect(result.probability).toBeCloseTo(0.5);
      expect(model.evidence).toBe('prior');
    }
  });

  it('uses both observed shocks about zero when their directions reverse', () => {
    const history = shiftedHistory(0.8);
    const base = history[0]!;
    const reversal = { ...base, year: 2027,
      rows: base.rows.map((row) => ({ ...row, year: 2027, lastMedia: 7.4 })) };
    const model = fitCutoffModel([...history, reversal], 2028);
    expect(model.tau).toBeCloseTo(Math.sqrt((0.8 ** 2 + 0.4 ** 2) / 2));
    expect(model.evidence).toBe('prior');
  });

  it('does not estimate a county shock from a handful of courses', () => {
    expect(fitCutoffModel(shiftedHistory(0.8, 4), 2027).tau).toBe(TAU_PRIOR);
  });

  it('rejects duplicate seasons instead of silently changing transition weighting', () => {
    const history = shiftedHistory(0.3);
    expect(() => fitCutoffModel([...history, history[0]!], 2027)).toThrow(/duplicate years/);
  });

  it('improves held-out coverage and Brier score when shared shocks exceed the prior', () => {
    // Fixed seeds, two training years and a genuinely unseen third year.
    // Course identities remain stable; exclude vacancies and aptitude gates.
    for (const tau of [0.12, 0.4, 0.8]) {
      let count = 0;
      let covered = 0;
      let oldCovered = 0;
      let score = 0;
      let oldScore = 0;
      let samples = 0;
      for (let seed = 2000; seed < 2200; seed += 1) {
        const { datasets } = generateHistory({ seed, county: 'SB', years: [2025, 2026, 2027],
          tau, sigma: 0.22, specCount: 100 });
        const model = fitCutoffModel(datasets.slice(0, 2), 2027);
        // Before this change short histories always used TAU_PRIOR, even
        // when their observed county-wide shift was several times larger.
        const before = uniqueCourses(datasets[0]!.rows);
        const changes: number[] = [];
        for (const [key, row] of uniqueCourses(datasets[1]!.rows)) {
          const previous = before.get(key);
          if (!previous || previous.lastMedia === null || row.lastMedia === null ||
            row.vocational || previous.vocational || hasVacancies(row) || hasVacancies(previous)) continue;
          changes.push(row.lastMedia - previous.lastMedia);
        }
        const shift = median(changes) ?? 0;
        const oldSigma = changes.length >= 8
          ? robustScale(changes.map((change) => change - shift))! : SIGMA_PRIOR;
        const oldSd = Math.hypot(TAU_PRIOR, oldSigma);
        for (const row of datasets[2]!.rows) {
          if (row.lastMedia === null || row.vocational || row.occupiedSeats! < row.seats) continue;
          const result = predict(model, specKey(row), null);
          if (result.kind !== 'estimate') continue;
          count += 1;
          covered += Number(Math.abs(row.lastMedia - result.cutoff) <= Z_80 * result.sd);
          oldCovered += Number(Math.abs(row.lastMedia - result.cutoff) <= Z_80 * oldSd);
          for (const offset of [-0.8, -0.4, 0, 0.4, 0.8]) {
            const media = result.cutoff + offset;
            if (media < 1 || media > 10) continue;
            const outcome = Number(media >= row.lastMedia);
            score += (normalCdf(offset / result.sd) - outcome) ** 2;
            oldScore += (normalCdf(offset / oldSd) - outcome) ** 2;
            samples += 1;
          }
        }
      }
      expect(count).toBeGreaterThan(10000);
      if (tau > TAU_PRIOR) {
        expect(covered / count - oldCovered / count).toBeGreaterThan(0.1);
        expect(score / samples).toBeLessThan(oldScore / samples);
      } else {
        // Prior floors trade sharpness for protection; bound that cost in
        // a quiet world rather than reporting only the volatile-world wins.
        expect(score / samples - oldScore / samples).toBeLessThan(0.005);
        expect(covered / count).toBeGreaterThanOrEqual(0.8);
      }
      console.info({ tau, coverage: covered / count, baselineCoverage: oldCovered / count,
        brier: score / samples, baselineBrier: oldScore / samples });
    }
  });
});

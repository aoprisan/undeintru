/**
 * Validation of the marks model.
 *
 * Same contract as `model.test.ts`: the data is synthetic and drawn from the
 * process the model assumes, so these tests establish that the **machinery**
 * works — the intervals cover what they claim, the predictions beat the naive
 * reading of the catalog, the uncertainty grows and shrinks when it should.
 * They cannot establish accuracy about real Romanian kids; the calibration
 * constants are priors that have never met real data, and the last block
 * shows what a plausible misspecification costs.
 */

import { describe, expect, it } from 'vitest';

import { generateStudents, type SyntheticStudent } from '../src/mock/students.js';
import {
  MarksError,
  predictMarks,
  SIMULARE_UPLIFT,
  type SchoolGrade,
  type StudentRecord,
  type YearlyMedia,
} from '../src/marks.js';
import { generateHistory } from '../src/mock/generate.js';
import { fitCutoffModel, predict, specKey, Z_80 } from '../src/model.js';

/** A tidy record for the semantics tests. */
function record(
  currentGrade: SchoolGrade,
  romana: readonly (readonly [SchoolGrade, number])[],
  matematica: readonly (readonly [SchoolGrade, number])[],
  simulare?: { romana?: number; matematica?: number },
): StudentRecord {
  const entries = (list: readonly (readonly [SchoolGrade, number])[]): YearlyMedia[] =>
    list.map(([grade, media]) => ({ grade, media }));
  return {
    currentGrade,
    romana: entries(romana),
    matematica: entries(matematica),
    ...(simulare ? { simulare } : {}),
  };
}

// --- guards -----------------------------------------------------------------

describe('predictMarks guards', () => {
  it('refuses a grade outside V..VIII', () => {
    expect(() =>
      predictMarks(record(4 as SchoolGrade, [[5, 9]], [[5, 9]])),
    ).toThrow(MarksError);
    expect(() =>
      predictMarks(record(9 as SchoolGrade, [[5, 9]], [[5, 9]])),
    ).toThrow(/V\.\.VIII/);
  });

  it('refuses a media outside the grading scale, or a non-finite one', () => {
    expect(() => predictMarks(record(6, [[5, 0.5]], [[5, 9]]))).toThrow(/outside 1\.\.10/);
    expect(() => predictMarks(record(6, [[5, 9]], [[5, 10.5]]))).toThrow(/outside 1\.\.10/);
    expect(() => predictMarks(record(6, [[5, Number.NaN]], [[5, 9]]))).toThrow(/finite/);
  });

  it('refuses a subject with no history', () => {
    expect(() => predictMarks(record(6, [], [[5, 9]]))).toThrow(/at least one yearly media/);
  });

  it('refuses a media for a grade the kid has not reached', () => {
    expect(() => predictMarks(record(6, [[7, 9]], [[5, 9]]))).toThrow(/cannot exist/);
  });

  it('refuses duplicate grades within a subject', () => {
    expect(() =>
      predictMarks(
        record(
          6,
          [
            [5, 9],
            [5, 8],
          ],
          [[5, 9]],
        ),
      ),
    ).toThrow(/two medii/);
  });

  it('refuses simulare marks from anyone not in grade 8', () => {
    expect(() =>
      predictMarks(record(7, [[6, 9]], [[6, 9]], { matematica: 7 })),
    ).toThrow(/simulare/);
  });
});

// --- semantics --------------------------------------------------------------

describe('predictMarks semantics', () => {
  it('predicts below the school media: the calibration removes inflation', () => {
    const p = predictMarks(record(8, [[8, 9]], [[8, 9]]));
    expect(p.romana.mean).toBeLessThan(9);
    expect(p.matematica.mean).toBeLessThan(9);
    // ...and matematică loses more, as it does at the real exam.
    expect(p.matematica.mean).toBeLessThan(p.romana.mean);
  });

  it('is monotone: better school grades never lower the prediction', () => {
    let previous = -1;
    for (let media = 5; media <= 10; media += 0.5) {
      const p = predictMarks(record(8, [[8, media]], [[8, media]]));
      expect(p.media.mean).toBeGreaterThanOrEqual(previous);
      previous = p.media.mean;
    }
  });

  it('is vaguer about a 5th grader than an 8th grader — three more years of drift', () => {
    const young = predictMarks(record(5, [[5, 9]], [[5, 9]]));
    const old = predictMarks(record(8, [[8, 9]], [[8, 9]]));
    expect(young.media.sd).toBeGreaterThan(old.media.sd);
    expect(young.romana.horizonYears).toBe(3);
    expect(old.romana.horizonYears).toBe(0);
  });

  it('tightens as more school years are observed', () => {
    const one = predictMarks(record(8, [[8, 9]], [[8, 9]]));
    const four = predictMarks(
      record(
        8,
        [
          [5, 9],
          [6, 9],
          [7, 9],
          [8, 9],
        ],
        [
          [5, 9],
          [6, 9],
          [7, 9],
          [8, 9],
        ],
      ),
    );
    expect(four.media.sd).toBeLessThan(one.media.sd);
  });

  it('weights the newest year hardest', () => {
    const risingLate = predictMarks(
      record(
        8,
        [
          [7, 7],
          [8, 9],
        ],
        [
          [7, 7],
          [8, 9],
        ],
      ),
    );
    const fallingLate = predictMarks(
      record(
        8,
        [
          [7, 9],
          [8, 7],
        ],
        [
          [7, 9],
          [8, 7],
        ],
      ),
    );
    // Same two medii either way round; the one who is at 9 *now* predicts higher.
    expect(risingLate.media.mean).toBeGreaterThan(fallingLate.media.mean);
  });

  it('a simulare tightens the answer and moves it toward the simulare marks', () => {
    const without = predictMarks(record(8, [[8, 9.5]], [[8, 9.5]]));
    const withSim = predictMarks(record(8, [[8, 9.5]], [[8, 9.5]], { romana: 6, matematica: 6 }));
    expect(withSim.media.sd).toBeLessThan(without.media.sd);
    expect(withSim.media.mean).toBeLessThan(without.media.mean);
    expect(withSim.romana.basis).toBe('school+simulare');
    expect(without.romana.basis).toBe('school');
  });

  it('centres the 80% interval on the mean, away from the scale bounds', () => {
    const p = predictMarks(record(8, [[8, 8]], [[8, 8]]));
    expect((p.media.interval[0] + p.media.interval[1]) / 2).toBeCloseTo(p.media.mean, 10);
    expect(p.media.interval[1] - p.media.interval[0]).toBeCloseTo(2 * Z_80 * p.media.sd, 10);
  });

  it('clamps to the grading scale rather than promising an 11', () => {
    const p = predictMarks(record(8, [[8, 10]], [[8, 10]], { romana: 10, matematica: 10 }));
    expect(p.media.interval[1]).toBeLessThanOrEqual(10);
    expect(p.romana.mean).toBeLessThanOrEqual(10);
    const low = predictMarks(record(5, [[5, 1.5]], [[5, 1.5]]));
    expect(low.media.interval[0]).toBeGreaterThanOrEqual(1);
  });
});

// --- backtest against realized exams ----------------------------------------

interface Scored {
  readonly error: number;
  readonly naiveError: number;
  readonly covered: boolean;
}

function score(students: readonly SyntheticStudent[]): Scored[] {
  return students.map(({ record: r, truth }) => {
    const p = predictMarks(r);
    // What a parent reads off the catalog with no model: the school medii
    // averaged straight across, as if the exam graded the same way school does.
    const last = (list: readonly YearlyMedia[]): number => {
      const sorted = [...list].sort((a, b) => a.grade - b.grade);
      return sorted[sorted.length - 1]?.media ?? 0;
    };
    const naive = (last(r.romana) + last(r.matematica)) / 2;
    return {
      error: p.media.mean - truth.exam.media,
      naiveError: naive - truth.exam.media,
      covered: truth.exam.media >= p.media.interval[0] && truth.exam.media <= p.media.interval[1],
    };
  });
}

const mean = (xs: readonly number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;
const mae = (xs: readonly number[]): number => mean(xs.map(Math.abs));

describe('backtest against realized synthetic exams', () => {
  const perGrade = new Map<SchoolGrade, Scored[]>(
    ([5, 6, 7, 8] as const).map((grade) => [
      grade,
      score(generateStudents({ seed: 400 + grade, count: 2500, currentGrade: grade })),
    ]),
  );

  it('80% intervals cover about 80% of realized exam medias, in every grade', () => {
    for (const scored of perGrade.values()) {
      const rate = scored.filter((s) => s.covered).length / scored.length;
      expect(rate).toBeGreaterThan(0.77);
      expect(rate).toBeLessThan(0.93);
    }
  });

  it('is nearly unbiased when the world matches the calibration', () => {
    for (const scored of perGrade.values()) {
      expect(Math.abs(mean(scored.map((s) => s.error)))).toBeLessThan(0.12);
    }
  });

  it('beats reading the catalog at face value, by a wide margin', () => {
    for (const scored of perGrade.values()) {
      const model = mae(scored.map((s) => s.error));
      const naive = mae(scored.map((s) => s.naiveError));
      expect(model).toBeLessThan(naive);
      // The catalog runs one to two points hot; the whole reason this model
      // exists is that "media 9 la școală" is not "media 9 la evaluare".
      expect(naive - model).toBeGreaterThan(0.4);
    }
  });

  it('a simulare makes 8th-grade predictions sharper', () => {
    const plain = score(generateStudents({ seed: 900, count: 2500, currentGrade: 8 }));
    const withSim = score(
      generateStudents({ seed: 900, count: 2500, currentGrade: 8, withSimulare: true }),
    );
    expect(mae(withSim.map((s) => s.error))).toBeLessThan(mae(plain.map((s) => s.error)));
    // ...while keeping honest coverage.
    const rate = withSim.filter((s) => s.covered).length / withSim.length;
    expect(rate).toBeGreaterThan(0.77);
  });

  it('uses the documented uplift: exams land above simulare marks on average', () => {
    const students = generateStudents({
      seed: 901,
      count: 2000,
      currentGrade: 8,
      withSimulare: true,
    });
    const gaps = students.map(
      (s) => s.truth.exam.romana - (s.record.simulare?.romana ?? Number.NaN),
    );
    expect(mean(gaps)).toBeGreaterThan(SIMULARE_UPLIFT - 0.15);
    expect(mean(gaps)).toBeLessThan(SIMULARE_UPLIFT + 0.15);
  });
});

// --- chaining into the admission model ---------------------------------------

describe('an estimated media chains into the admission model', () => {
  const history = generateHistory({
    seed: 77,
    county: 'SB',
    years: [2023, 2024, 2025, 2026],
  }).datasets;
  const model = fitCutoffModel([...history], 2027);
  const latest = history[history.length - 1];
  const row = latest?.rows.find((r) => r.lastMedia !== null && !r.vocational);
  if (!row) throw new Error('expected a scoreable row');
  const key = specKey(row);

  it('with zero media spread, matches the exact-media prediction', () => {
    const exact = predict(model, key, 8.5);
    const chained = predict(model, key, 8.5, 0);
    expect(chained).toEqual(exact);
  });

  it('an uncertain media pulls the probability toward 0.5 — the honest direction', () => {
    const cutoff = row.lastMedia ?? 0;
    for (const media of [cutoff - 0.8, cutoff + 0.8]) {
      const exact = predict(model, key, media);
      const vague = predict(model, key, media, 0.9);
      if (exact.kind !== 'estimate' || vague.kind !== 'estimate') {
        throw new Error('expected estimates');
      }
      expect(Math.abs(vague.probability - 0.5)).toBeLessThan(Math.abs(exact.probability - 0.5));
      // Same side of the cutoff, though: vagueness hedges, it does not flip.
      expect(Math.sign(vague.probability - 0.5)).toBe(Math.sign(exact.probability - 0.5));
    }
  });
});

// --- the honest caveat ------------------------------------------------------

describe('misspecification: what synthetic validation cannot promise', () => {
  it('overpredicts when schools grade more generously than the calibration assumes', () => {
    // Give the world half a point of extra inflation the model does not know
    // about. Predictions go high and coverage suffers — this is the failure
    // mode to expect from real data, and the reason the calibration priors
    // must be re-estimated the moment real (school record, exam mark) pairs
    // are available.
    const inflated = score(
      generateStudents({ seed: 700, count: 2500, currentGrade: 8, inflationBias: 0.5 }),
    );
    expect(mean(inflated.map((s) => s.error))).toBeGreaterThan(0.3);
    const rate = inflated.filter((s) => s.covered).length / inflated.length;
    expect(rate).toBeLessThan(0.78);
  });

  it('stays calibrated when the world matches its assumptions', () => {
    const matched = score(generateStudents({ seed: 701, count: 2500, currentGrade: 8 }));
    const rate = matched.filter((s) => s.covered).length / matched.length;
    expect(rate).toBeGreaterThan(0.78);
  });
});

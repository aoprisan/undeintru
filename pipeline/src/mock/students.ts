/**
 * Synthetic students, for validating the marks model.
 *
 * The generator runs the process the marks model assumes, in the generative
 * direction: a kid has a school-record level that drifts between grades, the
 * catalog reads it with yearly noise, and at the end of grade 8 the exam marks
 * come out of the **measured** 2025 calibration — conditional mean and
 * conditional spread both read from `EVNAT_CALIBRATION`. Recovering the exam
 * media from the record is then a fair test of the machinery.
 *
 * Since the calibration is now measured rather than guessed, the synthetic
 * world is anchored to the real one at the point that matters most: kids here
 * lose the same amount between catalog and exam as real Romanian kids did in
 * 2025, and the spread around that is the real spread.
 *
 * What is still synthetic — and what these students therefore cannot validate
 * — is everything about the *trajectory*: how a record drifts between grades,
 * how noisy one year's catalog entry is, what a simulare is worth. The
 * published data carries one school number per candidate, so none of that is
 * measurable from it, and the constants for it stay priors.
 *
 * The options exist to break the model's assumptions on purpose:
 * `inflationBias` makes schools grade more generously than the calibration
 * expects, which is the misspecification most likely to be true of any
 * particular school, and the suite measures what it costs.
 *
 * The real-data check lives in `test/evnat.test.ts`, which scores the model
 * against committed 2025 candidates. This file is the machinery test; that one
 * is the accuracy test.
 */

import { Rng } from './rng.js';
import { computeMediaAdmitere } from '../util/media.js';
import {
  calibratedMean,
  calibratedSd,
  EXAM_DAY_SHARE,
  EXAM_GRADE,
  SIMULARE_SD,
  SIMULARE_UPLIFT,
  type SchoolGrade,
  type StudentRecord,
  type Subject,
  type YearlyMedia,
} from '../marks.js';

export interface StudentGenOptions {
  readonly seed: number;
  readonly count: number;
  /** The grade every generated kid is currently in. */
  readonly currentGrade: SchoolGrade;
  /** Attach simulare marks; only meaningful for grade 8. */
  readonly withSimulare?: boolean;
  /** Drift of the school-record level per year, school scale. */
  readonly driftSd?: number;
  /**
   * Extra school-scale generosity beyond what the calibration expects. Zero
   * keeps the model well-specified; positive values misspecify it the way a
   * school grading softer than the national average would.
   */
  readonly inflationBias?: number;
  /** Correlation of the two subjects' exam-day noise. */
  readonly examRho?: number;
  /** Correlation of the two subjects' standing gap to their catalog. */
  readonly abilityShockRho?: number;
  /** Correlation of the two subjects' school-record levels. */
  readonly abilityRho?: number;
}

/** What actually happened to the kid — the answer the model is scored on. */
export interface StudentTruth {
  /** The kid's true grade-8 school-record level, before catalog noise. */
  readonly ability8: { readonly romana: number; readonly matematica: number };
  readonly exam: {
    readonly romana: number;
    readonly matematica: number;
    /** (romana + matematica) / 2, truncated — the official arithmetic. */
    readonly media: number;
  };
}

export interface SyntheticStudent {
  readonly record: StudentRecord;
  readonly truth: StudentTruth;
}

/**
 * Where school records actually sit.
 *
 * Matched to the 2025 published file, whose 143,183 usable candidates average
 * 8.93 with the mass piled toward 10 (median 9.14, p10 7.61). A normal at
 * these parameters, clamped, spans the calibrated range with most kids in the
 * crowded top half — which is where getting the answer right matters, because
 * that is where the cutoffs are.
 */
const SCHOOL_LEVEL = { mean: 8.93, sd: 0.95 } as const;

/**
 * Year-over-year drift of the record, on the school scale.
 *
 * The model's `DRIFT_SD` is 0.25 in *exam* points. The measured table runs at
 * roughly 1.7 exam points per school point across its range, so the matching
 * school-scale figure is about 0.15.
 */
const SCHOOL_DRIFT_SD = 0.15;

const round2 = (v: number): number => Math.round(v * 100) / 100;
const clamp2 = (v: number): number => round2(Math.min(10, Math.max(1, v)));

/** The record level walked backwards from grade 8 to grade 5, by grade. */
function levelTrajectory(rng: Rng, level8: number, driftSd: number): Map<number, number> {
  const byGrade = new Map<number, number>([[EXAM_GRADE, level8]]);
  for (let grade = EXAM_GRADE - 1; grade >= 5; grade -= 1) {
    const next = byGrade.get(grade + 1) ?? level8;
    byGrade.set(grade, next - rng.normal(0, driftSd));
  }
  return byGrade;
}

/** One year's catalog entry: the record level, read with noise. */
const YEAR_NOISE_SD = 0.2;

function catalogEntry(rng: Rng, level: number, inflationBias: number): number {
  return clamp2(level + inflationBias + rng.normal(0, YEAR_NOISE_SD));
}

/**
 * How far a kid sits from the average kid with their record — the part of the
 * measured spread that is the kid rather than the day.
 *
 * Two kids with identical catalogs do not score the same, and the difference
 * is not all nerves: one of them is genuinely better prepared. That standing
 * difference is what a simulare can reveal and an exam-day wobble cannot, so
 * the generator draws it separately, sized by the same `EXAM_DAY_SHARE` split
 * the model uses. A world where the whole spread was exam day would be one
 * where no earlier reading could ever help, and the simulare path would be
 * untestable.
 */
function abilityOffsetFor(subject: Subject, level8: number, z: number): number {
  return Math.sqrt(1 - EXAM_DAY_SHARE) * calibratedSd(subject, level8) * z;
}

/**
 * The exam mark a kid with this record actually scores.
 *
 * Mean and spread both come from the measured 2025 table, so a synthetic kid
 * loses what a real one lost. `shock` is the standardized exam-day draw,
 * shared between subjects so a good or bad day shows up in both rooms.
 */
function examMarkFor(
  subject: Subject,
  level8: number,
  abilityOffset: number,
  shock: number,
): number {
  return clamp2(
    calibratedMean(subject, level8) +
      abilityOffset +
      Math.sqrt(EXAM_DAY_SHARE) * calibratedSd(subject, level8) * shock,
  );
}

/**
 * Generate students from a known process.
 *
 * Every kid gets a full trajectory to grade 8 — abilities, exam marks — but
 * their record only contains the school medii up to `currentGrade`, which is
 * exactly the information a real parent would have. The rest is the held-out
 * truth the model is scored against.
 */
export function generateStudents(options: StudentGenOptions): SyntheticStudent[] {
  const {
    seed,
    count,
    currentGrade,
    withSimulare = false,
    driftSd = SCHOOL_DRIFT_SD,
    inflationBias = 0,
    examRho = 0.5,
    abilityShockRho = 0.4,
    abilityRho = 0.6,
  } = options;

  if (withSimulare && currentGrade !== EXAM_GRADE) {
    throw new Error(`simulare marks exist only in grade ${EXAM_GRADE}`);
  }

  const rng = new Rng(seed);
  const students: SyntheticStudent[] = [];

  for (let i = 0; i < count; i += 1) {
    // Correlated record levels: a shared factor plus a subject-specific one.
    const shared = rng.normal();
    const zR = Math.sqrt(abilityRho) * shared + Math.sqrt(1 - abilityRho) * rng.normal();
    const zM = Math.sqrt(abilityRho) * shared + Math.sqrt(1 - abilityRho) * rng.normal();
    const level8R = clamp2(SCHOOL_LEVEL.mean + SCHOOL_LEVEL.sd * zR);
    const level8M = clamp2(SCHOOL_LEVEL.mean + SCHOOL_LEVEL.sd * zM);

    const trajR = levelTrajectory(rng, level8R, driftSd);
    const trajM = levelTrajectory(rng, level8M, driftSd);

    const romana: YearlyMedia[] = [];
    const matematica: YearlyMedia[] = [];
    for (let grade = 5 as SchoolGrade; grade <= currentGrade; grade = (grade + 1) as SchoolGrade) {
      romana.push({
        grade,
        media: catalogEntry(rng, trajR.get(grade) ?? level8R, inflationBias),
      });
      matematica.push({
        grade,
        media: catalogEntry(rng, trajM.get(grade) ?? level8M, inflationBias),
      });
    }

    // Correlated exam-day noise: a good or bad day tends to be shared.
    const day = rng.normal();
    const shockR = Math.sqrt(examRho) * day + Math.sqrt(1 - examRho) * rng.normal();
    const shockM = Math.sqrt(examRho) * day + Math.sqrt(1 - examRho) * rng.normal();
    /*
     * The standing part: how good this kid actually is, given their record.
     * Correlated across subjects but not identical — a kid ahead of their
     * catalog in română is usually, not always, ahead in matematică. Together
     * with the exam-day correlation this reproduces the 0.443 between-subject
     * residual correlation measured in the 2025 results.
     */
    const abilityShared = rng.normal();
    const zAR =
      Math.sqrt(abilityShockRho) * abilityShared +
      Math.sqrt(1 - abilityShockRho) * rng.normal();
    const zAM =
      Math.sqrt(abilityShockRho) * abilityShared +
      Math.sqrt(1 - abilityShockRho) * rng.normal();
    const offsetR = abilityOffsetFor('romana', level8R, zAR);
    const offsetM = abilityOffsetFor('matematica', level8M, zAM);
    const examR = examMarkFor('romana', level8R, offsetR, shockR);
    const examM = examMarkFor('matematica', level8M, offsetM, shockM);

    // The simulare is an earlier, independent reading of the same kid, sitting
    // below the real exam by the documented uplift.
    const simulare = withSimulare
      ? {
          romana: clamp2(
            calibratedMean('romana', level8R) +
              offsetR -
              SIMULARE_UPLIFT +
              rng.normal(0, SIMULARE_SD),
          ),
          matematica: clamp2(
            calibratedMean('matematica', level8M) +
              offsetM -
              SIMULARE_UPLIFT +
              rng.normal(0, SIMULARE_SD),
          ),
        }
      : undefined;

    students.push({
      record: { currentGrade, romana, matematica, ...(simulare ? { simulare } : {}) },
      truth: {
        ability8: { romana: level8R, matematica: level8M },
        exam: { romana: examR, matematica: examM, media: computeMediaAdmitere(examR, examM) },
      },
    });
  }

  return students;
}

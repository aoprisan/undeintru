/**
 * Synthetic students, for validating the marks model.
 *
 * Same reasoning as `generate.ts`: no real per-student data is reachable, and
 * a model that has never been scored against a known answer is a hypothesis.
 * The generator implements exactly the process the marks model assumes —
 * latent ability on the exam scale, yearly school medii as noisy inflated
 * readings of it, ability drifting between years, exam-day noise at the end —
 * so recovering the exam mark is a fair test of the machinery.
 *
 * By default every parameter mirrors the model's priors, which makes the
 * model well-specified in this world. The options exist to *break* that on
 * purpose: `inflationBias` makes schools grade more generously than the
 * calibration assumes, which is the misspecification most likely to be true
 * of reality, and the suite measures what it costs.
 *
 * Nothing here says the model is accurate about real kids. It cannot.
 */

import { Rng } from './rng.js';
import { computeMediaAdmitere } from '../util/media.js';
import {
  DRIFT_SD,
  EXAM_GRADE,
  MATEMATICA_PRIOR,
  ROMANA_PRIOR,
  SIMULARE_SD,
  SIMULARE_UPLIFT,
  type SchoolGrade,
  type StudentRecord,
  type SubjectPrior,
  type YearlyMedia,
} from '../marks.js';

export interface StudentGenOptions {
  readonly seed: number;
  readonly count: number;
  /** The grade every generated kid is currently in. */
  readonly currentGrade: SchoolGrade;
  /** Attach simulare marks; only meaningful for grade 8. */
  readonly withSimulare?: boolean;
  /** Ability drift per year, exam scale. Defaults to the model's prior. */
  readonly driftSd?: number;
  /**
   * Extra school-scale generosity beyond what the calibration line assumes.
   * Zero keeps the model well-specified; positive values misspecify it the
   * way real grade inflation would.
   */
  readonly inflationBias?: number;
  /** Correlation of the two subjects' exam-day noise. */
  readonly examRho?: number;
  /** Correlation of the two subjects' underlying abilities. */
  readonly abilityRho?: number;
}

/** What actually happened to the kid — the answer the model is scored on. */
export interface StudentTruth {
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

/** Ability distributions on the exam scale — matematică harder and wider. */
const ABILITY = {
  romana: { mean: 6.8, sd: 1.4 },
  matematica: { mean: 6.1, sd: 1.7 },
} as const;

const round2 = (v: number): number => Math.round(v * 100) / 100;
const clamp2 = (v: number): number => round2(Math.min(10, Math.max(1, v)));

/** Ability walked backwards from grade 8 to grade 5, indexed by grade. */
function abilityTrajectory(rng: Rng, ability8: number, driftSd: number): Map<number, number> {
  const byGrade = new Map<number, number>([[EXAM_GRADE, ability8]]);
  for (let grade = EXAM_GRADE - 1; grade >= 5; grade -= 1) {
    const next = byGrade.get(grade + 1) ?? ability8;
    byGrade.set(grade, next - rng.normal(0, driftSd));
  }
  return byGrade;
}

/** The school's catalog reading of an ability, per the calibration line. */
function schoolMediaFor(
  rng: Rng,
  ability: number,
  prior: SubjectPrior,
  inflationBias: number,
): number {
  const onSchoolScale = (ability - prior.intercept) / prior.slope;
  return clamp2(onSchoolScale + inflationBias + rng.normal(0, prior.yearSd));
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
    driftSd = DRIFT_SD,
    inflationBias = 0,
    examRho = 0.5,
    abilityRho = 0.6,
  } = options;

  if (withSimulare && currentGrade !== EXAM_GRADE) {
    throw new Error(`simulare marks exist only in grade ${EXAM_GRADE}`);
  }

  const rng = new Rng(seed);
  const students: SyntheticStudent[] = [];

  for (let i = 0; i < count; i += 1) {
    // Correlated abilities: a shared factor plus a subject-specific one.
    const shared = rng.normal();
    const zR = Math.sqrt(abilityRho) * shared + Math.sqrt(1 - abilityRho) * rng.normal();
    const zM = Math.sqrt(abilityRho) * shared + Math.sqrt(1 - abilityRho) * rng.normal();
    const ability8R = ABILITY.romana.mean + ABILITY.romana.sd * zR;
    const ability8M = ABILITY.matematica.mean + ABILITY.matematica.sd * zM;

    const trajR = abilityTrajectory(rng, ability8R, driftSd);
    const trajM = abilityTrajectory(rng, ability8M, driftSd);

    const romana: YearlyMedia[] = [];
    const matematica: YearlyMedia[] = [];
    for (let grade = 5 as SchoolGrade; grade <= currentGrade; grade = (grade + 1) as SchoolGrade) {
      romana.push({
        grade,
        media: schoolMediaFor(rng, trajR.get(grade) ?? ability8R, ROMANA_PRIOR, inflationBias),
      });
      matematica.push({
        grade,
        media: schoolMediaFor(rng, trajM.get(grade) ?? ability8M, MATEMATICA_PRIOR, inflationBias),
      });
    }

    // Correlated exam-day noise: a good or bad day tends to be shared.
    const day = rng.normal();
    const noiseR =
      ROMANA_PRIOR.examSd * (Math.sqrt(examRho) * day + Math.sqrt(1 - examRho) * rng.normal());
    const noiseM =
      MATEMATICA_PRIOR.examSd * (Math.sqrt(examRho) * day + Math.sqrt(1 - examRho) * rng.normal());
    const examR = clamp2(ability8R + noiseR);
    const examM = clamp2(ability8M + noiseM);

    const simulare = withSimulare
      ? {
          romana: clamp2(ability8R - SIMULARE_UPLIFT + rng.normal(0, SIMULARE_SD)),
          matematica: clamp2(ability8M - SIMULARE_UPLIFT + rng.normal(0, SIMULARE_SD)),
        }
      : undefined;

    students.push({
      record: { currentGrade, romana, matematica, ...(simulare ? { simulare } : {}) },
      truth: {
        ability8: { romana: ability8R, matematica: ability8M },
        exam: { romana: examR, matematica: examM, media: computeMediaAdmitere(examR, examM) },
      },
    });
  }

  return students;
}

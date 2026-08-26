/**
 * Predicting the exam mark itself.
 *
 * The admission model in `predict.ts` answers "will this media get my kid in"
 * — but a kid in class V–VII has no media yet, and even an 8th grader only
 * has one after the exam. What a parent *does* have is the school record.
 * This module turns that record into a predicted Evaluarea Națională media,
 * with an uncertainty band, which the admission model can then consume.
 *
 * ## Inputs
 *
 * - the grade the kid is in now (V–VIII),
 * - the yearly school media in română and matematică for each grade so far,
 * - optionally, for 8th graders, the simulare marks.
 *
 * These were chosen because they are what every parent can read off the
 * catalog, and because the eventual real datasets contain exactly the pairs
 * needed to calibrate them: admission listings publish each candidate's
 * school record alongside their exam marks.
 *
 * ## The model
 *
 * Per subject, the exam mark is modelled through a latent ability on the
 * exam scale:
 *
 *     school[y]   = inv(ability[y]) + yearly noise        (catalog is a noisy,
 *                                                          inflated reading)
 *     ability[y+1] = ability[y] + drift                   (kids change)
 *     exam        = ability[8] + exam-day noise
 *
 * `inv` is the inverse of a linear calibration `exam = intercept + slope *
 * school`. The slope is above 1 and the intercept negative: school grades run
 * higher than exam marks, and the gap widens as the school media drops — a
 * school 10 loses half a point at the exam, a school 7 in matematică loses
 * far more. The calibration constants are **priors, not measurements** (see
 * {@link ROMANA_PRIOR}); they are re-estimable from real data the moment the
 * pipeline can fetch it.
 *
 * The school years are combined with recency weights (last year counts
 * double the one before), and the predictive spread is derived from the
 * structure rather than guessed per grade: yearly catalog noise shrinks with
 * more observed years, drift variance grows with every year between the last
 * observed media and the grade-8 exam, and exam-day noise never shrinks.
 * That is why a prediction for a 5th grader is honest about being much
 * vaguer than one for an 8th grader with a simulare in hand.
 *
 * The simulare, when present, is a second, independent reading of the same
 * ability — combined precision-weighted, with a documented uplift because
 * real exam marks land above the simulare on average.
 *
 * ## What this model does not do
 *
 * It does not extrapolate a trend in the kid's grades — same reasoning as
 * the cutoff model: a slope fitted to three or four yearly medii is mostly
 * noise, and a model that projected it forward would be confidently wrong
 * every time it reversed. The trajectory enters only through the drift
 * variance, i.e. as uncertainty, not as a direction.
 */

import { Z_80 } from './predict.js';

/** The Romanian grading scale. */
const GRADE_MIN = 1;
const GRADE_MAX = 10;

/** The school grades this model covers, and the one the exam ends. */
export type SchoolGrade = 5 | 6 | 7 | 8;
export const EXAM_GRADE: SchoolGrade = 8;

export type Subject = 'romana' | 'matematica';

/** One yearly school media (medie anuală) for one subject. */
export interface YearlyMedia {
  readonly grade: SchoolGrade;
  /** 1..10. */
  readonly media: number;
}

/** Simulare marks, available only in grade 8. Either subject may be missing. */
export interface SimulareMarks {
  readonly romana?: number;
  readonly matematica?: number;
}

/** Everything the model consumes about one kid. */
export interface StudentRecord {
  readonly currentGrade: SchoolGrade;
  readonly romana: readonly YearlyMedia[];
  readonly matematica: readonly YearlyMedia[];
  readonly simulare?: SimulareMarks;
}

export class MarksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarksError';
  }
}

// --- priors -----------------------------------------------------------------

/**
 * Per-subject calibration and noise, all on documented priors.
 *
 * - `slope`/`intercept`: the school→exam line. Anchors: a school 10 lands
 *   near 9.5–9.6 at the exam; the national exam average sits one to two
 *   points below the school average, with matematică the harsher of the two.
 * - `yearSd`: how far one yearly catalog media strays from what the kid's
 *   ability implies, on the school scale.
 * - `examSd`: exam-day spread — subject choice, form, nerves.
 *
 * None of these has met real data. They are deliberately conservative
 * guesses; the real datasets (which pair each candidate's school record with
 * their exam marks) are what should replace them.
 */
export interface SubjectPrior {
  readonly slope: number;
  readonly intercept: number;
  readonly yearSd: number;
  readonly examSd: number;
}

export const ROMANA_PRIOR: SubjectPrior = {
  slope: 1.15,
  intercept: -1.9,
  yearSd: 0.45,
  examSd: 0.5,
};

export const MATEMATICA_PRIOR: SubjectPrior = {
  slope: 1.45,
  intercept: -5.0,
  yearSd: 0.5,
  examSd: 0.55,
};

/** Year-over-year spread of a kid's ability, in exam points per year. */
export const DRIFT_SD = 0.25;

/**
 * Correlation between the two subjects' prediction errors. A kid having a
 * good or bad exam day tends to have it in both rooms.
 */
export const SUBJECT_RHO = 0.35;

/**
 * Real exam marks land above the simulare on average — the simulare is graded
 * to warn, and kids study the gap between. `uplift` is added to a simulare
 * mark; `sd` is how far one simulare strays from the ability it measures.
 */
export const SIMULARE_UPLIFT = 0.35;
export const SIMULARE_SD = 0.45;

/** Each earlier school year counts half the one after it. */
const RECENCY_DECAY = 0.5;

const GRADES: readonly SchoolGrade[] = [5, 6, 7, 8];

const clamp = (v: number): number => Math.min(GRADE_MAX, Math.max(GRADE_MIN, v));

// --- validation -------------------------------------------------------------

function assertMark(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new MarksError(`${what}: expected a finite number, got ${String(value)}`);
  }
  if (value < GRADE_MIN || value > GRADE_MAX) {
    throw new MarksError(`${what}: ${value} is outside ${GRADE_MIN}..${GRADE_MAX}`);
  }
}

function assertSubjectHistory(
  entries: readonly YearlyMedia[],
  subject: Subject,
  currentGrade: SchoolGrade,
): void {
  if (entries.length === 0) {
    throw new MarksError(`${subject}: at least one yearly media is required`);
  }
  const seen = new Set<number>();
  for (const { grade, media } of entries) {
    if (!GRADES.includes(grade)) {
      throw new MarksError(`${subject}: grade ${String(grade)} is not one of V..VIII`);
    }
    if (grade > currentGrade) {
      throw new MarksError(
        `${subject}: a media for grade ${grade} cannot exist while the kid is in grade ${currentGrade}`,
      );
    }
    if (seen.has(grade)) {
      throw new MarksError(`${subject}: two medii for grade ${grade}`);
    }
    seen.add(grade);
    assertMark(media, `${subject} grade ${grade}`);
  }
}

// --- the model --------------------------------------------------------------

export interface SubjectEstimate {
  readonly subject: Subject;
  /** Recency-weighted summary of the yearly school medii. */
  readonly schoolMedia: number;
  /** Predicted exam mark, clamped to the grading scale. */
  readonly mean: number;
  readonly sd: number;
  /** 80% prediction interval, clamped to the grading scale. */
  readonly interval: readonly [number, number];
  /** Years between the newest school media and the grade-8 exam. */
  readonly horizonYears: number;
  readonly basis: 'school' | 'school+simulare';
}

export interface MarksPrediction {
  readonly currentGrade: SchoolGrade;
  readonly romana: SubjectEstimate;
  readonly matematica: SubjectEstimate;
  /** The media de admitere, (romana + matematica) / 2. */
  readonly media: {
    readonly mean: number;
    readonly sd: number;
    readonly interval: readonly [number, number];
  };
}

interface SubjectResult {
  readonly estimate: SubjectEstimate;
  /** Mean before clamping, for combining into the media. */
  readonly rawMean: number;
}

function estimateSubject(
  subject: Subject,
  entries: readonly YearlyMedia[],
  prior: SubjectPrior,
  simulareMark: number | undefined,
): SubjectResult {
  const sorted = [...entries].sort((a, b) => a.grade - b.grade);
  const last = sorted[sorted.length - 1];
  if (!last) throw new MarksError(`${subject}: at least one yearly media is required`);
  const latestGrade = last.grade;

  // Recency weights: the newest year speaks loudest about who the kid is now.
  const weights = sorted.map((e) => RECENCY_DECAY ** (latestGrade - e.grade));
  const total = weights.reduce((a, w) => a + w, 0);
  const schoolMedia =
    sorted.reduce((acc, e, i) => acc + e.media * (weights[i] ?? 0), 0) / total;

  // Catalog noise: a weighted mean of independent yearly readings has
  // spread yearSd * sqrt(sum w^2) / sum w — more observed years, less noise.
  const sumSq = weights.reduce((a, w) => a + w * w, 0);
  const yearVar = (prior.slope * prior.yearSd) ** 2 * (sumSq / (total * total));

  /*
   * Drift: each school media reads the kid's ability in *that* year, and the
   * exam happens at the end of grade 8. For the year step k -> k+1, the
   * fraction of summary weight sitting at grades <= k is how much of that
   * step's drift the summary misses. Squared and summed, this is exactly the
   * drift variance between the weighted summary and grade-8 ability: zero
   * for an 8th grader's own media, three full steps for a single 5th-grade
   * one.
   */
  let driftVar = 0;
  for (let k = 5; k < EXAM_GRADE; k += 1) {
    const behind = sorted.reduce(
      (acc, e, i) => (e.grade <= k ? acc + (weights[i] ?? 0) : acc),
      0,
    );
    driftVar += (DRIFT_SD * (behind / total)) ** 2;
  }

  // Ability estimate from the school record alone.
  let abilityMean = prior.intercept + prior.slope * schoolMedia;
  let abilityVar = yearVar + driftVar;
  let basis: SubjectEstimate['basis'] = 'school';

  if (simulareMark !== undefined) {
    // A second, independent reading of the same ability. Precision-weighted:
    // whichever reading is sharper carries more of the answer.
    const simMean = simulareMark + SIMULARE_UPLIFT;
    const simVar = SIMULARE_SD ** 2;
    const w = simVar / (abilityVar + simVar);
    abilityMean = w * abilityMean + (1 - w) * simMean;
    abilityVar = (abilityVar * simVar) / (abilityVar + simVar);
    basis = 'school+simulare';
  }

  const sd = Math.sqrt(abilityVar + prior.examSd ** 2);
  const rawMean = abilityMean;

  return {
    rawMean,
    estimate: {
      subject,
      schoolMedia,
      mean: clamp(rawMean),
      sd,
      interval: [clamp(rawMean - Z_80 * sd), clamp(rawMean + Z_80 * sd)],
      horizonYears: EXAM_GRADE - latestGrade,
      basis,
    },
  };
}

/**
 * Predict a kid's Evaluarea Națională marks and media from their school
 * record.
 *
 * @throws MarksError on a grade outside V..VIII, a media outside 1..10, a
 *   subject with no history, a media claimed for a grade the kid has not
 *   reached, duplicate grades, or simulare marks from anyone not in grade 8.
 */
export function predictMarks(record: StudentRecord): MarksPrediction {
  const { currentGrade, simulare } = record;
  if (!GRADES.includes(currentGrade)) {
    throw new MarksError(`currentGrade ${String(currentGrade)} is not one of V..VIII`);
  }
  assertSubjectHistory(record.romana, 'romana', currentGrade);
  assertSubjectHistory(record.matematica, 'matematica', currentGrade);

  const hasSimulare =
    simulare !== undefined &&
    (simulare.romana !== undefined || simulare.matematica !== undefined);
  if (hasSimulare && currentGrade !== EXAM_GRADE) {
    throw new MarksError(
      `simulare marks exist only in grade ${EXAM_GRADE}; the kid is in grade ${currentGrade}`,
    );
  }
  if (simulare?.romana !== undefined) assertMark(simulare.romana, 'simulare romana');
  if (simulare?.matematica !== undefined) assertMark(simulare.matematica, 'simulare matematica');

  const romana = estimateSubject('romana', record.romana, ROMANA_PRIOR, simulare?.romana);
  const matematica = estimateSubject(
    'matematica',
    record.matematica,
    MATEMATICA_PRIOR,
    simulare?.matematica,
  );

  // media = (romana + matematica) / 2, with the subject errors correlated:
  // var = (sd_r^2 + sd_m^2 + 2 rho sd_r sd_m) / 4.
  const sdR = romana.estimate.sd;
  const sdM = matematica.estimate.sd;
  const mediaSd = Math.sqrt(sdR * sdR + sdM * sdM + 2 * SUBJECT_RHO * sdR * sdM) / 2;
  const mediaMean = (romana.rawMean + matematica.rawMean) / 2;

  return {
    currentGrade,
    romana: romana.estimate,
    matematica: matematica.estimate,
    media: {
      mean: clamp(mediaMean),
      sd: mediaSd,
      interval: [clamp(mediaMean - Z_80 * mediaSd), clamp(mediaMean + Z_80 * mediaSd)],
    },
  };
}

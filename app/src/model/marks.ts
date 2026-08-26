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
 * The centre of it is {@link EVNAT_CALIBRATION}: the exam mark actually
 * scored, on average, by candidates whose gimnaziu record sat at each level —
 * measured on the 143,183 candidates in the published Evaluarea Națională
 * 2025 results, together with the spread around that average. A prediction
 * starts as a recency-weighted summary of the school medii a parent has, read
 * off that table.
 *
 * Three things are then layered on, in variance:
 *
 * - **record incompleteness** — the table is indexed by a full V–VIII
 *   average, so a parent holding fewer years has a noisier summary of the
 *   same kid and is owed a wider answer;
 * - **drift** — a kid who has not reached grade 8 will change before they sit
 *   the exam, and every remaining year widens the interval;
 * - **exam day** — the part of the measured spread that no earlier reading
 *   can ever remove.
 *
 * That is why a prediction for a 5th grader is honest about being much vaguer
 * than one for an 8th grader with a simulare in hand.
 *
 * The simulare, when present, is a second, independent reading of the same
 * kid — combined precision-weighted against the reducible part of the spread
 * only, with a documented uplift because real exam marks land above the
 * simulare on average.
 *
 * ## What it scores, against real candidates
 *
 * Calibrated on 2025 and tested on the 134,430 usable candidates of the
 * **2026** results — a different year, so genuinely out of sample — it lands
 * a mean error of +0.24 with 80% intervals covering 80.8%. Reading the
 * catalog at face value is off by 2.22. The version this replaced, whose
 * calibration was a pair of guessed lines, was off by +1.19 with its "80%"
 * intervals covering 43%. Full measurements in `docs/MARKS.md`.
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

// --- calibration: measured where it could be, prior where it could not ------

/**
 * The school→exam calibration. **Measured**, not assumed.
 *
 * Every knot is the average exam mark actually scored by candidates whose
 * gimnaziu average sat at that value, in the published Evaluarea Națională
 * 2025 results: 143,183 candidates, the ones present at both common papers
 * with a school average on file and not sitting a *limba maternă* paper.
 * Source and method: `pipeline/src/evnat/calibrate.ts`, regenerate with
 * `just evnat-calibrate`.
 *
 * This table replaced a pair of straight lines that had never met data. The
 * lines were optimistic by roughly a point — they put a school-8.0 kid at
 * 7.30 in română where the real average is 5.68 — and optimistic is the
 * dangerous direction here: it is the direction that tells a parent their kid
 * clears a cutoff they do not.
 *
 * ## Why a table
 *
 * Română is near-linear in the school average, but matematică is not: flat at
 * the bottom, steep at the top. A quadratic fits it better than a line and
 * then turns back **upward** below 7, predicting more for a school 5 than for
 * a school 7. Rather than pick a curve that misbehaves exactly where a worried
 * parent is looking, the estimator interpolates the measured means and clamps
 * outside the range they cover.
 *
 * ## The one link still unmeasured
 *
 * The published file records `MEDIA V-VIII`, the gimnaziu average **over all
 * subjects** — one number per candidate. It does not record per-subject school
 * medii. So the knots below are indexed by a kid's *overall* average, while
 * this model is handed their *română* and *matematică* medii separately.
 *
 * Applying the table to a per-subject media therefore assumes that media
 * tracks the kid's overall average. That assumption is this model's last
 * unmeasured joint, and it is stated rather than buried: for a kid whose
 * subject medii are lopsided — strong in one, weak in the other — the two
 * subject predictions will be further apart than the data behind this table
 * can vouch for. Closing it needs a source pairing per-subject school medii
 * with exam marks, which no published dataset currently is.
 */
export interface CalibrationKnot {
  /** Gimnaziu average V–VIII. */
  readonly schoolMedia: number;
  readonly romana: number;
  readonly romanaSd: number;
  readonly matematica: number;
  readonly matematicaSd: number;
}

export const EVNAT_CALIBRATION_YEAR = 2025;
export const EVNAT_CALIBRATION_COUNT = 143_183;

export const EVNAT_CALIBRATION: readonly CalibrationKnot[] = [
  { schoolMedia: 6.0, romana: 2.396, romanaSd: 0.943, matematica: 3.091, matematicaSd: 1.245 },
  { schoolMedia: 6.25, romana: 2.643, romanaSd: 1.013, matematica: 3.171, matematicaSd: 1.205 },
  { schoolMedia: 6.5, romana: 3.043, romanaSd: 1.104, matematica: 3.463, matematicaSd: 1.186 },
  { schoolMedia: 6.75, romana: 3.371, romanaSd: 1.144, matematica: 3.58, matematicaSd: 1.238 },
  { schoolMedia: 7.0, romana: 3.883, romanaSd: 1.248, matematica: 3.844, matematicaSd: 1.277 },
  { schoolMedia: 7.25, romana: 4.352, romanaSd: 1.259, matematica: 4.058, matematicaSd: 1.281 },
  { schoolMedia: 7.5, romana: 4.778, romanaSd: 1.283, matematica: 4.24, matematicaSd: 1.293 },
  { schoolMedia: 7.75, romana: 5.254, romanaSd: 1.262, matematica: 4.488, matematicaSd: 1.331 },
  { schoolMedia: 8.0, romana: 5.68, romanaSd: 1.229, matematica: 4.761, matematicaSd: 1.351 },
  { schoolMedia: 8.25, romana: 6.151, romanaSd: 1.202, matematica: 5.1, matematicaSd: 1.408 },
  { schoolMedia: 8.5, romana: 6.589, romanaSd: 1.167, matematica: 5.452, matematicaSd: 1.438 },
  { schoolMedia: 8.75, romana: 7.063, romanaSd: 1.094, matematica: 5.895, matematicaSd: 1.455 },
  { schoolMedia: 9.0, romana: 7.491, romanaSd: 1.033, matematica: 6.375, matematicaSd: 1.461 },
  { schoolMedia: 9.25, romana: 7.925, romanaSd: 0.94, matematica: 6.918, matematicaSd: 1.42 },
  { schoolMedia: 9.5, romana: 8.361, romanaSd: 0.821, matematica: 7.539, matematicaSd: 1.322 },
  { schoolMedia: 9.75, romana: 8.815, romanaSd: 0.699, matematica: 8.253, matematicaSd: 1.148 },
  { schoolMedia: 10.0, romana: 9.279, romanaSd: 0.515, matematica: 9.035, matematicaSd: 0.82 },
];

type KnotField = keyof Omit<CalibrationKnot, 'schoolMedia'>;

/**
 * Read the measured table at an arbitrary school media.
 *
 * Linear between knots, flat outside them. Clamping rather than extrapolating
 * is deliberate: below the lowest knot the published data thins to a few dozen
 * candidates, and a line drawn through that tail runs to a negative mark.
 */
export function calibratedValue(schoolMedia: number, field: KnotField): number {
  const first = EVNAT_CALIBRATION[0];
  const last = EVNAT_CALIBRATION[EVNAT_CALIBRATION.length - 1];
  if (!first || !last) throw new MarksError('the calibration table is empty');
  if (schoolMedia <= first.schoolMedia) return first[field];
  if (schoolMedia >= last.schoolMedia) return last[field];
  for (let i = 1; i < EVNAT_CALIBRATION.length; i += 1) {
    const hi = EVNAT_CALIBRATION[i];
    const lo = EVNAT_CALIBRATION[i - 1];
    if (!hi || !lo) continue;
    if (schoolMedia <= hi.schoolMedia) {
      const t = (schoolMedia - lo.schoolMedia) / (hi.schoolMedia - lo.schoolMedia);
      return lo[field] + t * (hi[field] - lo[field]);
    }
  }
  return last[field];
}

const MEAN_FIELD: Readonly<Record<Subject, KnotField>> = {
  romana: 'romana',
  matematica: 'matematica',
};
const SD_FIELD: Readonly<Record<Subject, KnotField>> = {
  romana: 'romanaSd',
  matematica: 'matematicaSd',
};

/** Average exam mark for a kid with this school record, per the 2025 results. */
export function calibratedMean(subject: Subject, schoolMedia: number): number {
  return calibratedValue(schoolMedia, MEAN_FIELD[subject]);
}

/**
 * Spread of the exam mark around that average — also measured.
 *
 * This is the whole conditional spread at grade 8, not just exam-day nerves:
 * it already contains everything that makes two kids with the same school
 * record score differently. It is far wider than the 0.5 the old prior
 * assumed, which is why that model's "80%" intervals covered 43% of real
 * candidates. It also varies with the record — 0.52 in română for a straight-
 * 10 kid, 1.28 mid-scale — so it is read from the table rather than fixed.
 */
export function calibratedSd(subject: Subject, schoolMedia: number): number {
  return calibratedValue(schoolMedia, SD_FIELD[subject]);
}

/**
 * Local slope of the calibration, in exam points per school point.
 *
 * Measured — it is the gradient of the table — and used to carry school-scale
 * quantities onto the exam scale where the rest of the arithmetic lives.
 */
export function calibratedSlope(subject: Subject, schoolMedia: number): number {
  const h = 0.125;
  const lo = Math.max(schoolMedia - h, 1);
  const hi = Math.min(schoolMedia + h, 10);
  if (hi <= lo) return 0;
  return (calibratedMean(subject, hi) - calibratedMean(subject, lo)) / (hi - lo);
}

/** Year-over-year spread of a kid's ability, in exam points per year. Prior. */
export const DRIFT_SD = 0.25;

/**
 * How much of the measured conditional spread is exam day, and so irreducible.
 *
 * The measured spread lumps together two things the model has to tell apart:
 * how little we know about the kid, and how much a given kid's mark moves on
 * the day. Only the first shrinks when a second reading — a simulare — comes
 * in. Treating the whole spread as reducible would let a simulare promise a
 * precision no simulare can deliver.
 *
 * The split is **not** measurable from the published file, which records one
 * exam per candidate and no simulare. This is a prior, and it is the reason a
 * simulare helps here by a bounded amount rather than collapsing the interval.
 */
export const EXAM_DAY_SHARE = 0.45;

/**
 * Yearly catalog noise, school scale. Prior.
 *
 * How far one year's entry in the catalog strays from the kid's real level.
 * Not measurable from the published file either: it carries `MEDIA V-VIII`,
 * one already-averaged number per candidate, never the four it averages.
 */
export const CATALOG_YEAR_SD = 0.3;

/**
 * Years of school record the measured table is built on.
 *
 * `MEDIA V-VIII` is itself an average over grades V–VIII, so the table's
 * spread is the spread for a kid whose record is *complete*. A parent holding
 * fewer years than that has a noisier summary of the same kid, and the model
 * owes them a wider answer — see {@link recordIncompletenessVar}.
 */
export const RECORD_YEARS = 4;

/**
 * Correlation between the two subjects' prediction errors — **measured**:
 * the correlation of română and matematică residuals about the table above,
 * over the same 143,183 candidates. A kid having a good or bad exam day tends
 * to have it in both rooms, and the data agrees more strongly than the 0.35
 * this was guessed at.
 */
export const SUBJECT_RHO = 0.443;

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

/**
 * Extra variance from holding fewer school years than the table assumes.
 *
 * The table's x-axis is an average of four yearly readings, so its spread
 * already contains the noise of a four-year average: `c^2 / 4` for yearly
 * catalog noise `c`. A weighted summary of the years a parent actually has
 * carries `c^2 * sum(w^2) / (sum w)^2` instead. The difference is what this
 * model owes on top — zero for a flat four-year record, largest for a single
 * year, and in between for a recency-weighted one.
 *
 * Carried onto the exam scale by the local slope, since `c` is a school-scale
 * quantity and everything else here is in exam points.
 */
function recordIncompletenessVar(
  subject: Subject,
  schoolMedia: number,
  weights: readonly number[],
  total: number,
): number {
  const sumSq = weights.reduce((a, w) => a + w * w, 0);
  const excess = sumSq / (total * total) - 1 / RECORD_YEARS;
  if (excess <= 0) return 0;
  return (calibratedSlope(subject, schoolMedia) * CATALOG_YEAR_SD) ** 2 * excess;
}

function estimateSubject(
  subject: Subject,
  entries: readonly YearlyMedia[],
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

  /*
   * Estimate from the school record alone, read straight off the measured
   * table.
   *
   * The measured spread is the whole conditional spread for a kid with a
   * *complete* V–VIII record, since that is what `MEDIA V-VIII` is. Two
   * corrections sit on top of it, and one split runs through it:
   *
   * - a record shorter than four years summarizes the kid more noisily, so
   *   {@link recordIncompletenessVar} widens the answer (and a full record
   *   adds nothing);
   * - a kid who has not reached grade 8 will drift before they sit the exam;
   * - of what remains, only the part that is not exam-day noise can ever be
   *   sharpened by a second reading.
   */
  const measuredVar = calibratedSd(subject, schoolMedia) ** 2;
  const examDayVar = EXAM_DAY_SHARE * measuredVar;

  let abilityMean = calibratedMean(subject, schoolMedia);
  let abilityVar =
    (1 - EXAM_DAY_SHARE) * measuredVar +
    driftVar +
    recordIncompletenessVar(subject, schoolMedia, weights, total);
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

  const sd = Math.sqrt(abilityVar + examDayVar);
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

  const romana = estimateSubject('romana', record.romana, simulare?.romana);
  const matematica = estimateSubject('matematica', record.matematica, simulare?.matematica);

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

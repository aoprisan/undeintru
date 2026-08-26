/**
 * Measuring the school-record → exam-mark relationship, from real results.
 *
 * `app/src/model/marks.ts` shipped with documented *priors* for how far school
 * grades run above exam marks, and said plainly that they had never met real
 * data. This is the module that measures them.
 *
 * ## What the published file supports, and what it does not
 *
 * The dataset pairs every candidate's exam marks with `MEDIA V-VIII` — the
 * gimnaziu average **across all subjects**, one number per candidate. So what
 * is measurable here is
 *
 *     E[exam mark in a subject | overall school average]
 *
 * and *not* `E[exam mark in română | school média in română]`, which is what
 * the model's per-subject calibration line describes. The file simply does not
 * carry per-subject school medii. Estimating one and installing it as the
 * other would be the same class of mistake as writing the HTML parser against
 * imagined markup, so the two are kept apart: this table is published as its
 * own estimator, and the per-subject constants stay labelled as priors.
 *
 * ## Why a table and not a line
 *
 * Română is near-linear against the overall average and a straight line fits
 * it (rmse 0.9718 linear, 0.9717 quadratic — no gain). Matematică is not: it
 * is flat at the bottom and steep at the top. Fitting a quadratic lowers rmse
 * (1.3415 → 1.2902) but the parabola turns back **upward** below 7, predicting
 * a *higher* exam mark for a school 5 than for a school 7. A cubic is worse.
 *
 * So the estimator is the measured conditional mean itself, on a 0.25 grid,
 * interpolated linearly between knots and clamped outside them. It cannot
 * invert, it cannot extrapolate to a negative mark, and every value in it is
 * an average of real candidates rather than a coefficient.
 *
 * ## Who is counted
 *
 * Candidates present at both common papers, with a school average recorded,
 * and **not** sitting a *limba maternă* paper. The last exclusion matters:
 * minority-language candidates take a different română syllabus and average
 * 6.22 against 7.35 for everyone else, so folding them in would bias the
 * română curve down for a reason that has nothing to do with school grades.
 */

import { isComplete, readEvnatWorkbook, type EvnatRecord } from './dataset.js';

/** Conditional mean and spread of one subject's exam mark, at one knot. */
export interface Knot {
  /** Overall school average V–VIII this knot describes. */
  readonly schoolMedia: number;
  readonly count: number;
  readonly romanaMean: number;
  readonly romanaSd: number;
  readonly matematicaMean: number;
  readonly matematicaSd: number;
}

export interface Calibration {
  readonly year: number;
  readonly source: string;
  /** Candidates the table is built from. */
  readonly count: number;
  readonly knots: readonly Knot[];
  /** Correlation of the two subjects' residuals about their conditional means. */
  readonly subjectRho: number;
}

/** Knot spacing on the school-average axis. */
export const KNOT_STEP = 0.25;
/**
 * Knots below this hold too few candidates to average, and are merged into the
 * lowest kept knot. At 0.25 spacing the 2025 file has single digits below 5.75.
 */
export const MIN_KNOT_COUNT = 150;

function toKnot(value: number): number {
  return Math.round(value / KNOT_STEP) * KNOT_STEP;
}

interface Bucket {
  romana: number[];
  matematica: number[];
}

function meanOf(values: readonly number[]): number {
  return values.reduce((a, v) => a + v, 0) / values.length;
}

function sdOf(values: readonly number[], mean: number): number {
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

/** Candidates this calibration is built from — see the module note. */
export function countsTowardCalibration(record: EvnatRecord): boolean {
  return isComplete(record) && record.limbaMaterna === null;
}

/**
 * Bin candidates by school average and average each bin.
 *
 * Bins below {@link MIN_KNOT_COUNT} are folded upward into the first bin that
 * clears it, so the bottom knot is a real average of real candidates rather
 * than a mean of eleven.
 */
export function calibrateFrom(
  records: Iterable<EvnatRecord>,
  year: number,
  source: string,
): Calibration {
  // Materialized deliberately: the table is built in one pass and the residual
  // correlation needs a second one over the same candidates. Left as a bare
  // Iterable, a generator would be spent by the first pass and the correlation
  // would silently come back from an empty set.
  const counted = [...records].filter(countsTowardCalibration);

  const buckets = new Map<number, Bucket>();
  let count = 0;
  for (const record of counted) {
    if (!isComplete(record)) continue;
    const key = toKnot(record.schoolMedia);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { romana: [], matematica: [] };
      buckets.set(key, bucket);
    }
    bucket.romana.push(record.romana);
    bucket.matematica.push(record.matematica);
    count++;
  }
  if (count === 0) throw new Error('no candidates counted toward the calibration');

  const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const merged: [number, Bucket][] = [];
  let carry: Bucket = { romana: [], matematica: [] };
  for (const [key, bucket] of ordered) {
    const romana = [...carry.romana, ...bucket.romana];
    const matematica = [...carry.matematica, ...bucket.matematica];
    if (romana.length < MIN_KNOT_COUNT) {
      carry = { romana, matematica };
      continue;
    }
    merged.push([key, { romana, matematica }]);
    carry = { romana: [], matematica: [] };
  }
  // A tail too thin to stand alone joins the last complete knot.
  if (carry.romana.length > 0 && merged.length > 0) {
    const last = merged[merged.length - 1];
    if (last) {
      last[1].romana.push(...carry.romana);
      last[1].matematica.push(...carry.matematica);
    }
  }

  const knots: Knot[] = merged.map(([schoolMedia, bucket]) => {
    const romanaMean = meanOf(bucket.romana);
    const matematicaMean = meanOf(bucket.matematica);
    return {
      schoolMedia,
      count: bucket.romana.length,
      romanaMean,
      romanaSd: sdOf(bucket.romana, romanaMean),
      matematicaMean,
      matematicaSd: sdOf(bucket.matematica, matematicaMean),
    };
  });

  return { year, source, count, knots, subjectRho: residualRho(counted, knots) };
}

/** Correlation of the residuals about the fitted conditional means. */
function residualRho(records: readonly EvnatRecord[], knots: readonly Knot[]): number {
  const romana: number[] = [];
  const matematica: number[] = [];
  for (const record of records) {
    if (!isComplete(record)) continue;
    romana.push(record.romana - interpolate(knots, record.schoolMedia, 'romanaMean'));
    matematica.push(record.matematica - interpolate(knots, record.schoolMedia, 'matematicaMean'));
  }
  const mr = meanOf(romana);
  const mm = meanOf(matematica);
  let cov = 0;
  for (let i = 0; i < romana.length; i++) {
    cov += ((romana[i] ?? 0) - mr) * ((matematica[i] ?? 0) - mm);
  }
  cov /= romana.length;
  return cov / (sdOf(romana, mr) * sdOf(matematica, mm));
}

type KnotField = 'romanaMean' | 'romanaSd' | 'matematicaMean' | 'matematicaSd';

/** Linear interpolation between knots; clamped to the end knots outside them. */
export function interpolate(
  knots: readonly Knot[],
  schoolMedia: number,
  field: KnotField,
): number {
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (!first || !last) throw new Error('calibration has no knots');
  if (schoolMedia <= first.schoolMedia) return first[field];
  if (schoolMedia >= last.schoolMedia) return last[field];
  for (let i = 1; i < knots.length; i++) {
    const hi = knots[i];
    const lo = knots[i - 1];
    if (!hi || !lo) continue;
    if (schoolMedia <= hi.schoolMedia) {
      const t = (schoolMedia - lo.schoolMedia) / (hi.schoolMedia - lo.schoolMedia);
      return lo[field] + t * (hi[field] - lo[field]);
    }
  }
  return last[field];
}

/** Stream the workbook once, keeping only what the calibration needs. */
export async function calibrateWorkbook(
  path: string,
  year: number,
  source: string,
): Promise<Calibration> {
  const kept: EvnatRecord[] = [];
  for await (const record of readEvnatWorkbook(path)) {
    if (countsTowardCalibration(record)) kept.push(record);
  }
  return calibrateFrom(kept, year, source);
}

/** The measured table, as the TypeScript literal that goes into marks.ts. */
export function formatCalibration(calibration: Calibration): string {
  const rows = calibration.knots
    .map(
      (k) =>
        `  { schoolMedia: ${k.schoolMedia.toFixed(2)}, romana: ${k.romanaMean.toFixed(3)}, ` +
        `romanaSd: ${k.romanaSd.toFixed(3)}, matematica: ${k.matematicaMean.toFixed(3)}, ` +
        `matematicaSd: ${k.matematicaSd.toFixed(3)} }, // n = ${k.count}`,
    )
    .join('\n');
  return (
    `// Measured from ${calibration.count.toLocaleString('en-US')} candidates, ` +
    `Evaluarea Națională ${calibration.year}.\n` +
    `// ${calibration.source}\n` +
    `export const EVNAT_CALIBRATION = [\n${rows}\n] as const;\n` +
    `export const SUBJECT_RHO = ${calibration.subjectRho.toFixed(3)};\n`
  );
}

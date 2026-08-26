/**
 * Synthetic admission data.
 *
 * This exists for one reason: the real source is unreachable, and a prediction
 * model that has never been run end to end is not a model, it is a hypothesis.
 * Synthetic data lets us check that the estimator recovers parameters it is
 * given, that its intervals have the coverage they claim, and that the app
 * renders a probability correctly — none of which needs real cutoffs.
 *
 * What it emphatically does **not** do is tell us the model is accurate about
 * Romanian high schools. Data generated from the model's own assumptions can
 * only validate the machinery. Real accuracy is unknown until real data exists.
 *
 * Every dataset produced here is stamped `provenance: 'synthetic'`, carries no
 * source URLs, and uses school names no Romanian county has. That is
 * deliberate and load-bearing — see `app/src/data/schema.ts`.
 */

import { normalizeText } from '../util/diacritics.js';
import { truncateToTwoDecimals } from '../util/media.js';
import { Rng } from './rng.js';
import {
  MEDIA_FORMULA_EPOCH_YEAR,
  type AdmissionRow,
  type CountyDataset,
  type Filiera,
} from '../schema.js';

/**
 * Obviously-fictional school names. Greek letters, so nobody mistakes a
 * generated cutoff for a statement about a real school.
 */
const SCHOOL_STEMS = [
  'Alfa',
  'Beta',
  'Gama',
  'Delta',
  'Epsilon',
  'Zeta',
  'Eta',
  'Theta',
  'Iota',
  'Kappa',
  'Lambda',
  'Miu',
  'Niu',
  'Xi',
  'Omicron',
  'Pi',
  'Rho',
  'Sigma',
  'Tau',
  'Upsilon',
] as const;

const SCHOOL_KINDS = [
  'Colegiul Național',
  'Liceul Teoretic',
  'Colegiul Tehnic',
  'Liceul Tehnologic',
] as const;

interface SpecTemplate {
  readonly label: string;
  readonly profile: string;
  readonly filiera: Filiera;
  /** Rough demand, driving the base cutoff. */
  readonly appeal: 'high' | 'mid' | 'low';
}

const SPEC_TEMPLATES: readonly SpecTemplate[] = [
  { label: 'Matematică-Informatică', profile: 'Real', filiera: 'teoretica', appeal: 'high' },
  { label: 'Matematică-Informatică intensiv', profile: 'Real', filiera: 'teoretica', appeal: 'high' },
  { label: 'Științe ale naturii', profile: 'Real', filiera: 'teoretica', appeal: 'high' },
  { label: 'Filologie', profile: 'Uman', filiera: 'teoretica', appeal: 'mid' },
  { label: 'Științe sociale', profile: 'Uman', filiera: 'teoretica', appeal: 'mid' },
  { label: 'Economic', profile: 'Servicii', filiera: 'tehnologica', appeal: 'mid' },
  { label: 'Turism și alimentație', profile: 'Servicii', filiera: 'tehnologica', appeal: 'low' },
  { label: 'Tehnician mecanic', profile: 'Tehnic', filiera: 'tehnologica', appeal: 'low' },
  { label: 'Tehnician electrician', profile: 'Tehnic', filiera: 'tehnologica', appeal: 'low' },
  { label: 'Construcții și instalații', profile: 'Tehnic', filiera: 'tehnologica', appeal: 'low' },
  { label: 'Muzică', profile: 'Artistic', filiera: 'vocationala', appeal: 'mid' },
  { label: 'Arte plastice', profile: 'Artistic', filiera: 'vocationala', appeal: 'mid' },
];

/**
 * Mean starting cutoff by appeal, in media points.
 *
 * Kept clear of the 10.0 ceiling on purpose. A cutoff that clamps at the top
 * stays pinned there year after year, which makes its year-over-year change
 * exactly zero and turns any "did this media clear it" comparison degenerate.
 * Real cutoffs do bunch near 9.9, but a generator that reproduces that
 * bunching would be measuring the clamp rather than the model.
 */
const BASE_BY_APPEAL: Readonly<Record<SpecTemplate['appeal'], number>> = {
  high: 8.7,
  mid: 7.7,
  low: 6.2,
};

export interface GenerateOptions {
  readonly seed: number;
  readonly county: string;
  /** Years to generate, ascending. All must be in the current formula epoch. */
  readonly years: readonly number[];
  /** How many specializations across all schools. */
  readonly specCount?: number;
  /** True spread of the county-wide year shift. */
  readonly tau?: number;
  /** True spread of specialization-level noise. */
  readonly sigma?: number;
  /**
   * A systematic year-over-year trend. Zero by default, matching the model's
   * random-walk assumption; set it to deliberately misspecify the model and
   * see what that costs.
   */
  readonly drift?: number;
  /** Probability that a low-appeal specialization fails to fill in a year. */
  readonly unfilledRate?: number;
}

/** The parameters the data was actually generated from. */
export interface GroundTruth {
  readonly tau: number;
  readonly sigma: number;
  readonly drift: number;
  /** The county-wide shift actually drawn for each year after the first. */
  readonly shifts: readonly { year: number; shift: number }[];
}

export interface GeneratedHistory {
  readonly datasets: readonly CountyDataset[];
  readonly truth: GroundTruth;
}

interface SpecSlot {
  readonly schoolCode: string;
  readonly schoolName: string;
  readonly specId: string;
  readonly template: SpecTemplate;
  readonly seats: number;
  /** Chance this one fails to fill in any given year. */
  readonly unfilledChance: number;
  /** Cutoff in the first generated year, before the walk starts. */
  base: number;
}

const clampMedia = (v: number): number => truncateToTwoDecimals(Math.min(10, Math.max(1, v)));

/**
 * Generate a county's admission history from a known process.
 *
 * The process is exactly the one the model assumes — a random walk with a
 * shared per-year shift plus per-specialization noise — so that recovering
 * `tau` and `sigma` is a fair test of the estimator rather than of luck.
 *
 * @throws Error if any year predates the media-formula epoch, which would make
 *   the generated cutoffs incomparable by the project's own rules.
 */
export function generateHistory(options: GenerateOptions): GeneratedHistory {
  const {
    seed,
    county,
    years,
    specCount = 48,
    tau = 0.12,
    sigma = 0.22,
    drift = 0,
    unfilledRate = 0.35,
  } = options;

  if (years.length === 0) throw new Error('generateHistory needs at least one year');
  for (const year of years) {
    if (year < MEDIA_FORMULA_EPOCH_YEAR) {
      throw new Error(
        `year ${year} predates the ${MEDIA_FORMULA_EPOCH_YEAR} media formula change; ` +
          'generating it would produce cutoffs that are not comparable with the rest',
      );
    }
  }

  const rng = new Rng(seed);
  const ordered = [...years].sort((a, b) => a - b);

  // --- build the school/specialization roster, stable across years ---
  const slots: SpecSlot[] = [];
  let schoolIndex = 0;
  while (slots.length < specCount) {
    const stem = SCHOOL_STEMS[schoolIndex % SCHOOL_STEMS.length] ?? 'Alfa';
    const kind = SCHOOL_KINDS[schoolIndex % SCHOOL_KINDS.length] ?? 'Liceul Teoretic';
    const schoolCode = `${county}${String(100 + schoolIndex)}`;
    const schoolName = normalizeText(`${kind} ${stem}`);
    // A school's quality shifts all of its specializations together.
    const schoolQuality = rng.normal(0, 0.45);

    const perSchool = rng.int(2, 4);
    for (let j = 0; j < perSchool && slots.length < specCount; j += 1) {
      const template = rng.pick(SPEC_TEMPLATES);
      const base = BASE_BY_APPEAL[template.appeal] + schoolQuality + rng.normal(0, 0.3);
      slots.push({
        schoolCode,
        schoolName,
        specId: `${schoolCode}-${String(j + 1).padStart(2, '0')}`,
        template,
        seats: rng.int(6, 14) * 2,
        unfilledChance: template.appeal === 'low' ? unfilledRate : 0,
        base: Math.min(9.3, Math.max(5, base)),
      });
    }
    schoolIndex += 1;
  }

  // --- walk the cutoffs forward ---
  const shifts: { year: number; shift: number }[] = [];
  const current = new Map(slots.map((s) => [s.specId, s.base]));
  const datasets: CountyDataset[] = [];

  ordered.forEach((year, index) => {
    if (index > 0) {
      const shift = rng.normal(drift, tau);
      shifts.push({ year, shift });
      for (const slot of slots) {
        const previous = current.get(slot.specId) ?? slot.base;
        current.set(slot.specId, previous + shift + rng.normal(0, sigma));
      }
    }

    const rows: AdmissionRow[] = slots.map((slot) => {
      const raw = current.get(slot.specId) ?? slot.base;
      const unfilled = rng.chance(slot.unfilledChance);
      return {
        year,
        county,
        schoolCode: slot.schoolCode,
        schoolName: slot.schoolName,
        specId: slot.specId,
        specLabel: normalizeText(slot.template.label),
        profile: slot.template.profile,
        filiera: slot.template.filiera,
        limba: 'Româna',
        seats: slot.seats,
        lastMedia: unfilled ? null : clampMedia(raw),
        vocational: slot.template.filiera === 'vocationala',
      };
    });

    rows.sort(
      (a, b) =>
        a.schoolName.localeCompare(b.schoolName, 'ro') ||
        a.schoolCode.localeCompare(b.schoolCode) ||
        a.specId.localeCompare(b.specId),
    );

    datasets.push({
      schemaVersion: 1,
      year,
      county,
      generatedAt: new Date(Date.UTC(year, 7, 1)).toISOString(),
      provenance: 'synthetic',
      sources: [],
      rows,
    });
  });

  return { datasets, truth: { tau, sigma, drift, shifts } };
}

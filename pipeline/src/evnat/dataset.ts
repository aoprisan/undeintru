/**
 * The Evaluarea Națională open dataset: rows in, validated records out.
 *
 * Source: the Ministry of Education's yearly "Rezultate la Evaluarea
 * Naționala" publication on data.gov.ro, CC-BY 4.0. See
 * `pipeline/fixtures/evnat/README.md` for the published column list and for
 * what is committed.
 *
 * This is the first real data in the repo. The cutoff pages on
 * admitere.edu.ro are still unreachable (`docs/STATUS.md`), so nothing here
 * produces admission cutoffs — what it produces is every candidate's exam
 * marks paired with their school record, which is what the marks model in
 * `app/src/model/marks.ts` needed in order to stop running on priors.
 *
 * The rule from the HTML parser applies unchanged: when the file is not what
 * we expect, throw and name the file. A national dataset that silently loses a
 * column is worse than one that fails to load.
 */

import { computeMediaAdmitere } from '../util/media.js';
import { readSheetRows } from './xlsx.js';

export class EvnatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvnatError';
  }
}

/**
 * SIIIR school codes open with the county's ordinal.
 *
 * The numbering is the long-standing Romanian one: alphabetical over the 40
 * counties that existed in 1968 with București last at 40, then Călărași and
 * Giurgiu appended at 51 and 52 when they were created in 1981. It is *not*
 * plain alphabetical order over today's 42 — Călărași and Giurgiu sort into
 * the C and G runs by name but not by number.
 *
 * Checked against the 2025 file, which carries exactly 01–40, 51 and 52 and
 * nothing else. Two independent signals confirm the assignment rather than
 * assuming it: the counties this table calls Harghita and Covasna are the two
 * where candidates sitting a *limba maternă* paper are the majority (86.0% and
 * 69.4%), which is true of Harghita and Covasna and of nowhere else in
 * Romania; and the ordering by candidate count reproduces the known population
 * ranking, București first at 17,527.
 */
export const COUNTY_BY_SIIIR_PREFIX: Readonly<Record<string, string>> = {
  '01': 'AB', '02': 'AR', '03': 'AG', '04': 'BC', '05': 'BH', '06': 'BN',
  '07': 'BT', '08': 'BV', '09': 'BR', '10': 'BZ', '11': 'CS', '12': 'CJ',
  '13': 'CT', '14': 'CV', '15': 'DB', '16': 'DJ', '17': 'GL', '18': 'GJ',
  '19': 'HR', '20': 'HD', '21': 'IL', '22': 'IS', '23': 'IF', '24': 'MM',
  '25': 'MH', '26': 'MS', '27': 'NT', '28': 'OT', '29': 'PH', '30': 'SM',
  '31': 'SJ', '32': 'SB', '33': 'SV', '34': 'TR', '35': 'TM', '36': 'TL',
  '37': 'VS', '38': 'VL', '39': 'VN', '40': 'B', '51': 'CL', '52': 'GR',
};

/** One candidate, as far as this repo is concerned. */
export interface EvnatRecord {
  readonly county: string;
  readonly urban: boolean;
  /** Final mark after contestații, or null when absent from that paper. */
  readonly romana: number | null;
  /** Non-null only for candidates who sat the minority-language paper. */
  readonly limbaMaterna: number | null;
  readonly matematica: number | null;
  /** The ministry's own published media de admitere. */
  readonly media: number | null;
  /** Gimnaziu average over grades V–VIII, across all subjects. */
  readonly schoolMedia: number | null;
}

/** A record with everything the calibration needs, narrowed for the compiler. */
export interface CompleteRecord extends EvnatRecord {
  readonly romana: number;
  readonly matematica: number;
  readonly media: number;
  readonly schoolMedia: number;
}

export function isComplete(record: EvnatRecord): record is CompleteRecord {
  return (
    record.romana !== null &&
    record.matematica !== null &&
    record.media !== null &&
    record.schoolMedia !== null
  );
}

/** Header labels carry stray spaces in the published file (" COD SIIIR"). */
const COLUMNS = {
  siiir: 'COD SIIIR',
  mediu: 'MEDIU',
  romana: 'NOTA FINALA ROMANA',
  limbaMaterna: 'NOTA FINALA LB MATERNA',
  matematica: 'NOTA FINALA MATEMATICA',
  media: 'MEDIA',
  schoolMedia: 'MEDIA V-VIII',
} as const;

type ColumnKey = keyof typeof COLUMNS;

function locateColumns(header: readonly string[], source: string): Record<ColumnKey, number> {
  const seen = header.map((h) => h.trim().toUpperCase());
  const located = {} as Record<ColumnKey, number>;
  for (const [key, label] of Object.entries(COLUMNS) as [ColumnKey, string][]) {
    const at = seen.indexOf(label);
    if (at < 0) {
      throw new EvnatError(
        `${source}: no "${label}" column. Header was: ${seen.join(' | ')}\n` +
          'The published layout changed — update pipeline/src/evnat/dataset.ts against the new file.',
      );
    }
    located[key] = at;
  }
  return located;
}

/**
 * A grade cell, to the two decimals grades actually carry.
 *
 * The workbook stores these as doubles, and they come back with the noise that
 * implies: the sheet holds `8.1300000000000008` for a school media of 8.13.
 * Rounding to two decimals at the boundary is what keeps that noise out of
 * every number derived downstream — the same concern `util/media.ts` has, one
 * layer earlier.
 */
function parseGrade(raw: string, what: string, source: string): number | null {
  const text = raw.trim();
  if (text === '' || text === '-') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new EvnatError(`${source}: ${what} is ${JSON.stringify(raw)}, which is not a number`);
  }
  const rounded = Math.round(value * 100) / 100;
  if (rounded < 1 || rounded > 10) {
    throw new EvnatError(`${source}: ${what} is ${rounded}, outside the 1..10 grading scale`);
  }
  return rounded;
}

function toRecord(
  row: readonly string[],
  at: Record<ColumnKey, number>,
  source: string,
): EvnatRecord {
  const code = (row[at.siiir] ?? '').trim();
  const prefix = code.slice(0, 2);
  const county = COUNTY_BY_SIIIR_PREFIX[prefix];
  if (county === undefined) {
    throw new EvnatError(
      `${source}: SIIIR code ${JSON.stringify(code)} opens with ${JSON.stringify(prefix)}, ` +
        'which is not one of the 42 county prefixes.',
    );
  }
  return {
    county,
    urban: (row[at.mediu] ?? '').trim().toUpperCase() === 'URBAN',
    romana: parseGrade(row[at.romana] ?? '', 'nota finala romana', source),
    limbaMaterna: parseGrade(row[at.limbaMaterna] ?? '', 'nota finala limba materna', source),
    matematica: parseGrade(row[at.matematica] ?? '', 'nota finala matematica', source),
    media: parseGrade(row[at.media] ?? '', 'media', source),
    schoolMedia: parseGrade(row[at.schoolMedia] ?? '', 'media V-VIII', source),
  };
}

/** Stream the published workbook as records. */
export async function* readEvnatWorkbook(path: string): AsyncGenerator<EvnatRecord> {
  let at: Record<ColumnKey, number> | null = null;
  for await (const row of readSheetRows(path)) {
    if (at === null) {
      at = locateColumns(row, path);
      continue;
    }
    yield toRecord(row, at, path);
  }
  if (at === null) throw new EvnatError(`${path}: the sheet is empty`);
}

/**
 * Recompute a candidate's media and compare with the published one.
 *
 * This is the check that earned `computeMediaAdmitere` its third argument: run
 * over the whole 2025 file, the two-subject formula disagrees with the
 * ministry on 9,024 rows, every one of them a candidate who sat a *limba
 * maternă* paper.
 */
export function checkMedia(record: EvnatRecord): 'ok' | 'mismatch' | 'incomplete' {
  const { romana, matematica, limbaMaterna, media } = record;
  if (romana === null || matematica === null || media === null) return 'incomplete';
  return computeMediaAdmitere(romana, matematica, limbaMaterna) === media ? 'ok' : 'mismatch';
}

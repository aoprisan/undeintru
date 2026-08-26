/**
 * The Evaluarea Națională open-data commands: download, verify, calibrate,
 * and regenerate the committed samples.
 *
 * Network-only, like `just fetch`. `assertNetworkAllowed()` guards the one
 * function that reaches out, so a test that wandered in here would fail rather
 * than quietly download 16 MB from data.gov.ro.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';

import { assertNetworkAllowed } from '../fetch.js';
import { FIXTURES_DIR, PIPELINE_ROOT } from '../paths.js';
import { calibrateFrom, formatCalibration, countsTowardCalibration } from './calibrate.js';
import { checkMedia, isComplete, readEvnatWorkbook, type EvnatRecord } from './dataset.js';

/** Where downloaded workbooks land. Gitignored, like `pipeline/raw/`. */
export const EVNAT_DIR = resolve(PIPELINE_ROOT, 'raw', 'evnat');
export const EVNAT_FIXTURES_DIR = join(FIXTURES_DIR, 'evnat');

/**
 * The published workbook for each year, by resource URL.
 *
 * These are recorded rather than derived: data.gov.ro resource URLs carry
 * opaque UUIDs and a dated filename, so there is no template to guess. Each
 * was read off the dataset's own API listing. Add a year by looking it up at
 * https://data.gov.ro/dataset?q=evaluare+nationala — do not invent a URL.
 */
export const EVNAT_SOURCES: Readonly<Record<number, string>> = {
  2024:
    'https://data.gov.ro/dataset/5b6d91d4-1e9c-40ff-91d5-2ac1d0056667/resource/' +
    '39eefd94-485e-4ddf-86c8-c0395689b949/download/2024.09.30_evnat_2024_date-deschise.xlsx',
  2025:
    'https://data.gov.ro/dataset/6fa8dcf3-3d08-4a32-9f88-8dbf77062c7a/resource/' +
    '182f732d-4303-4985-9499-814a8789adba/download/2025.10.01_evnat_2025_date-deschise.xlsx',
  2026:
    'https://data.gov.ro/dataset/394c5432-bb13-485d-80c3-5bfd96e7b906/resource/' +
    'e5672a85-6457-4cfd-b132-3307a70a10bc/download/2026.08.13_evnat_2026_date-deschise.xlsx',
};

/** The year the shipped calibration in `app/src/model/marks.ts` was measured on. */
export const CALIBRATION_YEAR = 2025;

export function sourceFor(year: number): string {
  const url = EVNAT_SOURCES[year];
  if (url === undefined) {
    throw new Error(
      `No recorded source for Evaluarea Națională ${year}. ` +
        `Known years: ${Object.keys(EVNAT_SOURCES).join(', ')}.\n` +
        'Look the resource up at https://data.gov.ro/dataset?q=evaluare+nationala ' +
        'and add it to EVNAT_SOURCES — do not guess the URL.',
    );
  }
  return url;
}

export function workbookPath(year: number): string {
  return join(EVNAT_DIR, `evnat-${year}.xlsx`);
}

/** Download a year's workbook, unless it is already on disk. */
export async function download(year: number): Promise<string> {
  const target = workbookPath(year);
  try {
    const info = await stat(target);
    if (info.size > 0) {
      process.stdout.write(`Cached ${target} (${info.size} bytes)\n`);
      return target;
    }
  } catch {
    // not downloaded yet
  }

  assertNetworkAllowed();
  const url = sourceFor(year);
  process.stdout.write(`Downloading ${url}\n`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
  }
  await mkdir(dirname(target), { recursive: true });
  await streamPipeline(Readable.fromWeb(response.body), createWriteStream(target));
  process.stdout.write(`Wrote ${target}\n`);
  return target;
}

async function collect(path: string): Promise<EvnatRecord[]> {
  const records: EvnatRecord[] = [];
  for await (const record of readEvnatWorkbook(path)) records.push(record);
  return records;
}

/**
 * Recompute every candidate's media and compare with the published one.
 *
 * This is the check behind the three-subject rule in `util/media.ts`. It exits
 * non-zero on any mismatch: a disagreement with the ministry's own arithmetic
 * means our formula is wrong, and every cutoff comparison downstream is too.
 */
export async function verify(year: number): Promise<void> {
  const path = await download(year);
  let two = 0;
  let three = 0;
  let incomplete = 0;
  const mismatches: EvnatRecord[] = [];

  for await (const record of readEvnatWorkbook(path)) {
    switch (checkMedia(record)) {
      case 'ok':
        if (record.limbaMaterna === null) two += 1;
        else three += 1;
        break;
      case 'mismatch':
        mismatches.push(record);
        break;
      default:
        incomplete += 1;
    }
  }

  const total = two + three;
  process.stdout.write(
    `\nEvaluarea Națională ${year}\n` +
      `  two-subject rows  : ${two.toLocaleString('en-US')}\n` +
      `  three-subject rows: ${three.toLocaleString('en-US')}\n` +
      `  total reproduced  : ${total.toLocaleString('en-US')}\n` +
      `  no media published: ${incomplete.toLocaleString('en-US')}\n` +
      `  mismatches        : ${mismatches.length.toLocaleString('en-US')}\n`,
  );

  if (mismatches.length > 0) {
    for (const bad of mismatches.slice(0, 10)) {
      process.stderr.write(
        `  ${bad.county}: romana=${String(bad.romana)} materna=${String(bad.limbaMaterna)} ` +
          `matematica=${String(bad.matematica)} published=${String(bad.media)}\n`,
      );
    }
    throw new Error(
      `${mismatches.length} candidates whose published media we cannot reproduce. ` +
        'computeMediaAdmitere disagrees with the ministry — fix the formula, not the data.',
    );
  }
}

/** Fit the school-record → exam-mark table and print it as TypeScript. */
export async function calibrate(year: number): Promise<void> {
  const path = await download(year);
  const records = await collect(path);
  const calibration = calibrateFrom(records, year, sourceFor(year));
  process.stdout.write(
    `\nCalibrated on ${calibration.count.toLocaleString('en-US')} candidates ` +
      `(${calibration.knots.length} knots).\n` +
      'Paste into app/src/model/marks.ts:\n\n',
  );
  process.stdout.write(formatCalibration(calibration));
}

const MEDIA_FIXTURE = 'evnat-2025-sample.csv';
const BACKTEST_FIXTURE = 'evnat-2026-backtest.csv';

/** Evenly spaced picks from a sorted list — deterministic, no RNG. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)] as T);
}

const two = (value: number): string => value.toFixed(2);

/**
 * Regenerate the committed samples.
 *
 * Deterministic by construction: candidates are sorted by their grades and
 * picked at even intervals, so re-running produces the same file. Nothing
 * identifying is carried over — grades only, never `COD UNIC CANDIDAT`.
 */
export async function sample(mediaYear = 2025, backtestYear = 2026): Promise<void> {
  await mkdir(EVNAT_FIXTURES_DIR, { recursive: true });

  const mediaRecords = await collect(await download(mediaYear));
  const hundredths = (value: number): number => Math.round(value * 100);
  const buckets: Record<string, EvnatRecord[]> = {
    twoTruncating: [],
    twoExact: [],
    threeTruncating: [],
    threeExact: [],
  };
  for (const record of mediaRecords) {
    const { romana, matematica, limbaMaterna, media } = record;
    if (romana === null || matematica === null || media === null) continue;
    if (limbaMaterna === null) {
      const sum = hundredths(romana) + hundredths(matematica);
      buckets[sum % 2 === 0 ? 'twoExact' : 'twoTruncating']?.push(record);
    } else {
      const sum = hundredths(romana) + hundredths(limbaMaterna) + hundredths(matematica);
      buckets[sum % 3 === 0 ? 'threeExact' : 'threeTruncating']?.push(record);
    }
  }
  const key = (r: EvnatRecord): string =>
    `${two(r.romana ?? 0)}|${r.limbaMaterna === null ? '' : two(r.limbaMaterna)}|${two(r.matematica ?? 0)}`;
  const sortUnique = (list: readonly EvnatRecord[]): EvnatRecord[] => {
    const byKey = new Map<string, EvnatRecord>();
    for (const r of list) byKey.set(key(r), r);
    return [...byKey.values()].sort((a, b) => key(a).localeCompare(key(b)));
  };

  const mediaRows = [
    ...spread(sortUnique(buckets['twoTruncating'] ?? []), 220),
    ...spread(sortUnique(buckets['twoExact'] ?? []), 110),
    ...spread(sortUnique(buckets['threeTruncating'] ?? []), 220),
    ...spread(sortUnique(buckets['threeExact'] ?? []), 110),
  ].sort((a, b) => key(a).localeCompare(key(b)));

  const mediaCsv = [
    'nota_finala_romana,nota_finala_limba_materna,nota_finala_matematica,media',
    ...mediaRows.map((r) =>
      [
        two(r.romana ?? 0),
        r.limbaMaterna === null ? '' : two(r.limbaMaterna),
        two(r.matematica ?? 0),
        two(r.media ?? 0),
      ].join(','),
    ),
  ].join('\n');
  await writeFile(join(EVNAT_FIXTURES_DIR, MEDIA_FIXTURE), `${mediaCsv}\n`, 'utf8');
  await writeFile(
    join(EVNAT_FIXTURES_DIR, `${MEDIA_FIXTURE}.url`),
    `${sourceFor(mediaYear)}\n`,
    'utf8',
  );
  process.stdout.write(`Wrote ${MEDIA_FIXTURE} (${mediaRows.length} rows)\n`);

  // The backtest sample deliberately comes from a *different* year than the
  // calibration, so the committed test is out-of-sample rather than a
  // restatement of the fit.
  const backtestRecords = (await collect(await download(backtestYear)))
    .filter((r) => countsTowardCalibration(r) && isComplete(r))
    .sort((a, b) =>
      a.schoolMedia === b.schoolMedia
        ? (a.romana ?? 0) - (b.romana ?? 0) || (a.matematica ?? 0) - (b.matematica ?? 0)
        : (a.schoolMedia ?? 0) - (b.schoolMedia ?? 0),
    );
  const backtestRows = spread(backtestRecords, 4000);
  const backtestCsv = [
    'media_v_viii,nota_finala_romana,nota_finala_matematica,media',
    ...backtestRows.map((r) =>
      [two(r.schoolMedia ?? 0), two(r.romana ?? 0), two(r.matematica ?? 0), two(r.media ?? 0)].join(
        ',',
      ),
    ),
  ].join('\n');
  await writeFile(join(EVNAT_FIXTURES_DIR, BACKTEST_FIXTURE), `${backtestCsv}\n`, 'utf8');
  await writeFile(
    join(EVNAT_FIXTURES_DIR, `${BACKTEST_FIXTURE}.url`),
    `${sourceFor(backtestYear)}\n`,
    'utf8',
  );
  process.stdout.write(`Wrote ${BACKTEST_FIXTURE} (${backtestRows.length} rows)\n`);
}

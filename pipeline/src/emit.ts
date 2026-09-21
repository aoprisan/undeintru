/**
 * normalized rows -> published data.
 *
 * Reads every `pipeline/normalized/<year>/<county>.json`, validates it against
 * the shared schema, and writes `app/public/data/v1/<year>/<county>.json` plus
 * an index. Validation happens before any file is written: a bad dataset must
 * not half-publish.
 */

import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { NORMALIZED_DIR, PUBLIC_DATA_DIR } from './paths.js';
import type { NormalizedFile } from './normalize.js';
import {
  assertCountyDataset,
  assertDatasetIndex,
  SCHEMA_VERSION,
  type CountyDataset,
  type DatasetIndex,
  type DatasetIndexEntry,
} from './schema.js';

export interface EmitOptions {
  readonly normalizedDir?: string;
  readonly outDir?: string;
  /**
   * Timestamp stamped into the emitted files. Injected so tests can assert on
   * exact bytes.
   */
  readonly now?: Date;
}

export interface EmitResult {
  readonly datasets: readonly { path: string; rowCount: number }[];
  readonly indexPath: string;
}

/** A year directory holding one JSON file per county. */
async function listNormalized(dir: string): Promise<{ year: number; file: string }[]> {
  let years: string[];
  try {
    years = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }

  const out: { year: number; file: string }[] = [];
  for (const name of years.sort()) {
    const year = Number(name);
    if (!Number.isInteger(year)) continue;
    const yearDir = join(dir, name);
    // A discovered year must be readable: skipping it would delete its
    // previously published data when the complete generation is installed.
    const files = await readdir(yearDir);
    for (const f of files.filter((f) => f.endsWith('.json')).sort()) {
      out.push({ year, file: join(yearDir, f) });
    }
  }
  return out;
}

/** Turn a normalized file into the published dataset shape and validate it. */
export function toCountyDataset(normalized: NormalizedFile, generatedAt: string): CountyDataset {
  const candidate = {
    schemaVersion: SCHEMA_VERSION,
    year: normalized.year,
    county: normalized.county,
    generatedAt,
    provenance: normalized.provenance,
    sources: normalized.sources,
    rows: normalized.rows,
  };
  return assertCountyDataset(candidate, `${normalized.county}/${normalized.year}`);
}

/**
 * Publish every normalized dataset.
 *
 * @throws SchemaValidationError if any dataset is invalid -- nothing is written
 *   in that case.
 */
export async function emit(options: EmitOptions = {}): Promise<EmitResult> {
  const {
    normalizedDir = NORMALIZED_DIR,
    outDir = PUBLIC_DATA_DIR,
    now = new Date(),
  } = options;
  const generatedAt = now.toISOString();

  const inputs = await listNormalized(normalizedDir);
  if (inputs.length === 0) {
    throw new Error(
      `Nothing to emit: no files under ${normalizedDir}. Run "just normalize <year>" first.`,
    );
  }

  // Validate everything up front, then write. A partial publish would leave
  // the app serving a mix of old and new data.
  const validated: { entry: DatasetIndexEntry; dataset: CountyDataset }[] = [];
  for (const input of inputs) {
    const parsed = JSON.parse(await readFile(input.file, 'utf8')) as NormalizedFile;
    if (parsed.year !== input.year) {
      throw new Error(
        `${input.file} declares year ${parsed.year} but lives under ${input.year}/`,
      );
    }
    const dataset = toCountyDataset(parsed, generatedAt);
    validated.push({
      dataset,
      entry: {
        year: dataset.year,
        county: dataset.county,
        path: `${dataset.year}/${dataset.county}.json`,
        rowCount: dataset.rows.length,
        provenance: dataset.provenance,
      },
    });
  }

  const index: DatasetIndex = assertDatasetIndex({
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    datasets: validated
      .map((v) => v.entry)
      .sort((a, b) => b.year - a.year || a.county.localeCompare(b.county)),
  });

  // Build a complete generation beside the destination (on the same filesystem).
  // This command publishes build inputs; it must not run against a live server.
  const destination = resolve(outDir);
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(dirname(destination), `.${basename(destination)}-emit-`));
  const next = join(staging, 'next');
  const previous = join(staging, 'previous');
  const state = { hasPrevious: false };
  try {
    await mkdir(next);
    for (const { entry, dataset } of validated) {
      await mkdir(join(next, String(entry.year)), { recursive: true });
      await writeFile(join(next, entry.path), `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    }
    await writeFile(join(next, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    try {
      await rename(destination, previous);
      state.hasPrevious = true;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    try {
      await rename(next, destination);
    } catch (error) {
      if (state.hasPrevious) {
        // If rollback itself fails, retain the backup for manual recovery.
        await rename(previous, destination);
        state.hasPrevious = false;
      }
      throw error;
    }
    state.hasPrevious = false;
  } finally {
    if (!state.hasPrevious) await rm(staging, { recursive: true, force: true });
  }

  const written = validated.map(({ entry }) => ({
    path: join(outDir, entry.path), rowCount: entry.rowCount,
  }));
  const indexPath = join(outDir, 'index.json');
  process.stdout.write(`Emitted index (${index.datasets.length} datasets) -> ${indexPath}\n`);
  return { datasets: written, indexPath };
}

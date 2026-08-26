/**
 * `just mock` — write synthetic normalized files so the rest of the pipeline
 * and the app can be exercised without the live source.
 *
 * The output goes through the *same* normalize -> emit path as real data, so
 * the schema validation, the index, and the app's loading code are all
 * genuinely tested rather than bypassed. The only difference is the
 * `provenance: 'synthetic'` stamp, which every layer carries forward and the
 * UI shows prominently.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NORMALIZED_DIR } from '../paths.js';
import type { NormalizedFile } from '../normalize.js';
import { generateHistory } from './generate.js';

/** Years the committed mock covers, all inside the current formula epoch. */
export const DEFAULT_MOCK_YEARS = [2023, 2024, 2025, 2026] as const;
export const DEFAULT_MOCK_SEED = 20240704;

export interface MockOptions {
  readonly county: string;
  readonly years: readonly number[];
  readonly seed: number;
  readonly outDir?: string;
}

/** Generate a synthetic history and write it as normalized files. */
export async function writeMock(options: MockOptions): Promise<string[]> {
  const { county, years, seed, outDir = NORMALIZED_DIR } = options;
  const { datasets } = generateHistory({ seed, county, years });

  const written: string[] = [];
  for (const dataset of datasets) {
    const file: NormalizedFile = {
      year: dataset.year,
      county: dataset.county,
      provenance: 'synthetic',
      sources: [],
      rows: dataset.rows,
    };
    const dir = join(outDir, String(dataset.year));
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${dataset.county}.json`);
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    written.push(path);
    process.stdout.write(`Mocked ${dataset.rows.length} synthetic rows -> ${path}\n`);
  }

  process.stdout.write(
    'These are SYNTHETIC rows generated from a known process. They validate the ' +
      'pipeline and the model machinery; they say nothing about real schools.\n',
  );
  return written;
}

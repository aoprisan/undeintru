import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { emit } from '../src/emit.js';
import type { NormalizedFile } from '../src/normalize.js';
import { assertCountyDataset, assertDatasetIndex, type AdmissionRow } from '../src/schema.js';

const NOW = new Date('2024-08-01T12:00:00.000Z');

const baseRow: AdmissionRow = {
  year: 2024,
  county: 'SB',
  schoolCode: '1234',
  schoolName: 'Colegiul Național Gheorghe Lazăr',
  specId: '567',
  specLabel: 'Matematică-Informatică',
  profile: 'Real',
  filiera: 'teoretica',
  limba: 'Româna',
  seats: 28,
  lastMedia: 9.85,
  vocational: false,
};

let root: string;
let normalizedDir: string;
let outDir: string;

async function writeNormalized(file: NormalizedFile): Promise<void> {
  const dir = join(normalizedDir, String(file.year));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${file.county}.json`), JSON.stringify(file, null, 2), 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'undeintru-emit-'));
  normalizedDir = join(root, 'normalized');
  outDir = join(root, 'public');
});

describe('emit', () => {
  it('publishes a validated county file and an index', async () => {
    await writeNormalized({
      year: 2024,
      county: 'SB',
      provenance: 'official',
      sources: ['https://admitere.edu.ro/example'],
      rows: [baseRow, { ...baseRow, specId: '568', specLabel: 'Filologie', lastMedia: null }],
    });

    const result = await emit({ normalizedDir, outDir, now: NOW });
    expect(result.datasets).toHaveLength(1);

    const dataset = assertCountyDataset(
      JSON.parse(await readFile(join(outDir, '2024', 'SB.json'), 'utf8')),
    );
    expect(dataset.year).toBe(2024);
    expect(dataset.county).toBe('SB');
    expect(dataset.generatedAt).toBe(NOW.toISOString());
    expect(dataset.rows).toHaveLength(2);

    const index = assertDatasetIndex(
      JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8')),
    );
    expect(index.datasets).toEqual([
      { year: 2024, county: 'SB', path: '2024/SB.json', rowCount: 2, provenance: 'official' },
    ]);
  });

  it('lists newest year first, then county', async () => {
    await writeNormalized({ year: 2024, county: 'SB', provenance: 'official', sources: [], rows: [] });
    await writeNormalized({ year: 2023, county: 'SB', provenance: 'official', sources: [], rows: [] });
    await writeNormalized({
      year: 2024,
      county: 'CJ',
      provenance: 'official',
      sources: [],
      rows: [{ ...baseRow, county: 'CJ' }],
    });

    await emit({ normalizedDir, outDir, now: NOW });
    const index = assertDatasetIndex(
      JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8')),
    );
    expect(index.datasets.map((d) => d.path)).toEqual([
      '2024/CJ.json',
      '2024/SB.json',
      '2023/SB.json',
    ]);
  });

  it('refuses to publish an invalid dataset, and writes nothing', async () => {
    await writeNormalized({
      year: 2024,
      county: 'SB',
      provenance: 'official',
      sources: [],
      // Three decimals: the truncation rule was not applied upstream.
      rows: [{ ...baseRow, lastMedia: 9.855 }],
    });

    await expect(emit({ normalizedDir, outDir, now: NOW })).rejects.toThrow(
      /more than two decimals/,
    );
    await expect(readFile(join(outDir, 'index.json'), 'utf8')).rejects.toThrow();
  });

  it('validates every dataset before writing any of them', async () => {
    await writeNormalized({ year: 2024, county: 'SB', provenance: 'official', sources: [], rows: [baseRow] });
    await writeNormalized({
      year: 2024,
      county: 'CJ',
      provenance: 'official',
      sources: [],
      rows: [{ ...baseRow, county: 'CJ', seats: -5 }],
    });

    await expect(emit({ normalizedDir, outDir, now: NOW })).rejects.toThrow(/seats/);
    // SB is valid, but a partial publish would leave the index out of sync.
    await expect(readFile(join(outDir, '2024', 'SB.json'), 'utf8')).rejects.toThrow();
  });

  it('rejects a file whose declared year contradicts its directory', async () => {
    const dir = join(normalizedDir, '2024');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SB.json'),
      JSON.stringify({ year: 2023, county: 'SB', provenance: 'official', sources: [], rows: [] }),
      'utf8',
    );

    await expect(emit({ normalizedDir, outDir, now: NOW })).rejects.toThrow(
      /declares year 2023 but lives under 2024/,
    );
  });

  it('fails loudly when there is nothing to publish', async () => {
    await expect(emit({ normalizedDir, outDir, now: NOW })).rejects.toThrow(/Nothing to emit/);
  });

  it('is byte-stable across runs', async () => {
    await writeNormalized({ year: 2024, county: 'SB', provenance: 'official', sources: [], rows: [baseRow] });
    await emit({ normalizedDir, outDir, now: NOW });
    const first = await readFile(join(outDir, '2024', 'SB.json'), 'utf8');
    await emit({ normalizedDir, outDir, now: NOW });
    expect(await readFile(join(outDir, '2024', 'SB.json'), 'utf8')).toBe(first);
  });
});

/** Rebuild official datasets offline from complete, source-attributed archive snapshots. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES_DIR, NORMALIZED_DIR } from './paths.js';
import { parseSpecializations } from './parse/specialization.js';
import { toCountyDataset } from './emit.js';
import type { NormalizedFile } from './normalize.js';

export async function normalizeArchive(): Promise<void> {
  const dir = join(FIXTURES_DIR, 'admitere');
  const pending: NormalizedFile[] = [];
  for (const name of (await readdir(dir)).sort()) {
    const match = /^(\d{4})-([A-Z]{1,2})\.json$/.exec(name);
    if (!match) continue;
    const year = Number(match[1]);
    const county = match[2];
    if (!county) throw new Error(`Missing county in ${name}`);
    const sourceUrl = (await readFile(join(dir, `${name}.url`), 'utf8')).trim();
    const rows = parseSpecializations(await readFile(join(dir, name), 'utf8'), { year, county, sourceUrl });
    rows.sort((a, b) => a.schoolCode.localeCompare(b.schoolCode) || a.specId.localeCompare(b.specId));
    const dataset: NormalizedFile = { year, county, provenance: 'official', sources: [sourceUrl], rows };
    toCountyDataset(dataset, new Date().toISOString());
    pending.push(dataset);
  }
  if (pending.length === 0) throw new Error('No official archive snapshots found');
  for (const dataset of pending) {
    const dir = join(NORMALIZED_DIR, String(dataset.year));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${dataset.county}.json`), `${JSON.stringify(dataset, null, 2)}\n`);
    process.stdout.write(`Normalized ${dataset.county}/${dataset.year}: ${dataset.rows.length} official rows\n`);
  }
}

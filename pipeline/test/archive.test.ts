import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTY_NAMES } from '../../app/src/data/counties.js';
import { assertCountyDataset, assertDatasetIndex } from '../src/schema.js';
import { PUBLIC_DATA_DIR } from '../src/paths.js';
import { FIXTURES_DIR } from '../src/paths.js';
import { parseSpecializations } from '../src/parse/specialization.js';
import { toCountyDataset } from '../src/emit.js';
import { fitCutoffModel, predict, specKey } from '../src/model.js';

const source = (year: number): string => `https://static.admitere.edu.ro/${year}/repartizare/SB/data/specialization.json`;
async function snapshot(year: number): Promise<string> {
  const path = join(FIXTURES_DIR, 'admitere', `${year}-SB.json`);
  expect((await readFile(`${path}.url`, 'utf8')).trim()).toBe(source(year));
  return readFile(path, 'utf8');
}
async function dataset(year: number) {
  return toCountyDataset({ year, county: 'SB', provenance: 'official', sources: [source(year)],
    rows: parseSpecializations(await snapshot(year), { year, county: 'SB', sourceUrl: source(year) }),
  }, '2026-09-15T00:00:00.000Z');
}

describe('official archive', () => {
  it('publishes both official seasons for every county, exactly matching the source snapshots', async () => {
    const index = assertDatasetIndex(JSON.parse(await readFile(join(PUBLIC_DATA_DIR, 'index.json'), 'utf8')));
    const codes = Object.keys(COUNTY_NAMES).sort();
    expect(codes).toHaveLength(42);
    expect(index.datasets).toHaveLength(84);
    for (const year of [2025, 2026]) {
      expect(index.datasets.filter((entry) => entry.year === year).map((entry) => entry.county).sort()).toEqual(codes);
      for (const county of codes) {
        const path = join(FIXTURES_DIR, 'admitere', `${year}-${county}.json`);
        const sourceUrl = (await readFile(`${path}.url`, 'utf8')).trim();
        const rows = parseSpecializations(await readFile(path, 'utf8'), { year, county, sourceUrl });
        rows.sort((a, b) => a.schoolCode.localeCompare(b.schoolCode) || a.specId.localeCompare(b.specId));
        const entry = index.datasets.find((item) => item.year === year && item.county === county);
        expect(entry).toMatchObject({ path: `${year}/${county}.json`, rowCount: rows.length, provenance: 'official' });
        const published = assertCountyDataset(JSON.parse(await readFile(join(PUBLIC_DATA_DIR, `${year}/${county}.json`), 'utf8')));
        expect(published).toMatchObject({ year, county, provenance: 'official', sources: [sourceUrl], rows });
        expect(published.rows).toHaveLength(rows.length);
        expect(fitCutoffModel([published], year + 1).county).toBe(county);
      }
    }
  });

  it('reproduces complete official county tables and current, not previous, cutoffs', async () => {
    const previous = await dataset(2025);
    const current = await dataset(2026);
    expect(previous.rows).toHaveLength(74);
    expect(current.rows).toHaveLength(117);
    expect(previous.rows.reduce((sum, row) => sum + row.seats, 0)).toBe(2344);
    expect(current.rows.reduce((sum, row) => sum + row.seats, 0)).toBe(3474);
    expect(previous.rows.find((row) => row.specId === '113')).toMatchObject({
      schoolName: 'COLEGIUL NAȚIONAL "GHEORGHE LAZĂR" SIBIU', lastMedia: 9.37,
    });
    expect(current.rows.find((row) => row.specId === '103')).toMatchObject({ lastMedia: 9.05 });
    expect(current.rows.filter((row) => row.specLabel.endsWith('(dual)'))).toHaveLength(37);
    expect(current.rows.some((row) => row.lastMedia === null)).toBe(true);
    expect(previous.rows.find((row) => row.specId === '115')?.specLabel).toContain('bilingv: Limba engleză');
  });

  it('preserves official allocations above the offered seat count', async () => {
    const sourceUrl = 'https://static.admitere.edu.ro/2025/repartizare/B/data/specialization.json';
    const rows = parseSpecializations(await readFile(join(FIXTURES_DIR, 'admitere', '2025-B.json'), 'utf8'),
      { year: 2025, county: 'B', sourceUrl });
    const published = toCountyDataset({ year: 2025, county: 'B', provenance: 'official', sources: [sourceUrl], rows },
      '2026-09-16T00:00:00.000Z');
    expect(published.rows.find((row) => row.specId === '344')).toMatchObject({ seats: 78, occupiedSeats: 79, lastMedia: 9.82 });
  });

  it('rejects wrong years, counties, duplicate records, missing fields and malformed cutoffs', async () => {
    const json = await snapshot(2025);
    const ctx = { year: 2025, county: 'SB', sourceUrl: source(2025) };
    expect(() => parseSpecializations(json, { ...ctx, year: 2024 })).toThrow(/source URL/);
    const rows = JSON.parse(json) as Record<string, unknown>[];
    const first = rows[0];
    if (!first) throw new Error('Missing fixture row');
    for (const change of [{ j: 'CJ' }, { um: 'oops' }, { lc: undefined }, { nlt: '-1' }, { nlo: '-1' }]) {
      expect(() => parseSpecializations(JSON.stringify([{ ...first, ...change }]), ctx)).toThrow(source(2025));
    }
    expect(() => parseSpecializations(JSON.stringify([first, first]), ctx)).toThrow(/duplicate/);
    expect(() => parseSpecializations('[]', ctx)).toThrow(/nonempty/);
  });

  it('matches renamed option codes and ignores the erroneous previous-year column', async () => {
    const previous = await dataset(2025);
    const current = await dataset(2026);
    const model = fitCutoffModel([previous, current], 2027);
    expect(model.observedShifts[0]?.specCount).toBe(27);
    const row = current.rows.find((row) => row.specId === '103');
    if (!row) throw new Error('Missing Lazar row');
    expect(predict(model, specKey(row), 9.5).kind).toBe('estimate');
    const renumbered = { ...current, rows: current.rows.map((r) => ({ ...r, specId: `new-${r.specId}` })) };
    expect(fitCutoffModel([previous, renumbered], 2027).observedShifts).toEqual(model.observedShifts);
    // Reusing the same option code for a different course must not create a match.
    const changed = { ...current, rows: current.rows.map((r) => ({ ...r, specLabel: `Other ${r.specLabel}` })) };
    expect(fitCutoffModel([previous, changed], 2027).observedShifts).toEqual([]);
    // A duplicate course identity is not resolved by arbitrary array ordering.
    const duplicated = { ...current, rows: [...current.rows, { ...row, specId: 'duplicate' }] };
    expect(fitCutoffModel([previous, duplicated], 2027).observedShifts[0]?.specCount).toBe(26);
  });
});

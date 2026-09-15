import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('rejects wrong years, counties, duplicate records, missing fields and malformed cutoffs', async () => {
    const json = await snapshot(2025);
    const ctx = { year: 2025, county: 'SB', sourceUrl: source(2025) };
    expect(() => parseSpecializations(json, { ...ctx, year: 2024 })).toThrow(/source URL/);
    const rows = JSON.parse(json) as Record<string, unknown>[];
    const first = rows[0];
    if (!first) throw new Error('Missing fixture row');
    for (const change of [{ j: 'CJ' }, { um: 'oops' }, { lc: undefined }, { nlt: '-1' }, { nlo: '9999' }]) {
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

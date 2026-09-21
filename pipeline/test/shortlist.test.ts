import { describe, expect, it } from 'vitest';
import { courseId, courseSnapshots, readShortlist } from '../../app/src/data/shortlist.js';
import type { AdmissionRow, CountyDataset } from '../../app/src/data/schema.js';

const row: AdmissionRow = {
  year: 2026, county: 'SB', schoolCode: '1', schoolName: 'Liceu', specId: '101',
  specLabel: 'Matematică', profile: 'Real', filiera: 'teoretica', limba: 'Româna',
  seats: 28, occupiedSeats: 28, lastMedia: 4.5, vocational: false,
};
function dataset(year: number, rows: AdmissionRow[]): CountyDataset {
  return { schemaVersion: 1, year, county: 'SB', provenance: 'official',
    generatedAt: '2026-09-21T00:00:00Z', sources: ['https://example.com/source'], rows };
}
const latest = dataset(2026, [row]);
const older = dataset(2025, [{ ...row, year: 2025, specId: '999', lastMedia: 5.1 }]);

describe('saved historical preferences', () => {
  it('matches course details across code changes and preserves year-specific facts', () => {
    const snapshots = courseSnapshots(row, [older, latest]);
    expect(snapshots.map((d) => d.rows[0]?.specId)).toEqual(['101', '999']);
    expect(readShortlist(JSON.stringify([{ snapshots }]))).toEqual([{ snapshots }]);
  });
  it('does not confuse recycled codes or ambiguous course matches', () => {
    const unrelated = dataset(2025, [{ ...row, year: 2025, specLabel: 'Filologie' }]);
    expect(courseSnapshots(row, [unrelated, latest])).toEqual([latest]);
    const ambiguous = dataset(2025, [older.rows[0]!, { ...older.rows[0]!, specId: '998' }]);
    expect(courseSnapshots(row, [ambiguous, latest])).toEqual([latest]);
  });
  it('excludes incomparable years and other counties', () => {
    const old = dataset(2022, [{ ...row, year: 2022 }]);
    expect(courseSnapshots(row, [old, { ...older, county: 'BV' }, latest])).toEqual([latest]);
  });
  it('keeps different county/year options distinct', () => {
    expect(courseId(row)).not.toBe(courseId({ ...row, county: 'BV' }));
    expect(courseId(row)).not.toBe(courseId({ ...row, year: 2025 }));
  });
  it('rejects corrupted, duplicate and unrelated stored history', () => {
    expect(readShortlist(null)).toEqual([]);
    for (const value of ['broken', '{}', '[{}]', JSON.stringify([{ snapshots: [] }]),
      JSON.stringify([{ snapshots: [latest] }, { snapshots: [latest] }]),
      JSON.stringify([{ snapshots: [latest, latest] }]),
      JSON.stringify([{ snapshots: [latest, dataset(2025, [{ ...row, year: 2025, specLabel: 'Filologie' }])] }])]) {
      expect(() => readShortlist(value)).toThrow();
    }
  });
  it('retains synthetic provenance and null cutoffs on restoration', () => {
    const synthetic = { ...latest, provenance: 'synthetic' as const, sources: [], rows: [{ ...row, lastMedia: null }] };
    expect(readShortlist(JSON.stringify([{ snapshots: [synthetic] }]))[0]?.snapshots[0]).toEqual(synthetic);
  });
});

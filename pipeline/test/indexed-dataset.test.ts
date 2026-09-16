import { describe, expect, it } from 'vitest';
import { assertIndexedDataset, type CountyDataset, type DatasetIndexEntry } from '../src/schema.js';

const dataset: CountyDataset = {
  schemaVersion: 1, year: 2026, county: 'SB', provenance: 'official',
  generatedAt: '2026-09-16T00:00:00.000Z', sources: [], rows: [],
};
const entry: DatasetIndexEntry = {
  year: 2026, county: 'SB', provenance: 'official', rowCount: 0, path: '2026/SB.json',
};

describe('indexed dataset validation', () => {
  it('accepts a matching payload', () => {
    expect(assertIndexedDataset(dataset, entry)).toBe(dataset);
  });
  it.each([
    { county: 'CJ' }, { year: 2025 }, { provenance: 'synthetic' as const }, { rowCount: 1 },
  ])('rejects a mismatched index entry %j', (change) => {
    expect(() => assertIndexedDataset(dataset, { ...entry, ...change })).toThrow(/expected/);
  });
  it('still rejects invalid payloads', () => {
    expect(() => assertIndexedDataset({ ...dataset, schemaVersion: 2 }, entry)).toThrow(/schemaVersion/);
  });
});

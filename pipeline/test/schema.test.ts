import { describe, expect, it } from 'vitest';
import {
  areYearsComparable,
  assertCountyDataset,
  assertDatasetIndex,
  MEDIA_FORMULA_EPOCH_YEAR,
  SchemaValidationError,
  SCHEMA_VERSION,
  type AdmissionRow,
} from '../src/schema.js';

const row: AdmissionRow = {
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

function dataset(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: SCHEMA_VERSION,
    year: 2024,
    county: 'SB',
    generatedAt: '2024-08-01T00:00:00.000Z',
    provenance: 'official',
    sources: ['https://admitere.edu.ro/example'],
    rows: [row],
    ...overrides,
  };
}

describe('assertCountyDataset', () => {
  it('accepts a well-formed dataset', () => {
    expect(assertCountyDataset(dataset()).rows).toHaveLength(1);
  });

  it('accepts a null cutoff for a specialization that did not fill', () => {
    expect(() => assertCountyDataset(dataset({ rows: [{ ...row, lastMedia: null }] }))).not.toThrow();
  });

  it('rejects a row whose year disagrees with the file', () => {
    expect(() => assertCountyDataset(dataset({ rows: [{ ...row, year: 2023 }] }))).toThrow(
      /expected 2024 to match \$\.year/,
    );
  });

  it('rejects a row whose county disagrees with the file', () => {
    expect(() => assertCountyDataset(dataset({ rows: [{ ...row, county: 'CJ' }] }))).toThrow(
      /match \$\.county/,
    );
  });

  it('rejects a media with more than two decimals', () => {
    expect(() => assertCountyDataset(dataset({ rows: [{ ...row, lastMedia: 9.855 }] }))).toThrow(
      /more than two decimals/,
    );
  });

  it('accepts every two-decimal media on the scale, floats notwithstanding', () => {
    // Regression: the check used to be `Math.round(m * 100) !== m * 100`, which
    // rejects 8.96 because `8.96 * 100` is 896.0000000000001. Sweep the whole
    // grid so no individual value can regress silently.
    for (let h = 100; h <= 1000; h += 1) {
      const media = h / 100;
      expect(() => assertCountyDataset(dataset({ rows: [{ ...row, lastMedia: media }] }))).not.toThrow();
    }
  });

  it('rejects a media outside the 1..10 scale', () => {
    expect(() => assertCountyDataset(dataset({ rows: [{ ...row, lastMedia: 10.5 }] }))).toThrow(
      /outside 1\.\.10/,
    );
  });

  it('rejects a vocational flag that contradicts the filiera', () => {
    expect(() =>
      assertCountyDataset(dataset({ rows: [{ ...row, filiera: 'vocationala' }] })),
    ).toThrow(/implies vocational=true/);
  });

  it('rejects an unknown filiera', () => {
    expect(() => assertCountyDataset(dataset({ rows: [{ ...row, filiera: 'sportiva' }] }))).toThrow(
      /expected one of teoretica \| tehnologica \| vocationala/,
    );
  });

  it('rejects duplicate school/spec pairs', () => {
    expect(() => assertCountyDataset(dataset({ rows: [row, { ...row, seats: 30 }] }))).toThrow(
      /duplicate schoolCode\/specId/,
    );
  });

  it('rejects untrimmed text', () => {
    expect(() =>
      assertCountyDataset(dataset({ rows: [{ ...row, schoolName: ' Lazăr ' }] })),
    ).toThrow(/expected trimmed text/);
  });

  it('rejects negative seats and non-integer seats', () => {
    expect(() => assertCountyDataset(dataset({ rows: [{ ...row, seats: -1 }] }))).toThrow(/>= 0/);
    expect(() => assertCountyDataset(dataset({ rows: [{ ...row, seats: 2.5 }] }))).toThrow(
      /expected an integer/,
    );
  });

  it('rejects an unknown provenance', () => {
    expect(() => assertCountyDataset(dataset({ provenance: 'guessed' }))).toThrow(/provenance/);
    expect(() => assertCountyDataset(dataset({ provenance: undefined }))).toThrow(/provenance/);
  });

  it('refuses to let synthetic data cite sources it never had', () => {
    expect(() =>
      assertCountyDataset(dataset({ provenance: 'synthetic' })),
    ).toThrow(/synthetic datasets must not cite sources/);
    expect(() =>
      assertCountyDataset(dataset({ provenance: 'synthetic', sources: [] })),
    ).not.toThrow();
  });

  it('rejects a wrong schema version', () => {
    expect(() => assertCountyDataset(dataset({ schemaVersion: 99 }))).toThrow(/schemaVersion/);
  });

  it('reports every problem at once, with paths', () => {
    try {
      assertCountyDataset(dataset({ rows: [{ ...row, seats: -1, lastMedia: 42, specLabel: '' }] }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const issues = (err as SchemaValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
      expect(issues.map((i) => i.path)).toEqual(
        expect.arrayContaining(['$.rows[0].specLabel', '$.rows[0].seats', '$.rows[0].lastMedia']),
      );
    }
  });
});

describe('assertDatasetIndex', () => {
  const index = (datasets: unknown[]): unknown => ({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: '2024-08-01T00:00:00.000Z',
    datasets,
  });

  const entry = {
    year: 2024,
    county: 'SB',
    path: '2024/SB.json',
    rowCount: 12,
    provenance: 'official',
  };

  it('accepts a well-formed index', () => {
    expect(assertDatasetIndex(index([entry])).datasets).toHaveLength(1);
  });

  it('rejects a path that does not match its year and county', () => {
    expect(() => assertDatasetIndex(index([{ ...entry, path: '2023/SB.json' }]))).toThrow(
      /expected 2024\/SB\.json/,
    );
  });

  it('rejects duplicate datasets', () => {
    expect(() => assertDatasetIndex(index([entry, entry]))).toThrow(/duplicate dataset/);
  });

  it('rejects an entry with no provenance, so synthetic data cannot hide', () => {
    const { provenance: _omitted, ...withoutProvenance } = entry;
    expect(() => assertDatasetIndex(index([withoutProvenance]))).toThrow(/provenance/);
  });
});

describe('areYearsComparable', () => {
  it('refuses to compare across the 2023 formula change', () => {
    expect(areYearsComparable(2022, 2024)).toBe(false);
    expect(areYearsComparable(2024, 2022)).toBe(false);
    expect(areYearsComparable(2019, 2022)).toBe(true);
    expect(areYearsComparable(2023, 2024)).toBe(true);
    expect(areYearsComparable(MEDIA_FORMULA_EPOCH_YEAR, MEDIA_FORMULA_EPOCH_YEAR)).toBe(true);
  });
});

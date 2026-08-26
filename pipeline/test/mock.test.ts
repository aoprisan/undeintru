import { describe, expect, it } from 'vitest';

import { generateHistory } from '../src/mock/generate.js';
import { mulberry32, Rng } from '../src/mock/rng.js';
import { assertCountyDataset, MEDIA_FORMULA_EPOCH_YEAR } from '../src/schema.js';

describe('Rng', () => {
  it('is a pure function of its seed', () => {
    const a = Array.from({ length: 20 }, mulberry32(123));
    const b = Array.from({ length: 20 }, mulberry32(123));
    expect(a).toEqual(b);
    expect(a).not.toEqual(Array.from({ length: 20 }, mulberry32(124)));
  });

  it('produces uniforms in [0, 1)', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 1000; i += 1) {
      const u = rng.uniform();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('produces normals with the requested mean and spread', () => {
    const rng = new Rng(2);
    const sample = Array.from({ length: 20_000 }, () => rng.normal(3, 2));
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
    const sd = Math.sqrt(
      sample.reduce((a, b) => a + (b - mean) ** 2, 0) / (sample.length - 1),
    );
    expect(mean).toBeCloseTo(3, 1);
    expect(sd).toBeGreaterThan(1.9);
    expect(sd).toBeLessThan(2.1);
  });

  it('refuses to pick from an empty list rather than returning undefined', () => {
    expect(() => new Rng(3).pick([])).toThrow(/empty/);
  });
});

describe('generateHistory', () => {
  const years = [2023, 2024, 2025, 2026];
  const options = { seed: 7, county: 'SB', years };

  it('is deterministic for a seed, and different across seeds', () => {
    const a = generateHistory(options);
    const b = generateHistory(options);
    const c = generateHistory({ ...options, seed: 8 });
    expect(JSON.stringify(a.datasets)).toBe(JSON.stringify(b.datasets));
    expect(JSON.stringify(a.datasets)).not.toBe(JSON.stringify(c.datasets));
  });

  it('produces one schema-valid dataset per requested year', () => {
    const { datasets } = generateHistory(options);
    expect(datasets.map((d) => d.year)).toEqual(years);
    for (const dataset of datasets) {
      expect(() => assertCountyDataset(dataset)).not.toThrow();
    }
  });

  it('marks every dataset synthetic and cites no sources', () => {
    // The schema enforces this too; asserting it here as well because it is
    // the property that keeps generated cutoffs from being mistaken for real
    // ones, and it must not quietly regress.
    for (const dataset of generateHistory(options).datasets) {
      expect(dataset.provenance).toBe('synthetic');
      expect(dataset.sources).toEqual([]);
    }
  });

  it('refuses to generate years before the media formula change', () => {
    expect(() => generateHistory({ ...options, years: [2021, 2022] })).toThrow(
      new RegExp(String(MEDIA_FORMULA_EPOCH_YEAR)),
    );
  });

  it('refuses an empty year list', () => {
    expect(() => generateHistory({ ...options, years: [] })).toThrow(/at least one year/);
  });

  it('keeps the same specializations across years, so history can be linked', () => {
    const { datasets } = generateHistory(options);
    const keys = datasets.map((d) => d.rows.map((r) => `${r.schoolCode}/${r.specId}`).sort());
    for (const set of keys) expect(set).toEqual(keys[0]);
  });

  it('produces cutoffs that are valid medias — two decimals, within 1..10', () => {
    for (const dataset of generateHistory(options).datasets) {
      for (const row of dataset.rows) {
        if (row.lastMedia === null) continue;
        expect(row.lastMedia).toBeGreaterThanOrEqual(1);
        expect(row.lastMedia).toBeLessThanOrEqual(10);
        expect(Math.abs(row.lastMedia * 100 - Math.round(row.lastMedia * 100))).toBeLessThan(
          1e-6,
        );
      }
    }
  });

  it('includes the awkward cases the app has to render', () => {
    const rows = generateHistory({ ...options, specCount: 80 }).datasets.at(-1)!.rows;
    expect(rows.some((r) => r.lastMedia === null)).toBe(true); // did not fill
    expect(rows.some((r) => r.vocational)).toBe(true); // aptitude-gated
    expect(new Set(rows.map((r) => r.filiera)).size).toBeGreaterThan(1);
  });

  it('reports the ground truth it generated from, for the validation suite', () => {
    const { truth } = generateHistory({ ...options, tau: 0.3, sigma: 0.4, drift: 0.1 });
    expect(truth.tau).toBe(0.3);
    expect(truth.sigma).toBe(0.4);
    expect(truth.drift).toBe(0.1);
    // One shift per year after the first.
    expect(truth.shifts.map((s) => s.year)).toEqual([2024, 2025, 2026]);
  });

  it('applies drift when asked, so the model can be tested under misspecification', () => {
    const flat = generateHistory({ ...options, drift: 0, tau: 0.01, sigma: 0.01 });
    const rising = generateHistory({ ...options, drift: 0.4, tau: 0.01, sigma: 0.01 });
    const meanShift = (h: typeof flat): number =>
      h.truth.shifts.reduce((a, s) => a + s.shift, 0) / h.truth.shifts.length;
    expect(meanShift(flat)).toBeCloseTo(0, 1);
    expect(meanShift(rising)).toBeGreaterThan(0.3);
  });

  it('keeps cutoffs clear of the 10.0 ceiling, where comparisons go degenerate', () => {
    const rows = generateHistory({ ...options, specCount: 120 }).datasets.flatMap((d) => d.rows);
    const pinned = rows.filter((r) => r.lastMedia === 10).length;
    expect(pinned / rows.length).toBeLessThan(0.01);
  });
});

import { describe, expect, it } from 'vitest';

import { fitCutoffModel, predict, specKey, SIGMA_PRIOR, TAU_PRIOR } from '../../app/src/model/predict.js';
import type { AdmissionRow, CountyDataset, Filiera } from '../src/schema.js';

/**
 * A county-year built from cutoffs: `moves` is one cutoff per course, per
 * filiera. Course identities are stable across years by construction.
 */
function dataset(year: number, moves: Readonly<Record<string, readonly number[]>>): CountyDataset {
  const rows: AdmissionRow[] = [];
  for (const [filiera, cutoffs] of Object.entries(moves)) {
    cutoffs.forEach((lastMedia, index) => {
      rows.push({
        year, county: 'SB', schoolCode: `${filiera}-${index}`, schoolName: 'Liceu',
        specId: `${year}-${filiera}-${index}`, specLabel: `Spec ${index}`, profile: 'P',
        filiera: filiera as Filiera, limba: 'Limba română', seats: 28, occupiedSeats: 28,
        lastMedia, vocational: false,
      });
    });
  }
  return {
    schemaVersion: 1, year, county: 'SB', generatedAt: '2026-01-01T00:00:00.000Z',
    provenance: 'official', sources: ['test'], rows,
  };
}

/** Teoretică barely moves; tehnologică drops hard. Eight courses each, the minimum. */
const steady = [8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7];
const volatile = [7.0, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7];
const previous = dataset(2025, { teoretica: steady, tehnologica: volatile });
const current = dataset(2026, {
  teoretica: steady.map((c) => c - 0.1),
  tehnologica: volatile.map((c) => c - 1.2),
});

describe('per-filiera predictive spread', () => {
  const model = fitCutoffModel([previous, current], 2027);

  it('gives the filiera that moved further the wider band', () => {
    const teoretica = model.sdByFiliera.get('teoretica');
    const tehnologica = model.sdByFiliera.get('tehnologica');
    expect(teoretica).toBeDefined();
    expect(tehnologica).toBeDefined();
    expect(tehnologica!).toBeGreaterThan(teoretica!);
  });

  it('brackets the pooled spread, rather than replacing it with one extreme', () => {
    expect(model.sdByFiliera.get('teoretica')!).toBeLessThan(model.sd);
    expect(model.sdByFiliera.get('tehnologica')!).toBeGreaterThan(model.sd);
  });

  it('is what predict uses, so two courses that moved differently get different bands', () => {
    const width = (row: AdmissionRow) => {
      const p = predict(model, specKey(row), null);
      if (p.kind !== 'estimate') throw new Error(`expected an estimate, got ${p.kind}`);
      return p.interval[1] - p.interval[0];
    };
    const teoretica = current.rows.find((r) => r.filiera === 'teoretica')!;
    const tehnologica = current.rows.find((r) => r.filiera === 'tehnologica')!;
    expect(width(tehnologica)).toBeGreaterThan(width(teoretica));
  });

  it('still predicts last year’s cutoff: the split widens the band, never moves the centre', () => {
    for (const row of current.rows) {
      const p = predict(model, specKey(row), null);
      if (p.kind !== 'estimate') throw new Error(`expected an estimate, got ${p.kind}`);
      expect(p.cutoff).toBe(row.lastMedia);
    }
  });

  it('falls back to the pooled spread for a filiera with too little evidence', () => {
    const thin = { teoretica: steady, tehnologica: [6.0] };
    const model = fitCutoffModel(
      [dataset(2025, thin), dataset(2026, { teoretica: steady.map((c) => c - 0.1), tehnologica: [4.0] })],
      2027,
    );
    expect(model.sdByFiliera.has('tehnologica')).toBe(false);
    const row = { schoolCode: 'tehnologica-0', specId: '2026-tehnologica-0' };
    const p = predict(model, specKey(row), null);
    if (p.kind !== 'estimate') throw new Error(`expected an estimate, got ${p.kind}`);
    expect(p.sd).toBe(model.sd);
  });

  it('has no filiera bands at all without an observed year pair, so priors still rule', () => {
    const model = fitCutoffModel([previous], 2026);
    expect(model.sdByFiliera.size).toBe(0);
    expect(model.sd).toBeCloseTo(Math.hypot(SIGMA_PRIOR, TAU_PRIOR));
  });
});

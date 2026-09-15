import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_DATA_DIR } from '../src/paths.js';
import { assertCountyDataset } from '../src/schema.js';
import { fitCutoffModel, predict, specKey } from '../src/model.js';
import { predictMarks } from '../src/marks.js';

const history = [2025, 2026].map((year) => assertCountyDataset(
  JSON.parse(readFileSync(join(PUBLIC_DATA_DIR, String(year), 'SB.json'), 'utf8')),
));

describe('review regressions', () => {
  it('distinguishes vacancies, missing cutoffs, and competitive thresholds', () => {
    const model = fitCutoffModel(history, 2027);
    const vacant = [...model.base.values()].find((row) => row.specId === '135');
    if (!vacant) throw new Error('Missing official course');
    expect(vacant).toMatchObject({ seats: 28, occupiedSeats: 19, lastMedia: 6.05 });
    expect(predict(model, specKey(vacant), 5)).toEqual({ kind: 'open' });
    const unknown = { ...vacant, occupiedSeats: 28, lastMedia: null };
    expect(predict({ ...model, base: new Map([[specKey(unknown), unknown]]) }, specKey(unknown), 10))
      .toEqual({ kind: 'unavailable', reason: 'no-cutoff' });
    const withoutOccupancy = { ...vacant, lastMedia: null };
    delete withoutOccupancy.occupiedSeats;
    expect(predict({ ...model, base: new Map([[specKey(vacant), withoutOccupancy]]) }, specKey(vacant), 10).kind)
      .toBe('unavailable');
  });

  it('accumulates annual variance for a four-year forecast', () => {
    const next = fitCutoffModel(history, 2027);
    const later = fitCutoffModel(history, 2030);
    expect(later.sd).toBeCloseTo(2 * next.sd, 12);
    expect(() => fitCutoffModel(history, Number.NaN)).toThrow(/integer/);
    const row = [...next.base.values()].find((r) => r.specId === '103');
    if (!row) throw new Error('Missing competitive course');
    const a = predict(next, specKey(row), 9.5);
    const b = predict(later, specKey(row), 9.5);
    if (a.kind !== 'estimate' || b.kind !== 'estimate') throw new Error('Expected estimates');
    expect(b.probability).toBeLessThan(a.probability);
    expect(b.interval[1] - b.interval[0]).toBeCloseTo(2 * (a.interval[1] - a.interval[0]));
  });

  it('uses one overall record for both subject calibrations and gates unsupported candidates', () => {
    const record = { currentGrade: 8 as const, takesMotherTongue: false,
      school: [{ grade: 5 as const, media: 8 }, { grade: 8 as const, media: 10 }] };
    const result = predictMarks(record);
    expect(result.romana.schoolMedia).toBe(9);
    expect(result.matematica.schoolMedia).toBe(9);
    expect(result.media.mean).toBeCloseTo(6.933);
    expect(() => predictMarks({ ...record, takesMotherTongue: true })).toThrow(/Mother-tongue/);
  });

  it('validates published occupancy', () => {
    const dataset = history[0];
    if (!dataset || !dataset.rows[0]) throw new Error('Missing fixture');
    for (const occupiedSeats of [-1, 0.5, dataset.rows[0].seats + 1]) {
      expect(() => assertCountyDataset({ ...dataset, rows: [{ ...dataset.rows[0], occupiedSeats }] }))
        .toThrow(/occupiedSeats/);
    }
  });
});

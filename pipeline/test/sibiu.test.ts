import { describe, expect, it } from 'vitest';
import { predictMarks } from '../../app/src/model/marks.js';
import type { StudentRecord } from '../../app/src/model/marks.js';
import { SIBIU_SCHOOLS } from '../../app/src/model/sibiu-schools.js';
import { fitSibiu, readSibiuRows } from '../src/evnat/sibiu.js';

const record = (schoolCode?: string, media = 9): StudentRecord => ({
  currentGrade: 8, takesMotherTongue: false,
  school: ([5, 6, 7, 8] as const).map(grade => ({ grade, media })),
  ...(schoolCode === undefined ? {} : { schoolCode }),
});

describe('Sibiu city school calibration', () => {
  it('reproduces every published school adjustment from the 2025 fixture', async () => {
    expect(await fitSibiu()).toEqual(SIBIU_SCHOOLS);
    expect(SIBIU_SCHOOLS.every(school => school.name.endsWith('SIBIU'))).toBe(true);
  });
  it('distinguishes the same school average while retaining national fallback', () => {
    const predictions = SIBIU_SCHOOLS.filter(school => school.n >= 20)
      .map(school => predictMarks(record(school.code)).media.mean);
    expect(Math.max(...predictions) - Math.min(...predictions)).toBeGreaterThan(0.5);
    expect(predictMarks(record('unknown'))).toEqual(predictMarks(record()));
    for (const school of SIBIU_SCHOOLS.filter(s => s.n < 20)) {
      expect(predictMarks(record(school.code))).toEqual(predictMarks(record()));
    }
  });
  it('lets simulare evidence reduce the influence of school and preserves bounds', () => {
    const school = SIBIU_SCHOOLS.find(s => s.romana > 0.3);
    expect(school).toBeDefined();
    const base = record();
    const local = record(school?.code);
    const sim = { romana: 8, matematica: 8 };
    const gap = predictMarks(local).media.mean - predictMarks(base).media.mean;
    const simGap = predictMarks({ ...local, simulare: sim }).media.mean -
      predictMarks({ ...base, simulare: sim }).media.mean;
    expect(simGap).toBeGreaterThan(0);
    expect(simGap).toBeLessThan(gap);
    for (const school of SIBIU_SCHOOLS) for (const media of [1, 5, 9, 10]) {
      const p = predictMarks(record(school.code, media)).media;
      expect(p.mean).toBeGreaterThanOrEqual(1);
      expect(p.mean).toBeLessThanOrEqual(10);
      expect(p.sd).toBeGreaterThanOrEqual(predictMarks(record(undefined, media)).media.sd);
    }
  });
  it('improves held-out 2026 error without fitting on the test year', async () => {
    const rows = await readSibiuRows(2026);
    expect(rows).toHaveLength(1245);
    let baseline = 0;
    let local = 0;
    let covered = 0;
    for (const row of rows) {
      const national = predictMarks(record(undefined, row.school)).media;
      const adjusted = predictMarks(record(row.code, row.school)).media;
      baseline += (national.mean - row.media) ** 2;
      local += (adjusted.mean - row.media) ** 2;
      covered += Number(row.media >= adjusted.interval[0] && row.media <= adjusted.interval[1]);
    }
    expect(Math.sqrt(local / rows.length)).toBeLessThan(0.85);
    expect(local).toBeLessThan(baseline * 0.9);
    expect(covered / rows.length).toBeGreaterThan(0.8);
  });
});

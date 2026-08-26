/**
 * Real data. Not synthetic, not a fixture anyone wrote by hand.
 *
 * Every number checked here comes from the Ministry of Education's published
 * Evaluarea Națională results (`pipeline/fixtures/evnat/`, CC-BY 4.0). Two
 * separate claims are under test:
 *
 * 1. **The arithmetic.** Our media matches the ministry's own, on rows chosen
 *    to stress the truncation and both formula branches.
 * 2. **The model.** The marks model, whose calibration was measured on 2025,
 *    is scored against **2026** candidates. Different year, so this is an
 *    out-of-sample test rather than a restatement of the fit.
 *
 * Both run offline against committed samples. The full-file versions are
 * `just evnat-verify` and `just evnat-calibrate`, which are network-only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIXTURES_DIR } from '../src/paths.js';
import { computeMediaAdmitere } from '../src/util/media.js';
import { columnIndex } from '../src/evnat/xlsx.js';
import { COUNTY_BY_SIIIR_PREFIX } from '../src/evnat/dataset.js';
import { calibratedMean, calibratedSd, predictMarks } from '../src/marks.js';
import type { SchoolGrade, YearlyMedia } from '../src/marks.js';

const EVNAT_DIR = join(FIXTURES_DIR, 'evnat');

function readFixture(name: string): { header: string[]; rows: string[][] } {
  const text = readFileSync(join(EVNAT_DIR, name), 'utf8').trim();
  const [head, ...rest] = text.split('\n');
  return {
    header: (head ?? '').split(','),
    rows: rest.map((line) => line.split(',')),
  };
}

const num = (cell: string | undefined): number => Number(cell);
const optional = (cell: string | undefined): number | null =>
  cell === undefined || cell === '' ? null : Number(cell);

describe('the published media, recomputed — Evaluarea Națională 2025', () => {
  const { header, rows } = readFixture('evnat-2025-sample.csv');

  it('reads the committed sample', () => {
    expect(header).toEqual([
      'nota_finala_romana',
      'nota_finala_limba_materna',
      'nota_finala_matematica',
      'media',
    ]);
    expect(rows.length).toBeGreaterThan(600);
  });

  it('reproduces the ministry’s media for every candidate in the sample', () => {
    for (const row of rows) {
      const romana = num(row[0]);
      const limbaMaterna = optional(row[1]);
      const matematica = num(row[2]);
      const published = num(row[3]);
      expect(computeMediaAdmitere(romana, matematica, limbaMaterna)).toBe(published);
    }
  });

  it('covers both formula branches, and both truncating and exact means', () => {
    const three = rows.filter((r) => r[1] !== '');
    const two = rows.filter((r) => r[1] === '');
    expect(three.length).toBeGreaterThan(250);
    expect(two.length).toBeGreaterThan(250);

    const truncating = rows.filter((row) => {
      const h = (v: string | undefined): number => Math.round(Number(v) * 100);
      return row[1] === ''
        ? (h(row[0]) + h(row[2])) % 2 !== 0
        : (h(row[0]) + h(row[1]) + h(row[2])) % 3 !== 0;
    });
    expect(truncating.length).toBeGreaterThan(300);
  });

  it('would get the minority-language candidates wrong without the third grade', () => {
    // The defect this rule fixed: averaging two of the three papers. If this
    // ever stops failing, the three-subject branch has stopped mattering and
    // something is wrong with the fixture, not with the news.
    const wrong = rows
      .filter((row) => row[1] !== '')
      .filter((row) => computeMediaAdmitere(num(row[0]), num(row[2])) !== num(row[3]));
    expect(wrong.length).toBeGreaterThan(250);
  });
});

describe('the marks model against real candidates — Evaluarea Națională 2026', () => {
  /*
   * Out-of-sample: the calibration in marks.ts was measured on 2025 and these
   * are 2026 candidates. The bounds below are deliberately loose enough to
   * survive a normal year's drift in exam difficulty and tight enough to fail
   * if the model regresses to anything like the pre-calibration version, which
   * scored a bias of +1.19 and 43% coverage.
   */
  const { rows } = readFixture('evnat-2026-backtest.csv');
  const GRADES: readonly SchoolGrade[] = [5, 6, 7, 8];

  const scored = rows.map((row) => {
    const schoolMedia = num(row[0]);
    const actual = num(row[3]);
    const years: YearlyMedia[] = GRADES.map((grade) => ({ grade, media: schoolMedia }));
    const prediction = predictMarks({ currentGrade: 8, romana: years, matematica: years });
    return {
      error: prediction.media.mean - actual,
      covered:
        actual >= prediction.media.interval[0] && actual <= prediction.media.interval[1],
      naiveError: schoolMedia - actual,
    };
  });

  const mean = (xs: readonly number[]): number => xs.reduce((a, v) => a + v, 0) / xs.length;
  const mae = (xs: readonly number[]): number => mean(xs.map(Math.abs));

  it('scores several thousand real candidates', () => {
    expect(scored.length).toBeGreaterThan(3000);
  });

  it('is close to unbiased a year after the data it was calibrated on', () => {
    expect(Math.abs(mean(scored.map((s) => s.error)))).toBeLessThan(0.5);
  });

  it('80% intervals cover about 80% of real candidates', () => {
    const rate = scored.filter((s) => s.covered).length / scored.length;
    expect(rate).toBeGreaterThan(0.72);
    expect(rate).toBeLessThan(0.92);
  });

  it('beats reading the catalog at face value, by a wide margin', () => {
    expect(mae(scored.map((s) => s.error))).toBeLessThan(
      mae(scored.map((s) => s.naiveError)) * 0.6,
    );
  });

  it('predicts below the school media for every real candidate', () => {
    // School grades run above exam marks at every level the table covers.
    // A prediction at or above the catalog would mean the inflation
    // correction had inverted somewhere.
    for (const row of rows) {
      const schoolMedia = num(row[0]);
      const years: YearlyMedia[] = GRADES.map((grade) => ({ grade, media: schoolMedia }));
      const p = predictMarks({ currentGrade: 8, romana: years, matematica: years });
      expect(p.media.mean).toBeLessThan(schoolMedia);
    }
  });
});

describe('the measured calibration table', () => {
  it('is monotone in the school record, in both subjects', () => {
    for (let m = 5; m <= 10; m += 0.05) {
      const next = Math.min(m + 0.05, 10);
      expect(calibratedMean('romana', next)).toBeGreaterThanOrEqual(
        calibratedMean('romana', m) - 1e-9,
      );
      expect(calibratedMean('matematica', next)).toBeGreaterThanOrEqual(
        calibratedMean('matematica', m) - 1e-9,
      );
    }
  });

  it('clamps outside the measured range rather than extrapolating', () => {
    expect(calibratedMean('romana', 1)).toBe(calibratedMean('romana', 6));
    expect(calibratedMean('matematica', 10)).toBe(calibratedMean('matematica', 12));
    // A line through the bottom knots would run negative well before a 1.
    expect(calibratedMean('matematica', 1)).toBeGreaterThan(0);
  });

  it('keeps every predicted mark inside the grading scale', () => {
    for (let m = 1; m <= 10; m += 0.05) {
      for (const subject of ['romana', 'matematica'] as const) {
        expect(calibratedMean(subject, m)).toBeGreaterThan(1);
        expect(calibratedMean(subject, m)).toBeLessThan(10);
        expect(calibratedSd(subject, m)).toBeGreaterThan(0);
      }
    }
  });

  it('is wider mid-scale than at the top, where kids bunch against the ceiling', () => {
    expect(calibratedSd('romana', 7.5)).toBeGreaterThan(calibratedSd('romana', 10));
    expect(calibratedSd('matematica', 9)).toBeGreaterThan(calibratedSd('matematica', 10));
  });

  it('says matematica costs more than romana — but only above a school 7', () => {
    /*
     * The two curves cross just below 7. A kid whose catalog says 6.5 does
     * *better* in matematică than in română (3.46 against 3.04); a kid at 9
     * does much worse (6.38 against 7.49). That is the opposite of the folk
     * rule the old priors encoded, which had matematică harsher everywhere by
     * a fixed slope, and it is why the calibration is a measured table rather
     * than two lines: no pair of straight lines fitted to the crowded top of
     * the scale would have found the crossing at the bottom.
     */
    for (let m = 7.25; m <= 10; m += 0.25) {
      expect(calibratedMean('matematica', m)).toBeLessThan(calibratedMean('romana', m));
    }
    for (let m = 6; m <= 6.75; m += 0.25) {
      expect(calibratedMean('matematica', m)).toBeGreaterThan(calibratedMean('romana', m));
    }
  });

  it('opens the widest subject gap mid-scale, not at the ceiling', () => {
    const gap = (m: number): number => calibratedMean('romana', m) - calibratedMean('matematica', m);
    expect(gap(8.75)).toBeGreaterThan(gap(10));
    expect(gap(8.75)).toBeGreaterThan(gap(7));
  });
});

describe('the county table behind the dataset', () => {
  it('covers exactly the 42 prefixes the published file uses', () => {
    const prefixes = Object.keys(COUNTY_BY_SIIIR_PREFIX);
    expect(prefixes).toHaveLength(42);
    // 01..40 with Bucuresti last, then Calarasi and Giurgiu appended.
    for (let i = 1; i <= 40; i += 1) {
      expect(prefixes).toContain(String(i).padStart(2, '0'));
    }
    expect(prefixes).toContain('51');
    expect(prefixes).toContain('52');
  });

  it('maps each prefix to a distinct county code', () => {
    const codes = Object.values(COUNTY_BY_SIIIR_PREFIX);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('xlsx column references', () => {
  it('decodes spreadsheet column letters', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('B2')).toBe(1);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA1')).toBe(26);
    expect(columnIndex('BC12')).toBe(54);
  });
});

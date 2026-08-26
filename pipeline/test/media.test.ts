import { describe, expect, it } from 'vitest';
import {
  computeMediaAdmitere,
  formatMedia,
  MediaError,
  parseMediaCell,
  truncateToTwoDecimals,
} from '../src/util/media.js';

describe('computeMediaAdmitere — (romana + matematica) / 2, truncated', () => {
  it('truncates the canonical 9.855 case down to 9.85', () => {
    // 9.90 and 9.81 average to exactly 9.855. Rounding would give 9.86 and
    // would put a candidate over cutoffs they did not actually clear.
    expect(computeMediaAdmitere(9.9, 9.81)).toBe(9.85);
  });

  it('never rounds up, at any half-hundredth', () => {
    const halves: [number, number, number][] = [
      [10, 9.99, 9.99], // 9.995 -> 9.99
      [9.5, 9.51, 9.5], // 9.505 -> 9.50
      [8.2, 8.21, 8.2], // 8.205 -> 8.20
      [7.0, 7.01, 7.0], // 7.005 -> 7.00
      [1.0, 1.01, 1.0], // 1.005 -> 1.00
      [6.66, 6.67, 6.66], // 6.665 -> 6.66
    ];
    for (const [romana, matematica, expected] of halves) {
      expect(computeMediaAdmitere(romana, matematica)).toBe(expected);
    }
  });

  it('keeps exact averages exactly — truncation must not shave a real hundredth', () => {
    // The float trap: 9.86 * 100 === 985.9999999999999, so a naive
    // Math.floor(x * 100) / 100 would report 9.85 here.
    expect(computeMediaAdmitere(9.9, 9.82)).toBe(9.86);
    expect(computeMediaAdmitere(9.86, 9.86)).toBe(9.86);
    expect(computeMediaAdmitere(8.29, 8.29)).toBe(8.29);
    expect(computeMediaAdmitere(10, 10)).toBe(10);
    expect(computeMediaAdmitere(1, 1)).toBe(1);
  });

  it('is symmetric in its two arguments', () => {
    expect(computeMediaAdmitere(9.9, 9.81)).toBe(computeMediaAdmitere(9.81, 9.9));
    expect(computeMediaAdmitere(7.35, 9.2)).toBe(computeMediaAdmitere(9.2, 7.35));
  });

  it('agrees with exact decimal arithmetic across the whole grade range', () => {
    for (let r = 100; r <= 1000; r += 7) {
      for (let m = 100; m <= 1000; m += 13) {
        const expected = Math.floor((r + m) / 2) / 100;
        expect(computeMediaAdmitere(r / 100, m / 100)).toBe(expected);
      }
    }
  });

  it('rejects grades outside 1..10 and grades with too many decimals', () => {
    expect(() => computeMediaAdmitere(10.5, 9)).toThrow(MediaError);
    expect(() => computeMediaAdmitere(0.5, 9)).toThrow(MediaError);
    expect(() => computeMediaAdmitere(9.855, 9)).toThrow(/more than two decimals/);
    expect(() => computeMediaAdmitere(Number.NaN, 9)).toThrow(MediaError);
  });
});

describe('truncateToTwoDecimals', () => {
  it('truncates rather than rounds', () => {
    expect(truncateToTwoDecimals(9.855)).toBe(9.85);
    expect(truncateToTwoDecimals(9.859)).toBe(9.85);
    expect(truncateToTwoDecimals(9.999)).toBe(9.99);
  });

  it('leaves values that already have two decimals untouched', () => {
    for (const v of [9.86, 8.11, 7.0, 10, 1.05, 6.6]) {
      expect(truncateToTwoDecimals(v)).toBe(v);
    }
  });

  it('is idempotent', () => {
    const once = truncateToTwoDecimals(9.8551);
    expect(truncateToTwoDecimals(once)).toBe(once);
  });

  it('rejects non-finite input', () => {
    expect(() => truncateToTwoDecimals(Number.POSITIVE_INFINITY)).toThrow(MediaError);
  });
});

describe('parseMediaCell', () => {
  it('reads both decimal separators', () => {
    expect(parseMediaCell('9,85')).toBe(9.85);
    expect(parseMediaCell('9.85')).toBe(9.85);
    expect(parseMediaCell(' 9,85 ')).toBe(9.85);
    expect(parseMediaCell('10')).toBe(10);
  });

  it('truncates extra published decimals instead of rounding them', () => {
    expect(parseMediaCell('9,859')).toBe(9.85);
    expect(parseMediaCell('9,8599999')).toBe(9.85);
  });

  it('pads a single published decimal', () => {
    expect(parseMediaCell('9,5')).toBe(9.5);
    expect(formatMedia(parseMediaCell('9,5'))).toBe('9.50');
  });

  it('returns null for the cells that mean "no cutoff published"', () => {
    for (const empty of ['', '-', '—', '–', 'n/a', '*']) {
      expect(parseMediaCell(empty)).toBeNull();
    }
  });

  it('throws on anything it does not recognize, rather than silently nulling', () => {
    expect(() => parseMediaCell('nota 9')).toThrow(MediaError);
    expect(() => parseMediaCell('12,00')).toThrow(/outside/);
    expect(() => parseMediaCell('9,85 (contestatie)')).toThrow(MediaError);
  });
});

describe('formatMedia', () => {
  it('always shows two decimals, and empty for null', () => {
    expect(formatMedia(9.5)).toBe('9.50');
    expect(formatMedia(10)).toBe('10.00');
    expect(formatMedia(null)).toBe('');
  });
});

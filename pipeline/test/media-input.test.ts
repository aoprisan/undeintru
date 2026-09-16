import { describe, expect, it } from 'vitest';
import { parseMediaInput } from '../../app/src/data/media-input.js';

describe('admission average input', () => {
  it.each(['', 'NaN', 'Infinity', '-1', '0.99', '11', '10.001', '1e1', 'abc'])(
    'rejects invalid or out-of-range input %s', (raw) => {
      expect(parseMediaInput(raw)).toBeNull();
    },
  );
  it.each([
    ['9.855', 9.85], ['9.86', 9.86], ['9,855', 9.85], ['1', 1],
    ['10.000', 10], [' 8.9 ', 8.9], ['9.99999999999999999', 9.99],
  ] as const)('truncates %s to %s', (raw, expected) => {
    expect(parseMediaInput(raw)).toBe(expected);
  });
  it('preserves every valid hundredth', () => {
    for (let value = 100; value <= 1000; value += 1) {
      expect(parseMediaInput((value / 100).toFixed(2))).toBe(value / 100);
    }
  });
});

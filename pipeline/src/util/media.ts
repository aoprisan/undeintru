/**
 * "Media de admitere" arithmetic.
 *
 * Since 2023 the admission media is the plain average of the Evaluarea
 * Națională grades:
 *
 *     media = (romana + matematica) / 2                    (most candidates)
 *     media = (romana + limba maternă + matematica) / 3    (minority-language)
 *
 * kept to two decimals and **truncated, not rounded**: 9.855 becomes 9.85, not
 * 9.86. Rounding here is not a cosmetic difference — it moves a candidate
 * across a cutoff and changes which schools the app says they can enter.
 *
 * The three-subject form is not a footnote. Candidates schooled in a minority
 * language sit a third written paper, *Limba și literatura maternă*, and it
 * enters the media on equal footing. In the 2025 national results it is
 * 9,024 of the 152,644 candidates who sat both common papers — 5.9% overall,
 * and the majority in Harghita and Covasna. Averaging only two grades for
 * them yields a different number, so it is a wrong answer for a whole county,
 * not a rounding quibble.
 *
 * Every grade carries at most two decimals, so everything is computed in
 * integer hundredths. Doing it in floating point is wrong in a way that is
 * easy to miss: `9.86 * 100` is `985.9999999999999` in IEEE-754, and flooring
 * that silently yields 9.85 for a value that should have stayed 9.86.
 *
 * Both branches are checked against the published 2025 national results:
 * every one of the 152,644 rows reproduces exactly, the three-subject rows
 * only under the three-subject form. See `pipeline/test/media.test.ts`.
 */

/** Romanian grades run 1..10. */
export const GRADE_MIN = 1;
export const GRADE_MAX = 10;

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

/** Exact hundredths for a grade with at most two decimals. */
function gradeToHundredths(grade: number, what: string): number {
  if (!Number.isFinite(grade)) {
    throw new MediaError(`${what}: expected a finite grade, got ${String(grade)}`);
  }
  if (grade < GRADE_MIN || grade > GRADE_MAX) {
    throw new MediaError(`${what}: grade ${grade} is outside ${GRADE_MIN}..${GRADE_MAX}`);
  }
  const hundredths = Math.round(grade * 100);
  if (Math.abs(grade * 100 - hundredths) > 1e-6) {
    throw new MediaError(`${what}: grade ${grade} has more than two decimals`);
  }
  return hundredths;
}

/**
 * Media de admitere from the Evaluarea Națională grades, 2023 formula.
 * Two decimals, truncated toward zero.
 *
 * Pass `limbaMaterna` for a candidate who sat the minority-language paper:
 * the media is then the mean of all three grades. Omit it — or pass
 * `undefined`/`null` — for the common two-subject case. The distinction is
 * carried by the argument rather than a flag so that a caller cannot claim a
 * three-subject candidate and then fail to supply the grade.
 *
 * @example computeMediaAdmitere(9.90, 9.81) // 9.85 — the exact value is 9.855
 * @example computeMediaAdmitere(5.70, 3.10, 9.05) // 5.95 — exactly 5.95
 */
export function computeMediaAdmitere(
  romana: number,
  matematica: number,
  limbaMaterna?: number | null,
): number {
  const romanaH = gradeToHundredths(romana, 'romana');
  const matematicaH = gradeToHundredths(matematica, 'matematica');

  // Both branches floor in integer hundredths: halving or thirding may land
  // between hundredths — exactly the 9.855 case — and the rules truncate.
  if (limbaMaterna === undefined || limbaMaterna === null) {
    return Math.floor((romanaH + matematicaH) / 2) / 100;
  }
  const maternaH = gradeToHundredths(limbaMaterna, 'limba materna');
  return Math.floor((romanaH + maternaH + matematicaH) / 3) / 100;
}

/**
 * Truncate an already-computed media to two decimals.
 *
 * `toFixed(10)` first, to shed the double-representation noise that would
 * otherwise make a true 9.86 truncate to 9.85, then cut the decimal string.
 * Truncation is applied to the decimal expansion, never via `Math.floor(x*100)`.
 */
export function truncateToTwoDecimals(value: number): number {
  if (!Number.isFinite(value)) {
    throw new MediaError(`expected a finite number, got ${String(value)}`);
  }
  const negative = value < 0;
  const text = Math.abs(value).toFixed(10);
  const dot = text.indexOf('.');
  const truncated = Number(text.slice(0, dot + 3));
  return negative ? -truncated : truncated;
}

const MEDIA_CELL_RE = /^(\d{1,2})(?:[.,](\d+))?$/;
/** Cell contents that mean "no cutoff published" rather than "parse failure". */
const EMPTY_CELL_VALUES = new Set(['', '-', '--', '—', '–', 'n/a', 'N/A', '.', '*']);

/**
 * Parse a published media cell.
 *
 * Handles the comma decimal separator Romanian tables use, truncates any extra
 * decimals on the *string* (never via float arithmetic), and returns `null`
 * for the blank/dash cells that mean the specialization published no cutoff.
 *
 * @throws MediaError when the cell holds something that is neither a media nor
 *   a recognized "empty" marker — an unrecognized cell is a parser bug and
 *   must fail loudly rather than become a silent `null`.
 */
export function parseMediaCell(raw: string): number | null {
  const text = raw.replace(/\s+/g, '').trim();
  if (EMPTY_CELL_VALUES.has(text)) return null;

  const match = MEDIA_CELL_RE.exec(text);
  if (!match) throw new MediaError(`unrecognized media cell ${JSON.stringify(raw)}`);

  const whole = match[1] ?? '';
  const frac = (match[2] ?? '').slice(0, 2).padEnd(2, '0');
  const value = Number(`${whole}.${frac}`);

  if (value < GRADE_MIN || value > GRADE_MAX) {
    throw new MediaError(`media ${value} is outside ${GRADE_MIN}..${GRADE_MAX}`);
  }
  return value;
}

/** Render a media the way the app and the JSON files show it. */
export function formatMedia(value: number | null): string {
  return value === null ? '' : value.toFixed(2);
}

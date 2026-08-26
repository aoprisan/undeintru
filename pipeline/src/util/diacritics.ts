/**
 * Romanian diacritics normalization.
 *
 * Romanian ș and ț are *comma-below* letters (U+0219 / U+021B). For historical
 * reasons — Unicode 1.0 had no comma-below forms, and Windows-1250 shipped the
 * Turkish cedilla ones — a great deal of Romanian public data, admitere.edu.ro
 * included, uses the *cedilla* letters ş (U+015F) and ţ (U+0163) instead. The
 * two look nearly identical in most fonts but are different code points, so
 * "Şaguna" and "Șaguna" do not compare equal, do not sort together, and do not
 * match the same search query.
 *
 * Everything entering the dataset goes through here so there is exactly one
 * spelling of every school name.
 */

/** Cedilla forms mapped to their comma-below counterparts. */
const CEDILLA_TO_COMMA: ReadonlyMap<string, string> = new Map([
  ['ş', 'ș'], // ş -> ș
  ['Ş', 'Ș'], // Ş -> Ș
  ['ţ', 'ț'], // ţ -> ț
  ['Ţ', 'Ț'], // Ţ -> Ț
]);

/**
 * Some sources emit a bare letter followed by a combining mark. NFC composes
 * s + U+0327 into the precomposed ş, which the map above then handles; a
 * combining *comma below* (U+0326) has no precomposed s/t form in NFC, so it
 * survives normalization and must be folded explicitly.
 */
const COMBINING_COMMA_BELOW = '\u0326';
const COMBINING_CEDILLA = '\u0327';

const COMBINING_PAIRS: ReadonlyMap<string, string> = new Map([
  [`s${COMBINING_COMMA_BELOW}`, 'ș'],
  [`S${COMBINING_COMMA_BELOW}`, 'Ș'],
  [`t${COMBINING_COMMA_BELOW}`, 'ț'],
  [`T${COMBINING_COMMA_BELOW}`, 'Ț'],
  [`s${COMBINING_CEDILLA}`, 'ș'],
  [`S${COMBINING_CEDILLA}`, 'Ș'],
  [`t${COMBINING_CEDILLA}`, 'ț'],
  [`T${COMBINING_CEDILLA}`, 'Ț'],
]);

const COMBINING_RE = /[sStT][\u0326\u0327]/g;
const CEDILLA_RE = /[ŞşŢţ]/g;

/**
 * Convert cedilla ş/ţ to comma-below ș/ț and return NFC.
 *
 * Leaves ă, â and î alone — those are the same code points under both
 * conventions and only need NFC composition.
 */
export function fixDiacritics(input: string): string {
  return input
    .normalize('NFC')
    .replace(COMBINING_RE, (m) => COMBINING_PAIRS.get(m) ?? m)
    .replace(CEDILLA_RE, (m) => CEDILLA_TO_COMMA.get(m) ?? m)
    .normalize('NFC');
}

/** Non-breaking and other exotic spaces that HTML tables are full of. */
const ODD_SPACE_RE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
/** Soft hyphen and zero-width characters that survive copy-paste. */
const INVISIBLE_RE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Full text cleanup for any string that lands in the dataset: fix diacritics,
 * drop invisibles, fold every run of whitespace to one space, and trim.
 *
 * The schema rejects untrimmed text, so this is not cosmetic.
 */
export function normalizeText(input: string): string {
  return fixDiacritics(input)
    .replace(INVISIBLE_RE, '')
    .replace(ODD_SPACE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Casefold for comparison only — strips diacritics down to ASCII so
 * "Şaguna", "Șaguna" and "Saguna" all match a parent typing without a
 * Romanian keyboard. Never store the result.
 */
export function foldForSearch(input: string): string {
  return normalizeText(input)
    .toLocaleLowerCase('ro-RO')
    .replace(/ș/g, 's')
    .replace(/ț/g, 't')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .normalize('NFC');
}

import { describe, expect, it } from 'vitest';
import { fixDiacritics, foldForSearch, normalizeText } from '../src/util/diacritics.js';

const S_CEDILLA = 'ş'; // ş
const T_CEDILLA = 'ţ'; // ţ
const S_COMMA = 'ș'; // ș
const T_COMMA = 'ț'; // ț

describe('fixDiacritics', () => {
  it('converts cedilla ş/ţ to comma-below ș/ț in both cases', () => {
    expect(fixDiacritics(S_CEDILLA)).toBe(S_COMMA);
    expect(fixDiacritics(T_CEDILLA)).toBe(T_COMMA);
    expect(fixDiacritics('Ş')).toBe('Ș'); // Ş -> Ș
    expect(fixDiacritics('Ţ')).toBe('Ț'); // Ţ -> Ț
  });

  it('fixes real school names from the source data', () => {
    expect(fixDiacritics('Colegiul Natţional "Gheorghe Lazăr"')).toBe(
      'Colegiul Natțional "Gheorghe Lazăr"',
    );
    expect(fixDiacritics('Şaguna')).toBe('Șaguna');
    expect(fixDiacritics('Şcoala Postliceală')).toBe('Școala Postliceală');
  });

  it('leaves already-correct comma-below text alone', () => {
    const good = 'Colegiul Național Ștefan cel Mare';
    expect(fixDiacritics(good)).toBe(good);
  });

  it('leaves ă, â and î untouched', () => {
    expect(fixDiacritics('ăâîĂÂÎ')).toBe(
      'ăâîĂÂÎ',
    );
  });

  it('folds decomposed combining marks — cedilla and comma below alike', () => {
    // s + U+0327 COMBINING CEDILLA; NFC composes it to precomposed ş first.
    expect(fixDiacritics('s\u0327')).toBe(S_COMMA);
    expect(fixDiacritics('t\u0327')).toBe(T_COMMA);
    // s + U+0326 COMBINING COMMA BELOW; no precomposed form exists in NFC,
    // so this one only survives because we fold it explicitly.
    expect(fixDiacritics('s\u0326')).toBe(S_COMMA);
    expect(fixDiacritics('T\u0326')).toBe('\u021A');
  });

  it('returns NFC', () => {
    const out = fixDiacritics('Bras\u0327ov a\u0306'); // s + cedilla, a + breve
    expect(out).toBe(out.normalize('NFC'));
    expect(out).toBe('Brașov ă');
  });

  it('is idempotent', () => {
    const input = 'Liceul Teoretic "Constantin Noica" şi Naţional';
    expect(fixDiacritics(fixDiacritics(input))).toBe(fixDiacritics(input));
  });
});

describe('normalizeText', () => {
  it('trims and collapses whitespace, including non-breaking spaces', () => {
    expect(normalizeText('  Colegiul  Naţional \n  Gheorghe   Lazăr  ')).toBe(
      'Colegiul Național Gheorghe Lazăr',
    );
  });

  it('strips soft hyphens, zero-width characters and BOMs', () => {
    expect(normalizeText('\uFEFFMate\u00ADmatic\u0103-\u200BInformatic\u0103')).toBe(
      'Matematică-Informatică',
    );
  });

  it('produces text the schema accepts as trimmed', () => {
    const out = normalizeText('  Știinţe ale naturii  ');
    expect(out).toBe(out.trim());
    expect(out).toBe('Științe ale naturii');
  });

  it('is idempotent', () => {
    const input = ' Filologie  \u015Fi  \u200Bistorie ';
    expect(normalizeText(normalizeText(input))).toBe(normalizeText(input));
  });
});

describe('foldForSearch', () => {
  it('makes every spelling of a name match', () => {
    const folded = 'saguna';
    expect(foldForSearch('Șaguna')).toBe(folded);
    expect(foldForSearch('Şaguna')).toBe(folded);
    expect(foldForSearch('Saguna')).toBe(folded);
  });

  it('reduces ă/â/î to ASCII', () => {
    expect(foldForSearch('Gheorghe Lazăr')).toBe('gheorghe lazar');
    expect(foldForSearch('Română')).toBe('romana');
    expect(foldForSearch('Învățământ')).toBe('invatamant');
  });
});

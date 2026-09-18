import { describe, expect, it } from 'vitest';

import {
  COURSE_DOMAINS,
  TEHNOLOGICA_DOMAINS,
  resolveSpecLabel,
} from '../../app/src/model/courseDomains.js';
import { uniqueCourses } from '../../app/src/model/predict.js';
import type { AdmissionRow } from '../src/schema.js';
import { collectEvidence, lexicalDomain, qualificationOf } from '../src/alias/evidence.js';
import { classifyQualifications, type SystemOneClient } from '../src/alias/classify.js';
import { combine } from '../src/alias/fit.js';

function row(over: Partial<AdmissionRow> & Pick<AdmissionRow, 'specLabel'>): AdmissionRow {
  return {
    year: 2026, county: 'SB', schoolCode: '1', schoolName: 'Liceul Test', specId: '1',
    profile: 'Tehnic', filiera: 'tehnologica', limba: 'Limba română', seats: 28,
    lastMedia: 6, vocational: false, ...over,
  };
}

describe('resolveSpecLabel', () => {
  it('translates a 2026 calificare to its 2025 domeniu', () => {
    expect(resolveSpecLabel('Tehnician în gastronomie / Bucătar')).toBe('Turism și alimentație');
  });

  it('drops the dual qualifier, which 2025 cannot express', () => {
    expect(resolveSpecLabel('Tehnician în gastronomie / Bucătar (dual)')).toBe(
      'Turism și alimentație',
    );
  });

  it('keeps the bilingual qualifier, which both generations publish', () => {
    expect(resolveSpecLabel('Tehnician în turism / Lucrător hotelier (bilingv: Limba engleză)'))
      .toBe('Turism și alimentație (bilingv: Limba engleză)');
  });

  it('leaves a label it does not cover alone, so a gap costs matches but never invents one', () => {
    expect(resolveSpecLabel('Matematică-Informatică')).toBeNull();
    expect(resolveSpecLabel('Mecanică')).toBeNull();
    expect(resolveSpecLabel('Tehnician în ceva ce nu există / Nimic')).toBeNull();
  });

  it('only maps onto domains the 2025 generation actually published', () => {
    for (const domain of Object.values(COURSE_DOMAINS)) {
      expect(TEHNOLOGICA_DOMAINS).toContain(domain);
    }
  });
});

describe('uniqueCourses across the vocabulary change', () => {
  const previous = [row({ year: 2025, specLabel: 'Turism și alimentație' })];

  it('matches a course whose label changed generation', () => {
    const current = [row({ specId: '9', specLabel: 'Tehnician în gastronomie / Bucătar' })];
    const [prevKey] = [...uniqueCourses(previous).keys()];
    expect([...uniqueCourses(current).keys()]).toEqual([prevKey]);
  });

  it('drops both sides when two calificări collapse onto one domeniu', () => {
    const current = [
      row({ specId: '9', specLabel: 'Tehnician în gastronomie / Bucătar' }),
      row({ specId: '10', specLabel: 'Tehnician în turism / Lucrător hotelier' }),
    ];
    expect(uniqueCourses(current).size).toBe(0);
  });
});

describe('collectEvidence', () => {
  const previous: AdmissionRow[] = [
    row({ year: 2025, schoolCode: 'A', specLabel: 'Mecanică' }),
    row({ year: 2025, schoolCode: 'B', specLabel: 'Mecanică' }),
    row({ year: 2025, schoolCode: 'B', specLabel: 'Economic' }),
  ];
  const current: AdmissionRow[] = [
    row({ schoolCode: 'A', specLabel: 'Tehnician mecatronist / Sudor' }),
    row({ schoolCode: 'B', specLabel: 'Tehnician mecatronist / Strungar (dual)' }),
  ];

  it('votes for the domains taught by the same school', () => {
    const [item] = collectEvidence(previous, current);
    expect(item?.qualification).toBe('Tehnician mecatronist');
    expect(item?.rows).toBe(2);
    expect(item?.votes[0]).toEqual({ domain: 'Mecanică', count: 2 });
    expect(item?.votes[1]).toEqual({ domain: 'Economic', count: 1 });
  });

  it('ignores teoretică rows entirely', () => {
    const withTeoretica = [...current, row({ filiera: 'teoretica', specLabel: 'Filologie' })];
    expect(collectEvidence(previous, withTeoretica)).toHaveLength(1);
  });
});

describe('lexicalDomain', () => {
  it('reads the domeniu out of the calificare when it is named', () => {
    expect(lexicalDomain('Tehnician în chimie industrială')).toBe('Chimie industrială');
  });

  it('declines when the name is not there, rather than guessing', () => {
    expect(lexicalDomain('Tehnician mecatronist')).toBeNull();
  });

  it('declines when two domains are named, since that is evidence for neither', () => {
    expect(lexicalDomain('Tehnician silvicultură și agricultură')).toBeNull();
  });
});

describe('combine', () => {
  const evidence = collectEvidence(
    [row({ year: 2025, schoolCode: 'A', specLabel: 'Mecanică' })],
    [row({ schoolCode: 'A', specLabel: 'Tehnician mecatronist / Sudor' })],
  );

  it('settles a clear co-occurrence lead', () => {
    expect(combine(evidence, [])[0]?.agreed).toBe('Mecanică');
  });

  it('leaves a tie unsettled', () => {
    const tied = collectEvidence(
      [
        row({ year: 2025, schoolCode: 'A', specLabel: 'Mecanică' }),
        row({ year: 2025, schoolCode: 'A', specLabel: 'Economic' }),
      ],
      [row({ schoolCode: 'A', specLabel: 'Tehnician mecatronist / Sudor' })],
    );
    expect(combine(tied, [])[0]?.agreed).toBeNull();
  });

  it('reports the model separately instead of letting it decide', () => {
    const [proposal] = combine(evidence, [
      { qualification: 'Tehnician mecatronist', domain: 'Electric', confidence: 0.9, inputTokens: 12 },
    ]);
    expect(proposal?.agreed).toBe('Mecanică');
    expect(proposal?.model).toBe('Electric');
  });
});

describe('classifyQualifications', () => {
  /** Stands in for the SDK: same call shape, no key, no network. */
  const stub = (choice: string): SystemOneClient => ({
    systemOne: (request) => {
      expect(request.questions['domain']).toMatchObject({ type: 'choice' });
      return Promise.resolve({
        answers: { domain: { choice, confidence: 0.82, probabilities: { [choice]: 0.82 } } },
        usage: { input_tokens: 17 },
      });
    },
  });

  it('returns the chosen domeniu with its confidence', async () => {
    const [proposal] = await classifyQualifications(stub('Mecanică'), ['Tehnician mecatronist']);
    expect(proposal).toEqual({
      qualification: 'Tehnician mecatronist', domain: 'Mecanică',
      confidence: 0.82, inputTokens: 17,
    });
  });

  it('refuses an answer outside the domains it offered', async () => {
    await expect(classifyQualifications(stub('Ceva nou'), ['Tehnician mecatronist']))
      .rejects.toThrow(/unknown domeniu/);
  });
});

describe('qualificationOf', () => {
  it('takes the liceal half of the pair', () => {
    expect(qualificationOf('Tehnician în turism / Bucătar (dual)')).toBe('Tehnician în turism');
  });
});

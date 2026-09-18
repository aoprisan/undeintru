/**
 * Two offline signals for the calificare -> domeniu table, neither of which
 * needs a network, a key or a model.
 *
 * **Co-occurrence.** A school that offered `"Mecanică"` in 2025 and offers
 * `"Tehnician mecatronist / ..."` in 2026 is weak evidence that the second is
 * the first. One school proves nothing; 42 counties of them are a vote. The
 * signal is noisy in a specific way — a school offering four domains votes for
 * all four — so it is read as an argmax with a margin, never as a fact.
 *
 * **Lexicon.** Many calificări simply contain their domeniu:
 * `"Tehnician în chimie industrială"` is `"Chimie industrială"`. Co-occurrence
 * is systematically wrong on exactly these, because a school teaching chemistry
 * usually teaches four other things too, so the lexical signal is the one that
 * corrects it.
 *
 * They disagree often enough to be worth keeping apart. Agreement is a proposal
 * worth trusting; disagreement is what a human — or a third opinion, see
 * `classify.ts` — has to settle.
 */

import type { AdmissionRow } from '../schema.js';
import { domainKey, TEHNOLOGICA_DOMAINS } from '../../../app/src/model/courseDomains.js';
import type { TehnologicaDomain } from '../../../app/src/model/courseDomains.js';

/** The liceal qualification a 2026 label starts with, without its qualifiers. */
export function qualificationOf(specLabel: string): string {
  const stripped = specLabel.replace(/ \(dual\)$/, '').replace(/ \(bilingv: [^)]*\)/, '');
  return stripped.split(' / ')[0] ?? stripped;
}

/** A published label reduced to its domeniu, for the years that publish one. */
export function domainOf(specLabel: string): string {
  return specLabel.replace(/ \(dual\)$/, '').replace(/ \(bilingv: [^)]*\)/, '');
}

export interface DomainVote {
  readonly domain: TehnologicaDomain;
  readonly count: number;
}

export interface QualificationEvidence {
  readonly qualification: string;
  /** How many rows nationwide carry this qualification. */
  readonly rows: number;
  /** Co-occurrence votes, strongest first. */
  readonly votes: readonly DomainVote[];
  /** Share of the votes held by the leader, 0..1; `null` with no votes. */
  readonly leadShare: number | null;
  /** The domeniu whose name the qualification contains, when exactly one does. */
  readonly lexical: TehnologicaDomain | null;
}

/**
 * Score every 2026 qualification against the 2025 domains of the same schools.
 *
 * @param previous rows from the generation that publishes the domeniu.
 * @param current rows from the generation that publishes the calificare.
 */
export function collectEvidence(
  previous: readonly AdmissionRow[],
  current: readonly AdmissionRow[],
): QualificationEvidence[] {
  const domainsBySchool = new Map<string, Set<string>>();
  for (const row of previous) {
    if (row.filiera !== 'tehnologica') continue;
    let set = domainsBySchool.get(row.schoolCode);
    if (!set) {
      set = new Set<string>();
      domainsBySchool.set(row.schoolCode, set);
    }
    set.add(domainOf(row.specLabel));
  }

  const rowCount = new Map<string, number>();
  const qualificationsBySchool = new Map<string, Set<string>>();
  for (const row of current) {
    if (row.filiera !== 'tehnologica') continue;
    const qualification = qualificationOf(row.specLabel);
    rowCount.set(qualification, (rowCount.get(qualification) ?? 0) + 1);
    let set = qualificationsBySchool.get(row.schoolCode);
    if (!set) {
      set = new Set<string>();
      qualificationsBySchool.set(row.schoolCode, set);
    }
    set.add(qualification);
  }

  const tally = new Map<string, Map<string, number>>();
  for (const [school, qualifications] of qualificationsBySchool) {
    const domains = domainsBySchool.get(school);
    if (!domains) continue;
    for (const qualification of qualifications) {
      let counts = tally.get(qualification);
      if (!counts) {
        counts = new Map<string, number>();
        tally.set(qualification, counts);
      }
      for (const domain of domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
  }

  const evidence: QualificationEvidence[] = [];
  for (const [qualification, rows] of rowCount) {
    const counts = tally.get(qualification) ?? new Map<string, number>();
    const votes: DomainVote[] = [];
    for (const [label, count] of counts) {
      const domain = asDomain(label);
      if (domain !== null) votes.push({ domain, count });
    }
    votes.sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain, 'ro'));
    const total = votes.reduce((sum, vote) => sum + vote.count, 0);
    evidence.push({
      qualification,
      rows,
      votes,
      leadShare: total === 0 ? null : (votes[0]?.count ?? 0) / total,
      lexical: lexicalDomain(qualification),
    });
  }
  evidence.sort((a, b) => a.qualification.localeCompare(b.qualification, 'ro'));
  return evidence;
}

/** A published 2025 label as one of the known domains, ignoring bilingual variants. */
function asDomain(label: string): TehnologicaDomain | null {
  const key = domainKey(label);
  return TEHNOLOGICA_DOMAINS.find((domain) => domainKey(domain) === key) ?? null;
}

/**
 * The domeniu named inside a qualification, when exactly one is.
 *
 * Ambiguity disqualifies rather than ranks: `"Tehnician în industria alimentară
 * fermentativă"` contains only `"Industrie alimentară"` after folding, but a
 * label containing two domain names is not evidence for either.
 */
export function lexicalDomain(qualification: string): TehnologicaDomain | null {
  const haystack = domainKey(qualification).replace(/\bindustria\b/g, 'industrie');
  const hits = TEHNOLOGICA_DOMAINS.filter((domain) => haystack.includes(domainKey(domain)));
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

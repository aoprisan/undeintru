/**
 * Propose the calificare -> domeniu table, and say how much of it is settled.
 *
 * Reads two published generations, scores every liceal qualification with the
 * offline signals in `evidence.ts`, optionally adds the model's opinion, and
 * prints the table as the TypeScript literal that goes into
 * `app/src/model/courseDomains.ts` — the same hand-review loop
 * `just evnat-calibrate` uses for the exam-mark table.
 *
 * It prints; it does not write. The committed table is reviewed by a human,
 * because a wrong entry silently pairs two different courses and the model
 * downstream cannot tell.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { PUBLIC_DATA_DIR } from '../paths.js';
import { assertCountyDataset } from '../schema.js';
import type { AdmissionRow } from '../schema.js';
import { COURSE_DOMAINS } from '../../../app/src/model/courseDomains.js';
import type { TehnologicaDomain } from '../../../app/src/model/courseDomains.js';
import { collectEvidence, type QualificationEvidence } from './evidence.js';
import { classifyQualifications, createClient, type ModelProposal } from './classify.js';

export interface FitOptions {
  /** The generation publishing the domeniu. */
  readonly previousYear: number;
  /** The generation publishing the calificare. */
  readonly currentYear: number;
  /** Also ask the model, when a key and the SDK are both present. */
  readonly useModel?: boolean;
}

/** Where a proposal came from, and how strongly. */
export interface Proposal {
  readonly qualification: string;
  readonly rows: number;
  readonly cooccurrence: TehnologicaDomain | null;
  readonly leadShare: number | null;
  readonly lexical: TehnologicaDomain | null;
  readonly model: TehnologicaDomain | null;
  readonly modelConfidence: number | null;
  /** The value the signals agree on, or `null` when they do not. */
  readonly agreed: TehnologicaDomain | null;
  /** What the committed table says today, for regression review. */
  readonly committed: TehnologicaDomain | null;
}

async function loadYear(year: number): Promise<AdmissionRow[]> {
  const dir = join(PUBLIC_DATA_DIR, String(year));
  const rows: AdmissionRow[] = [];
  for (const name of (await readdir(dir)).filter((file) => file.endsWith('.json')).sort()) {
    const dataset = assertCountyDataset(JSON.parse(await readFile(join(dir, name), 'utf8')));
    rows.push(...dataset.rows);
  }
  return rows;
}

/**
 * Combine the signals into one proposal per qualification.
 *
 * Agreement rule: the lexical signal wins outright when it fires, because it
 * reads the label the ministry wrote rather than inferring from who teaches
 * what. Otherwise co-occurrence must both lead and lead clearly. Everything
 * else is left unsettled on purpose — an unsettled qualification costs matches,
 * a wrong one corrupts them.
 */
export function combine(
  evidence: readonly QualificationEvidence[],
  proposals: readonly ModelProposal[],
): Proposal[] {
  const byQualification = new Map(proposals.map((p) => [p.qualification, p]));
  return evidence.map((item) => {
    const leader = item.votes[0]?.domain ?? null;
    const runnerUp = item.votes[1]?.count ?? 0;
    const clear =
      leader !== null && item.leadShare !== null && (item.votes[0]?.count ?? 0) > runnerUp;
    const model = byQualification.get(item.qualification);
    const agreed = item.lexical ?? (clear ? leader : null);
    return {
      qualification: item.qualification,
      rows: item.rows,
      cooccurrence: leader,
      leadShare: item.leadShare,
      lexical: item.lexical,
      model: model?.domain ?? null,
      modelConfidence: model?.confidence ?? null,
      agreed,
      committed: COURSE_DOMAINS[item.qualification] ?? null,
    };
  });
}

/** The table as the TypeScript literal for `app/src/model/courseDomains.ts`. */
export function formatTable(proposals: readonly Proposal[]): string {
  const lines = proposals
    .filter((p) => p.agreed !== null)
    .map((p) => `  ${JSON.stringify(p.qualification)}: ${JSON.stringify(p.agreed)},`);
  return `export const COURSE_DOMAINS: Readonly<Record<string, TehnologicaDomain>> = {\n${lines.join('\n')}\n};`;
}

export async function fitAliases(options: FitOptions): Promise<void> {
  const [previous, current] = await Promise.all([
    loadYear(options.previousYear),
    loadYear(options.currentYear),
  ]);
  const evidence = collectEvidence(previous, current);

  let proposals: ModelProposal[] = [];
  if (options.useModel) {
    const client = await createClient();
    if ('reason' in client) {
      process.stdout.write(`Model opinion skipped: ${client.reason}\n\n`);
    } else {
      proposals = await classifyQualifications(
        client,
        evidence.map((item) => item.qualification),
      );
      const tokens = proposals.reduce((sum, p) => sum + p.inputTokens, 0);
      process.stdout.write(`Model: ${proposals.length} calls, ${tokens} input tokens\n\n`);
    }
  }

  const combined = combine(evidence, proposals);
  const settled = combined.filter((p) => p.agreed !== null);
  const unsettled = combined.filter((p) => p.agreed === null);
  const changed = combined.filter((p) => p.agreed !== null && p.committed !== p.agreed);
  const modelDisagrees = combined.filter(
    (p) => p.model !== null && p.agreed !== null && p.model !== p.agreed,
  );

  const rows = combined.reduce((sum, p) => sum + p.rows, 0);
  const settledRows = settled.reduce((sum, p) => sum + p.rows, 0);
  process.stdout.write(
    `${combined.length} qualifications covering ${rows} rows; ` +
      `${settled.length} settled (${settledRows} rows), ${unsettled.length} unsettled\n`,
  );

  for (const proposal of unsettled) {
    process.stdout.write(
      `  UNSETTLED  ${proposal.qualification} (${proposal.rows} rows)\n` +
        `             co-occurrence ${proposal.cooccurrence ?? '—'}` +
        `, lexical ${proposal.lexical ?? '—'}, model ${proposal.model ?? '—'}\n`,
    );
  }
  for (const proposal of changed) {
    process.stdout.write(
      `  REVIEW     ${proposal.qualification}: committed ` +
        `${proposal.committed ?? '(absent)'}, proposed ${proposal.agreed ?? '—'}\n`,
    );
  }
  for (const proposal of modelDisagrees) {
    process.stdout.write(
      `  MODEL      ${proposal.qualification}: offline ${proposal.agreed ?? '—'}, ` +
        `model ${proposal.model ?? '—'} (confidence ${proposal.modelConfidence?.toFixed(2) ?? '—'})\n`,
    );
  }

  process.stdout.write(`\n${formatTable(combined)}\n`);
}

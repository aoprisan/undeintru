/**
 * The third opinion: TypeSafe's Jev, asked to place a calificare in a domeniu
 * from the label text alone.
 *
 * This is deliberately the *weakest-privileged* signal in `alias/`. It never
 * writes the table; it produces a proposal that `fit.ts` compares against the
 * two offline signals, and the disagreements are what a human reviews. Nothing
 * here runs during `just check`, during a build, or in the app — only when
 * `just alias-fit --model` is run by hand with a key present.
 *
 * Jev fits this shape unusually well: the question is a closed choice over 18
 * known labels, the answer needed is the label plus a confidence, and there is
 * nothing to be gained from prose. That is what a System One model returns
 * natively — `answers.domain.choice` is typed as the union of the keys passed
 * in, and `probabilities` is keyed by the same union.
 */

import {
  TEHNOLOGICA_DOMAINS,
  type TehnologicaDomain,
} from '../../../app/src/model/courseDomains.js';

const SDK_MODULE = '@typesafe-ai/sdk';

/** What the SDK's `systemOne` gives back for our one question. */
interface ChoiceAnswer {
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

/**
 * The slice of `@typesafe-ai/sdk`'s client this module uses.
 *
 * Declared structurally so the module imports the SDK lazily and stays
 * testable with a stub. The SDK is an optional dependency of a hand-run
 * command; requiring it to be installed for `just check` would put a network
 * install in the way of the offline test suite.
 */
export interface SystemOneClient {
  systemOne(request: {
    state: unknown;
    questions: Record<string, unknown>;
  }): Promise<{ answers: Record<string, ChoiceAnswer>; usage?: { input_tokens: number } }>;
}

export interface ModelProposal {
  readonly qualification: string;
  readonly domain: TehnologicaDomain;
  readonly confidence: number;
  readonly inputTokens: number;
}

/** Criteria for the one question, as label -> description (null = undescribed). */
const CRITERIA: Readonly<Record<string, null>> = Object.fromEntries(
  TEHNOLOGICA_DOMAINS.map((domain) => [domain, null]),
);

const INSTRUCTIONS =
  'Acesta este numele unei calificări de nivel liceal din învățământul ' +
  'tehnologic românesc. În care domeniu de pregătire se încadrează?';

/**
 * Ask the model to place each qualification, one call per distinct label.
 *
 * The 2026 generation publishes 381 distinct labels but only 66 distinct
 * liceal qualifications, and the domeniu depends only on the latter — so this
 * is 66 calls for the whole country, cached in the committed table afterwards.
 *
 * @param client a TypeSafe client, or any stub with the same `systemOne`.
 * @param qualifications distinct liceal qualifications, as published.
 */
export async function classifyQualifications(
  client: SystemOneClient,
  qualifications: readonly string[],
): Promise<ModelProposal[]> {
  const proposals: ModelProposal[] = [];
  for (const qualification of qualifications) {
    const result = await client.systemOne({
      state: { calificare: qualification },
      questions: { domain: { type: 'choice', instructions: INSTRUCTIONS, criteria: CRITERIA } },
    });
    const answer = result.answers['domain'];
    if (!answer) throw new Error(`No answer for ${qualification}`);
    const domain = TEHNOLOGICA_DOMAINS.find((known) => known === answer.choice);
    if (domain === undefined) {
      throw new Error(`Model returned an unknown domeniu ${JSON.stringify(answer.choice)}`);
    }
    proposals.push({
      qualification,
      domain,
      confidence: answer.confidence,
      inputTokens: result.usage?.input_tokens ?? 0,
    });
  }
  return proposals;
}

/**
 * Build a real client, or explain why there is none.
 *
 * Kept separate from {@link classifyQualifications} so the tests exercise the
 * question and the answer handling without the SDK installed, and so the CLI
 * can report a missing key as a normal outcome rather than a crash.
 */
export async function createClient(): Promise<SystemOneClient | { reason: string }> {
  if (!process.env['TYPESAFE_API_KEY']) {
    return { reason: 'TYPESAFE_API_KEY is not set' };
  }
  try {
    // Resolved through a variable so the offline typecheck and test suite do not
    // require the SDK to be installed: this command is the only thing that needs
    // it, and it is run by hand.
    const specifier: string = SDK_MODULE;
    const sdk = (await import(specifier)) as { TypeSafeClient: new () => SystemOneClient };
    return new sdk.TypeSafeClient();
  } catch {
    return { reason: '@typesafe-ai/sdk is not installed (npm i -w pipeline @typesafe-ai/sdk)' };
  }
}

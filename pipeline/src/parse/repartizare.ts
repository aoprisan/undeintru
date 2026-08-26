/**
 * Parser for the admitere.edu.ro repartizare tables.
 *
 * ## Status: not implemented, on purpose
 *
 * A parser for a page whose markup you have never seen is a guess dressed up
 * as code. It typechecks, it has tests written against the same guess, it
 * passes CI, and it produces confidently wrong cutoffs — which in this app
 * means telling a parent their kid can enter a school they cannot.
 *
 * So the rule for this file is: **it is written against committed fixtures in
 * `pipeline/fixtures/`, and it is written after those fixtures exist.** Until
 * then every call fails loudly.
 *
 * ## How to implement it
 *
 * 1. `just fetch 2024 SB` — downloads into `pipeline/raw/` and prints the URLs.
 * 2. Copy 2-3 representative pages into `pipeline/fixtures/`, keeping the
 *    original filename plus a `.url` sidecar naming where each came from.
 * 3. Write the extraction below against those files, and a test per fixture in
 *    `pipeline/test/parse.repartizare.test.ts` asserting real rows.
 * 4. Route every text field through `normalizeText`, every media cell through
 *    `parseMediaCell`. Both are already tested.
 * 5. When a page does not match, throw `PageStructureError` with its URL —
 *    never skip the row, never fall back to a default.
 */

import type { AdmissionRow, Filiera } from '../schema.js';

export interface ParseContext {
  readonly year: number;
  readonly county: string;
  /** The URL the HTML came from — quoted in every error raised here. */
  readonly sourceUrl: string;
}

/**
 * A page whose structure does not match what the fixtures taught us.
 *
 * Always carries the URL, so the fix is: fetch that page, add it as a fixture,
 * extend the parser. Never catch this to skip a page.
 */
export class PageStructureError extends Error {
  readonly sourceUrl: string;

  constructor(sourceUrl: string, detail: string) {
    super(
      `Unexpected page structure at ${sourceUrl}: ${detail}\n` +
        'Save this page under pipeline/fixtures/ and extend the parser against it. ' +
        'Do not guess at the markup.',
    );
    this.name = 'PageStructureError';
    this.sourceUrl = sourceUrl;
  }
}

export class ParserNotImplementedError extends Error {
  readonly sourceUrl: string;

  constructor(sourceUrl: string) {
    super(
      `No repartizare parser yet (asked to parse ${sourceUrl}).\n` +
        'pipeline/fixtures/ is empty, so there is no real markup to write one against. ' +
        'Run `just fetch 2024 SB`, commit 2-3 pages as fixtures, then implement ' +
        'parseRepartizarePage in pipeline/src/parse/repartizare.ts.',
    );
    this.name = 'ParserNotImplementedError';
    this.sourceUrl = sourceUrl;
  }
}

/** Filiera labels as they appear in the published tables, folded for lookup. */
const FILIERA_BY_LABEL: ReadonlyMap<string, Filiera> = new Map([
  ['teoretica', 'teoretica'],
  ['tehnologica', 'tehnologica'],
  ['vocationala', 'vocationala'],
]);

/**
 * Map a published filiera label onto the schema's enum.
 *
 * Exported and tested independently of the HTML parsing, since the label set
 * is documented by the ministry rather than inferred from markup.
 *
 * @throws PageStructureError for a label outside the three official filiere.
 */
export function toFiliera(label: string, ctx: ParseContext): Filiera {
  const key = label
    .toLocaleLowerCase('ro-RO')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[șț]/g, (m) => (m === 'ș' ? 's' : 't'))
    .replace(/[^a-z]/g, '');
  const filiera = FILIERA_BY_LABEL.get(key);
  if (!filiera) throw new PageStructureError(ctx.sourceUrl, `unknown filiera ${JSON.stringify(label)}`);
  return filiera;
}

/**
 * Extract admission rows from one repartizare page.
 *
 * @throws ParserNotImplementedError until fixtures exist to write it against.
 * @throws PageStructureError when a page does not match the fixtures.
 */
export function parseRepartizarePage(html: string, ctx: ParseContext): AdmissionRow[] {
  void html;
  throw new ParserNotImplementedError(ctx.sourceUrl);
}

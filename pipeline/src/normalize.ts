/**
 * raw HTML -> normalized rows.
 *
 * Reads the pages `just fetch` cached (or the committed fixtures), runs each
 * through the repartizare parser, and writes one intermediate file per
 * county-year to `pipeline/normalized/`. Publication is a separate step --
 * see `emit.ts` -- so that parsing failures never touch `app/public/`.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FIXTURES_DIR, NORMALIZED_DIR, RAW_DIR } from './paths.js';
import { parseRepartizarePage } from './parse/repartizare.js';
import type { AdmissionRow, Provenance } from './schema.js';

/** The intermediate file format: `pipeline/normalized/<year>/<county>.json`. */
export interface NormalizedFile {
  readonly year: number;
  readonly county: string;
  /** Parsed pages are always 'official'; the mock generator writes 'synthetic'. */
  readonly provenance: Provenance;
  readonly sources: readonly string[];
  readonly rows: readonly AdmissionRow[];
}

interface ManifestEntry {
  readonly url: string;
  readonly file: string;
}

/** One page to parse, with the URL it came from. */
export interface PageInput {
  readonly url: string;
  readonly html: string;
}

/**
 * Every page cached by `just fetch`, in manifest order.
 *
 * @returns an empty array when nothing has been downloaded yet.
 */
export async function loadRawPages(dir: string = RAW_DIR): Promise<PageInput[]> {
  let manifest: Record<string, ManifestEntry>;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<
      string,
      ManifestEntry
    >;
  } catch {
    return [];
  }

  const pages: PageInput[] = [];
  for (const entry of Object.values(manifest)) {
    pages.push({ url: entry.url, html: await readFile(join(dir, entry.file), 'utf8') });
  }
  return pages;
}

/**
 * Every committed fixture, with the URL from its `.url` sidecar.
 *
 * A fixture without a sidecar is an error: a page whose origin nobody recorded
 * cannot be re-fetched or cited, and the parser's error messages depend on it.
 */
export async function loadFixturePages(dir: string = FIXTURES_DIR): Promise<PageInput[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.html')).sort();
  } catch {
    return [];
  }

  const pages: PageInput[] = [];
  for (const name of names) {
    const sidecar = join(dir, `${name}.url`);
    let url: string;
    try {
      url = (await readFile(sidecar, 'utf8')).trim();
    } catch {
      throw new Error(
        `Fixture ${name} has no ${name}.url sidecar naming the page it came from. ` +
          'Every fixture must record its source URL.',
      );
    }
    if (!url) throw new Error(`Fixture sidecar ${name}.url is empty.`);
    pages.push({ url, html: await readFile(join(dir, name), 'utf8') });
  }
  return pages;
}

/**
 * Parse pages into rows, deduplicated and sorted deterministically.
 *
 * Sorting matters: the emitted JSON is committed, so a stable order keeps
 * diffs readable and re-runs byte-identical.
 */
export function normalizePages(
  pages: readonly PageInput[],
  year: number,
  county: string,
): NormalizedFile {
  const byKey = new Map<string, AdmissionRow>();
  const sources: string[] = [];

  for (const page of pages) {
    const rows = parseRepartizarePage(page.html, { year, county, sourceUrl: page.url });
    if (rows.length > 0) sources.push(page.url);
    for (const row of rows) {
      if (row.year !== year || row.county !== county) {
        throw new Error(
          `${page.url} produced a row for ${row.county}/${row.year}, expected ${county}/${year}`,
        );
      }
      byKey.set(`${row.schoolCode} ${row.specId}`, row);
    }
  }

  const rows = [...byKey.values()].sort(
    (a, b) =>
      a.schoolName.localeCompare(b.schoolName, 'ro') ||
      a.schoolCode.localeCompare(b.schoolCode) ||
      a.specId.localeCompare(b.specId),
  );

  return {
    year,
    county,
    provenance: 'official',
    sources: [...new Set(sources)].sort(),
    rows,
  };
}

export interface NormalizeOptions {
  readonly year: number;
  readonly county: string;
  /** Parse the committed fixtures instead of `pipeline/raw/`. */
  readonly useFixtures?: boolean;
  readonly outDir?: string;
}

/** Run the normalize step and write the intermediate file. */
export async function normalize(options: NormalizeOptions): Promise<string> {
  const { year, county, useFixtures = false, outDir = NORMALIZED_DIR } = options;

  const pages = useFixtures ? await loadFixturePages() : await loadRawPages();
  if (pages.length === 0) {
    throw new Error(
      useFixtures
        ? `No fixtures in ${FIXTURES_DIR}. Commit representative pages before parsing.`
        : `No cached pages in ${RAW_DIR}. Run "just fetch ${year} ${county}" first.`,
    );
  }

  const normalized = normalizePages(pages, year, county);
  const dir = join(outDir, String(year));
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${county}.json`);
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `Normalized ${normalized.rows.length} rows from ${pages.length} pages -> ${path}\n`,
  );
  return path;
}

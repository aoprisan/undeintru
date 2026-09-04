/**
 * `just harvest`: the whole network-side job in one run, for a machine that
 * can reach admitere.edu.ro.
 *
 * The rest of the pipeline is offline and already done; what is missing is
 * real pages. This command does everything that needs the network so a single
 * invocation on the right machine leaves the repository one commit away from
 * writing the parser:
 *
 * 1. For every requested year, run the discovery-first crawl (`crawl.ts`):
 *    origin -> year archive -> county pages. It prints every link it follows.
 * 2. Descend one level below each county page, following only links that stay
 *    under that page's own directory. Repartizare listings have historically
 *    been split across several pages; a crawl that stops at the county index
 *    leaves the actual tables behind.
 * 3. Record which cached URL belongs to which county-year in
 *    `pipeline/raw/harvest.json`, so `normalize` parses the right pages and
 *    not the archive index.
 * 4. Stage representative pages into `pipeline/fixtures/`, each with its
 *    `.url` sidecar, ready to commit.
 *
 * A year that cannot be discovered does not stop the others: the failure is
 * reported at the end, with the links the crawler did see.
 *
 * Nothing here runs in tests or CI. The selection and naming helpers are pure
 * and tested; the network path is guarded by `assertNetworkAllowed`.
 */

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { crawl, DiscoveryFailedError } from './crawl.js';
import { Downloader, extractLinks, FetchFailedError, readManifest } from './fetch.js';
import type { ManifestEntry } from './fetch.js';
import { FIXTURES_DIR, RAW_DIR } from './paths.js';

// --- the harvest record ------------------------------------------------------

/** What one crawl found for one county-year. */
export interface HarvestDataset {
  readonly year: number;
  readonly county: string;
  /** The county links the crawl chose on the year page. */
  readonly countyLinks: readonly string[];
  /** Every cached URL that belongs to this county-year: county pages plus what was found under them. */
  readonly pages: readonly string[];
  readonly harvestedAt: string;
}

/** `pipeline/raw/harvest.json`: which cached page belongs to which dataset. */
export interface HarvestRecord {
  readonly schemaVersion: 1;
  readonly datasets: Record<string, HarvestDataset>;
}

export const HARVEST_FILE = 'harvest.json';

export function harvestKey(year: number, county: string): string {
  return `${year}/${county.toUpperCase()}`;
}

export async function readHarvest(dir: string = RAW_DIR): Promise<HarvestRecord> {
  try {
    const text = await readFile(join(dir, HARVEST_FILE), 'utf8');
    return JSON.parse(text) as HarvestRecord;
  } catch {
    return { schemaVersion: 1, datasets: {} };
  }
}

export async function writeHarvest(dir: string, record: HarvestRecord): Promise<void> {
  const ordered: Record<string, HarvestDataset> = Object.fromEntries(
    Object.entries(record.datasets).sort(([a], [b]) => a.localeCompare(b)),
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, HARVEST_FILE),
    `${JSON.stringify({ schemaVersion: 1, datasets: ordered }, null, 2)}\n`,
    'utf8',
  );
}

// --- descending below the county page ----------------------------------------

/** The directory a URL lives in: everything up to and including the last `/`. */
export function directoryOf(url: string): string {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  const path = u.pathname.endsWith('/') ? u.pathname : u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
  return `${u.origin}${path}`;
}

/**
 * Does `url` sit in the same directory as `parent`, or below it?
 *
 * This is the one structural assumption the descent makes, and it is about
 * URLs rather than markup: a county's pages live together. It rules out
 * following the site's navigation back up to other counties or years.
 */
export function underDirectory(url: string, parent: string): boolean {
  let candidate: string;
  try {
    candidate = new URL(url).href;
  } catch {
    return false;
  }
  return candidate !== new URL(parent).href && candidate.startsWith(directoryOf(parent));
}

// --- choosing and naming fixtures --------------------------------------------

export interface PageSummary {
  readonly url: string;
  readonly bytes: number;
}

/**
 * Pick up to `count` pages that differ from each other, judged by the only
 * signal available before a parser exists: size. The largest page (a full
 * listing), the smallest non-trivial one (an index, or a specialization that
 * did not fill) and the median are the three that most often disagree about
 * structure. Anything past three is spread evenly through the size range.
 */
export function pickRepresentative(pages: readonly PageSummary[], count: number): PageSummary[] {
  const bySize = [...pages].sort((a, b) => b.bytes - a.bytes || a.url.localeCompare(b.url));
  if (count <= 0) return [];
  if (bySize.length <= count) return bySize;

  const chosen = new Set<PageSummary>();
  const add = (p: PageSummary | undefined): void => {
    if (p && chosen.size < count) chosen.add(p);
  };

  add(bySize[0]);
  const nonTrivial = bySize.filter((p) => p.bytes >= 512);
  add(nonTrivial[nonTrivial.length - 1] ?? bySize[bySize.length - 1]);
  add(bySize[Math.floor(bySize.length / 2)]);

  // Past three: spread evenly through the size range, then top up in order.
  const stride = bySize.length / (count + 1);
  for (let k = 1; k <= count && chosen.size < count; k += 1) {
    add(bySize[Math.min(bySize.length - 1, Math.round(k * stride))]);
  }
  for (const p of bySize) add(p);

  return bySize.filter((p) => chosen.has(p));
}

function shortHash(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 6);
}

/**
 * A fixture filename that says what the page is: `sb-2024-<slug>.html`, the
 * slug taken from the URL's last path segment and query. Two URLs that reduce
 * to the same slug are told apart by a short hash of the URL.
 */
export function fixtureName(county: string, year: number, url: string, taken: ReadonlySet<string> = new Set()): string {
  const u = new URL(url);
  const segment = u.pathname.split('/').filter(Boolean).pop() ?? '';
  const stem = segment.replace(/\.[a-z0-9]+$/i, '');
  const raw = `${stem} ${u.search}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = raw === '' ? 'index' : raw.slice(0, 48).replace(/-+$/g, '');
  const base = `${county.toLowerCase()}-${year}-${slug}`;
  const plain = `${base}.html`;
  return taken.has(plain) ? `${base}-${shortHash(url)}.html` : plain;
}

/** URLs already staged: read back from every `.url` sidecar in the fixtures dir. */
export async function stagedUrls(dir: string = FIXTURES_DIR): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.html.url')) continue;
    const url = (await readFile(join(dir, name), 'utf8')).trim();
    if (url) out.set(url, name.slice(0, -'.url'.length));
  }
  return out;
}

export interface StageOptions {
  readonly county: string;
  readonly year: number;
  /** Cached pages belonging to this county-year. */
  readonly pages: readonly ManifestEntry[];
  /** How many to stage; `all` overrides it. */
  readonly count: number;
  readonly all?: boolean;
  readonly rawDir?: string;
  readonly fixturesDir?: string;
}

export interface StagedFixture {
  readonly url: string;
  readonly file: string;
  readonly bytes: number;
  /** True when a sidecar for this URL already existed and nothing was copied. */
  readonly existing: boolean;
}

/**
 * Copy representative pages into the fixtures directory, byte for byte, each
 * with a `.url` sidecar. Idempotent: a URL that already has a sidecar is
 * reported and left alone.
 */
export async function stageFixtures(options: StageOptions): Promise<StagedFixture[]> {
  const { county, year, pages, count, all = false } = options;
  const rawDir = options.rawDir ?? RAW_DIR;
  const fixturesDir = options.fixturesDir ?? FIXTURES_DIR;

  const chosen = all ? [...pages].sort((a, b) => b.bytes - a.bytes) : pickRepresentative(pages, count);
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const already = await stagedUrls(fixturesDir);
  const taken = new Set(already.values());

  await mkdir(fixturesDir, { recursive: true });
  const staged: StagedFixture[] = [];
  for (const pick of chosen) {
    const entry = byUrl.get(pick.url);
    if (!entry) continue;
    const existing = already.get(entry.url);
    if (existing !== undefined) {
      staged.push({ url: entry.url, file: existing, bytes: entry.bytes, existing: true });
      continue;
    }
    const file = fixtureName(county, year, entry.url, taken);
    taken.add(file);
    await copyFile(join(rawDir, entry.file), join(fixturesDir, file));
    await writeFile(join(fixturesDir, `${file}.url`), `${entry.url}\n`, 'utf8');
    staged.push({ url: entry.url, file, bytes: entry.bytes, existing: false });
  }
  return staged;
}

// --- the run -----------------------------------------------------------------

export interface HarvestOptions {
  readonly county: string;
  readonly years: readonly number[];
  readonly seed?: string;
  /** Print the discovered URLs for each year and stop. Stages nothing. */
  readonly discoverOnly?: boolean;
  /** Skip the crawl; stage fixtures from what `pipeline/raw/harvest.json` already records. */
  readonly stageOnly?: boolean;
  /** Fixtures to stage per year; 0 stages none. Default 3. */
  readonly fixtureCount?: number;
  /** Stage every page of every year. */
  readonly allFixtures?: boolean;
  /** Pages per year, counting the descent. */
  readonly maxPages?: number;
  readonly rawDir?: string;
  readonly fixturesDir?: string;
}

export interface HarvestYearResult {
  readonly year: number;
  readonly pages: number;
  readonly staged: readonly StagedFixture[];
  readonly error?: string;
}

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Crawl one year, descend below its county pages, and return every URL that belongs to it. */
async function harvestYear(
  year: number,
  county: string,
  options: HarvestOptions,
  downloader: Downloader,
): Promise<{ countyLinks: readonly string[]; pages: readonly string[] }> {
  const maxPages = options.maxPages ?? 200;
  const result = await crawl({
    year,
    county,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.discoverOnly !== undefined ? { discoverOnly: options.discoverOnly } : {}),
    ...(options.rawDir !== undefined ? { rawDir: options.rawDir } : {}),
    maxPages,
  });
  if (options.discoverOnly) return { countyLinks: result.countyLinks, pages: [] };

  const pages = new Set<string>(result.countyLinks);
  const queue = [...result.countyLinks];
  log(`\nDescending below the ${county} pages for ${year} (same directory or below only):`);
  let found = 0;
  while (queue.length > 0 && pages.size < maxPages) {
    const parent = queue.shift();
    if (parent === undefined) break;
    const page = await downloader.get(parent);
    for (const link of extractLinks(page.html, parent)) {
      if (pages.size >= maxPages) break;
      if (pages.has(link.url) || !underDirectory(link.url, parent)) continue;
      const child = await downloader.get(link.url);
      pages.add(child.url);
      queue.push(child.url);
      found += 1;
      log(`  ${child.cached ? 'cached ' : 'fetched'} ${child.url} (${child.bytes} bytes)${link.text ? `  — ${link.text}` : ''}`);
    }
  }
  if (found === 0) log('  nothing below the county pages; they are the listing.');
  if (pages.size >= maxPages) log(`  stopped at maxPages=${maxPages}`);

  return { countyLinks: result.countyLinks, pages: [...pages] };
}

export async function harvest(options: HarvestOptions): Promise<HarvestYearResult[]> {
  const county = options.county.toUpperCase();
  const rawDir = options.rawDir ?? RAW_DIR;
  const fixturesDir = options.fixturesDir ?? FIXTURES_DIR;
  const fixtureCount = options.fixtureCount ?? 3;
  const downloader = new Downloader(rawDir);
  const record = await readHarvest(rawDir);
  const datasets: Record<string, HarvestDataset> = { ...record.datasets };
  const results: HarvestYearResult[] = [];

  for (const year of options.years) {
    const key = harvestKey(year, county);
    log(`\n${'='.repeat(72)}\n${county} ${year}\n${'='.repeat(72)}`);

    if (!options.stageOnly) {
      try {
        const { countyLinks, pages } = await harvestYear(year, county, options, downloader);
        if (!options.discoverOnly) {
          datasets[key] = { year, county, countyLinks, pages, harvestedAt: new Date().toISOString() };
          await writeHarvest(rawDir, { schemaVersion: 1, datasets });
        }
      } catch (err) {
        if (err instanceof DiscoveryFailedError || err instanceof FetchFailedError) {
          log(`\n${year}: ${describe(err)}`);
          results.push({ year, pages: 0, staged: [], error: describe(err).split('\n')[0] ?? 'failed' });
          continue;
        }
        throw err;
      }
    }

    if (options.discoverOnly) {
      results.push({ year, pages: 0, staged: [] });
      continue;
    }

    const dataset = datasets[key];
    if (!dataset) {
      results.push({ year, pages: 0, staged: [], error: `nothing recorded for ${key} in ${HARVEST_FILE}` });
      continue;
    }

    const manifest = await readManifest(rawDir);
    const pages = dataset.pages.map((url) => manifest[url]).filter((e): e is ManifestEntry => e !== undefined);
    let staged: StagedFixture[] = [];
    if (options.allFixtures || fixtureCount > 0) {
      staged = await stageFixtures({
        county,
        year,
        pages,
        count: fixtureCount,
        all: options.allFixtures ?? false,
        rawDir,
        fixturesDir,
      });
      log(`\nFixtures for ${year}:`);
      for (const s of staged) {
        log(`  ${s.existing ? 'already ' : 'staged  '} ${s.file} (${s.bytes} bytes) <- ${s.url}`);
      }
    }
    results.push({ year, pages: pages.length, staged });
  }

  log(`\n${'='.repeat(72)}\nSummary\n${'='.repeat(72)}`);
  for (const r of results) {
    if (r.error !== undefined) log(`  ${r.year}: FAILED — ${r.error}`);
    else if (options.discoverOnly) log(`  ${r.year}: discovered (see above)`);
    else log(`  ${r.year}: ${r.pages} pages in raw, ${r.staged.filter((s) => !s.existing).length} new fixtures`);
  }

  const failed = results.filter((r) => r.error !== undefined);
  if (failed.length === results.length && results.length > 0) {
    throw new Error(
      'Every year failed. If the site did not answer at all it is probably down between admission ' +
        'cycles; if it answered but nothing matched, the links printed above are what to look at.',
    );
  }

  if (!options.discoverOnly) {
    const newFixtures = results.flatMap((r) => r.staged).filter((s) => !s.existing);
    log('\nNext:');
    log('  1. Open the staged files under pipeline/fixtures/ and confirm they are the repartizare tables.');
    log('     If they are navigation pages instead, delete them and re-run with --all-fixtures, or pick');
    log('     the right ones from pipeline/raw/ (harvest.json maps URLs to files).');
    log('  2. git add pipeline/fixtures && git commit && git push');
    if (newFixtures.length > 0) {
      log('  NOTE: `just check` now fails on purpose until parseRepartizarePage() is implemented against');
      log('        these fixtures. That is the ratchet in test/parse.repartizare.test.ts doing its job.');
    }
    log('  3. Implement the parser, then: just normalize <year> ' + county + ' (per year) && just emit && just check');
  }

  return results;
}

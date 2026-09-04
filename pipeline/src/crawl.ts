/**
 * Discovery-first crawl of the admitere.edu.ro archive.
 *
 * The site's URL layout is not documented anywhere and has changed between
 * years, so this does not hardcode a path template. It starts at the origin,
 * prints every link it considers at each hop, and only then descends. The
 * printed URLs are the point: they are what a human confirms before the
 * fixtures get committed and the parser gets written.
 */

import {
  ADMITERE_ORIGIN,
  Downloader,
  extractLinks,
  looksLikeCounty,
  looksLikeYear,
  THROTTLE_MS,
} from './fetch.js';
import type { RawPage } from './fetch.js';

export interface CrawlOptions {
  readonly year: number;
  readonly county: string;
  /** Where to start. Defaults to the site root. */
  readonly seed?: string;
  /** Print the discovered URLs and stop, without downloading county pages. */
  readonly discoverOnly?: boolean;
  /** Safety rail against following the site into unrelated sections. */
  readonly maxPages?: number;
  /** Where downloads are cached. Defaults to `pipeline/raw/`. */
  readonly rawDir?: string;
}

export interface CrawlResult {
  readonly seed: string;
  readonly yearLinks: readonly string[];
  readonly countyLinks: readonly string[];
  readonly pages: readonly { url: string; file: string; cached: boolean }[];
}

export class DiscoveryFailedError extends Error {
  constructor(what: string, seen: readonly { url: string; text: string }[]) {
    const sample = seen
      .slice(0, 40)
      .map((l) => `  ${l.url}${l.text ? `  — ${l.text}` : ''}`)
      .join('\n');
    super(
      `Could not find ${what}. The site structure is not what this crawler expects.\n` +
        `Links seen (${seen.length} total, first 40):\n${sample}\n\n` +
        'Do not guess: save the surprising page under pipeline/fixtures/ and fix the crawler against it.',
    );
    this.name = 'DiscoveryFailedError';
  }
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const { year, county, discoverOnly = false, maxPages = 200 } = options;
  const seed = options.seed ?? ADMITERE_ORIGIN;
  const downloader = new Downloader(options.rawDir);
  const pages: { url: string; file: string; cached: boolean }[] = [];

  const record = (page: RawPage): void => {
    pages.push({ url: page.url, file: page.file, cached: page.cached });
    log(`  ${page.cached ? 'cached ' : 'fetched'} ${page.url} (${page.bytes} bytes)`);
  };

  log(`Seed: ${seed}`);
  const entry = await downloader.get(seed);
  record(entry);

  const entryLinks = extractLinks(entry.html, seed);
  log(`\nLinks on the entry page: ${entryLinks.length}`);

  const yearLinks = entryLinks.filter((l) => looksLikeYear(l, year));
  if (yearLinks.length === 0) throw new DiscoveryFailedError(`a ${year} archive link`, entryLinks);

  log(`\n${year} archive candidates (${yearLinks.length}):`);
  for (const l of yearLinks) log(`  ${l.url}${l.text ? `  — ${l.text}` : ''}`);

  // Hop 2: inside each year page, look for the county.
  const countyLinks = new Map<string, { url: string; text: string }>();
  const seenOnYearPages: { url: string; text: string }[] = [];

  for (const yearLink of yearLinks) {
    if (pages.length >= maxPages) break;
    const page = await downloader.get(yearLink.url);
    record(page);

    const links = extractLinks(page.html, yearLink.url);
    seenOnYearPages.push(...links);
    for (const l of links) {
      if (looksLikeCounty(l, county) && looksLikeYear({ url: l.url, text: `${l.text} ${year}` }, year)) {
        countyLinks.set(l.url, l);
      }
    }
  }

  if (countyLinks.size === 0) {
    throw new DiscoveryFailedError(`a ${county} link for ${year}`, seenOnYearPages);
  }

  log(`\n${county} candidates for ${year} (${countyLinks.size}):`);
  for (const l of countyLinks.values()) log(`  ${l.url}${l.text ? `  — ${l.text}` : ''}`);

  if (discoverOnly) {
    log('\n--discover: stopping before downloading county pages.');
    return {
      seed,
      yearLinks: yearLinks.map((l) => l.url),
      countyLinks: [...countyLinks.keys()],
      pages,
    };
  }

  log(`\nDownloading ${county} pages (1 request / ${THROTTLE_MS / 1000}s, cached pages skipped):`);
  for (const l of countyLinks.values()) {
    if (pages.length >= maxPages) {
      log(`  stopped at maxPages=${maxPages}`);
      break;
    }
    record(await downloader.get(l.url));
  }

  log(`\nDone. ${pages.length} pages in pipeline/raw/.`);
  log('Next: copy 2-3 representative pages into pipeline/fixtures/ and write the parser against them.');

  return { seed, yearLinks: yearLinks.map((l) => l.url), countyLinks: [...countyLinks.keys()], pages };
}

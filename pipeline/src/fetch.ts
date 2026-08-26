/**
 * Downloader for the admitere.edu.ro repartizare pages.
 *
 * Three things this module is careful about:
 *
 * 1. **Proxies.** Node's built-in `fetch` ignores `HTTPS_PROXY`. In a sandbox
 *    that routes egress through a proxy it fails with a bare connect error and
 *    no hint as to why. `undici`'s `EnvHttpProxyAgent` reads the standard
 *    `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` variables, so we always dispatch
 *    through it.
 * 2. **Politeness.** One request every 2 seconds, and never re-download a page
 *    already sitting in `pipeline/raw/`.
 * 3. **Provenance.** Every download is recorded in a manifest next to the
 *    files, so the emitted dataset can cite the exact URLs it came from.
 *
 * Nothing here ever runs in tests or in CI — see `assertNetworkAllowed`.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EnvHttpProxyAgent, interceptors, request } from 'undici';

import { RAW_DIR } from './paths.js';

export const ADMITERE_ORIGIN = 'https://admitere.edu.ro';

/** Politeness delay between two network requests, in milliseconds. */
export const THROTTLE_MS = 2000;

const USER_AGENT =
  'undeintru/0.1 (open-source; historical high-school admission cutoffs; contact via repository issues)';

export class NetworkDisabledError extends Error {
  constructor() {
    super(
      'Network access is disabled (UNDEINTRU_OFFLINE=1 or CI=true). ' +
        'Tests and CI must run against pipeline/fixtures/, never the live site.',
    );
    this.name = 'NetworkDisabledError';
  }
}

export class FetchFailedError extends Error {
  readonly url: string;
  readonly status: number | undefined;

  constructor(url: string, message: string, status?: number) {
    super(`GET ${url} failed: ${message}`);
    this.name = 'FetchFailedError';
    this.url = url;
    if (status !== undefined) this.status = status;
  }
}

/**
 * Guard so a stray import can never make the test suite or CI hit the network.
 * @throws NetworkDisabledError
 */
export function assertNetworkAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env['UNDEINTRU_OFFLINE'] === '1' || env['CI'] === 'true') throw new NetworkDisabledError();
}

/** One downloaded page. */
export interface RawPage {
  readonly url: string;
  readonly file: string;
  readonly fetchedAt: string;
  readonly status: number;
  readonly bytes: number;
  readonly html: string;
  /** True when the body came from `pipeline/raw/` instead of the network. */
  readonly cached: boolean;
}

type ManifestEntry = Omit<RawPage, 'html' | 'cached'>;

/** Stable, filesystem-safe name for a URL. */
function cacheKey(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function manifestPath(dir: string): string {
  return join(dir, 'manifest.json');
}

async function readManifest(dir: string): Promise<Record<string, ManifestEntry>> {
  try {
    const text = await readFile(manifestPath(dir), 'utf8');
    return JSON.parse(text) as Record<string, ManifestEntry>;
  } catch {
    return {};
  }
}

async function writeManifest(dir: string, m: Record<string, ManifestEntry>): Promise<void> {
  const ordered = Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(manifestPath(dir), `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A throttled, caching HTTP client for one crawl run.
 *
 * Construct once per `just fetch` invocation; it holds the proxy dispatcher
 * and the last-request timestamp that enforces the delay.
 */
export class Downloader {
  // EnvHttpProxyAgent reads HTTPS_PROXY/HTTP_PROXY/NO_PROXY; the redirect
  // interceptor replaces the `maxRedirections` request option undici 7 dropped.
  readonly #dispatcher = new EnvHttpProxyAgent().compose(
    interceptors.redirect({ maxRedirections: 5 }),
  );
  readonly #dir: string;
  #manifest: Record<string, ManifestEntry> = {};
  #lastRequestAt = 0;
  #loaded = false;

  constructor(dir: string = RAW_DIR) {
    this.#dir = dir;
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    await mkdir(this.#dir, { recursive: true });
    this.#manifest = await readManifest(this.#dir);
    this.#loaded = true;
  }

  async #throttle(): Promise<void> {
    const waitFor = this.#lastRequestAt + THROTTLE_MS - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    this.#lastRequestAt = Date.now();
  }

  /**
   * Fetch a URL, serving it from `pipeline/raw/` when already downloaded.
   *
   * @throws NetworkDisabledError when offline mode is on and the page is not cached.
   * @throws FetchFailedError on a non-2xx response or a transport failure.
   */
  async get(url: string): Promise<RawPage> {
    await this.#load();

    const cached = this.#manifest[url];
    if (cached) {
      try {
        const html = await readFile(join(this.#dir, cached.file), 'utf8');
        return { ...cached, html, cached: true };
      } catch {
        // Manifest entry without its file — fall through and re-download.
      }
    }

    assertNetworkAllowed();
    await this.#throttle();

    let status: number;
    let body: string;
    try {
      const res = await request(url, {
        dispatcher: this.#dispatcher,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      });
      status = res.statusCode;
      body = await res.body.text();
    } catch (err) {
      // The sandbox proxy answers 403 to CONNECT for hosts outside its
      // allowlist, which surfaces here as an opaque socket error. Say so.
      throw new FetchFailedError(
        url,
        `${err instanceof Error ? err.message : String(err)} ` +
          '(if this is a proxy rejection, the host is blocked by egress policy — report it, do not route around it)',
      );
    }

    if (status < 200 || status >= 300) {
      throw new FetchFailedError(url, `HTTP ${status}`, status);
    }

    const file = `${cacheKey(url)}.html`;
    await writeFile(join(this.#dir, file), body, 'utf8');
    const entry: ManifestEntry = {
      url,
      file,
      fetchedAt: new Date().toISOString(),
      status,
      bytes: Buffer.byteLength(body, 'utf8'),
    };
    this.#manifest[url] = entry;
    await writeManifest(this.#dir, this.#manifest);

    return { ...entry, html: body, cached: false };
  }
}

// --- link discovery ---------------------------------------------------------

/**
 * Pull every same-origin link out of a page.
 *
 * This is deliberately structure-agnostic: it exists to *discover* what the
 * site looks like, so it must not assume anything about the markup. The
 * row parser is a different matter — that one is written against committed
 * fixtures, never against a guess.
 */
export function extractLinks(html: string, baseUrl: string): { url: string; text: string }[] {
  const out = new Map<string, string>();
  const anchor = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi;

  for (const m of html.matchAll(anchor)) {
    const href = m[1] ?? m[2] ?? m[3] ?? '';
    if (!href || href.startsWith('#') || /^(?:javascript|mailto|tel):/i.test(href)) continue;

    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.origin !== new URL(baseUrl).origin) continue;
    url.hash = '';

    const text = (m[4] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!out.has(url.href)) out.set(url.href, text);
  }

  return [...out].map(([url, text]) => ({ url, text }));
}

/** County codes to the county names that appear in link text. */
const COUNTY_NAMES: Readonly<Record<string, string>> = {
  SB: 'Sibiu',
};

/** Does this link plausibly belong to the given year? */
export function looksLikeYear(link: { url: string; text: string }, year: number): boolean {
  return new RegExp(`\\b${year}\\b`).test(`${link.url} ${link.text}`);
}

/** Does this link plausibly belong to the given county? */
export function looksLikeCounty(link: { url: string; text: string }, county: string): boolean {
  const haystack = `${link.url} ${link.text}`;
  const code = new RegExp(`\\b${county}\\b`, 'i');
  const name = COUNTY_NAMES[county.toUpperCase()];
  return code.test(haystack) || (name !== undefined && new RegExp(name, 'i').test(haystack));
}

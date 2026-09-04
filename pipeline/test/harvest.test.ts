import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractLinks, sameSite } from '../src/fetch.js';
import {
  directoryOf,
  fixtureName,
  harvest,
  harvestKey,
  pickRepresentative,
  readHarvest,
  stageFixtures,
  underDirectory,
} from '../src/harvest.js';
import { loadRawPages } from '../src/normalize.js';

describe('sameSite', () => {
  it('accepts the host itself and subdomains in either direction', () => {
    expect(sameSite('admitere.edu.ro', 'admitere.edu.ro')).toBe(true);
    expect(sameSite('static.admitere.edu.ro', 'admitere.edu.ro')).toBe(true);
    expect(sameSite('admitere.edu.ro', 'static.admitere.edu.ro')).toBe(true);
  });

  it('rejects siblings and unrelated hosts', () => {
    expect(sameSite('www.edu.ro', 'admitere.edu.ro')).toBe(false);
    expect(sameSite('evaluare.edu.ro', 'admitere.edu.ro')).toBe(false);
    expect(sameSite('notadmitere.edu.ro', 'admitere.edu.ro')).toBe(false);
  });
});

describe('extractLinks across the site', () => {
  it('keeps links to a subdomain of the entry host and drops the rest', () => {
    const html = `
      <a href="https://static.admitere.edu.ro/2024/repartizare/SB/index.html">Sibiu</a>
      <a href="https://www.edu.ro/">Minister</a>
      <a href="ftp://admitere.edu.ro/x">ftp</a>
    `;
    expect(extractLinks(html, 'https://admitere.edu.ro/').map((l) => l.url)).toEqual([
      'https://static.admitere.edu.ro/2024/repartizare/SB/index.html',
    ]);
  });
});

describe('directoryOf / underDirectory', () => {
  it('takes the directory of a file URL and keeps a directory URL as is', () => {
    expect(directoryOf('https://x.ro/2024/SB/index.html?p=1')).toBe('https://x.ro/2024/SB/');
    expect(directoryOf('https://x.ro/2024/SB/')).toBe('https://x.ro/2024/SB/');
    expect(directoryOf('https://x.ro')).toBe('https://x.ro/');
  });

  it('follows siblings and children, never the parent itself, a cousin or another year', () => {
    const parent = 'https://x.ro/2024/SB/index.html';
    expect(underDirectory('https://x.ro/2024/SB/parte_2.html', parent)).toBe(true);
    expect(underDirectory('https://x.ro/2024/SB/licee/1.html', parent)).toBe(true);
    expect(underDirectory('https://x.ro/2024/SB/index.html', parent)).toBe(false);
    expect(underDirectory('https://x.ro/2024/CJ/index.html', parent)).toBe(false);
    expect(underDirectory('https://x.ro/2023/SB/index.html', parent)).toBe(false);
    expect(underDirectory('https://x.ro/', parent)).toBe(false);
    expect(underDirectory('not a url', parent)).toBe(false);
  });
});

describe('pickRepresentative', () => {
  const pages = [100, 700, 2_000, 9_000, 40_000, 120_000].map((bytes, i) => ({
    url: `https://x.ro/p${i}.html`,
    bytes,
  }));

  it('returns everything when there is no more than asked for', () => {
    expect(pickRepresentative(pages, 6)).toHaveLength(6);
    expect(pickRepresentative(pages, 10)).toHaveLength(6);
    expect(pickRepresentative(pages, 0)).toEqual([]);
  });

  it('picks the largest, the smallest non-trivial and the median, largest first', () => {
    expect(pickRepresentative(pages, 3).map((p) => p.bytes)).toEqual([120_000, 2_000, 700]);
  });

  it('falls back to the smallest page when every page is tiny', () => {
    const tiny = [50, 60, 70, 80].map((bytes, i) => ({ url: `https://x.ro/t${i}`, bytes }));
    expect(pickRepresentative(tiny, 2).map((p) => p.bytes)).toEqual([80, 50]);
  });

  it('never repeats a page and fills up to the count', () => {
    const picked = pickRepresentative(pages, 5);
    expect(new Set(picked.map((p) => p.url)).size).toBe(5);
  });
});

describe('fixtureName', () => {
  it('names the fixture after county, year and the URL slug', () => {
    expect(fixtureName('SB', 2024, 'https://x.ro/2024/repartizare/SB/parte_2.html')).toBe(
      'sb-2024-parte-2.html',
    );
    expect(fixtureName('sb', 2024, 'https://x.ro/2024/SB/')).toBe('sb-2024-sb.html');
    expect(fixtureName('SB', 2024, 'https://x.ro/')).toBe('sb-2024-index.html');
    expect(fixtureName('SB', 2024, 'https://x.ro/list.php?jud=SB&pag=3')).toBe(
      'sb-2024-list-jud-sb-pag-3.html',
    );
  });

  it('disambiguates a slug that is already taken with a hash of the URL', () => {
    const taken = new Set(['sb-2024-index.html']);
    const name = fixtureName('SB', 2024, 'https://x.ro/2024/SB/index.html', taken);
    expect(name).toMatch(/^sb-2024-index-[0-9a-f]{6}\.html$/);
  });
});

// --- an offline end-to-end run against a fake site ---------------------------
//
// The Downloader serves anything in its manifest from disk without touching
// the network, so a cache preloaded with a small site exercises discovery,
// the descent, the harvest record and the fixture staging under the offline
// flag the suite sets.

interface FakePage {
  readonly url: string;
  readonly html: string;
}

async function fakeSite(dir: string, pages: readonly FakePage[]): Promise<void> {
  const manifest: Record<string, unknown> = {};
  for (const [i, p] of pages.entries()) {
    const file = `p${i}.html`;
    await writeFile(join(dir, file), p.html, 'utf8');
    manifest[p.url] = {
      url: p.url,
      file,
      fetchedAt: '2026-07-10T00:00:00.000Z',
      status: 200,
      bytes: Buffer.byteLength(p.html, 'utf8'),
    };
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

const ORIGIN = 'https://admitere.edu.ro';
const site: FakePage[] = [
  {
    url: `${ORIGIN}/`,
    html: '<a href="/2024/">Admitere 2024</a><a href="/2023/">Admitere 2023</a>',
  },
  {
    url: `${ORIGIN}/2024/`,
    html: '<a href="/2024/repartizare/SB/index.html">Sibiu</a><a href="/2024/repartizare/CJ/index.html">Cluj</a>',
  },
  {
    url: `${ORIGIN}/2024/repartizare/SB/index.html`,
    html:
      '<a href="parte_1.html">1</a><a href="parte_2.html">2</a>' +
      '<a href="/2024/repartizare/CJ/index.html">Cluj</a><a href="/2024/">sus</a>',
  },
  { url: `${ORIGIN}/2024/repartizare/SB/parte_1.html`, html: `<table>${'<tr><td>x</td></tr>'.repeat(60)}</table>` },
  { url: `${ORIGIN}/2024/repartizare/SB/parte_2.html`, html: `<table>${'<tr><td>y</td></tr>'.repeat(20)}</table>` },
  { url: `${ORIGIN}/2024/repartizare/CJ/index.html`, html: '<p>never fetched</p>' },
  { url: `${ORIGIN}/2023/`, html: '<p>no county links here</p>' },
];

describe('harvest (offline, preloaded cache)', () => {
  it('crawls, descends, records the county-year and stages fixtures with sidecars', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'undeintru-raw-'));
    const fixturesDir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    await fakeSite(rawDir, site);

    const results = await harvest({ county: 'sb', years: [2024], rawDir, fixturesDir, fixtureCount: 2 });

    expect(results).toHaveLength(1);
    expect(results[0]?.error).toBeUndefined();
    expect(results[0]?.pages).toBe(3);

    const record = await readHarvest(rawDir);
    const dataset = record.datasets[harvestKey(2024, 'SB')];
    expect(dataset?.countyLinks).toEqual([`${ORIGIN}/2024/repartizare/SB/index.html`]);
    expect([...(dataset?.pages ?? [])].sort()).toEqual([
      `${ORIGIN}/2024/repartizare/SB/index.html`,
      `${ORIGIN}/2024/repartizare/SB/parte_1.html`,
      `${ORIGIN}/2024/repartizare/SB/parte_2.html`,
    ]);

    const names = (await readdir(fixturesDir)).sort();
    expect(names).toEqual([
      'sb-2024-parte-1.html',
      'sb-2024-parte-1.html.url',
      'sb-2024-parte-2.html',
      'sb-2024-parte-2.html.url',
    ]);
    expect((await readFile(join(fixturesDir, 'sb-2024-parte-1.html.url'), 'utf8')).trim()).toBe(
      `${ORIGIN}/2024/repartizare/SB/parte_1.html`,
    );
    expect(await readFile(join(fixturesDir, 'sb-2024-parte-1.html'), 'utf8')).toBe(site[3]?.html);

    // normalize's loader now sees only this county-year, not the archive index.
    const scoped = await loadRawPages(rawDir, { year: 2024, county: 'SB' });
    expect(scoped.map((p) => p.url).sort()).toEqual([...(dataset?.pages ?? [])].sort());
    const unscoped = await loadRawPages(rawDir);
    expect(unscoped.length).toBe(site.length);
  });

  it('is idempotent: a second run stages nothing new', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'undeintru-raw-'));
    const fixturesDir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    await fakeSite(rawDir, site);

    await harvest({ county: 'SB', years: [2024], rawDir, fixturesDir, fixtureCount: 2 });
    const again = await harvest({ county: 'SB', years: [2024], rawDir, fixturesDir, fixtureCount: 2 });
    expect(again[0]?.staged.every((s) => s.existing)).toBe(true);
    expect((await readdir(fixturesDir)).filter((n) => n.endsWith('.html'))).toHaveLength(2);
  });

  it('reports a year that cannot be discovered and carries on with the others', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'undeintru-raw-'));
    const fixturesDir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    await fakeSite(rawDir, site);

    const results = await harvest({ county: 'SB', years: [2023, 2024], rawDir, fixturesDir, fixtureCount: 1 });
    expect(results.map((r) => r.year)).toEqual([2023, 2024]);
    expect(results[0]?.error).toMatch(/Could not find a SB link for 2023/);
    expect(results[1]?.error).toBeUndefined();
    expect(results[1]?.staged).toHaveLength(1);
  });

  it('throws when every year fails, so the caller sees a non-zero exit', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'undeintru-raw-'));
    const fixturesDir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    await fakeSite(rawDir, site);

    await expect(harvest({ county: 'SB', years: [2023], rawDir, fixturesDir })).rejects.toThrow(
      /Every year failed/,
    );
  });

  it('--discover stops before downloading and stages nothing', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'undeintru-raw-'));
    const fixturesDir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    await fakeSite(rawDir, site);

    await harvest({ county: 'SB', years: [2024], rawDir, fixturesDir, discoverOnly: true });
    expect(await readdir(fixturesDir)).toEqual([]);
    expect(Object.keys((await readHarvest(rawDir)).datasets)).toEqual([]);
  });

  it('refuses to reach the network for a page that is not cached', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'undeintru-raw-'));
    const fixturesDir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    await fakeSite(rawDir, site.filter((p) => !p.url.endsWith('parte_2.html')));

    await expect(harvest({ county: 'SB', years: [2024], rawDir, fixturesDir })).rejects.toThrow(
      /Network access is disabled/,
    );
  });
});

describe('stageFixtures', () => {
  it('copies bytes untouched and writes one URL per sidecar', async () => {
    const rawDir = await mkdtemp(join(tmpdir(), 'undeintru-raw-'));
    const fixturesDir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    const html = '<html>\r\n<body>Şaguna </body>\r\n</html>'; // cedilla and CRLF stay as they are
    await fakeSite(rawDir, [{ url: 'https://admitere.edu.ro/2024/SB/x.html', html }]);
    const manifest = JSON.parse(await readFile(join(rawDir, 'manifest.json'), 'utf8')) as Record<
      string,
      { url: string; file: string; fetchedAt: string; status: number; bytes: number }
    >;

    const staged = await stageFixtures({
      county: 'SB',
      year: 2024,
      pages: Object.values(manifest),
      count: 3,
      rawDir,
      fixturesDir,
    });
    expect(staged).toEqual([
      { url: 'https://admitere.edu.ro/2024/SB/x.html', file: 'sb-2024-x.html', bytes: manifest['https://admitere.edu.ro/2024/SB/x.html']?.bytes, existing: false },
    ]);
    expect(await readFile(join(fixturesDir, 'sb-2024-x.html'), 'utf8')).toBe(html);
    expect(await readFile(join(fixturesDir, 'sb-2024-x.html.url'), 'utf8')).toBe(
      'https://admitere.edu.ro/2024/SB/x.html\n',
    );
  });
});

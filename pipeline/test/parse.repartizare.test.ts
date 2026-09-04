import { readdirSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadFixturePages, normalizePages } from '../src/normalize.js';
import { FIXTURES_DIR } from '../src/paths.js';
import {
  PageStructureError,
  ParserNotImplementedError,
  parseRepartizarePage,
  toFiliera,
  type ParseContext,
} from '../src/parse/repartizare.js';
import { assertCountyDataset, SCHEMA_VERSION } from '../src/schema.js';

const ctx: ParseContext = {
  year: 2024,
  county: 'SB',
  sourceUrl: 'https://admitere.edu.ro/example',
};

function listFixtures(): string[] {
  try {
    return readdirSync(FIXTURES_DIR)
      .filter((n) => n.endsWith('.html'))
      .sort();
  } catch {
    return [];
  }
}

const fixtures = listFixtures();

describe('toFiliera', () => {
  it('maps the three official filiere, with or without diacritics', () => {
    expect(toFiliera('Teoretică', ctx)).toBe('teoretica');
    expect(toFiliera('teoretica', ctx)).toBe('teoretica');
    expect(toFiliera('Tehnologică', ctx)).toBe('tehnologica');
    expect(toFiliera('Vocațională', ctx)).toBe('vocationala');
    expect(toFiliera('Vocaţională', ctx)).toBe('vocationala'); // cedilla source
  });

  it('throws with the source URL for a label outside the three filiere', () => {
    expect(() => toFiliera('Sportivă', ctx)).toThrow(PageStructureError);
    expect(() => toFiliera('Sportivă', ctx)).toThrow(/admitere\.edu\.ro\/example/);
  });
});

describe('repartizare parser', () => {
  if (fixtures.length === 0) {
    // Ratchet. The parser must not exist while there is no real markup to
    // write it against; the moment someone commits a fixture, this branch
    // stops running and the fixture cases below take over -- so a fixture
    // landing without a parser fails the suite instead of passing silently.
    it('is not implemented while pipeline/fixtures/ is empty', () => {
      expect(() => parseRepartizarePage('<html></html>', ctx)).toThrow(ParserNotImplementedError);
    });

    it('names the source URL and what to do about it', () => {
      expect(() => parseRepartizarePage('<html></html>', ctx)).toThrow(
        /admitere\.edu\.ro\/example/,
      );
      expect(() => parseRepartizarePage('<html></html>', ctx)).toThrow(/scripts\/populate\.sh/);
    });
  } else {
    it('has a source URL sidecar for every fixture', async () => {
      const pages = await loadFixturePages();
      expect(pages.map((p) => p.url).every((u) => u.startsWith('http'))).toBe(true);
      expect(pages).toHaveLength(fixtures.length);
    });

    it.each(fixtures)('parses %s into schema-valid rows', async (name) => {
      const pages = (await loadFixturePages()).filter((p) => p.html.length > 0);
      const page = pages[fixtures.indexOf(name)];
      expect(page).toBeDefined();

      const rows = parseRepartizarePage(page?.html ?? '', {
        ...ctx,
        sourceUrl: page?.url ?? ctx.sourceUrl,
      });
      expect(rows.length).toBeGreaterThan(0);

      assertCountyDataset({
        schemaVersion: SCHEMA_VERSION,
        year: ctx.year,
        county: ctx.county,
        generatedAt: '2024-08-01T00:00:00.000Z',
        sources: [page?.url ?? ''],
        rows,
      });
    });

    it('deduplicates and sorts rows across pages', async () => {
      const normalized = normalizePages(await loadFixturePages(), ctx.year, ctx.county);
      const keys = normalized.rows.map((r) => `${r.schoolCode} ${r.specId}`);
      expect(new Set(keys).size).toBe(keys.length);

      const names = normalized.rows.map((r) => r.schoolName);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ro')));
    });
  }
});

describe('loadFixturePages', () => {
  it('refuses a fixture with no .url sidecar recording where it came from', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    await writeFile(join(dir, 'page.html'), '<html></html>', 'utf8');

    await expect(loadFixturePages(dir)).rejects.toThrow(/no page\.html\.url sidecar/);
  });

  it('refuses an empty sidecar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'undeintru-fixtures-'));
    await writeFile(join(dir, 'page.html'), '<html></html>', 'utf8');
    await writeFile(join(dir, 'page.html.url'), '  \n', 'utf8');

    await expect(loadFixturePages(dir)).rejects.toThrow(/is empty/);
  });

  it('returns nothing for a directory that does not exist', async () => {
    await expect(loadFixturePages(join(tmpdir(), 'undeintru-nope-does-not-exist'))).resolves.toEqual(
      [],
    );
  });
});

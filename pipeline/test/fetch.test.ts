import { describe, expect, it } from 'vitest';

import {
  assertNetworkAllowed,
  extractLinks,
  looksLikeCounty,
  looksLikeYear,
  NetworkDisabledError,
  THROTTLE_MS,
} from '../src/fetch.js';

describe('assertNetworkAllowed', () => {
  it('blocks the network under the offline flag the test runner sets', () => {
    // vitest.config.ts sets UNDEINTRU_OFFLINE=1 for the whole suite, so this
    // is the guard that keeps a stray import from reaching admitere.edu.ro.
    expect(() => {
      assertNetworkAllowed();
    }).toThrow(NetworkDisabledError);
  });

  it('blocks the network in CI', () => {
    expect(() => {
      assertNetworkAllowed({ CI: 'true' });
    }).toThrow(NetworkDisabledError);
  });

  it('allows it for a local operator run', () => {
    expect(() => {
      assertNetworkAllowed({});
    }).not.toThrow();
  });
});

describe('throttle', () => {
  it('is the 1 request / 2s the crawl policy requires', () => {
    expect(THROTTLE_MS).toBe(2000);
  });
});

describe('extractLinks', () => {
  const base = 'https://admitere.edu.ro/2024/index.html';

  it('resolves relative links against the page and drops other origins', () => {
    const html = `
      <a href="repartizare/SB.html">Sibiu</a>
      <a href='/2024/CJ.html'>Cluj</a>
      <a href="https://www.edu.ro/altceva">Ministerul</a>
      <a href=nequoted.html>Fara ghilimele</a>
    `;
    expect(extractLinks(html, base).map((l) => l.url)).toEqual([
      'https://admitere.edu.ro/2024/repartizare/SB.html',
      'https://admitere.edu.ro/2024/CJ.html',
      'https://admitere.edu.ro/2024/nequoted.html',
    ]);
  });

  it('keeps the link text, with tags and entities flattened', () => {
    const html = '<a href="SB.html"><b>Sibiu</b>&nbsp;&mdash; repartizare</a>';
    expect(extractLinks(html, base)[0]?.text).toBe('Sibiu &mdash; repartizare');
  });

  it('skips anchors, javascript: and mailto: links', () => {
    const html = `
      <a href="#top">Sus</a>
      <a href="javascript:void(0)">Nimic</a>
      <a href="mailto:x@edu.ro">Contact</a>
      <a href="SB.html">Sibiu</a>
    `;
    expect(extractLinks(html, base)).toHaveLength(1);
  });

  it('deduplicates, ignoring the fragment', () => {
    const html = '<a href="SB.html">a</a><a href="SB.html#jos">b</a>';
    expect(extractLinks(html, base)).toHaveLength(1);
  });

  it('returns nothing for a page with no links, rather than throwing', () => {
    expect(extractLinks('<html><body>nimic</body></html>', base)).toEqual([]);
  });
});

describe('link heuristics', () => {
  it('matches a year in either the URL or the link text', () => {
    expect(looksLikeYear({ url: 'https://x/2024/a.html', text: '' }, 2024)).toBe(true);
    expect(looksLikeYear({ url: 'https://x/a.html', text: 'Admitere 2024' }, 2024)).toBe(true);
    expect(looksLikeYear({ url: 'https://x/2023/a.html', text: 'Admitere 2023' }, 2024)).toBe(false);
  });

  it('does not treat 2024 as a match for a longer number', () => {
    expect(looksLikeYear({ url: 'https://x/id=120241', text: '' }, 2024)).toBe(false);
  });

  it('matches a county by code or by name', () => {
    expect(looksLikeCounty({ url: 'https://x/SB.html', text: '' }, 'SB')).toBe(true);
    expect(looksLikeCounty({ url: 'https://x/a.html', text: 'Sibiu' }, 'SB')).toBe(true);
    expect(looksLikeCounty({ url: 'https://x/CJ.html', text: 'Cluj' }, 'SB')).toBe(false);
  });
});

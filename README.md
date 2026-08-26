# undeintru

La ce licee poate intra copilul tău — a static PWA that answers one question for
Romanian parents: given an admission media, which high schools would that have
been enough for in a past year?

No backend, no analytics, no third-party calls. The app is a static bundle plus
JSON files; everything it knows comes from published admitere.edu.ro data that a
pipeline in this repo downloads, parses and validates ahead of time.

## Layout

```
app/                    Vite vanilla-ts PWA (no framework)
  src/data/schema.ts    the shared data contract — see below
  public/data/v1/       published JSON, written by `just emit`
pipeline/               Node 22 + tsx + vitest
  src/fetch.ts          proxy-aware, throttled, caching downloader
  src/crawl.ts          discovery-first crawl of the archive
  src/parse/            HTML -> rows, written against committed fixtures
  src/normalize.ts      pages -> pipeline/normalized/<year>/<county>.json
  src/emit.ts           normalized -> app/public/data/v1/, schema-validated
  fixtures/             committed sample pages the parser is written against
  raw/                  downloaded pages (gitignored)
```

## Commands

```
just dev                 Vite dev server
just build               production build -> app/dist
just fetch 2024 SB       download the SB/2024 pages into pipeline/raw/
just normalize 2024 SB   parse pipeline/raw/ into normalized rows
just emit                validate and publish to app/public/data/v1/
just typecheck
just lint
just test
just check               typecheck + lint + test
```

`just check` is what CI runs, and it is the definition of done.

## Two rules the code enforces

**Media de admitere, since 2023, is `(romana + matematica) / 2`, kept to two
decimals and truncated — not rounded.** 9.855 is 9.85. Rounding moves a
candidate across a cutoff and changes the answer the app gives, so the
arithmetic is done in integer hundredths (`pipeline/src/util/media.ts`) and the
truncation is tested directly. The schema rejects any media with more than two
decimals, so an untruncated value cannot be published.

**Cutoffs from different years are not comparable across 2023.** The formula
changed that year — before it, the gimnaziu average was folded in. Every row,
every file and every index entry carries its `year`, the schema refuses a file
whose rows disagree with it, and `areYearsComparable()` exists so any future
cross-year feature has to opt in deliberately. There is no cross-year logic yet.

## Diacritics

admitere.edu.ro publishes Romanian text with the Turkish *cedilla* letters
ş/ţ (U+015F/U+0163) rather than the correct *comma-below* ș/ț
(U+0219/U+021B). They look alike and compare unequal, so "Şaguna" and "Șaguna"
would be two different schools. Everything entering the dataset goes through
`normalizeText()` (`pipeline/src/util/diacritics.ts`), which folds cedilla and
combining forms to comma-below, strips invisibles, collapses whitespace and
returns NFC.

## The data contract

`app/src/data/schema.ts` is the single definition of the emitted shape, imported
by both packages (`pipeline/src/schema.ts` re-exports it). It is dependency-free
on purpose — `app/` must not pull in third-party runtime code. `emit` validates
every dataset *before* writing any of them, so a bad parse cannot half-publish.

One row:

```ts
{ year, county, schoolCode, schoolName, specId, specLabel,
  profile, filiera, limba, seats, lastMedia, vocational }
```

`lastMedia` is `null` when a specialization published no cutoff.
`vocational` marks filiera vocationala, where an aptitude exam gates admission
and the cutoff does not mean "any kid above this got in".

## Fixtures, and why the parser is written against them

The parser is written against real pages committed in `pipeline/fixtures/`,
never against imagined markup. Each fixture has a `<name>.html.url` sidecar
recording where it came from. When a page does not match, the parser throws
`PageStructureError` **with the URL** rather than skipping the row — save that
page as a fixture and extend the parser.

## Offline by contract

Tests and CI never touch the network. `assertNetworkAllowed()` throws when
`CI=true` or `UNDEINTRU_OFFLINE=1` (which `vitest.config.ts` sets for the whole
suite), so a stray import cannot reach the live site from a test run.
`just fetch` is the only recipe that makes requests: one every 2 seconds, with
already-downloaded pages served from `pipeline/raw/`.

Node's built-in `fetch` ignores `HTTPS_PROXY`. The downloader dispatches through
undici's `EnvHttpProxyAgent` so it works behind a proxy.

## Status

See [`docs/STATUS.md`](docs/STATUS.md). Short version: the scaffold, the shared
schema, the emit path and both hard-rule utilities are done and tested. The
2024/SB fixtures and the HTML parser are not — the environment this was built in
blocks all egress to admitere.edu.ro, so there was no real markup to write the
parser against, and guessing at it was not an option.

# Fixtures

Real pages from admitere.edu.ro, committed so the parser is written and tested
against markup that actually exists. **Never hand-write a fixture**, and never
edit one to make a test pass — a fixture is evidence, not a test double.

## Adding one

1. `just fetch <year> <county>` downloads into `pipeline/raw/` (gitignored) and
   prints the URLs it used.
2. Copy 2-3 *representative* pages here — pick ones that differ from each
   other: a filiera teoretica listing, a filiera tehnologica one, and a page
   with a specialization that did not fill (empty cutoff cell) are a good set.
3. Give each one a sidecar recording where it came from:

   ```
   sb-2024-teoretica.html
   sb-2024-teoretica.html.url    <- one line: the full source URL
   ```

   `loadFixturePages()` refuses a fixture without a sidecar. A page whose origin
   nobody recorded cannot be re-fetched, cited in the emitted `sources`, or
   named in a parser error.
4. Keep the bytes as downloaded. Do not reformat, minify, or strip anything —
   the encoding quirks and the cedilla diacritics are part of what the parser
   has to handle.

## Currently empty

No repartizare pages have been downloaded; `admitere.edu.ro` does not answer.
See [`../../docs/STATUS.md`](../../docs/STATUS.md). While this directory holds
no `.html` file, `pipeline/test/parse.repartizare.test.ts` asserts the parser
stays unimplemented.

## `evnat/` is a different thing

[`evnat/`](evnat/) holds real Evaluarea Națională results from data.gov.ro,
which *is* reachable. Those are candidate marks, not cutoffs, and they are
CSV rather than HTML — so they neither satisfy nor disturb the `.html` ratchet
above. The rules are the same: real bytes only, and a `.url` sidecar on
everything.

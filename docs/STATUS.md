# Status

## Done

**Phase 0 — scaffold.** npm workspaces (`app`, `pipeline`), shared
`tsconfig.base.json` with strict TS, ESLint flat config on
`strictTypeChecked`, the justfile, `.gitignore`, and a GitHub Actions workflow
that runs `just check`, builds, and deploys `app/dist` to Pages on push to
`main`.

**Phase 1 — everything that does not need the live site.**

| Piece | State |
| --- | --- |
| `app/src/data/schema.ts` — shared contract, validators | done, 17 tests |
| `pipeline/src/util/media.ts` — 2023 formula, truncation | done, 16 tests |
| `pipeline/src/util/diacritics.ts` — cedilla to comma-below, NFC | done, 13 tests |
| `pipeline/src/fetch.ts` — proxy-aware, throttled, caching downloader | done, 12 tests |
| `pipeline/src/crawl.ts` — discovery-first crawl | written, never run |
| `pipeline/src/normalize.ts` — page loading, dedup, deterministic sort | done |
| `pipeline/src/emit.ts` — validate-then-publish, index | done, 7 tests |
| `pipeline/src/parse/repartizare.ts` — HTML to rows | **not implemented** |
| `pipeline/fixtures/` — 2024/SB sample pages | **empty** |

**Phase 2 — the prediction model, validated on synthetic data.**

| Piece | State |
| --- | --- |
| `app/src/model/predict.ts` — cutoff distribution, admission probability | done, 29 tests |
| `pipeline/src/mock/` — seeded synthetic generator with ground truth | done, 16 tests |
| Backtest: calibration, interval coverage, Brier vs. baseline | done — see [MODEL.md](MODEL.md) |
| App: probability bands, prediction interval, synthetic-data banner | done |

`just check` is green: 120 tests, typecheck and lint clean in both packages.

Two real defects were found along the way, both by the synthetic data:

- The schema's two-decimal check was `Math.round(m * 100) !== m * 100`, which
  **rejects a legitimate 8.96** because `8.96 * 100` is 896.0000000000001. It
  now compares with a tolerance, and a test sweeps all 901 valid medias.
- The model's first spread estimator combined separately-estimated `tau` and
  `sigma`, leaving it overconfident — 80% intervals covered only 74%. Estimating
  from pooled one-step-ahead errors instead brought coverage to 83.5%.

## Blocked: no network access to admitere.edu.ro

The crawl was never run, so there are no fixtures, so there is no parser. The
data published in `app/public/data/v1/` is **synthetic** — generated, marked
`provenance: 'synthetic'` at every layer, and shown behind a warning banner in
the app. It stands in so the pipeline and the model can be exercised end to
end; it says nothing about real schools.

The environment this repo was built in routes egress through a policy proxy
that refuses the host:

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://admitere.edu.ro
curl: (56) CONNECT tunnel failed, response 403

$ curl -sS "$HTTPS_PROXY/__agentproxy/status"
"recentRelayFailures": [
  { "kind": "connect_rejected",
    "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
    "host": "admitere.edu.ro:443" }
]
```

This is not specific to admitere.edu.ro — `example.com` and `www.edu.ro` are
refused identically. The allowlist covers package registries only. It is an
egress policy denial, so it was reported rather than routed around.

## Why the parser is a stub rather than a guess

A parser written against markup nobody has seen typechecks, passes tests
written against the same guess, goes green in CI, and produces confidently
wrong cutoffs. In this app that means telling a parent their kid can enter a
school they cannot.

So `parseRepartizarePage()` throws `ParserNotImplementedError` naming the URL it
was asked to parse and what to do about it. A ratchet in
`pipeline/test/parse.repartizare.test.ts` enforces the state: while
`pipeline/fixtures/` is empty it asserts the parser is *not* implemented, and
the moment a fixture is committed that branch stops running and the
fixture-driven cases take over — so a fixture landing without a parser fails the
suite instead of passing silently.

## Picking it up

On a machine that can reach the site:

1. `just fetch 2024 SB --` runs discovery first: it starts at the origin, prints
   every candidate link for 2024, then every candidate link for SB, and only
   then downloads. Run `npm run --workspace pipeline cli -- fetch --year 2024
   --county SB --discover` to print the URLs and stop.
2. Confirm the printed URLs are the repartizare pages, then let it crawl.
   Downloads land in `pipeline/raw/` (gitignored), one request every 2 seconds,
   cached pages skipped.
3. Copy 2-3 representative pages into `pipeline/fixtures/`, each with a
   `<name>.html.url` sidecar naming its source URL. Commit them.
4. Implement `parseRepartizarePage()` in `pipeline/src/parse/repartizare.ts`
   against those files. Route every text field through `normalizeText()` and
   every media cell through `parseMediaCell()`; both are already tested. Use
   `toFiliera()` for the filiera column.
5. `just normalize 2024 SB && just emit`, then `just check`.

If the crawl cannot find a 2024 link or an SB link, `DiscoveryFailedError`
prints every link it did see. That is a signal the site moved, not a reason to
hardcode a URL template.

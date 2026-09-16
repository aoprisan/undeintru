# Official admission archive snapshots

Complete specialization responses for all 41 counties and București in 2025
and 2026. Sibiu was downloaded on 2026-09-15; the other counties on
2026-09-16. Each file
has a `.url` sidecar. HTML and JavaScript are unmodified reference fixtures,
not app assets; their external scripts are never executed by the app.

The county HTML labels `data-api-source="data/specialization"` and maps the
JSON fields to table columns. Its linked `script/repartizare.js` appends
`.json` and loads the complete array (pagination is client-side).

The following counts describe the original Sibiu reference snapshots:

| Year | Rows | Offered seats | Format |
| --- | ---: | ---: | --- |
| 2025 | 74 | 2,344 | `n` is the level; no dual flag |
| 2026 | 117 | 3,474 | `d` is the dual flag; no level column |

`um` is the current year's cutoff; `uma` is the previous-year column and is
**not imported**. In 2026 it disagrees with the actual 2025 results for some
courses: Gheorghe Lazăr mathematics has `uma=6.09`, whereas the 2025 response
has `um=9.37`. Course codes also changed (113 to 103 in that example).
Historical matching therefore uses the school code, course label, profile,
track, and teaching language, with bilingual and dual status retained in the
course label. Ambiguous matches are excluded.

The Sibiu 2026 snapshot includes 37 dual courses. A published `um: null` remains null. A course
with unfilled seats can still have a published cutoff; that value is preserved.
Occupied counts can also exceed offered seats in the official response; both
counts are retained unchanged.
These are computerized allocation results, not a complete catalogue of
aptitude-gated or later-round admissions.

Reproduce the published data offline from the repository root:

```
node --import tsx pipeline/src/cli.ts archive
node --import tsx pipeline/src/cli.ts emit
```

To refresh a snapshot, download the exact URL in its sidecar and retain the
associated county page and script if their structure changed. Add regression
assertions before publishing a new format. Do not substitute the `ierarhie`
(pre-allocation) endpoint: its cutoffs describe the previous year.

The 2023 and 2024 archive landing pages still exist, but their news pages no
longer link to allocation tables; the search-indexed 2024 BZ allocation page
returned HTTP 404 during this fetch. No earlier data has been inferred from
current-year seats or previous-year cutoff columns.

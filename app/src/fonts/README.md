# Fonts

Three typefaces, self-hosted rather than loaded from a CDN: the app promises no
third-party calls, and a blocked font host would leave the page unreadable
offline. Only the `latin` and `latin-ext` subsets are shipped — `latin-ext` is
what carries the Romanian comma-below letters (ș ț), so school names set
correctly instead of falling back mid-word.

| File | Family | Axes shipped | License |
| --- | --- | --- | --- |
| `bricolage-*.woff2` | Bricolage Grotesque | wght 400–800, wdth 75–100 | [OFL 1.1](OFL-BricolageGrotesque.txt) |
| `instrument-*.woff2` | Instrument Sans | wght 400–700 | [OFL 1.1](OFL-InstrumentSans.txt) |
| `martian-*.woff2` | Martian Mono | wght 100–800, wdth 75–112.5 | [OFL 1.1](OFL-MartianMono.txt) |

The files come from Google Fonts' `fonts.gstatic.com` variable-font builds. The
`@font-face` rules — including the `unicode-range` for each subset — live in
`app/src/style.css`; they are declared relative to this directory so Vite
fingerprints the files and the service worker precaches them.

Only the axes the stylesheet actually uses are requested: Bricolage and Martian
vary by width as well as weight, Instrument by weight alone, and no face ships
an optical-size axis or an italic. Asking for axes nobody sets is what makes a
variable font heavy — dropping `opsz` alone halved Bricolage.

To refresh a family, request its CSS from `fonts.googleapis.com/css2` with a
browser user agent (that is what selects woff2), take the `latin` and
`latin-ext` blocks, and replace both the files and their `unicode-range`s. If
you add a `font-stretch` rule for a face that has no width axis, the browser
will synthesise it — check the axes here before reaching for one.

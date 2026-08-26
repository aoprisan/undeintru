# The interface

The app answers one question — *does this media get my kid in?* — so the whole
page is built as a single chart of one scale, and everything else is quiet.

## The scale is the design

Every threshold in the county lives on the same axis: **media 5 to 10, fixed**,
never fitted to the data. A domain that shrank to the county's own range would
turn a tenth of a point into half the screen; the fixed scale keeps two
counties, and two visits, comparable by eye.

That axis is drawn three times, at three sizes:

1. **The ruler** in the console: one hairline per specialization in the county.
   Where the hairlines crowd is where the competition is.
2. **The row plots**: the same axis repeated once per row, carrying the 80%
   prediction interval for that specialization's next cutoff.
3. **The line**: the child's own media, drawn at the same x in every row, so it
   reads as one unbroken rule down the page. Bands that end left of it are
   cleared; bands that straddle it are the ones the model calls *incert*.

A row's bar is not a progress bar. It is the interval the cutoff can plausibly
land in, and the filled part is how much of that interval the media is above —
which is the model's actual claim, drawn rather than summarised. The point tick
inside the bar is last year's cutoff, the point prediction.

## Colour carries one thing

Probability is encoded as **ink**, not hue: solid where the media clears,
hatched — a printed screen tint — where it does not. That reading survives
colour blindness, a greyscale print, and a phone in sunlight, and it leaves
exactly one saturated colour on the page for the family's own number. The blue
belongs to the media and to focus rings, and to nothing else.

Red is reserved for two things: the synthetic-data banner and a failure. If the
page is red, something is wrong with the data or with the app.

## Type

Three faces, each with a job:

| Role | Face | Where |
| --- | --- | --- |
| Display | Bricolage Grotesque | wordmark, verdict, section heads |
| Body | Instrument Sans | school names, prose, controls |
| Data | Martian Mono | every media, cutoff, interval and axis label |

Numbers are the product, so they get their own monospaced face and never share
one with prose. All three are **self-hosted** from `app/src/fonts/`, latin and
latin-ext subsets only: the app promises no third-party calls, and a font CDN
would be one — as well as a blank page on a school Wi-Fi that blocks it. They
are precached by the service worker, so the app is legible offline.

The faces are variable and used across their width axes; the Romanian
comma-below letters (ș ț) come from the latin-ext subset, so school names set
correctly without falling back mid-word.

## Structure and copy

The list is grouped by what a parent does next, not by score:

- **Aici ai șanse** — ordered hardest-first, because the top of that list is the
  best school still in reach.
- **Aici n-a fost prag** — nobody was turned away for their media last year.
- **Aici pragul e peste media ta** — ordered nearest-miss first.
- **Nu se decide doar din medie** — filiera vocationala, where an aptitude exam
  decides, and specializations with no history. These are left out of both
  sides of the headline count: a media neither clears nor misses them.

Copy is Romanian, sentence case, active voice, and counts inflect properly
(19 specializări, but 20 **de** specializări — the rule runs on the last two
digits). The verdict sentence states the count and then, in a second line, what
is uncertain about it. Nothing in the interface claims a precision the model
does not have: bands, never percentages.

## Floor

- Responsive to 360px; the row plot drops below the text and the line still runs
  through the full height of each row.
- Visible focus on every control; a skip link to the list.
- The charts are `aria-hidden` — every number they encode is also in the row's
  text column, so a screen reader gets the figures, not dozens of empty nodes.
- `prefers-reduced-motion` removes the entry animation and the line's transition.
- Dark mode is a real palette, not an inversion: paper becomes graphite, ink
  becomes bone, and the pen blue lifts to stay legible on it.

/**
 * Tehnologică course domains: the 2026 qualification vocabulary, mapped back
 * onto the 2025 domain vocabulary, so a tehnologică course keeps its history.
 *
 * ## Why this file exists
 *
 * The ministry changed what the `sp` field *means* between the two published
 * generations, without changing its name:
 *
 * - **2025** publishes the **domeniu**: 22 values nationwide, `"Mecanică"`,
 *   `"Economic"`, `"Turism și alimentație"`.
 * - **2026** publishes the **calificare pair**: 381 values nationwide,
 *   `"Tehnician mecanic pentru intreținere și reparații / Mecanic auto (dual)"`.
 *
 * The two vocabularies do not overlap at all — literally zero of the 22 appear
 * in 2026 — so every one of the 1550 tehnologică courses published in 2025
 * failed to match its 2026 self, and the model fitted county shifts on
 * teoretică alone. The domeniu is not merely renamed in the 2026 feed, it is
 * **absent**: the record carries `j, c, l, lc, m, sp, lp, lb, nlt, nlo, fi, p,
 * f, d, um, uma` and nothing else. So it has to be recovered, not parsed.
 *
 * ## What the table is
 *
 * The first segment of a 2026 label — the *liceal* qualification, before the
 * `/` — determines the domeniu. There are 66 of those nationwide, covering all
 * 3219 tehnologică rows, which is why this table is 66 entries rather than 381.
 *
 * Derived by `pipeline/src/alias/`, regenerate with `just alias-fit`. Two
 * independent offline signals propose each entry — how often a school's 2026
 * qualification co-occurs with one of its own 2025 domains, and whether the
 * qualification name lexically contains the domain name — and a third,
 * `just alias-fit --model`, asks TypeSafe's Jev to classify the label text on
 * its own. The committed values below are the reviewed result. Nothing calls a
 * model at app runtime, or at build time: this is plain data.
 *
 * ## What it changed, measured
 *
 * Against the committed 2026 outcomes (`pipeline/src/audit-model.ts`), fitting
 * 2025 and scoring 2026: **1504 -> 1852 scored courses**, and the 1504 that
 * scored before are unchanged to the digit — MAE 0.6414, coverage 0.4668 both
 * ways. Nothing was lost; 348 tehnologică courses gained a history they did not
 * have. The pairs are real: their 2025 and 2026 cutoffs correlate at r = 0.751,
 * where a mismatched table would show no correlation.
 *
 * **The 348 also predict much worse than the 1504** — MAE 1.2324 against
 * 0.6414, and only 15.8% land inside the interval against 46.7%. That is not
 * this table failing, it is this table making an existing gap visible: in 2026
 * tehnologică cutoffs fell by a median 0.98 while teoretică fell 0.42, and
 * `fitCutoffModel` applies **one** county-wide shift `m[y]` to both. The shift
 * is not county-wide, it is filiera-wide, and nobody could see that while no
 * tehnologică course ever matched. Until that is settled, a tehnologică
 * prediction is optimistic by roughly half a point — the dangerous direction.
 * Fitting shifts per filiera is the obvious answer and is a modelling decision,
 * not a matching one, so it is deliberately not taken here.
 *
 * ## What it deliberately does not do
 *
 * It maps *labels*, never numbers. No cutoff, media, seat count or probability
 * is derived from it. Its whole effect is to let {@link uniqueCourses} see that
 * two rows a year apart are the same course; everything downstream is the same
 * arithmetic on the same published values. When a school's 2026 qualifications
 * collapse onto one 2025 domain, the resulting identities collide and
 * `uniqueCourses` drops them — the existing "omit ambiguity rather than guess"
 * rule, unchanged.
 */

/** The 18 base domains published in 2025, before bilingual qualifiers. */
export const TEHNOLOGICA_DOMAINS = [
  'Agricultură',
  'Chimie industrială',
  'Comerț',
  'Construcții, instalații și lucrări publice',
  'Economic',
  'Electric',
  'Electromecanică',
  'Electronică automatizări',
  'Estetica și igiena corpului omenesc',
  'Fabricarea produselor din lemn',
  'Industrie alimentară',
  'Industrie textilă și pielărie',
  'Mecanică',
  'Producție media',
  'Protecția mediului',
  'Silvicultură',
  'Tehnici poligrafice',
  'Turism și alimentație',
] as const;

export type TehnologicaDomain = (typeof TEHNOLOGICA_DOMAINS)[number];

/**
 * Liceal qualification (the segment before `/`) to 2025 domeniu.
 *
 * Keys are stored exactly as published in 2026, after the bilingual and dual
 * qualifiers are stripped; {@link resolveDomain} does that stripping and the
 * case folding, so lookups here are on the published spelling.
 */
export const COURSE_DOMAINS: Readonly<Record<string, TehnologicaDomain>> = {
  'Coafor stilist': 'Estetica și igiena corpului omenesc',
  'Organizator banqueting': 'Turism și alimentație',
  'Tehnician agromontan': 'Agricultură',
  'Tehnician agronom': 'Agricultură',
  'Tehnician analize produse alimentare': 'Industrie alimentară',
  'Tehnician audio - video': 'Producție media',
  'Tehnician aviație': 'Electromecanică',
  'Tehnician chimist de laborator': 'Chimie industrială',
  'Tehnician construcții navale': 'Mecanică',
  'Tehnician de telecomunicații': 'Electronică automatizări',
  'Tehnician desenator pentru construcții și instalații':
    'Construcții, instalații și lucrări publice',
  'Tehnician designer mobila și amenajări interioare': 'Fabricarea produselor din lemn',
  'Tehnician designer vestimentar': 'Industrie textilă și pielărie',
  'Tehnician ecolog și protecția calității mediului': 'Protecția mediului',
  'Tehnician electrician electronist auto': 'Electric',
  'Tehnician electromecanic': 'Electromecanică',
  'Tehnician electronist': 'Electronică automatizări',
  'Tehnician electrotehnist': 'Electric',
  'Tehnician energetician': 'Electric',
  'Tehnician hidrometeorolog': 'Protecția mediului',
  'Tehnician horticultor': 'Agricultură',
  'Tehnician instalator pentru construcții': 'Construcții, instalații și lucrări publice',
  'Tehnician instalații de bord (avion)': 'Electromecanică',
  'Tehnician în achiziții și contractări': 'Comerț',
  'Tehnician în activități de comerț': 'Comerț',
  'Tehnician în activități de poștă': 'Economic',
  'Tehnician în activități economice': 'Economic',
  'Tehnician în administrație': 'Economic',
  'Tehnician în agricultura ecologică': 'Agricultură',
  'Tehnician în agricultură': 'Agricultură',
  'Tehnician în agroturism': 'Agricultură',
  'Tehnician în automatizări': 'Electronică automatizări',
  'Tehnician în chimie industrială': 'Chimie industrială',
  'Tehnician în construcții și lucrări publice': 'Construcții, instalații și lucrări publice',
  'Tehnician în gastronomie': 'Turism și alimentație',
  'Tehnician în hotelărie': 'Turism și alimentație',
  'Tehnician în industria alimentară': 'Industrie alimentară',
  'Tehnician în industria alimentară fermentativă și în prelucrarea legumelor și fructelor':
    'Industrie alimentară',
  'Tehnician în industria pielăriei': 'Industrie textilă și pielărie',
  'Tehnician în industria sticlei și ceramicii': 'Chimie industrială',
  'Tehnician în industria textilă': 'Industrie textilă și pielărie',
  'Tehnician în instalații electrice': 'Electric',
  'Tehnician în morărit, panificație și produse făinoase': 'Industrie alimentară',
  'Tehnician în prelucrarea lemnului': 'Fabricarea produselor din lemn',
  'Tehnician în prelucrarea produselor de origine animală': 'Industrie alimentară',
  'Tehnician în silvicultură și exploatări forestiere': 'Silvicultură',
  'Tehnician în turism': 'Turism și alimentație',
  'Tehnician mecanic pentru intreținere și reparații': 'Mecanică',
  'Tehnician mecatronist': 'Mecanică',
  'Tehnician metrolog': 'Electric',
  'Tehnician multimedia': 'Producție media',
  'Tehnician operator procesare text/imagine': 'Producție media',
  'Tehnician operator roboți industriali': 'Electronică automatizări',
  'Tehnician operator tehnică de calcul': 'Electronică automatizări',
  'Tehnician operator telematică': 'Electronică automatizări',
  'Tehnician pentru animale de companie': 'Agricultură',
  'Tehnician poligraf': 'Tehnici poligrafice',
  'Tehnician prelucrări la cald': 'Mecanică',
  'Tehnician prelucrări mecanice': 'Mecanică',
  'Tehnician prelucrări pe mașini cu comandă numerică': 'Mecanică',
  'Tehnician producție film si televiziune': 'Producție media',
  'Tehnician proiectant CAD': 'Mecanică',
  'Tehnician proiectant produse finite din lemn': 'Fabricarea produselor din lemn',
  'Tehnician transporturi': 'Mecanică',
  'Tehnician veterinar': 'Agricultură',
  'Tehnician zootehnist': 'Agricultură',
};

/** Fold a label for lookup: NFC, lowercase, legacy cedilla forms unified. */
export function domainKey(label: string): string {
  return label
    .normalize('NFC')
    .toLocaleLowerCase('ro-RO')
    .replace(/[şţ]/g, (letter) => (letter === 'ş' ? 'ș' : 'ț'))
    .replace(/\s+/g, ' ')
    .trim();
}

const BY_KEY: ReadonlyMap<string, TehnologicaDomain> = new Map(
  Object.entries(COURSE_DOMAINS).map(([label, domain]) => [domainKey(label), domain]),
);

/** The bilingual qualifier a label carries, e.g. `" (bilingv: Limba engleză)"`. */
const BILINGUAL = / \(bilingv: [^)]*\)/;

/**
 * The 2025-vocabulary spec label for a published one, or `null` when the label
 * is already in that vocabulary or is not a tehnologică qualification.
 *
 * The bilingual qualifier survives the translation, because both generations
 * publish it and it separates genuinely different courses at one school. The
 * `(dual)` qualifier does **not**: 2025 has no dual flag at all, so keeping it
 * would guarantee a miss rather than prevent a wrong match. Two courses at one
 * school that differ only by dual therefore collide, and `uniqueCourses` drops
 * both — ambiguity omitted rather than guessed, as everywhere else here.
 */
export function resolveSpecLabel(specLabel: string): string | null {
  const bilingual = BILINGUAL.exec(specLabel)?.[0] ?? '';
  const stripped = specLabel.replace(/ \(dual\)$/, '').replace(BILINGUAL, '');
  const qualification = stripped.split(' / ')[0];
  if (qualification === undefined) return null;
  const domain = BY_KEY.get(domainKey(qualification));
  return domain === undefined ? null : `${domain}${bilingual}`;
}

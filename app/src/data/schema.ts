/**
 * Shared data contract for undeintru.
 *
 * This module is the single source of truth for the shape of the JSON the
 * pipeline emits into `app/public/data/v1/` and the app reads back. The
 * pipeline imports it to validate before writing; the app imports it to
 * validate after fetching. Keep it dependency-free — `app/` must not pull in
 * third-party runtime code.
 *
 * ## Why every record carries a year
 *
 * The Romanian "media de admitere" formula changed in 2023. From 2023 onward
 * it is the average of the two Evaluarea Națională grades (romana, matematica).
 * Before 2023 the gimnaziu average was folded in as well. A 9.20 cutoff in
 * 2022 and a 9.20 cutoff in 2024 are therefore *not* the same thing, and
 * ranking or diffing across that boundary is meaningless. The year travels
 * with every row so no consumer can accidentally forget.
 */

export const SCHEMA_VERSION = 1 as const;

/**
 * First year the "(romana + matematica) / 2" formula applied. Cutoffs from
 * this year onward are comparable with each other; earlier ones are not
 * comparable with them.
 */
export const MEDIA_FORMULA_EPOCH_YEAR = 2023 as const;

/** Filiera — the top-level track of a Romanian high-school specialization. */
export const FILIERE = ['teoretica', 'tehnologica', 'vocationala'] as const;
export type Filiera = (typeof FILIERE)[number];

/** One specialization at one high school, for one admission year. */
export interface AdmissionRow {
  /** Admission year, e.g. 2024. */
  readonly year: number;
  /** County code, uppercase, e.g. "SB". Bucharest is "B". */
  readonly county: string;
  /** Official school code as published in the repartizare tables. */
  readonly schoolCode: string;
  /** School name, diacritics normalized to comma-below forms, NFC. */
  readonly schoolName: string;
  /** Official specialization code, unique within the year's dataset. */
  readonly specId: string;
  /** Specialization label as published, diacritics normalized, NFC. */
  readonly specLabel: string;
  /** Profile, e.g. "Real", "Uman", "Servicii". Empty string if not published. */
  readonly profile: string;
  /** Filiera the specialization belongs to. */
  readonly filiera: Filiera;
  /** Language of instruction, e.g. "Româna", "Germana". */
  readonly limba: string;
  /** Seats offered (locuri). Non-negative integer. */
  readonly seats: number;
  /**
   * Media of the last admitted candidate — the cutoff. `null` when the
   * specialization did not fill, or no cutoff was published.
   *
   * Two decimals, TRUNCATED (see `pipeline/src/util/media.ts`). Only
   * comparable against other rows with the same `year` epoch.
   */
  readonly lastMedia: number | null;
  /**
   * True for filiera vocationala. Admission there is gated by an aptitude
   * exam, so `lastMedia` does not mean "any kid above this got in".
   */
  readonly vocational: boolean;
}

/**
 * Where a dataset's numbers came from.
 *
 * `synthetic` data exists so the prediction model can be exercised end to end
 * while the real source is unreachable. It is generated, not observed, and it
 * must never be mistaken for the real thing — so it is marked here, carried
 * into the index, and surfaced in the UI rather than left to a README nobody
 * reads. A cutoff that looks official but was invented is the single worst
 * failure this app can have.
 */
export const PROVENANCES = ['official', 'synthetic'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** One emitted county file: `data/v1/<year>/<county>.json`. */
export interface CountyDataset {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly year: number;
  readonly county: string;
  /** ISO-8601 timestamp of the emit run. */
  readonly generatedAt: string;
  readonly provenance: Provenance;
  /** Source URLs the rows were derived from. Empty for synthetic data. */
  readonly sources: readonly string[];
  readonly rows: readonly AdmissionRow[];
}

/** One entry in `data/v1/index.json`. */
export interface DatasetIndexEntry {
  readonly year: number;
  readonly county: string;
  /** Path relative to `data/v1/`, e.g. "2024/SB.json". */
  readonly path: string;
  readonly rowCount: number;
  /** Mirrored from the dataset so the app can warn before loading it. */
  readonly provenance: Provenance;
}

/** `data/v1/index.json` — what the app loads first. */
export interface DatasetIndex {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly datasets: readonly DatasetIndexEntry[];
}

// --- validation -------------------------------------------------------------

/** A validation failure, addressed by a JSON-ish path. */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class SchemaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(what: string, issues: readonly ValidationIssue[]) {
    const detail = issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    super(`${what} failed schema validation:\n${detail}`);
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Checker {
  readonly issues: ValidationIssue[] = [];

  fail(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  record(path: string, v: unknown): Rec | undefined {
    if (!isRecord(v)) {
      this.fail(path, `expected an object, got ${describe(v)}`);
      return undefined;
    }
    return v;
  }

  str(path: string, v: unknown, { allowEmpty = false } = {}): string | undefined {
    if (typeof v !== 'string') {
      this.fail(path, `expected a string, got ${describe(v)}`);
      return undefined;
    }
    if (!allowEmpty && v.length === 0) {
      this.fail(path, 'expected a non-empty string');
      return undefined;
    }
    return v;
  }

  int(path: string, v: unknown, { min = Number.NEGATIVE_INFINITY } = {}): number | undefined {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      this.fail(path, `expected an integer, got ${describe(v)}`);
      return undefined;
    }
    if (v < min) {
      this.fail(path, `expected an integer >= ${min}, got ${v}`);
      return undefined;
    }
    return v;
  }

  bool(path: string, v: unknown): boolean | undefined {
    if (typeof v !== 'boolean') {
      this.fail(path, `expected a boolean, got ${describe(v)}`);
      return undefined;
    }
    return v;
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return typeof v;
}

/** Year sanity bounds — wide enough to be future-proof, tight enough to catch a parse slip. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const COUNTY_RE = /^[A-Z]{1,2}$/;
/** Two decimals at most, and within the 1..10 Romanian grading scale. */
const MEDIA_MIN = 1;
const MEDIA_MAX = 10;

function isFiliera(v: unknown): v is Filiera {
  return typeof v === 'string' && (FILIERE as readonly string[]).includes(v);
}

function isProvenance(v: unknown): v is Provenance {
  return typeof v === 'string' && (PROVENANCES as readonly string[]).includes(v);
}

function checkRow(c: Checker, path: string, value: unknown): void {
  const row = c.record(path, value);
  if (!row) return;

  const year = c.int(`${path}.year`, row['year']);
  if (year !== undefined && (year < MIN_YEAR || year > MAX_YEAR)) {
    c.fail(`${path}.year`, `year ${year} is outside ${MIN_YEAR}..${MAX_YEAR}`);
  }

  const county = c.str(`${path}.county`, row['county']);
  if (county !== undefined && !COUNTY_RE.test(county)) {
    c.fail(`${path}.county`, `expected an uppercase county code, got ${JSON.stringify(county)}`);
  }

  c.str(`${path}.schoolCode`, row['schoolCode']);
  c.str(`${path}.schoolName`, row['schoolName']);
  c.str(`${path}.specId`, row['specId']);
  c.str(`${path}.specLabel`, row['specLabel']);
  c.str(`${path}.profile`, row['profile'], { allowEmpty: true });
  c.str(`${path}.limba`, row['limba'], { allowEmpty: true });
  c.int(`${path}.seats`, row['seats'], { min: 0 });

  const filiera = row['filiera'];
  if (!isFiliera(filiera)) {
    c.fail(
      `${path}.filiera`,
      `expected one of ${FILIERE.join(' | ')}, got ${JSON.stringify(filiera)}`,
    );
  }

  const vocational = c.bool(`${path}.vocational`, row['vocational']);
  if (vocational !== undefined && isFiliera(filiera)) {
    const expected = filiera === 'vocationala';
    if (vocational !== expected) {
      c.fail(
        `${path}.vocational`,
        `filiera ${filiera} implies vocational=${String(expected)}, got ${String(vocational)}`,
      );
    }
  }

  const media = row['lastMedia'];
  if (media !== null) {
    if (typeof media !== 'number' || !Number.isFinite(media)) {
      c.fail(`${path}.lastMedia`, `expected a finite number or null, got ${describe(media)}`);
    } else if (media < MEDIA_MIN || media > MEDIA_MAX) {
      c.fail(`${path}.lastMedia`, `media ${media} is outside ${MEDIA_MIN}..${MEDIA_MAX}`);
    } else if (Math.abs(media * 100 - Math.round(media * 100)) > 1e-6) {
      // Compared with a tolerance, not exactly. `8.96 * 100` is
      // 896.0000000000001 in IEEE-754, so an exact test rejects a perfectly
      // well-formed cutoff. The tolerance is far tighter than the smallest
      // real violation: an untruncated 9.855 lands half a hundredth out.
      c.fail(`${path}.lastMedia`, `media ${media} has more than two decimals`);
    }
  }

  // A string of digits masquerading as a code is fine; a stray "\n" is not.
  for (const key of ['schoolName', 'specLabel', 'profile', 'limba'] as const) {
    const v = row[key];
    if (typeof v === 'string' && v !== v.trim()) {
      c.fail(`${path}.${key}`, 'expected trimmed text');
    }
  }
}

function checkIsoTimestamp(c: Checker, path: string, v: unknown): void {
  const s = c.str(path, v);
  if (s === undefined) return;
  if (Number.isNaN(Date.parse(s))) {
    c.fail(path, `expected an ISO-8601 timestamp, got ${JSON.stringify(s)}`);
  }
}

/**
 * Validate a parsed `data/v1/<year>/<county>.json` payload.
 * @throws SchemaValidationError with every issue found, not just the first.
 */
export function assertCountyDataset(value: unknown, what = 'county dataset'): CountyDataset {
  const c = new Checker();
  const root = c.record('$', value);

  if (root) {
    if (root['schemaVersion'] !== SCHEMA_VERSION) {
      c.fail('$.schemaVersion', `expected ${SCHEMA_VERSION}, got ${String(root['schemaVersion'])}`);
    }
    const year = c.int('$.year', root['year']);
    const county = c.str('$.county', root['county']);
    checkIsoTimestamp(c, '$.generatedAt', root['generatedAt']);

    const provenance = root['provenance'];
    if (!isProvenance(provenance)) {
      c.fail(
        '$.provenance',
        `expected one of ${PROVENANCES.join(' | ')}, got ${JSON.stringify(provenance)}`,
      );
    }

    const sources = root['sources'];
    if (!Array.isArray(sources)) {
      c.fail('$.sources', `expected an array, got ${describe(sources)}`);
    } else {
      sources.forEach((s, i) => void c.str(`$.sources[${i}]`, s));
      // Synthetic numbers must not carry URLs that imply they were observed.
      if (provenance === 'synthetic' && sources.length > 0) {
        c.fail('$.sources', 'synthetic datasets must not cite sources');
      }
    }

    const rows = root['rows'];
    if (!Array.isArray(rows)) {
      c.fail('$.rows', `expected an array, got ${describe(rows)}`);
    } else {
      const seen = new Set<string>();
      rows.forEach((row, i) => {
        const path = `$.rows[${i}]`;
        checkRow(c, path, row);
        if (isRecord(row)) {
          // Rows must agree with the file they live in — a mixed-year file
          // would silently reintroduce the cross-epoch comparison we banned.
          if (year !== undefined && row['year'] !== year) {
            c.fail(`${path}.year`, `expected ${year} to match $.year, got ${String(row['year'])}`);
          }
          if (county !== undefined && row['county'] !== county) {
            c.fail(
              `${path}.county`,
              `expected ${county} to match $.county, got ${String(row['county'])}`,
            );
          }
          const key = `${String(row['schoolCode'])}/${String(row['specId'])}`;
          if (seen.has(key)) c.fail(path, `duplicate schoolCode/specId pair ${key}`);
          seen.add(key);
        }
      });
    }
  }

  if (c.issues.length > 0) throw new SchemaValidationError(what, c.issues);
  return value as CountyDataset;
}

/**
 * Validate a parsed `data/v1/index.json` payload.
 * @throws SchemaValidationError with every issue found, not just the first.
 */
export function assertDatasetIndex(value: unknown, what = 'dataset index'): DatasetIndex {
  const c = new Checker();
  const root = c.record('$', value);

  if (root) {
    if (root['schemaVersion'] !== SCHEMA_VERSION) {
      c.fail('$.schemaVersion', `expected ${SCHEMA_VERSION}, got ${String(root['schemaVersion'])}`);
    }
    checkIsoTimestamp(c, '$.generatedAt', root['generatedAt']);

    const datasets = root['datasets'];
    if (!Array.isArray(datasets)) {
      c.fail('$.datasets', `expected an array, got ${describe(datasets)}`);
    } else {
      const seen = new Set<string>();
      datasets.forEach((entry, i) => {
        const path = `$.datasets[${i}]`;
        const rec = c.record(path, entry);
        if (!rec) return;
        const year = c.int(`${path}.year`, rec['year']);
        const county = c.str(`${path}.county`, rec['county']);
        const p = c.str(`${path}.path`, rec['path']);
        c.int(`${path}.rowCount`, rec['rowCount'], { min: 0 });
        if (!isProvenance(rec['provenance'])) {
          c.fail(
            `${path}.provenance`,
            `expected one of ${PROVENANCES.join(' | ')}, got ${JSON.stringify(rec['provenance'])}`,
          );
        }
        if (year !== undefined && county !== undefined && p !== undefined) {
          const expected = `${year}/${county}.json`;
          if (p !== expected) c.fail(`${path}.path`, `expected ${expected}, got ${p}`);
          if (seen.has(expected)) c.fail(path, `duplicate dataset ${expected}`);
          seen.add(expected);
        }
      });
    }
  }

  if (c.issues.length > 0) throw new SchemaValidationError(what, c.issues);
  return value as DatasetIndex;
}

/**
 * Guard against comparing cutoffs across the 2023 formula change.
 * @returns true when both years sit on the same side of the boundary.
 */
export function areYearsComparable(a: number, b: number): boolean {
  return a >= MEDIA_FORMULA_EPOCH_YEAR === (b >= MEDIA_FORMULA_EPOCH_YEAR);
}

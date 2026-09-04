/**
 * Pipeline entry point. Driven by the justfile; run directly with
 * `npm run --workspace pipeline cli -- <command> [flags]`.
 */

import { crawl } from './crawl.js';
import { calibrate, CALIBRATION_YEAR, sample, verify } from './evnat/index.js';
import { DEFAULT_MOCK_SEED, DEFAULT_MOCK_YEARS, writeMock } from './mock/index.js';
import { emit } from './emit.js';
import { harvest } from './harvest.js';
import { normalize } from './normalize.js';

const USAGE = `undeintru pipeline

  fetch      --year <year> --county <code> [--seed <url>] [--discover]
             Download the repartizare pages into pipeline/raw/ (gitignored).
             Throttled to one request every 2s; cached pages are skipped.
             --discover prints the URLs it found and stops.

  harvest    --county <code> [--years 2023,2024,2025,2026] [--seed <url>]
             [--discover] [--fixtures <n>] [--all-fixtures] [--stage-only]
             Everything that needs the network, in one run: crawl every year,
             descend below the county pages, record what belongs where in
             pipeline/raw/harvest.json, and stage representative pages into
             pipeline/fixtures/ with their .url sidecars. A year that fails
             does not stop the others. See scripts/populate.sh.

  normalize  --year <year> --county <code> [--fixtures]
             Parse pipeline/raw/ (or pipeline/fixtures/ with --fixtures)
             into pipeline/normalized/<year>/<county>.json.

  emit       Validate pipeline/normalized/ against the shared schema and
             publish to app/public/data/v1/.

  mock       --county <code> [--years 2023,2024] [--seed <n>]
             Write SYNTHETIC normalized data, for exercising the pipeline and
             the prediction model while the real source is unreachable. Every
             row it writes is stamped provenance: synthetic.

  evnat      verify|calibrate|sample [--year <year>]
             Real Evaluarea Națională results from data.gov.ro. Network-only.
               verify     recompute every published media and compare
               calibrate  fit the school-record -> exam-mark table
               sample     regenerate the committed fixtures
`;

interface Flags {
  readonly positional: string[];
  readonly options: Map<string, string | true>;
}

function parseArgs(argv: readonly string[]): Flags {
  const positional: string[] = [];
  const options = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options.set(name, next);
      i += 1;
    } else {
      options.set(name, true);
    }
  }

  return { positional, options };
}

function requiredNumber(flags: Flags, name: string): number {
  const raw = flags.options.get(name);
  if (typeof raw !== 'string') throw new Error(`Missing --${name}`);
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer, got ${raw}`);
  return value;
}

/** Parse a `--years 2023,2024` list, or fall back to the default. */
function yearList(raw: string | true | undefined, fallback: readonly number[]): number[] {
  if (typeof raw !== 'string') return [...fallback];
  return raw.split(',').map((y) => {
    const value = Number(y.trim());
    if (!Number.isInteger(value)) throw new Error(`--years: bad year ${y}`);
    return value;
  });
}

/**
 * Every year the current media formula covers. 2023 is the first year the
 * cutoffs are comparable with today's (see `areYearsComparable`); earlier
 * years would be fetched for nothing.
 */
const DEFAULT_HARVEST_YEARS: readonly number[] = [2023, 2024, 2025, 2026];

function requiredString(flags: Flags, name: string): string {
  const raw = flags.options.get(name);
  if (typeof raw !== 'string' || raw === '') throw new Error(`Missing --${name}`);
  return raw;
}

async function main(argv: readonly string[]): Promise<void> {
  const flags = parseArgs(argv);
  const command = flags.positional[0];

  switch (command) {
    case 'fetch': {
      const seed = flags.options.get('seed');
      await crawl({
        year: requiredNumber(flags, 'year'),
        county: requiredString(flags, 'county').toUpperCase(),
        discoverOnly: flags.options.get('discover') === true,
        ...(typeof seed === 'string' ? { seed } : {}),
      });
      return;
    }
    case 'harvest': {
      const seed = flags.options.get('seed');
      const rawFixtures = flags.options.get('fixtures');
      const fixtureCount = typeof rawFixtures === 'string' ? Number(rawFixtures) : undefined;
      if (fixtureCount !== undefined && (!Number.isInteger(fixtureCount) || fixtureCount < 0)) {
        throw new Error(`--fixtures must be a non-negative integer, got ${String(rawFixtures)}`);
      }
      await harvest({
        county: requiredString(flags, 'county').toUpperCase(),
        years: yearList(flags.options.get('years'), DEFAULT_HARVEST_YEARS),
        discoverOnly: flags.options.get('discover') === true,
        stageOnly: flags.options.get('stage-only') === true,
        allFixtures: flags.options.get('all-fixtures') === true,
        ...(fixtureCount !== undefined ? { fixtureCount } : {}),
        ...(typeof seed === 'string' ? { seed } : {}),
      });
      return;
    }
    case 'normalize': {
      await normalize({
        year: requiredNumber(flags, 'year'),
        county: requiredString(flags, 'county').toUpperCase(),
        useFixtures: flags.options.get('fixtures') === true,
      });
      return;
    }
    case 'emit': {
      await emit();
      return;
    }
    case 'mock': {
      const years = yearList(flags.options.get('years'), DEFAULT_MOCK_YEARS);
      const rawSeed = flags.options.get('seed');
      await writeMock({
        county: requiredString(flags, 'county').toUpperCase(),
        years,
        seed: typeof rawSeed === 'string' ? Number(rawSeed) : DEFAULT_MOCK_SEED,
      });
      return;
    }
    case 'evnat': {
      const action = flags.positional[1];
      const raw = flags.options.get('year');
      const year = typeof raw === 'string' ? Number(raw) : CALIBRATION_YEAR;
      if (!Number.isInteger(year)) throw new Error(`--year must be an integer, got ${String(raw)}`);
      switch (action) {
        case 'verify':
          await verify(year);
          return;
        case 'calibrate':
          await calibrate(year);
          return;
        case 'sample':
          await sample();
          return;
        default:
          throw new Error(
            `evnat: expected verify, calibrate or sample, got ${action ?? '(nothing)'}`,
          );
      }
    }
    default: {
      process.stdout.write(USAGE);
      if (command !== undefined) {
        process.stderr.write(`\nUnknown command: ${command}\n`);
        process.exitCode = 2;
      }
      return;
    }
  }
}

try {
  await main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
}

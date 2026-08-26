/**
 * Pipeline entry point. Driven by the justfile; run directly with
 * `npm run --workspace pipeline cli -- <command> [flags]`.
 */

import { crawl } from './crawl.js';
import { emit } from './emit.js';
import { normalize } from './normalize.js';

const USAGE = `undeintru pipeline

  fetch      --year <year> --county <code> [--seed <url>] [--discover]
             Download the repartizare pages into pipeline/raw/ (gitignored).
             Throttled to one request every 2s; cached pages are skipped.
             --discover prints the URLs it found and stops.

  normalize  --year <year> --county <code> [--fixtures]
             Parse pipeline/raw/ (or pipeline/fixtures/ with --fixtures)
             into pipeline/normalized/<year>/<county>.json.

  emit       Validate pipeline/normalized/ against the shared schema and
             publish to app/public/data/v1/.
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

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this file rather than from process.cwd(). */
export const REPO_ROOT = resolve(here, '..', '..');
export const PIPELINE_ROOT = resolve(REPO_ROOT, 'pipeline');

/** Downloaded pages. Gitignored — reproducible from `just fetch`. */
export const RAW_DIR = resolve(PIPELINE_ROOT, 'raw');
/** Committed sample pages the parser is written and tested against. */
export const FIXTURES_DIR = resolve(PIPELINE_ROOT, 'fixtures');
/** Intermediate parsed rows, before schema validation and publication. */
export const NORMALIZED_DIR = resolve(PIPELINE_ROOT, 'normalized');
/** Published data, served by the app. */
export const PUBLIC_DATA_DIR = resolve(REPO_ROOT, 'app', 'public', 'data', 'v1');

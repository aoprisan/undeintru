/** Offline audit: fit only 2025 when scoring 2026. Never fit on the outcome. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DATA_DIR } from './paths.js';
import { assertCountyDataset } from './schema.js';
import { fitCutoffModel, hasVacancies, predict, specKey, uniqueCourses } from './model.js';

const reports = [];
for (const file of readdirSync(join(PUBLIC_DATA_DIR, '2025')).filter((file) => file.endsWith('.json')).sort()) {
  const load = (year: number) => assertCountyDataset(
    JSON.parse(readFileSync(join(PUBLIC_DATA_DIR, String(year), file), 'utf8')),
  );
  const before = load(2025);
  const after = load(2026);
  if (before.provenance !== 'official' || after.provenance !== 'official') {
    throw new Error('Real-data audit requires official history');
  }
  const model = fitCutoffModel([before], after.year);
  const outcomes = uniqueCourses(after.rows);
  let matched = 0;
  let covered = 0;
  let absoluteError = 0;
  for (const [identity, row] of uniqueCourses(before.rows)) {
    const outcome = outcomes.get(identity);
    if (!outcome || outcome.lastMedia === null || outcome.vocational || hasVacancies(outcome)) continue;
    const prediction = predict(model, specKey(row), null);
    if (prediction.kind !== 'estimate') continue;
    matched += 1;
    absoluteError += Math.abs(outcome.lastMedia - prediction.cutoff);
    covered += Number(outcome.lastMedia >= prediction.interval[0] && outcome.lastMedia <= prediction.interval[1]);
  }
  const next = fitCutoffModel([before, after], 2027);
  reports.push({ county: before.county, matched, covered, absoluteError,
    coverage: matched ? covered / matched : null,
    nextYearSd: next.sd, observedShift: next.observedShifts[0]?.shift ?? null });
}
const matched = reports.reduce((sum, report) => sum + report.matched, 0);
console.log(JSON.stringify({
  description: '2025-only fit scored on matched, filled 2026 courses; 2027 SD is an unvalidated forecast.',
  counties: reports.length,
  matched,
  coverage: reports.reduce((sum, report) => sum + report.covered, 0) / matched,
  meanAbsoluteError: reports.reduce((sum, report) => sum + report.absoluteError, 0) / matched,
  reports,
}, null, 2));

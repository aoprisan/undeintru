/** Official static archive JSON, as labelled by the adjacent specialization table. */
import type { AdmissionRow } from '../schema.js';
import { normalizeText } from '../util/diacritics.js';
import { parseMediaCell } from '../util/media.js';
import { PageStructureError, toFiliera, type ParseContext } from './repartizare.js';

export function parseSpecializations(json: string, ctx: ParseContext): AdmissionRow[] {
  const fail = (detail: string): never => { throw new PageStructureError(ctx.sourceUrl, detail); };
  const url = new URL(ctx.sourceUrl);
  if (url.hostname !== 'static.admitere.edu.ro' ||
      url.pathname !== `/${ctx.year}/repartizare/${ctx.county}/data/specialization.json`) {
    fail('source URL does not identify the requested county/year repartizare data');
  }
  let data: unknown;
  try { data = JSON.parse(json); } catch { return fail('invalid JSON'); }
  if (!Array.isArray(data) || data.length === 0) return fail('expected nonempty specialization array');
  const seen = new Set<string>();
  return data.map((value: unknown, index): AdmissionRow => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(`row ${index}: expected object`);
    const record = value as Record<string, unknown>;
    const text = (key: string): string => {
      const field = record[key];
      if (typeof field !== 'string' || field.trim() === '') return fail(`row ${index}: missing ${key}`);
      return normalizeText(field);
    };
    const integer = (key: string): number => {
      const field = text(key);
      if (!/^\d+$/.test(field) || !Number.isSafeInteger(Number(field))) return fail(`row ${index}: invalid ${key}`);
      return Number(field);
    };
    if (text('j') !== ctx.county) return fail(`row ${index}: wrong county`);
    if (text('fi') !== 'Zi') return fail(`row ${index}: unsupported attendance form`);
    if (record['n'] !== undefined && text('n') !== 'Liceal') return fail(`row ${index}: unsupported level`);
    const dual = record['d'] === undefined ? 'NU' : text('d');
    if (dual !== 'DA' && dual !== 'NU') return fail(`row ${index}: invalid dual flag`);
    const schoolCode = text('lc');
    const specId = text('c');
    const key = `${schoolCode}/${specId}`;
    if (seen.has(key)) return fail(`row ${index}: duplicate specialization ${key}`);
    seen.add(key);
    const filiera = toFiliera(text('f'), ctx);
    const seats = integer('nlt');
    const occupiedSeats = integer('nlo');
    if (occupiedSeats > seats) return fail(`row ${index}: occupied seats exceed capacity`);
    const bilingual = text('lb');
    const specLabel = text('sp') + (bilingual === '-' ? '' : ` (bilingv: ${bilingual})`) +
      (dual === 'DA' ? ' (dual)' : '');
    let lastMedia: number | null;
    try { lastMedia = parseMediaCell(record['um'] === null ? '-' : text('um')); }
    catch { return fail(`row ${index}: invalid current cutoff`); }
    return { year: ctx.year, county: ctx.county, schoolCode, schoolName: text('l'),
      specId, specLabel, profile: text('p'), filiera, limba: text('lp'), seats, occupiedSeats,
      lastMedia, vocational: filiera === 'vocationala' };
  });
}

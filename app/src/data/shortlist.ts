import { assertCountyDataset, areYearsComparable, type AdmissionRow, type CountyDataset } from './schema.js';
import { uniqueCourses } from '../model/predict.js';

export interface SavedCourse {
  readonly snapshots: readonly CountyDataset[];
}

export function courseId(row: AdmissionRow): string {
  return `${row.county}/${row.year}/${row.schoolCode}/${row.specId}`;
}

/** Retain only unambiguous, comparable history, never match reassigned codes. */
export function courseSnapshots(row: AdmissionRow, history: readonly CountyDataset[]): CountyDataset[] {
  const key = [...uniqueCourses([row]).keys()][0];
  return history.filter((d) => d.county === row.county && areYearsComparable(d.year, row.year))
    .flatMap((dataset) => {
      const match = dataset.year === row.year
        ? dataset.rows.find((r) => courseId(r) === courseId(row))
        : key === undefined ? undefined : uniqueCourses(dataset.rows).get(key);
      return match ? [{ ...dataset, rows: [match] }] : [];
    }).sort((a, b) => b.year - a.year);
}

export function readShortlist(raw: string | null): SavedCourse[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid shortlist');
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('snapshots' in item) || !Array.isArray(item.snapshots)) {
      throw new Error('Invalid saved course');
    }
    const snapshots = item.snapshots.map((d: unknown) => assertCountyDataset(d));
    const first = snapshots[0]?.rows[0];
    if (!first || snapshots.some((d) => d.rows.length !== 1) || seen.has(courseId(first))) {
      throw new Error('Invalid saved history');
    }
    const expected = courseSnapshots(first, snapshots);
    if (expected.length !== snapshots.length || expected.some((d, i) => d.year !== snapshots[i]?.year)
      || new Set(snapshots.map((d) => d.year)).size !== snapshots.length) throw new Error('Invalid saved history');
    seen.add(courseId(first));
    return { snapshots };
  });
}

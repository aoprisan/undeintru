import './style.css';
import {
  assertCountyDataset,
  assertDatasetIndex,
  MEDIA_FORMULA_EPOCH_YEAR,
  type AdmissionRow,
  type CountyDataset,
  type DatasetIndex,
  type DatasetIndexEntry,
} from './data/schema.js';
import {
  chanceBand,
  fitCutoffModel,
  predict,
  specKey,
  type FittedModel,
  type Prediction,
} from './model/predict.js';

const DATA_ROOT = new URL('data/v1/', document.baseURI);

function mustFind(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector} mount point`);
  return node;
}

const root = mustFind('#app');

async function loadJson(path: string): Promise<unknown> {
  const url = new URL(path, DATA_ROOT);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`GET ${url.pathname} -> ${res.status}`);
  return (await res.json()) as unknown;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

const fmtMedia = (m: number | null): string => (m === null ? '—' : m.toFixed(2));

/** One table row: the school data plus what the model says about it. */
interface Scored {
  readonly row: AdmissionRow;
  readonly prediction: Prediction;
  /** Sort key: probability, with the special cases pushed to sensible ends. */
  readonly rank: number;
}

function score(model: FittedModel, rows: readonly AdmissionRow[], media: number | null): Scored[] {
  return rows.map((row) => {
    const prediction = predict(model, specKey(row), media);
    const rank =
      prediction.kind === 'estimate'
        ? prediction.probability
        : prediction.kind === 'open'
          ? 1.01 // certain, and above everything the model puts a number on
          : -1; // vocational or unknown: no answer, sort last
    return { row, prediction, rank };
  });
}

function renderChance(prediction: Prediction): HTMLElement {
  switch (prediction.kind) {
    case 'open':
      return el(
        'span',
        {
          class: 'pill pill-open',
          title: 'Specializarea nu s-a umplut anul trecut, deci nu a existat un prag.',
        },
        'a rămas loc',
      );
    case 'unavailable':
      return el(
        'span',
        { class: 'pill pill-none', title: 'Admiterea depinde de proba de aptitudini.' },
        prediction.reason === 'vocational' ? 'probă de aptitudini' : 'fără istoric',
      );
    case 'estimate': {
      const band = chanceBand(prediction.probability);
      const pct = Math.round(prediction.probability * 100);
      return el(
        'span',
        {
          class: `pill pill-${band.replace(/\s/g, '-')}`,
          title: `${pct}% — prag estimat ${prediction.cutoff.toFixed(2)}, interval 80%: ${prediction.interval[0].toFixed(2)}–${prediction.interval[1].toFixed(2)}`,
        },
        band,
      );
    }
  }
}

function renderRows(tbody: HTMLElement, scored: readonly Scored[], hasMedia: boolean): void {
  tbody.replaceChildren(
    ...scored.map(({ row, prediction }) =>
      el(
        'tr',
        {},
        el(
          'td',
          {},
          row.schoolName,
          el('br'),
          el('small', { style: 'color:var(--muted)' }, row.specLabel),
        ),
        el('td', {}, row.profile || '—'),
        el('td', { class: 'num' }, String(row.seats)),
        el('td', { class: 'num' }, fmtMedia(row.lastMedia)),
        el(
          'td',
          {},
          hasMedia
            ? renderChance(prediction)
            : el('span', { style: 'color:var(--muted)' }, '—'),
        ),
      ),
    ),
  );
}

/** Group index entries by county, newest year first. */
function byCounty(index: DatasetIndex): Map<string, DatasetIndexEntry[]> {
  const map = new Map<string, DatasetIndexEntry[]>();
  for (const entry of index.datasets) {
    const list = map.get(entry.county) ?? [];
    list.push(entry);
    map.set(entry.county, list);
  }
  for (const list of map.values()) list.sort((a, b) => b.year - a.year);
  return map;
}

function buildUi(index: DatasetIndex): void {
  const counties = byCounty(index);
  const countyNames = [...counties.keys()].sort();

  if (countyNames.length === 0) {
    root.replaceChildren(
      el('h1', {}, 'Unde intru'),
      el('p', { class: 'lede' }, 'Nu există încă date publicate.'),
    );
    return;
  }

  const countySelect = el(
    'select',
    { id: 'county' },
    ...countyNames.map((c) => el('option', { value: c }, c)),
  );
  const mediaInput = el('input', {
    id: 'media',
    type: 'number',
    min: '1',
    max: '10',
    step: '0.01',
    inputmode: 'decimal',
    placeholder: '9.85',
  });

  const banner = el('div', { class: 'banner', hidden: 'hidden' });
  const summary = el('p', { class: 'summary' });
  const modelNote = el('p', { class: 'model-note' });
  const tbody = el('tbody');
  const headCutoff = el('th', { class: 'num' }, 'Ultimul prag');

  root.replaceChildren(
    el('h1', {}, 'Unde intru'),
    el(
      'p',
      { class: 'lede' },
      'Introdu media de admitere și vezi cât de probabil este să prindă loc la fiecare specializare.',
    ),
    banner,
    el(
      'div',
      { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'county' }, 'Județ'), countySelect),
      el('div', { class: 'field' }, el('label', { for: 'media' }, 'Media de admitere'), mediaInput),
    ),
    summary,
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, 'Liceu / specializare'),
          el('th', {}, 'Profil'),
          el('th', { class: 'num' }, 'Locuri'),
          headCutoff,
          el('th', {}, 'Șanse'),
        ),
      ),
      tbody,
    ),
    modelNote,
    el(
      'p',
      { class: 'note' },
      `Din ${MEDIA_FORMULA_EPOCH_YEAR}, media de admitere = (nota la română + nota la matematică) / 2, ` +
        'trunchiată la două zecimale. Mediile din anii anteriori se calculau altfel și nu sunt comparabile. ' +
        'Pragurile se schimbă de la un an la altul — de aceea aplicația arată o probabilitate, nu un răspuns sigur.',
    ),
  );

  let model: FittedModel | null = null;
  let latest: CountyDataset | null = null;

  function refresh(): void {
    if (!model || !latest) return;
    const raw = mediaInput.value.trim();
    const parsed = raw === '' ? null : Number(raw);
    const media = parsed !== null && Number.isFinite(parsed) ? parsed : null;

    const scored = score(model, latest.rows, media).sort(
      (a, b) => b.rank - a.rank || a.row.schoolName.localeCompare(b.row.schoolName, 'ro'),
    );

    summary.textContent =
      media === null
        ? `${latest.rows.length} specializări în ${model.county}. Introdu o medie pentru a vedea șansele.`
        : `Șanse estimate pentru ${model.targetYear}, cu media ${media.toFixed(2)}, pe baza pragurilor din ${model.baseYear}.`;

    modelNote.textContent =
      model.evidence === 'estimated'
        ? `Model calibrat pe ${model.observedShifts.length + 1} ani de praguri; incertitudine estimată ±${(model.sd * 1.2816).toFixed(2)} puncte (interval 80%).`
        : `Istoric scurt (${model.observedShifts.length + 1} ani): incertitudinea folosește valori implicite prudente, ±${(model.sd * 1.2816).toFixed(2)} puncte. Șansele sunt orientative.`;

    renderRows(tbody, scored, media !== null);
  }

  async function selectCounty(county: string): Promise<void> {
    const entries = counties.get(county) ?? [];
    summary.textContent = 'Se încarcă…';

    const datasets: CountyDataset[] = [];
    for (const entry of entries) {
      datasets.push(assertCountyDataset(await loadJson(entry.path), entry.path));
    }
    datasets.sort((a, b) => a.year - b.year);

    const newest = datasets[datasets.length - 1];
    if (!newest) throw new Error(`no datasets for ${county}`);

    latest = newest;
    model = fitCutoffModel(datasets, newest.year + 1);
    headCutoff.textContent = `Prag ${newest.year}`;

    const synthetic = datasets.some((d) => d.provenance === 'synthetic');
    banner.hidden = !synthetic;
    if (synthetic) {
      banner.replaceChildren(
        el('strong', {}, 'Date simulate. '),
        'Aceste praguri sunt generate, nu reale — servesc doar la testarea aplicației și a modelului. ' +
          'Nu lua nicio decizie pe baza lor.',
      );
    }

    refresh();
  }

  countySelect.addEventListener('change', () => void selectCounty(countySelect.value));
  mediaInput.addEventListener('input', refresh);

  const first = countyNames[0];
  if (first) void selectCounty(first);
}

async function main(): Promise<void> {
  try {
    buildUi(assertDatasetIndex(await loadJson('index.json'), 'index.json'));
  } catch (err) {
    root.replaceChildren(
      el('h1', {}, 'Unde intru'),
      el(
        'div',
        { class: 'error' },
        'Datele nu au putut fi încărcate. ',
        el('code', {}, err instanceof Error ? err.message : String(err)),
      ),
    );
  }
}

void main();

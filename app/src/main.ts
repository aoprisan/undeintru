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

function fmtMedia(m: number | null): string {
  return m === null ? '—' : m.toFixed(2);
}

function renderRows(tbody: HTMLElement, rows: readonly AdmissionRow[]): void {
  tbody.replaceChildren(
    ...rows.map((r) =>
      el(
        'tr',
        {},
        el(
          'td',
          {},
          r.schoolName,
          el('br'),
          el('small', { style: 'color:var(--muted)' }, r.specLabel),
        ),
        el('td', {}, r.profile || '—'),
        el('td', {}, r.limba || '—'),
        el('td', { class: 'num' }, String(r.seats)),
        el(
          'td',
          { class: 'num' },
          fmtMedia(r.lastMedia),
          ...(r.vocational ? [' ', el('span', { class: 'tag' }, 'vocațional')] : []),
        ),
      ),
    ),
  );
}

function buildUi(index: DatasetIndex): void {
  const entries = [...index.datasets].sort(
    (a, b) => b.year - a.year || a.county.localeCompare(b.county),
  );

  const datasetSelect = el(
    'select',
    { id: 'dataset' },
    ...entries.map((e) => el('option', { value: e.path }, `${e.county} · ${e.year}`)),
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

  const summary = el('p', { class: 'summary' });
  const tbody = el('tbody');
  const table = el(
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
        el('th', {}, 'Limba'),
        el('th', { class: 'num' }, 'Locuri'),
        el('th', { class: 'num' }, 'Ultima medie'),
      ),
    ),
    tbody,
  );

  root.replaceChildren(
    el('h1', {}, 'Unde intru'),
    el(
      'p',
      { class: 'lede' },
      'Introdu media de admitere și vezi la ce specializări ar fi ajuns în anul selectat.',
    ),
    el(
      'div',
      { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'dataset' }, 'Județ și an'), datasetSelect),
      el(
        'div',
        { class: 'field' },
        el('label', { for: 'media' }, 'Media de admitere'),
        mediaInput,
      ),
    ),
    summary,
    table,
    el(
      'p',
      { class: 'note' },
      `Din ${MEDIA_FORMULA_EPOCH_YEAR}, media de admitere = (nota la română + nota la matematică) / 2, ` +
        'trunchiată la două zecimale. Mediile din anii anteriori se calculau altfel și nu sunt comparabile. ' +
        'Datele sunt istorice: pragurile se schimbă de la un an la altul.',
    ),
  );

  let current: CountyDataset | null = null;

  function refresh(): void {
    if (!current) return;
    const raw = mediaInput.value.trim();
    const media = raw === '' ? null : Number(raw);
    const hasMedia = media !== null && Number.isFinite(media);

    const rows = [...current.rows]
      .filter((r) => !hasMedia || r.lastMedia === null || r.lastMedia <= media)
      .sort((a, b) => (b.lastMedia ?? -1) - (a.lastMedia ?? -1));

    summary.textContent = hasMedia
      ? `${rows.length} specializări din ${current.rows.length} aveau ultima medie sub ${media.toFixed(2)} în ${current.year}.`
      : `${current.rows.length} specializări în ${current.county}, ${current.year}.`;
    renderRows(tbody, rows);
  }

  async function select(entry: DatasetIndexEntry): Promise<void> {
    summary.textContent = 'Se încarcă…';
    current = assertCountyDataset(await loadJson(entry.path), entry.path);
    refresh();
  }

  datasetSelect.addEventListener('change', () => {
    const entry = entries.find((e) => e.path === datasetSelect.value);
    if (entry) void select(entry);
  });
  mediaInput.addEventListener('input', refresh);

  const first = entries[0];
  if (first) void select(first);
  else summary.textContent = 'Nu există încă date publicate.';
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

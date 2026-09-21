import type { AdmissionRow, CountyDataset } from './data/schema.js';
import { courseId, courseSnapshots, readShortlist, type SavedCourse } from './data/shortlist.js';
import { countyName } from './data/counties.js';

const STORAGE_KEY = 'undeintru.preferences.v1';
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

export function historicalFacts(snapshots: readonly CountyDataset[]): HTMLElement {
  const wrap = node('div');
  wrap.className = 'history-facts';
  const table = node('table');
  table.append(node('caption', 'Rezultate istorice — nu oferta pentru anul viitor'));
  const head = node('tr');
  for (const label of ['An / cod', 'Ultima medie', 'Locuri / ocupate']) {
    const cell = node('th', label);
    cell.scope = 'col';
    head.append(cell);
  }
  const thead = node('thead');
  thead.append(head);
  table.append(thead);
  const body = node('tbody');
  for (const dataset of snapshots) {
    const row = dataset.rows[0];
    if (!row) continue;
    const tr = node('tr');
    tr.append(node('td', `${dataset.year} / ${row.specId}`),
      node('td', row.lastMedia === null ? 'Nepublicată' : row.lastMedia.toFixed(2)),
      node('td', `${row.seats} / ${row.occupiedSeats ?? 'necunoscut'}`));
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  if (snapshots.length < 2) wrap.append(node('p', 'Nu există o potrivire istorică unică pentru comparație.'));
  for (const dataset of snapshots) {
    const source = node('p', `${dataset.year} · ${dataset.provenance === 'synthetic' ? 'DATE SIMULATE' : 'Date oficiale'} · publicate în aplicație ${dataset.generatedAt.slice(0, 10)} `);
    if (dataset.provenance === 'synthetic') source.className = 'synthetic-note';
    for (const url of dataset.sources) {
      // Sources are data: never turn an arbitrary scheme into a clickable link.
      if (!/^https?:\/\//i.test(url)) continue;
      const link = node('a', 'Sursa ↗');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      source.append(link, ' ');
    }
    wrap.append(source);
  }
  return wrap;
}

export function buildShortlist(): {
  section: HTMLElement;
  button: (row: AdmissionRow, history: readonly CountyDataset[]) => HTMLButtonElement;
} {
  let saved: SavedCourse[] = [];
  let storageWarning = '';
  try { saved = readShortlist(localStorage.getItem(STORAGE_KEY)); }
  catch { storageWarning = 'Lista salvată nu poate fi citită. Modificările noi vor încerca să o înlocuiască.'; }
  const section = node('section');
  section.className = 'shortlist';
  section.id = 'preferinte';
  const title = node('h2', 'Lista mea de preferințe');
  const intro = node('p', 'Adaugă specializări, compară istoricul și așază-le în ordinea în care le preferi. Lista și copiile istorice se păstrează doar în acest browser; nu se actualizează automat.');
  const warning = node('p', 'Ciornă de lucru, nu fișă de înscriere. Codurile și locurile sunt istorice; verifică oferta și condițiile oficiale pentru anul în care candidezi.');
  const status = node('p');
  status.setAttribute('role', 'status');
  const list = node('ol');
  const print = node('button', 'Tipărește lista');
  print.type = 'button';
  print.className = 'chip shortlist-print';
  print.addEventListener('click', () => { window.print(); });
  section.append(title, intro, warning, print, status, list);
  // Only currently mounted catalog buttons are retained.
  const buttons = new Map<HTMLButtonElement, string>();
  function persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); storageWarning = ''; }
    catch { storageWarning = 'Salvarea în browser nu este disponibilă. Tipărește lista înainte de a închide pagina.'; }
  }
  function render(focusId?: string, action?: string): void {
    list.replaceChildren();
    print.disabled = saved.length === 0;
    status.textContent = storageWarning || (saved.length === 0 ? 'Lista este goală. Adaugă o specializare din rezultatele de mai jos.' : `${saved.length} specializări · ordinea ta, independentă de media de admitere.`);
    saved.forEach((entry, index) => {
      const row = entry.snapshots[0]?.rows[0];
      if (!row) return;
      const id = courseId(row);
      const li = node('li');
      li.append(node('h3', row.schoolName), node('p', `${row.specLabel} · ${countyName(row.county)} · ${row.limba}`));
      li.append(historicalFacts(entry.snapshots));
      const actions = node('div');
      actions.className = 'shortlist-actions';
      for (const [label, offset] of [['Mai sus', -1], ['Mai jos', 1], ['Elimină', 0]] as const) {
        const button = node('button', label);
        button.type = 'button';
        button.className = 'chip';
        button.setAttribute('aria-label', `${label}: ${row.schoolName}, ${row.specLabel}`);
        button.disabled = offset !== 0 && (index + offset < 0 || index + offset >= saved.length);
        button.addEventListener('click', () => {
          if (offset === 0) saved.splice(index, 1);
          else { saved.splice(index, 1); saved.splice(index + offset, 0, entry); }
          persist();
          render(offset === 0 ? undefined : id, label);
          if (offset === 0) { status.tabIndex = -1; status.focus(); }
        });
        actions.append(button);
        if (focusId === id && action === label) requestAnimationFrame(() => {
          if (button.disabled) { li.tabIndex = -1; li.focus(); } else button.focus();
        });
      }
      li.append(actions);
      list.append(li);
    });
    const ids = new Set(saved.flatMap((entry) => entry.snapshots[0]?.rows.map(courseId) ?? []));
    for (const [button, id] of buttons) {
      if (!button.isConnected) { buttons.delete(button); continue; }
      button.disabled = ids.has(id);
      button.textContent = ids.has(id) ? 'În lista mea' : 'Adaugă în listă';
    }
  }
  render();
  return { section, button(row, history) {
    const button = node('button');
    button.type = 'button';
    button.className = 'chip save-course';
    const id = courseId(row);
    const exists = saved.some((entry) => entry.snapshots[0]?.rows.some((r) => courseId(r) === id));
    button.disabled = exists;
    button.textContent = exists ? 'În lista mea' : 'Adaugă în listă';
    buttons.set(button, id);
    button.addEventListener('click', () => {
      if (saved.length >= 500) { status.textContent = 'Lista poate păstra cel mult 500 de specializări.'; return; }
      if (!saved.some((entry) => entry.snapshots[0]?.rows.some((r) => courseId(r) === id))) {
        saved.push({ snapshots: courseSnapshots(row, history) });
        persist();
        render();
      }
    });
    return button;
  } };
}

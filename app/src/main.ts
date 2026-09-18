import './style.css';
import {
  assertIndexedDataset,
  assertDatasetIndex,
  MEDIA_FORMULA_EPOCH_YEAR,
  type AdmissionRow,
  type CountyDataset,
  type DatasetIndex,
  type DatasetIndexEntry,
  type Filiera,
} from './data/schema.js';
import { parseMediaInput } from './data/media-input.js';
import { latestLoad } from './data/latest-load.js';
import { countyName } from './data/counties.js';
import { reloadOnNewServiceWorker } from './sw-update.js';
import {
  chanceBand,
  fitCutoffModel,
  hasVacancies,
  predict,
  specKey,
  Z_80,
  type Chance,
  type FittedModel,
  type Prediction,
} from './model/predict.js';
import {
  MarksError,
  predictMarks,
  type SchoolGrade,
  type StudentRecord,
  type YearlyMedia,
} from './model/marks.js';

/**
 * The scale every chart on the page is drawn on.
 *
 * It is fixed rather than fitted to the data on purpose: a domain that shrank
 * to the county's own range would magnify a tenth of a point into half the
 * width of the screen. Five to ten is the scale the media itself lives on, and
 * keeping it makes two counties — and two visits — comparable by eye.
 */
const SCALE_MIN = 5;
const SCALE_MAX = 10;

const DATA_ROOT = new URL('data/v1/', document.baseURI);

// --- small helpers ----------------------------------------------------------

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

function mustFind(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector} mount point`);
  return node;
}

async function loadJson(path: string): Promise<unknown> {
  const url = new URL(path, DATA_ROOT);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`GET ${url.pathname} -> ${res.status}`);
  return (await res.json()) as unknown;
}

/** Where a media sits on the shared scale, as a percentage of its width. */
function pos(media: number): number {
  const t = (media - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  return Math.min(100, Math.max(0, t * 100));
}

const fmt = (m: number): string => m.toFixed(2);

/**
 * Romanian counts the noun after twenty with "de": 19 specializări, but 20 de
 * specializări. The rule runs on the last two digits, so 101 drops it again.
 */
function nSpec(n: number): string {
  if (n === 1) return '1 specializare';
  const tail = n % 100;
  const de = n >= 20 && !(tail >= 1 && tail <= 19);
  return de ? `${n} de specializări` : `${n} specializări`;
}

/** Fold diacritics so a search for "stiinte" finds "Științe". */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ș|ş/gi, 's')
    .replace(/ț|ţ/gi, 't')
    .toLowerCase();
}

const CHANCE_LABEL: Readonly<Record<Chance, string>> = {
  sigur: 'favorabil în model',
  probabil: 'probabil',
  incert: 'incert',
  'putin probabil': 'puțin probabil',
  improbabil: 'improbabil',
};

const FILIERA_LABEL: Readonly<Record<Filiera, string>> = {
  teoretica: 'Teoretică',
  tehnologica: 'Tehnologică',
  vocationala: 'Vocațională',
};

// --- scoring ----------------------------------------------------------------

interface Scored {
  readonly row: AdmissionRow;
  readonly prediction: Prediction;
  /** Sort key: the probability, with the special cases pushed to the ends. */
  readonly rank: number;
}

function score(
  model: FittedModel,
  rows: readonly AdmissionRow[],
  media: number | null,
  mediaSd: number,
): Scored[] {
  return rows.map((row) => {
    const prediction = predict(model, specKey(row), media, mediaSd);
    const rank =
      prediction.kind === 'estimate'
        ? prediction.probability
        : prediction.kind === 'open'
          ? -0.5 // historical vacancies have no numeric admission probability
          : -1; // an aptitude exam decides it, or there is no history
    return { row, prediction, rank };
  });
}

// --- one row of the list ----------------------------------------------------

/**
 * A row is a small multiple of the ruler at the top: the same 5–10 scale, the
 * predicted cutoff's 80% interval drawn on it, and the family's media as a
 * rule through every row at the same x — so the whole list reads as one chart.
 */
interface RowView {
  readonly li: HTMLLIElement;
  readonly plot: HTMLElement;
  readonly meta: HTMLElement;
}

function buildRow(row: AdmissionRow, index: number): RowView {
  const li = el('li', { class: 'row' });
  li.style.setProperty('--i', String(index));

  const details = [row.specLabel, row.profile, `${row.seats} locuri`].filter(
    (part) => part !== '',
  );
  if (row.limba !== 'Româna' && row.limba !== '') details.splice(2, 0, `predare în ${row.limba}`);

  const plot = el('div', { class: 'plot', 'aria-hidden': 'true' });
  const meta = el('div', { class: 'row-meta' });

  li.append(
    el('div', { class: 'row-id' }, el('h3', {}, row.schoolName), el('p', {}, details.join(' · '))),
    meta,
    plot,
  );

  return { li, plot, meta };
}

/** Redraw one row's chart and its right-hand figures for the current media. */
function paintRow(view: RowView, scored: Scored, media: number | null): void {
  const { prediction, row } = scored;
  const line = el('span', { class: 'plot-line' });

  if (prediction.kind === 'estimate') {
    const [lo, hi] = prediction.interval;
    const fill =
      media === null ? 0 : Math.min(100, Math.max(0, ((media - lo) / (hi - lo)) * 100));

    const band = el('span', { class: 'band' }, el('i'));
    band.style.setProperty('--lo', String(pos(lo)));
    band.style.setProperty('--hi', String(pos(hi)));
    band.style.setProperty('--f', String(fill));

    const point = el('span', { class: 'point' });
    point.style.setProperty('--x', String(pos(prediction.cutoff)));

    view.plot.replaceChildren(el('span', { class: 'plot-base' }), band, point, line);

    const chance = chanceBand(prediction.probability);
    view.meta.replaceChildren(
      media === null
        ? el('span', { class: 'chance chance-num' }, fmt(prediction.cutoff))
        : el('span', { class: 'chance', 'data-band': chance }, CHANCE_LABEL[chance]),
      el('span', { class: 'figures' }, media === null ? 'prag' : `prag ~${fmt(prediction.cutoff)}`),
      el('span', { class: 'figures' }, `${fmt(lo)}–${fmt(hi)}`),
    );
  } else {
    const note =
      prediction.kind === 'open'
        ? 'nu s-a umplut'
        : prediction.reason === 'vocational'
          ? 'decide proba'
          : prediction.reason === 'no-cutoff' ? 'fără prag publicat' : 'fără istoric';

    view.plot.replaceChildren(
      el('span', { class: 'plot-flat' }),
      el('span', { class: 'plot-note' }, note),
      line,
    );

    const label =
      prediction.kind === 'open'
        ? 'a rămas loc'
        : prediction.reason === 'vocational'
          ? 'probă de aptitudini'
          : prediction.reason === 'no-cutoff' ? 'fără prag publicat' : 'fără istoric';
    const figures =
      prediction.kind === 'open'
        ? `${row.seats - (row.occupiedSeats ?? row.seats)} locuri neocupate în ${row.year}`
        : prediction.reason === 'vocational'
          ? 'media nu decide'
          : prediction.reason === 'no-cutoff' ? 'date insuficiente' : 'nou anul acesta';

    view.meta.replaceChildren(
      el(
        'span',
        { class: 'chance', 'data-band': 'none' },
        label,
      ),
      el('span', { class: 'figures' }, figures),
    );
  }

  if (media === null) {
    line.setAttribute('hidden', 'hidden');
  } else {
    line.style.setProperty('--x', String(pos(media)));
  }
}

// --- the estimator ----------------------------------------------------------

const GRADE_LABELS: Readonly<Record<SchoolGrade, string>> = {
  5: 'a V-a',
  6: 'a VI-a',
  7: 'a VII-a',
  8: 'a VIII-a',
};

const SCHOOL_GRADES = [5, 6, 7, 8] as const;

/**
 * For a child who has not sat the exam yet: estimate a media from the school
 * record. See `model/marks.ts` for what the estimate rests on — the short
 * version is that school marks run higher than exam marks, and by how much is
 * measured from the published 2025 national results rather than assumed.
 *
 * This is the one number on the page that does not come from the dataset the
 * app loaded, so it says where it comes from. The cutoffs it is compared
 * against are a separate matter, and while they are synthetic the banner at
 * the top of the page says so.
 */
function buildEstimator(
  onUse: (mean: number, sd: number, grade: SchoolGrade) => void,
  onClear: () => void,
): HTMLElement {
  const gradeSelect = el(
    'select',
    { id: 'est-grade' },
    ...SCHOOL_GRADES.map((g) => el('option', { value: String(g) }, `clasa ${GRADE_LABELS[g]}`)),
  );
  gradeSelect.value = '8';
  const motherTongue = el('select', { id: 'est-mother-tongue' },
    el('option', { value: '' }, 'Alege'),
    el('option', { value: 'no' }, 'Nu'),
    el('option', { value: 'yes' }, 'Da'));

  const sheet = el('div', { class: 'est-subjects' });
  const result = el(
    'p',
    { class: 'est-result', 'data-state': 'empty' },
    'Completează cel puțin o medie generală anuală.',
  );
  const useButton = el('button', { type: 'button', class: 'est-use', disabled: '' });
  useButton.textContent = 'Folosește media estimată';

  let estimate: { mean: number; sd: number } | null = null;

  const markInput = (attrs: Record<string, string>): HTMLInputElement =>
    el('input', {
      type: 'number',
      min: '1',
      max: '10',
      step: '0.01',
      inputmode: 'decimal',
      placeholder: '–',
      ...attrs,
    });

  function subjectBlock(
    subject: 'school',
    label: string,
    upTo: SchoolGrade,
  ): HTMLElement {
    return el(
      'div',
      { class: 'est-subject' },
      el('h3', {}, label),
      el(
        'div',
        { class: 'est-cells' },
        ...SCHOOL_GRADES.filter((g) => g <= upTo).map((g) =>
          el(
            'label',
            { class: 'est-cell' },
            el('span', {}, `cls. ${GRADE_LABELS[g].replace('a ', '').replace('-a', '')}`),
            markInput({ 'data-subject': subject, 'data-grade': String(g) }),
          ),
        ),
      ),
    );
  }

  function rebuild(): void {
    const upTo = Number(gradeSelect.value) as SchoolGrade;
    const blocks = [
      subjectBlock('school', 'Medii generale anuale — toate materiile', upTo),
    ];
    if (upTo === 8) {
      blocks.push(
        el(
          'div',
          { class: 'est-subject' },
          el('h3', {}, 'Simulare, dacă a dat-o'),
          el(
            'div',
            { class: 'est-cells' },
            el(
              'label',
              { class: 'est-cell' },
              el('span', {}, 'română'),
              markInput({ 'data-sim': 'romana' }),
            ),
            el(
              'label',
              { class: 'est-cell' },
              el('span', {}, 'matematică'),
              markInput({ 'data-sim': 'matematica' }),
            ),
          ),
        ),
      );
    }
    sheet.replaceChildren(...blocks);
    recompute();
  }

  function recompute(): void {
    const currentGrade = Number(gradeSelect.value) as SchoolGrade;
    const school: YearlyMedia[] = [];
    const simulare: { romana?: number; matematica?: number } = {};

    for (const input of sheet.querySelectorAll('input')) {
      const raw = input.value.trim();
      if (raw === '') continue;
      const value = Number(raw);
      const subject = input.dataset['subject'];
      const grade = Number(input.dataset['grade']) as SchoolGrade;
      if (subject === 'school') school.push({ grade, media: value });
      else if (input.dataset['sim'] === 'romana') simulare.romana = value;
      else if (input.dataset['sim'] === 'matematica') simulare.matematica = value;
    }

    estimate = null;
    useButton.setAttribute('disabled', '');

    if (motherTongue.value !== 'no') {
      result.dataset['state'] = 'empty';
      result.textContent = motherTongue.value === 'yes'
        ? 'Estimarea nu acoperă candidații care susțin proba de limbă maternă. Introdu media oficială de admitere după examen.'
        : 'Alege dacă elevul susține proba de limbă maternă.';
      return;
    }
    if (school.length === 0) {
      result.dataset['state'] = 'empty';
      result.textContent = 'Completează cel puțin o medie generală anuală.';
      return;
    }

    const record: StudentRecord = {
      currentGrade,
      school,
      takesMotherTongue: false,
      ...(simulare.romana !== undefined || simulare.matematica !== undefined ? { simulare } : {}),
    };

    try {
      const p = predictMarks(record);
      estimate = { mean: p.media.mean, sd: p.media.sd };
      result.dataset['state'] = 'ready';
      result.replaceChildren(
        'Media estimată la evaluare: ',
        el('b', {}, fmt(p.media.mean)),
        `. Interval orientativ de 80%: între ${fmt(p.media.interval[0])} și ${fmt(p.media.interval[1])} `,
        `— română ~${fmt(p.romana.mean)}, matematică ~${fmt(p.matematica.mean)}. `,
        'Notele din școală sunt de obicei mai mari decât cele de la evaluare. ' +
          'Relația cu media generală este calibrată pe 143.183 de candidați din 2025. ' +
          'Pentru anii rămași și simulare, incertitudinea include ipoteze nevalidate pe date reale.',
      );
      useButton.removeAttribute('disabled');
    } catch (err) {
      result.dataset['state'] = 'error';
      result.textContent =
        err instanceof MarksError
          ? 'Verifică notele: fiecare trebuie să fie între 1 și 10, câte una pe clasă.'
          : 'Estimarea nu a putut fi calculată.';
    }
  }

  gradeSelect.addEventListener('change', () => { onClear(); rebuild(); });
  sheet.addEventListener('input', () => { onClear(); recompute(); });
  motherTongue.addEventListener('change', () => { onClear(); recompute(); });
  useButton.addEventListener('click', () => {
    if (estimate) onUse(estimate.mean, estimate.sd, Number(gradeSelect.value) as SchoolGrade);
  });
  rebuild();

  return el(
    'details',
    { class: 'estimator' },
    el('summary', {}, 'Copilul nu a dat încă evaluarea? Estimează media din notele din școală'),
    el(
      'div',
      { class: 'estimator-body' },
      el(
        'p',
        { class: 'est-lede' },
        'Scrie mediile generale anuale, calculate peste toate materiile, nu mediile pe discipline. Cu cât mai sunt ani ' +
          'până la examen, cu atât estimarea e mai vagă — și o arată ca atare, în loc să ' +
          'pretindă o precizie pe care nu o are.',
      ),
      el(
        'div',
        { class: 'est-grade' },
        el('label', { for: 'est-grade' }, 'În ce clasă e copilul?'),
        gradeSelect,
      ),
      el('label', { for: 'est-mother-tongue' }, 'Susține proba de limbă maternă?'),
      motherTongue,
      sheet,
      result,
      useButton,
    ),
  );
}

// --- the page ---------------------------------------------------------------

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

interface Group {
  readonly section: HTMLElement;
  readonly heading: HTMLElement;
  readonly count: HTMLElement;
  readonly note: HTMLElement;
  readonly list: HTMLElement;
}

function buildGroup(): Group {
  const heading = el('span', {});
  const count = el('b', {});
  const note = el('p', { class: 'group-note' });
  const list = el('ol', { class: 'rows' });
  const section = el(
    'section',
    { class: 'group', hidden: 'hidden' },
    el('h2', { class: 'group-head' }, heading, count),
    note,
    list,
  );
  return { section, heading, count, note, list };
}

const root = mustFind('#app');

function buildUi(index: DatasetIndex): void {
  const counties = byCounty(index);
  const countyCodes = [...counties.keys()].sort();
  const firstCounty = countyCodes[0];

  if (firstCounty === undefined) {
    root.replaceChildren(
      el('header', { class: 'masthead' }, el('h1', { class: 'wordmark' }, 'unde intru')),
      el(
        'div',
        { class: 'empty' },
        'Nu există încă date publicate. Vino înapoi după ce apar rezultatele repartizării.',
      ),
    );
    return;
  }

  // --- the console
  const countySelect = el(
    'select',
    { id: 'county' },
    ...countyCodes.map((c) => el('option', { value: c }, countyName(c))),
  );
  const mediaInput = el('input', {
    id: 'media',
    class: 'media-input',
    type: 'number',
    min: '1',
    max: '10',
    step: '0.01',
    inputmode: 'decimal',
    placeholder: '9.85',
    'aria-describedby': 'verdict',
  });
  const estimateMark = el('span', { class: 'estimate-mark', hidden: 'hidden' });

  const ruler = el('div', { class: 'ruler', 'aria-hidden': 'true' });
  const youLine = el('div', { class: 'you', hidden: 'hidden' }, el('b'));
  const verdict = el('p', { class: 'verdict', id: 'verdict' });
  const verdictSub = el('p', { class: 'verdict-sub' });
  const epoch = el('p', { class: 'epoch' });
  const banner = el('div', { class: 'banner', hidden: 'hidden' });
  const retry = el('button', { type: 'button', class: 'chip', hidden: 'hidden' }, 'Încearcă din nou');

  const estimator = buildEstimator((mean, sd, grade) => {
    estimatedGrade = grade;
    refit();
    mediaInput.value = fmt(mean);
    estimatedMediaSd = sd;
    estimateMark.hidden = false;
    estimateMark.textContent = `estimare ±${(sd * Z_80).toFixed(2)}`;
    refresh();
  }, () => {
    if (estimatedMediaSd === 0) return;
    mediaInput.value = '';
    estimatedMediaSd = 0;
    estimatedGrade = 8;
    estimateMark.hidden = true;
    refit();
    refresh();
  });

  // --- the list
  const search = el('input', {
    id: 'search',
    class: 'text-input',
    type: 'search',
    placeholder: 'liceu sau specializare',
    autocomplete: 'off',
  });
  const filieraButtons = (['toate', ...(['teoretica', 'tehnologica', 'vocationala'] as const)] as const).map(
    (value) =>
      el(
        'button',
        {
          type: 'button',
          class: 'chip',
          'data-filiera': value,
          'aria-pressed': value === 'toate' ? 'true' : 'false',
        },
        value === 'toate' ? 'Toate' : FILIERA_LABEL[value],
      ),
  );
  const filterNote = el('p', { class: 'filter-note' });

  const groups = {
    above: buildGroup(),
    open: buildGroup(),
    below: buildGroup(),
    aside: buildGroup(),
  };
  const chart = el(
    'div',
    { class: 'chart' },
    groups.above.section,
    groups.open.section,
    groups.below.section,
    groups.aside.section,
  );
  const emptyState = el('p', { class: 'empty', hidden: 'hidden' });

  const modelNote = el('p', {});
  const dataNote = el('p', {});

  root.replaceChildren(
    el(
      'header',
      { class: 'masthead' },
      el('h1', { class: 'wordmark' }, el('em', {}, 'unde '), 'intru'),
      el('p', {}, 'Pragurile de admitere la liceu, cu tot cu cât se pot muta.'),
    ),
    el(
      'main',
      {},
      el(
        'section',
        { class: 'console' },
        el(
          'div',
          { class: 'console-top' },
          el(
            'div',
            { class: 'media-field' },
            el('label', { for: 'media' }, 'Media de admitere'),
            mediaInput,
            estimateMark,
          ),
          el(
            'div',
            { class: 'county-field' },
            el('label', { for: 'county' }, 'Județul'),
            countySelect,
          ),
        ),
        ruler,
        el('div', { 'aria-live': 'polite' }, verdict, verdictSub),
        retry,
        epoch,
      ),
      banner,
      estimator,
      el(
        'div',
        { class: 'list-controls', id: 'lista' },
        el(
          'div',
          { class: 'search-field' },
          el('label', { for: 'search' }, 'Caută'),
          search,
        ),
        el('div', { class: 'chips' }, ...filieraButtons),
      ),
      filterNote,
      chart,
      emptyState,
      el(
        'div',
        { class: 'notes' },
        el(
          'section',
          {},
          el('h2', {}, 'Cum se citește'),
          el(
            'p',
            {},
            'Bara arată intervalul în care poate cădea pragul anul viitor. Partea plină e ' +
              'cât din interval ai depășit; linia verticală e media copilului tău.',
          ),
        ),
        el('section', {}, el('h2', {}, 'Cât de sigur e'), modelNote),
        el(
          'section',
          {},
          el('h2', {}, 'Media de admitere'),
          el(
            'p',
            {},
            `Din ${MEDIA_FORMULA_EPOCH_YEAR}: (nota la română + nota la matematică) / 2, ` +
              'trunchiată la două zecimale — 9.855 rămâne 9.85. Mediile de dinainte se ' +
              'calculau altfel și nu se compară cu acestea.',
          ),
        ),
        el('section', {}, el('h2', {}, 'De unde vin datele'), dataNote),
      ),
    ),
  );

  // --- state
  let model: FittedModel | null = null;
  let latest: CountyDataset | null = null;
  let views = new Map<string, RowView>();
  let estimatedMediaSd = 0;
  let estimatedGrade: SchoolGrade = 8;
  let history: CountyDataset[] = [];

  function refit(): void {
    if (!latest) return;
    const today = new Date();
    const nextExam = today.getFullYear() + (today.getMonth() >= 8 ? 1 : 0);
    const target = Math.max(latest.year + 1, nextExam) + 8 - estimatedGrade;
    model = fitCutoffModel(history, target);
  }
  let filiera: Filiera | 'toate' = 'toate';

  function currentMedia(): number | null {
    const media = parseMediaInput(mediaInput.value);
    mediaInput.setAttribute('aria-invalid', String(mediaInput.value !== '' && media === null));
    return media;
  }

  function drawRuler(rows: readonly AdmissionRow[]): void {
    const ticks = rows
      .filter((row) => row.lastMedia !== null && !row.vocational)
      .map((row) => {
        const tick = el('span', { class: 'ruler-tick' });
        tick.style.setProperty('--x', String(pos(row.lastMedia ?? SCALE_MIN)));
        return tick;
      });

    const grades: HTMLElement[] = [];
    for (let m = SCALE_MIN; m <= SCALE_MAX; m += 1) {
      const grade = el('span', { class: 'ruler-grade' }, el('span', {}, String(m)));
      grade.style.setProperty('--x', String(pos(m)));
      grades.push(grade);
    }

    ruler.replaceChildren(el('span', { class: 'ruler-base' }), ...ticks, ...grades, youLine);
  }

  function refresh(): void {
    if (!model || !latest) return;
    const media = currentMedia();
    const county = countyName(model.county);

    const scored = score(model, latest.rows, media, estimatedMediaSd);

    // the family's own line, on the ruler and through every row
    if (media === null) {
      youLine.hidden = true;
    } else {
      youLine.hidden = false;
      youLine.style.setProperty('--x', String(pos(media)));
      const flag = youLine.firstElementChild;
      if (flag) flag.textContent = fmt(media);
    }

    // the verdict
    // Vocational specializations are left out of both sides of the count: an
    // aptitude exam decides them, so a media neither clears nor misses them.
    const answerable = scored.filter((s) => s.prediction.kind === 'estimate');
    const vacancies = scored.filter((s) => s.prediction.kind === 'open').length;
    const total = answerable.length;
    const aside = scored.filter((s) => s.prediction.kind === 'unavailable').length;
    const clears = answerable.filter(
      (s) => s.rank >= 0.5,
    ).length;
    const tight = scored.filter(
      (s) => s.prediction.kind === 'estimate' && chanceBand(s.prediction.probability) === 'incert',
    ).length;

    if (media === null) {
      verdict.textContent = 'Scrie media de admitere.';
      verdictSub.textContent =
        `${nSpec(total)} în ${county}, fiecare cu pragul din ${model.baseYear} și cu ` +
        `intervalul în care se poate muta până în ${model.targetYear}.`;
    } else {
      verdict.textContent =
        clears === 0
          ? `Cu ${fmt(media)}, nu ești peste niciunul dintre pragurile estimate din ${county}.`
          : `Cu ${fmt(media)}, ești peste pragul estimat la ${clears} din ${nSpec(total)} din ${county}.`;
      const parts = [
        tight === 0
          ? 'Nicio specializare nu cade în zona incertă la această medie.'
          : tight === 1
            ? 'La una singură diferența e mai mică decât se mișcă pragurile de la un an la altul, așa că răspunsul rămâne „incert”.'
            : `La ${tight} dintre ele diferența e mai mică decât se mișcă pragurile de la un an la altul, așa că răspunsul rămâne „incert”.`,
      ];
      if (aside === 1) {
        parts.push('Încă una nu are o estimare de prag și nu se socotește aici.');
      } else if (aside > 1) {
        parts.push(`Alte ${aside} nu au o estimare de prag și nu se socotesc aici.`);
      }
      if (vacancies > 0) parts.push(`${vacancies} specializări au avut locuri neocupate; nu sunt incluse în numărul pragurilor estimate.`);
      if (estimatedMediaSd > 0) {
        parts.push('Media e estimată din note, iar incertitudinea ei intră în fiecare șansă.');
      }
      verdictSub.textContent = parts.join(' ');
    }

    // The band is per filiera now, so quoting one number would understate the
    // wider one. Show the range when the filiere actually differ.
    const bands = [model.sd, ...model.sdByFiliera.values()].map((sd) => sd * Z_80);
    const lowBand = Math.min(...bands);
    const highBand = Math.max(...bands);
    const bandText = highBand - lowBand < 0.005
      ? `±${lowBand.toFixed(2)}`
      : `±${lowBand.toFixed(2)}–${highBand.toFixed(2)}, după filieră`;
    epoch.textContent =
      `fiecare liniuță = un prag · praguri ${model.baseYear} → estimare ${model.targetYear} · ` +
      `bandă orientativă ${bandText}`;

    modelNote.textContent =
      `Banda pentru ${model.targetYear} arată intervalul de 80% presupus de model, nu o precizie verificată. ` +
      (model.evidence === 'estimated'
        ? 'Lățimea este estimată din variațiile istorice. '
        : 'Istoricul este scurt; lățimea combină valori implicite cu variațiile observate. ') +
      'În testul pe 1.504 specializări din 2026, folosind doar date din 2025, ' +
      '46,68% dintre praguri au fost în banda de 80%. Benzile revizuite pentru 2027 ' +
      'nu au încă o validare pe rezultate reale independente. Etichetele sunt orientative, nu garanții de admitere.';

    // the list
    const needle = fold(search.value.trim());
    const visible = scored.filter(({ row }) => {
      if (filiera !== 'toate' && row.filiera !== filiera) return false;
      if (needle === '') return true;
      return fold(`${row.schoolName} ${row.specLabel} ${row.profile}`).includes(needle);
    });

    filterNote.textContent =
      visible.length === scored.length
        ? ''
        : `Filtrul arată ${visible.length} din ${nSpec(scored.length)}.`;

    const buckets: Record<'above' | 'open' | 'below' | 'aside', Scored[]> = {
      above: [],
      open: [],
      below: [],
      aside: [],
    };
    for (const s of visible) {
      if (s.prediction.kind === 'unavailable') buckets.aside.push(s);
      else if (s.prediction.kind === 'open') buckets.open.push(s);
      else if (media === null || s.rank >= 0.5) buckets.above.push(s);
      else buckets.below.push(s);
    }

    groups.above.heading.textContent =
      media === null ? `Specializările din ${county}` : 'Aici ai șanse';
    groups.above.note.textContent =
      media === null
        ? `Ordonate după pragul din ${model.baseYear}, de la cel mai greu de atins.`
        : 'Cele mai greu de atins primele — acolo ai cel mai puțin loc de greșeală. ' +
          'Cu cât bara e plină mai mult, cu atât marja e mai mare.';
    groups.open.heading.textContent = `Aici n-a fost prag în ${model.baseYear}`;
    groups.open.note.textContent =
      'Au rămas locuri neocupate în anul de referință. Nu estimăm o probabilitate: cererea și oferta se pot schimba.';
    groups.below.heading.textContent = 'Aici pragul e peste media ta';
    groups.below.note.textContent =
      'Începe cu cele la care ai fost cel mai aproape. Pragurile se mai duc și în jos ' +
      'de la un an la altul, iar bara arată cât ar trebui să scadă.';
    groups.aside.heading.textContent = 'Nu se decide doar din medie';
    groups.aside.note.textContent =
      'Filiera vocațională intră pe probă de aptitudini, iar o specializare nouă nu are prag anterior.';

    // Inside a group, order by the cutoff rather than by the probability: the
    // question at the top of the list is "what is the best place I can still
    // get into", and under it "what did I just miss".
    const byName = (a: Scored, b: Scored): number =>
      a.row.schoolName.localeCompare(b.row.schoolName, 'ro');
    const cutoff = (s: Scored): number => (s.prediction.kind === 'estimate' ? s.prediction.cutoff : -1);
    buckets.above.sort((a, b) => cutoff(b) - cutoff(a) || byName(a, b));
    buckets.below.sort((a, b) => cutoff(a) - cutoff(b) || byName(a, b));
    buckets.open.sort((a, b) => b.row.seats - a.row.seats || byName(a, b));
    buckets.aside.sort(byName);

    for (const key of ['above', 'open', 'below', 'aside'] as const) {
      const bucket = buckets[key];
      const group = groups[key];
      group.section.hidden = bucket.length === 0;
      group.count.textContent = String(bucket.length);
      group.list.replaceChildren(
        ...bucket.map((s) => {
          const view = views.get(specKey(s.row));
          if (!view) throw new Error(`no row for ${specKey(s.row)}`);
          paintRow(view, s, media);
          return view.li;
        }),
      );
    }

    emptyState.hidden = visible.length > 0;
    if (visible.length === 0) {
      emptyState.textContent = 'Nicio specializare nu se potrivește filtrului. Șterge căutarea sau alege altă filieră.';
    }
  }

  const loadCounty = latestLoad(async (code: string) => {
    const entries = counties.get(code) ?? [];
    const datasets = await Promise.all(entries.map(async (entry) =>
      assertIndexedDataset(await loadJson(entry.path), entry)));
    datasets.sort((a, b) => a.year - b.year);
    if (datasets.length === 0) throw new Error(`no datasets for ${code}`);
    return datasets;
  });
  let countyRequest = 0;

  async function selectCounty(code: string): Promise<void> {
    const request = ++countyRequest;
    model = null;
    latest = null;
    history = [];
    chart.hidden = true;
    ruler.hidden = true;
    emptyState.hidden = true;
    banner.hidden = true;
    retry.hidden = true;
    epoch.textContent = '';
    modelNote.textContent = '';
    dataNote.textContent = '';
    filterNote.textContent = '';
    verdict.textContent = `Se încarcă datele pentru ${countyName(code)}…`;
    verdictSub.textContent = '';
    try {
      const result = await loadCounty(code);
      if (result.kind === 'stale') return;
      if (result.kind === 'error') throw new Error('county load failed');
      const datasets = result.value;

      const newest = datasets[datasets.length - 1];
      if (!newest) throw new Error(`no datasets for ${code}`);

      latest = newest;
      history = datasets;
      refit();

      // Rows are built once per county and then only repainted, so the entry
      // animation runs on arrival and never again on a keystroke.
      views = new Map(
        [...newest.rows]
          .sort((a, b) => (b.lastMedia ?? -1) - (a.lastMedia ?? -1))
          .map((row, i) => [specKey(row), buildRow(row, i)]),
      );

      drawRuler(newest.rows.filter((row) => !hasVacancies(row) && !row.vocational));

      const synthetic = datasets.some((d) => d.provenance === 'synthetic');
      banner.hidden = !synthetic;
      if (synthetic) {
        banner.replaceChildren(
          el('strong', {}, 'Date simulate.'),
          'Pragurile de mai jos sunt generate ca să testeze aplicația și modelul. Nu sunt ' +
            'cifre reale și nicio decizie nu ar trebui luată după ele.',
        );
      }
      dataNote.textContent = synthetic
        ? 'Deocamdată sunt date simulate, generate în acest proiect. Cifrele reale vin din ' +
          'listele publicate pe admitere.edu.ro, descărcate și verificate înainte de publicare.'
        : `Praguri publicate pe admitere.edu.ro pentru ${countyName(code)}, ${newest.year}.`;

      chart.hidden = false;
      ruler.hidden = false;
      chart.classList.add('entering');
      refresh();
      window.setTimeout(() => {
        if (request === countyRequest) chart.classList.remove('entering');
      }, 1200);
    } catch {
      if (request !== countyRequest) return;
      model = null;
      latest = null;
      chart.hidden = true;
      ruler.hidden = true;
      verdict.textContent = `Datele pentru ${countyName(code)} nu s-au încărcat.`;
      verdictSub.textContent = 'Verifică legătura la internet, încearcă din nou sau alege alt județ.';
      retry.hidden = false;
    }
  }

  retry.addEventListener('click', () => void selectCounty(countySelect.value));
  countySelect.addEventListener('change', () => void selectCounty(countySelect.value));
  mediaInput.addEventListener('input', () => {
    // A typed media is an exam result: exact, and no longer the estimate.
    estimatedMediaSd = 0;
    estimatedGrade = 8;
    refit();
    estimateMark.hidden = true;
    refresh();
  });
  search.addEventListener('input', refresh);
  for (const button of filieraButtons) {
    button.addEventListener('click', () => {
      const value = button.dataset['filiera'];
      if (value === undefined) return;
      filiera = value as Filiera | 'toate';
      for (const other of filieraButtons) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      }
      refresh();
    });
  }

  void selectCounty(firstCounty);
}

async function main(): Promise<void> {
  try {
    buildUi(assertDatasetIndex(await loadJson('index.json'), 'index.json'));
  } catch (err) {
    root.replaceChildren(
      el('header', { class: 'masthead' }, el('h1', { class: 'wordmark' }, 'unde intru')),
      el(
        'div',
        { class: 'error' },
        el('h2', {}, 'Datele nu s-au încărcat'),
        el('p', {}, 'Verifică legătura la internet și reîncarcă pagina.'),
        el('code', {}, err instanceof Error ? err.message : String(err)),
      ),
    );
  }
}

reloadOnNewServiceWorker();
void main();

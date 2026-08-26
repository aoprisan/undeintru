/**
 * A very small, streaming XLSX reader — enough for one published workbook.
 *
 * The Evaluarea Națională open data is an .xlsx whose single sheet is 135 MB
 * once inflated. That rules out both "load the string and regex it" and, for
 * this repo, "npm install a spreadsheet library": the pipeline stays thin on
 * purpose, and a format this constrained is a couple of hundred lines.
 *
 * What is implemented is exactly what the file uses and no more:
 *
 * - ZIP: the end-of-central-directory record, the central directory, and
 *   stored/deflated entries. No zip64, no encryption, no data descriptors.
 * - SpreadsheetML: `<row>` / `<c>` / `<v>`, the shared-string table, and
 *   inline strings. No formulas, no styles, no dates — this sheet has none.
 *
 * Anything outside that throws {@link XlsxError} naming the file, rather than
 * returning a half-read sheet. A silently truncated read here would understate
 * a national dataset, and every number this repo derives from it would be
 * wrong in a way nothing downstream could notice.
 */

import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxError';
  }
}

interface ZipEntry {
  readonly name: string;
  /** 0 = stored, 8 = deflated. */
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  /** Offset of the local file header, not of the data. */
  readonly headerOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The EOCD is at the end, after a comment of at most 65535 bytes. */
const EOCD_MAX_SEARCH = 66_000;

/** Read the central directory: every entry's name, size and header offset. */
async function readZipDirectory(path: string): Promise<Map<string, ZipEntry>> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, EOCD_MAX_SEARCH);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new XlsxError(`${path}: no end-of-central-directory record — not a zip`);

    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (directoryOffset === 0xffffffff) {
      throw new XlsxError(`${path}: zip64 central directory is not supported`);
    }

    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);

    const entries = new Map<string, ZipEntry>();
    let at = 0;
    for (let i = 0; i < count; i++) {
      if (directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
        throw new XlsxError(`${path}: corrupt central directory at entry ${i}`);
      }
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
      entries.set(name, {
        name,
        method: directory.readUInt16LE(at + 10),
        compressedSize: directory.readUInt32LE(at + 20),
        uncompressedSize: directory.readUInt32LE(at + 24),
        headerOffset: directory.readUInt32LE(at + 42),
      });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/**
 * Where an entry's compressed bytes actually start.
 *
 * The central directory records the *local header* offset, and the local
 * header carries its own name and extra-field lengths — which routinely differ
 * from the central copy. Trusting the central lengths here yields a stream
 * that inflates to garbage a few entries in.
 */
async function dataOffset(path: string, entry: ZipEntry): Promise<number> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(30);
    await handle.read(header, 0, 30, entry.headerOffset);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new XlsxError(`${path}: ${entry.name} has no local file header`);
    }
    return entry.headerOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    await handle.close();
  }
}

/** Stream one entry's bytes, inflating if needed. */
async function* entryChunks(path: string, entry: ZipEntry): AsyncGenerator<Buffer> {
  if (entry.method !== 0 && entry.method !== 8) {
    throw new XlsxError(`${path}: ${entry.name} uses unsupported compression ${entry.method}`);
  }
  const start = await dataOffset(path, entry);
  const raw = createReadStream(path, { start, end: start + entry.compressedSize - 1 });
  const stream = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
  for await (const chunk of stream) {
    yield chunk as Buffer;
  }
}

async function readEntryText(path: string, entry: ZipEntry): Promise<string> {
  const parts: Buffer[] = [];
  for await (const chunk of entryChunks(path, entry)) parts.push(chunk);
  return Buffer.concat(parts).toString('utf8');
}

function requireEntry(entries: Map<string, ZipEntry>, path: string, name: string): ZipEntry {
  const entry = entries.get(name);
  if (!entry) {
    throw new XlsxError(
      `${path}: no ${name} in the workbook (entries: ${[...entries.keys()].join(', ')})`,
    );
  }
  return entry;
}

const XML_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** Resolve the five predefined entities and numeric character references. */
function decodeXmlText(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return XML_ENTITIES.get(body) ?? whole;
  });
}

/**
 * The shared-string table.
 *
 * A `<si>` may be a single `<t>` or a run of `<r><t>` fragments; both appear in
 * real files, and the fragments must be concatenated in order.
 */
function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const item = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  const text = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = item.exec(xml)) !== null) {
    const body = match[1] ?? '';
    let joined = '';
    text.lastIndex = 0;
    let piece: RegExpExecArray | null;
    while ((piece = text.exec(body)) !== null) joined += piece[1] ?? '';
    strings.push(decodeXmlText(joined));
  }
  return strings;
}

/** "BC12" -> 54. Column letters are base-26 with A = 1. */
export function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/** One `<c>` element's value, already resolved against the shared strings. */
function cellValue(cell: string, shared: readonly string[]): string {
  const type = /\bt="([^"]+)"/.exec(cell)?.[1];
  if (type === 'inlineStr') {
    const parts = [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? '');
    return decodeXmlText(parts.join(''));
  }
  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell)?.[1];
  if (value === undefined) return '';
  if (type === 's') {
    const index = Number.parseInt(value, 10);
    const resolved = shared[index];
    if (resolved === undefined) throw new XlsxError(`shared string ${index} is out of range`);
    return resolved;
  }
  return decodeXmlText(value);
}

/**
 * Every row of a sheet, as an array of cell strings positioned by column.
 *
 * Rows are yielded as they inflate, so a 135 MB sheet never exists in memory at
 * once. Empty cells — which the file omits entirely rather than writing out —
 * come back as `''`, placed by their `r` reference, so column positions stay
 * aligned with the header row.
 */
export async function* readSheetRows(
  path: string,
  sheet = 'xl/worksheets/sheet1.xml',
): AsyncGenerator<string[]> {
  const entries = await readZipDirectory(path);
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const shared = sharedEntry ? parseSharedStrings(await readEntryText(path, sharedEntry)) : [];

  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  const cellPattern = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;

  let buffer = '';
  for await (const chunk of entryChunks(path, requireEntry(entries, path, sheet))) {
    buffer += chunk.toString('utf8');
    rowPattern.lastIndex = 0;
    let consumed = 0;
    let row: RegExpExecArray | null;
    while ((row = rowPattern.exec(buffer)) !== null) {
      consumed = row.index + row[0].length;
      yield parseRow(row[1] ?? '', cellPattern, shared);
    }
    // Keep only the tail, which may hold a row split across chunk boundaries.
    buffer = buffer.slice(consumed);
  }
  if (/<row\b/.test(buffer)) {
    throw new XlsxError(`${path}: sheet ended inside a <row> — the stream was truncated`);
  }
}

function parseRow(body: string, cellPattern: RegExp, shared: readonly string[]): string[] {
  const cells: string[] = [];
  cellPattern.lastIndex = 0;
  let next = 0;
  let cell: RegExpExecArray | null;
  while ((cell = cellPattern.exec(body)) !== null) {
    const attributes = cell[1] ?? cell[2] ?? '';
    const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
    const at = reference === undefined ? next : columnIndex(reference);
    while (cells.length < at) cells.push('');
    cells.push(cell[3] === undefined ? '' : cellValue(cell[0], shared));
    next = at + 1;
  }
  return cells;
}

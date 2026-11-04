import type { Cell } from '@maunedas/shared/imports/table';

// An .xlsx is a ZIP of XML files. Its first sheet is read with what every browser has (DecompressionStream and
// DOMParser), so importing a spreadsheet adds no library (T-306).

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

export const NOT_XLSX = 'El archivo no parece un Excel (.xlsx). Ábrelo y guárdalo de nuevo, o como CSV.';

async function inflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return new Uint8Array(
    await new Response(source.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(),
  );
}

/** The ZIP's files whose name [wanted] accepts, as text. Stored and deflated entries; no ZIP64. */
export async function unzip(
  buffer: ArrayBuffer,
  wanted: (name: string) => boolean,
): Promise<Map<string, string>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(NOT_XLSX);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buffer.byteLength || view.getUint32(at, true) !== CENTRAL_HEADER) throw new Error(NOT_XLSX);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (!wanted(name)) continue;
    if (view.getUint32(local, true) !== LOCAL_HEADER) throw new Error(NOT_XLSX);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(start, start + size);
    if (method === 0) files.set(name, utf8.decode(data));
    else if (method === 8) files.set(name, utf8.decode(await inflate(data)));
    else throw new Error(NOT_XLSX);
  }
  return files;
}

const xml = (text: string | undefined) =>
  text ? new DOMParser().parseFromString(text, 'application/xml') : null;

/** The text of a shared or inline string: its runs, without the phonetic ones. */
function textOf(node: Element): string {
  return [...node.getElementsByTagName('t')]
    .filter((t) => t.parentElement?.tagName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');
}

/** "AB12" → 27, the 0-based column. */
function column(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The first sheet as rows of cells: text as text, numbers as numbers (dates are serial days, `parseImportDate`
 * reads them), errors and empty cells as null; rows without anything go.
 */
export async function readXlsx(buffer: ArrayBuffer): Promise<Cell[][]> {
  const files = await unzip(
    buffer,
    (name) => name.startsWith('xl/') && (name.endsWith('.xml') || name.endsWith('.rels')),
  );
  const workbook = xml(files.get('xl/workbook.xml'));
  const first = workbook?.getElementsByTagName('sheet')[0]?.getAttribute('r:id');
  const relation = [
    ...(xml(files.get('xl/_rels/workbook.xml.rels'))?.getElementsByTagName('Relationship') ?? []),
  ].find((r) => r.getAttribute('Id') === first);
  const target = relation?.getAttribute('Target');
  if (!target) throw new Error(NOT_XLSX);
  const sheet = xml(files.get(target.startsWith('/') ? target.slice(1) : `xl/${target}`));
  if (!sheet) throw new Error(NOT_XLSX);
  const shared = [...(xml(files.get('xl/sharedStrings.xml'))?.getElementsByTagName('si') ?? [])].map(textOf);

  const rows: Cell[][] = [];
  for (const row of sheet.getElementsByTagName('row')) {
    const cells: Cell[] = [];
    let next = 0;
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r');
      const at = ref ? column(ref) : next;
      next = at + 1;
      const type = c.getAttribute('t');
      const value = c.getElementsByTagName('v')[0]?.textContent ?? null;
      let cell: Cell = null;
      if (type === 's') cell = value === null ? null : (shared[Number(value)] ?? null);
      else if (type === 'inlineStr') cell = textOf(c.getElementsByTagName('is')[0] ?? c);
      else if (type === 'str') cell = value;
      else if (type === 'b') cell = value === '1' ? 'VERDADERO' : 'FALSO';
      else if (type !== 'e' && value !== null && value.trim() !== '') cell = Number(value);
      while (cells.length < at) cells.push(null);
      cells[at] = cell;
    }
    if (cells.some((c) => c !== null && String(c).trim() !== '')) rows.push(cells);
  }
  return rows;
}

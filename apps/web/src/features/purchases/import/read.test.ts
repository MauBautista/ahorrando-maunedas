import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, readTable } from './readFile';
import { NOT_XLSX, readXlsx, unzip } from './xlsx';
import { workbook, zip } from './zip.testkit';

const ROWS = `
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Importe</t></is></c></row>
  <row r="2"><c r="A2"><v>46330.5</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="b"><v>1</v></c><c r="D2"><v>28.5</v></c></row>
  <row r="3"><c r="A3" t="str"><v>04/11/2026</v></c><c r="B3" t="e"><v>#N/A</v></c><c r="D3"><v></v></c></row>
  <row r="4"><c r="A4" t="s"><v>3</v></c></row>
  <row><c t="str"><v>sin referencia</v></c><c><v>7</v></c></row>`;
const SHARED = [
  '<t>Fecha</t>',
  '<t>Descripción</t>',
  // Rich text runs are joined; the phonetic guide is not text.
  '<r><t>Leche </t></r><r><t>Lala</t></r><rPh><t>れ</t></rPh>',
  '<t xml:space="preserve">   </t>',
];

describe('Excel files (T-306)', () => {
  it('reads the first sheet: shared and inline text, numbers, booleans; errors and gaps are empty', async () => {
    for (const method of [8, 0] as const) {
      expect(await readXlsx(await zip(workbook(ROWS, SHARED), method))).toEqual([
        ['Fecha', 'Descripción', null, 'Importe'],
        [46330.5, 'Leche Lala', 'VERDADERO', 28.5],
        ['04/11/2026', null, null, null],
        ['sin referencia', 7],
      ]);
    }
  });

  it('follows the sheet wherever the workbook says, and without shared strings', async () => {
    const files = workbook(
      '<row r="1"><c r="B1"><v>3</v></c><c r="C1" t="b"><v>0</v></c></row>',
      [],
      '/xl/hojas/compras.xml',
    );
    const moved = {
      ...files,
      'xl/hojas/compras.xml': files['xl/worksheets/sheet1.xml'],
    } as Record<string, string>;
    delete moved['xl/worksheets/sheet1.xml'];
    delete moved['xl/sharedStrings.xml'];
    expect(await readXlsx(await zip(moved))).toEqual([[null, 3, 'FALSO']]);
  });

  it('says when it is not an Excel file', async () => {
    await expect(readXlsx(new TextEncoder().encode('fecha,total\n').buffer as ArrayBuffer)).rejects.toThrow(
      NOT_XLSX,
    );
    await expect(readXlsx(await zip(workbook(ROWS, SHARED), 12))).rejects.toThrow(NOT_XLSX);
    const noSheet = workbook(ROWS, SHARED) as Record<string, string>;
    delete noSheet['xl/worksheets/sheet1.xml'];
    await expect(readXlsx(await zip(noSheet))).rejects.toThrow(NOT_XLSX);
    const noRelation = workbook(ROWS, SHARED) as Record<string, string>;
    delete noRelation['xl/_rels/workbook.xml.rels'];
    await expect(readXlsx(await zip(noRelation))).rejects.toThrow(NOT_XLSX);
    // A broken central directory.
    const broken = new Uint8Array(await zip(workbook(ROWS, SHARED)));
    const view = new DataView(broken.buffer);
    view.setUint32(view.getUint32(broken.length - 6, true), 0, true);
    await expect(readXlsx(broken.buffer)).rejects.toThrow(NOT_XLSX);
  });

  it('unzips only what is asked for', async () => {
    const files = await unzip(await zip({ 'a.xml': '<a/>', 'b.bin': 'x' }), (n) => n.endsWith('.xml'));
    expect([...files]).toEqual([['a.xml', '<a/>']]);
  });
});

describe('the file the household picks', () => {
  const file = (parts: BlobPart[], name: string) => new File(parts, name);

  it('reads a CSV as UTF-8, or as Windows-1252 when it is not', async () => {
    expect(await readTable(file(['Fecha,Descripción\n04/11/2026,Café'], 'compras.csv'))).toEqual([
      ['Fecha', 'Descripción'],
      ['04/11/2026', 'Café'],
    ]);
    // "Café" as Excel in Spanish saves it.
    const latin = new Uint8Array([...new TextEncoder().encode('Fecha;Caf'), 0xe9, 0x0a, 0x31]);
    expect(await readTable(file([latin], 'COMPRAS.TXT'))).toEqual([['Fecha', 'Café'], ['1']]);
  });

  it('reads an .xlsx, and turns down an old .xls or a huge file', async () => {
    const xlsx = await zip(workbook(ROWS, SHARED));
    expect((await readTable(file([xlsx], 'Compras.XLSX')))[1]).toEqual([
      46330.5,
      'Leche Lala',
      'VERDADERO',
      28.5,
    ]);
    await expect(readTable(file(['x'], 'viejo.xls'))).rejects.toThrow('Los archivos .xls antiguos');
    await expect(readTable(file([new Uint8Array(MAX_FILE_BYTES + 1)], 'grande.csv'))).rejects.toThrow('5 MB');
  });
});

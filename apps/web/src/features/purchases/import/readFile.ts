import { parseCsv, type Cell } from '@maunedas/shared/imports/table';
import { readXlsx } from './xlsx';

/** A spreadsheet bigger than this is not a household's purchases. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * The rows of a CSV (or TSV/TXT) or an Excel file (its first sheet). A CSV that is not UTF-8 is read as Windows-1252,
 * as Excel in Spanish saves it.
 */
export async function readTable(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_FILE_BYTES) throw new Error('El archivo pesa más de 5 MB.');
  if (name.endsWith('.xls')) {
    throw new Error('Los archivos .xls antiguos no se pueden leer. Guárdalo como .xlsx o como CSV.');
  }
  const bytes = await file.arrayBuffer();
  if (name.endsWith('.xlsx')) return readXlsx(bytes);
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(bytes);
  return parseCsv(text);
}

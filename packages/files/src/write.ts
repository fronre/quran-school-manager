import ExcelJS from 'exceljs';
import type { Cell } from './read';

export interface SheetSpec { name: string; title?: string; headers: string[]; rows: Cell[][]; widths?: number[] }

const safeSheetName = (s: string) => s.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Sheet1';

/** Writes an .xlsx with a right-to-left sheet, a styled frozen header row and filters. Strings are always written as text
 *  (never as formulas), so a value such as "=1+1" typed by a user cannot execute when the file is opened. */
export async function writeXlsx(spec: SheetSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Mishkat'; wb.created = new Date();
  const ws = wb.addWorksheet(safeSheetName(spec.name), { views: [{ rightToLeft: true, state: 'frozen', ySplit: spec.title ? 2 : 1 }] });
  let r = 1;
  if (spec.title) { ws.mergeCells(1, 1, 1, Math.max(spec.headers.length, 1)); const t = ws.getCell(1, 1); t.value = spec.title; t.font = { bold: true, size: 14 }; t.alignment = { horizontal: 'right' }; r = 2; }
  const head = ws.getRow(r); spec.headers.forEach((h, i) => { const c = head.getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF064E3B' } }; c.alignment = { horizontal: 'right', vertical: 'middle' }; });
  head.height = 22;
  spec.rows.forEach((row, n) => {
    const rr = ws.getRow(r + 1 + n);
    row.forEach((v, i) => { const c = rr.getCell(i + 1); c.value = v instanceof Date ? v : v === null ? null : typeof v === 'string' ? { richText: [{ text: v }] } : v; c.alignment = { horizontal: 'right' }; });
  });
  spec.headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...spec.rows.slice(0, 500).map((row) => String(row[i] ?? '').length));
    ws.getColumn(i + 1).width = spec.widths?.[i] ?? Math.min(Math.max(longest + 3, 10), 40);
  });
  ws.autoFilter = { from: { row: r, column: 1 }, to: { row: r, column: Math.max(spec.headers.length, 1) } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

import ExcelJS from 'exceljs';

/** Reading spreadsheets from outside is untrusted input: size, row and column limits apply, and nothing is executed. */
export const LIMITS = { maxBytes: 10 * 1024 * 1024, maxRows: 20_000, maxCols: 60 } as const;

export type Cell = string | number | boolean | Date | null;
export interface Table { headers: string[]; rows: Cell[][]; sheetName: string; sheetNames: string[]; headerRow: number; format: 'xlsx' | 'csv' }
export type ReadError = 'too_large' | 'too_many_rows' | 'too_many_columns' | 'unreadable' | 'empty' | 'unsupported_xls';
export type ReadResult = { ok: true; table: Table } | { ok: false; error: ReadError };

const isBlank = (c: Cell) => c === null || (typeof c === 'string' && c.trim() === '');

/** Header row = first row with at least two filled cells (titles above the table are skipped); falls back to the first non-empty row. */
function findHeaderRow(grid: Cell[][]): number {
  const n = Math.min(grid.length, 15);
  for (let i = 0; i < n; i++) if (grid[i]!.filter((c) => !isBlank(c)).length >= 2) return i;
  return grid.findIndex((r) => r.some((c) => !isBlank(c)));
}

function finish(grid: Cell[][], sheetName: string, sheetNames: string[], format: Table['format']): ReadResult {
  const h = findHeaderRow(grid);
  if (h < 0) return { ok: false, error: 'empty' };
  const width = Math.max(...grid.slice(h).map((r) => r.length));
  if (width > LIMITS.maxCols) return { ok: false, error: 'too_many_columns' };
  const headers = Array.from({ length: width }, (_, i) => { const v = grid[h]![i]; const t = v === null || v === undefined ? '' : String(v).trim(); return t || `عمود ${i + 1}`; });
  const rows = grid.slice(h + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null)).filter((r) => r.some((c) => !isBlank(c)));
  if (rows.length === 0) return { ok: false, error: 'empty' };
  if (rows.length > LIMITS.maxRows) return { ok: false, error: 'too_many_rows' };
  return { ok: true, table: { headers, rows, sheetName, sheetNames, headerRow: h + 1, format } };
}

function plain(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const o = v as unknown as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('').trim();
  if ('result' in o) return plain(o.result as ExcelJS.CellValue); // formulas: the cached result, never the formula
  if (typeof o.text === 'string') return o.text.trim(); // hyperlinks
  return null; // errors and unknown objects
}

export async function readXlsx(data: Buffer, sheetIndex = 0): Promise<ReadResult> {
  if (data.length > LIMITS.maxBytes) return { ok: false, error: 'too_large' };
  if (data.length >= 4 && data.readUInt32BE(0) === 0xd0cf11e0) return { ok: false, error: 'unsupported_xls' }; // old binary .xls
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    const ws = wb.worksheets[sheetIndex] ?? wb.worksheets[0];
    if (!ws) return { ok: false, error: 'empty' };
    const grid: Cell[][] = [];
    const last = Math.min(ws.actualRowCount > 0 ? ws.rowCount : 0, LIMITS.maxRows + 50);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r); const cells: Cell[] = [];
      const lastCol = Math.min(row.cellCount, LIMITS.maxCols + 1);
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        // merged ranges repeat the master's value in every cell; keep it once so a merged title is not mistaken for data
        cells.push(cell.isMerged && cell.master.address !== cell.address ? null : plain(cell.value));
      }
      grid.push(cells);
    }
    return finish(grid, ws.name, names, 'xlsx');
  } catch { return { ok: false, error: 'unreadable' }; }
}

/** Decodes UTF-8 (with or without BOM); falls back to Windows-1256, the usual encoding of Arabic CSV from older Excel. */
export function decodeCsvBytes(data: Buffer): string {
  const body = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { return new TextDecoder('windows-1256').decode(body); }
}

export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; if (rows.length > LIMITS.maxRows + 50) break; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export function readCsv(data: Buffer): ReadResult {
  if (data.length > LIMITS.maxBytes) return { ok: false, error: 'too_large' };
  try {
    const grid: Cell[][] = parseCsv(decodeCsvBytes(data)).map((r) => r.map((c) => c.trim() || null));
    return finish(grid, 'CSV', ['CSV'], 'csv');
  } catch { return { ok: false, error: 'unreadable' }; }
}

export async function readTable(data: Buffer, fileName: string, sheetIndex = 0): Promise<ReadResult> {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'xlsx' || ext === 'xlsm') return readXlsx(data, sheetIndex);
  if (ext === 'csv' || ext === 'txt') return readCsv(data);
  if (ext === 'xls') return { ok: false, error: 'unsupported_xls' };
  return { ok: false, error: 'unreadable' };
}

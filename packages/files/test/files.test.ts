import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readXlsx, readCsv, readTable, parseCsv, decodeCsvBytes, writeXlsx, toXml, xmlEscape, LIMITS } from '../src';

async function book(build: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('طلاب'); build(ws, wb); return Buffer.from(await wb.xlsx.writeBuffer());
}
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

describe('xlsx reading', () => {
  it('reads Arabic text with tashkeel, numbers, dates and blanks', async () => {
    const buf = await book((ws) => { ws.addRow(['الاسم', 'اللقب', 'تاريخ الميلاد', 'الهاتف']); ws.addRow(['مُحَمَّد', 'بن عمر', new Date(Date.UTC(2015, 2, 10)), 550123456]); ws.addRow(['فاطمة', null, null, '0661 00 00 00']); });
    const t = ok(await readXlsx(buf)).table;
    expect(t.headers).toEqual(['الاسم', 'اللقب', 'تاريخ الميلاد', 'الهاتف']); expect(t.rows).toHaveLength(2);
    expect(t.rows[0]![0]).toBe('مُحَمَّد'); expect((t.rows[0]![2] as Date).toISOString().slice(0, 10)).toBe('2015-03-10'); expect(t.rows[0]![3]).toBe(550123456);
    expect(t.rows[1]).toEqual(['فاطمة', null, null, '0661 00 00 00']); expect(t.format).toBe('xlsx');
  });
  it('skips title rows above the table and fully empty rows', async () => {
    const buf = await book((ws) => { ws.addRow(['قائمة الطلاب 2026']); ws.addRow([]); ws.addRow(['الاسم', 'اللقب']); ws.addRow(['أحمد', 'بوعلام']); ws.addRow([]); ws.addRow(['يوسف', 'حمداني']); });
    const t = ok(await readXlsx(buf)).table;
    expect(t.headers).toEqual(['الاسم', 'اللقب']); expect(t.rows).toHaveLength(2); expect(t.headerRow).toBe(3);
  });
  it('returns the cached result of formulas, text of rich text and hyperlinks, and null for errors', async () => {
    const buf = await book((ws) => {
      ws.addRow(['a', 'b', 'c', 'd']);
      ws.addRow([{ formula: '1+1', result: 2 }, { richText: [{ text: 'مح' }, { text: 'مد' }] }, { text: 'رابط', hyperlink: 'https://x.example' }, { error: '#DIV/0!' } as unknown as ExcelJS.CellValue]);
    });
    expect(ok(await readXlsx(buf)).table.rows[0]).toEqual([2, 'محمد', 'رابط', null]);
  });
  it('names blank header cells and uses other sheets on request', async () => {
    const buf = await book((ws, wb) => { ws.addRow(['الاسم', null, 'الهاتف']); ws.addRow(['أ', 'ب', 'ج']); const w2 = wb.addWorksheet('ثان'); w2.addRow(['x', 'y']); w2.addRow(['1', '2']); });
    const t = ok(await readXlsx(buf)).table; expect(t.headers).toEqual(['الاسم', 'عمود 2', 'الهاتف']); expect(t.sheetNames).toEqual(['طلاب', 'ثان']);
    expect(ok(await readXlsx(buf, 1)).table.headers).toEqual(['x', 'y']);
  });
  it('rejects empty sheets, garbage, old .xls files and oversized or huge inputs without throwing', async () => {
    expect(await readXlsx(await book((ws) => { ws.addRow(['الاسم', 'اللقب']); }))).toEqual({ ok: false, error: 'empty' });
    expect(await readXlsx(Buffer.from('this is not a spreadsheet'))).toEqual({ ok: false, error: 'unreadable' });
    expect(await readXlsx(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).toEqual({ ok: false, error: 'unsupported_xls' });
    expect(await readXlsx(Buffer.alloc(LIMITS.maxBytes + 1))).toEqual({ ok: false, error: 'too_large' });
    expect(await readTable(Buffer.from('x'), 'old.xls')).toEqual({ ok: false, error: 'unsupported_xls' });
    expect(await readTable(Buffer.from('x'), 'notes.docx')).toEqual({ ok: false, error: 'unreadable' });
  });
  it('enforces the row and column limits', async () => {
    const many = await book((ws) => { ws.addRow(['a', 'b']); for (let i = 0; i < LIMITS.maxRows + 5; i++) ws.addRow([i, i]); });
    expect(await readXlsx(many)).toEqual({ ok: false, error: 'too_many_rows' });
    const wide = await book((ws) => { ws.addRow(Array.from({ length: LIMITS.maxCols + 5 }, (_, i) => 'h' + i)); ws.addRow(Array.from({ length: LIMITS.maxCols + 5 }, () => 'v')); });
    expect(await readXlsx(wide)).toEqual({ ok: false, error: 'too_many_columns' });
  }, 60000);
});

describe('csv reading', () => {
  it('parses quotes, escaped quotes, embedded newlines and blank lines', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n"line1\nline2",z\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['line1\nline2', 'z']]);
  });
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b;c\n1;2;3')[1]).toEqual(['1', '2', '3']); expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });
  it('decodes UTF-8 with BOM and falls back to Windows-1256', () => {
    expect(decodeCsvBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('محمد', 'utf8')]))).toBe('محمد');
    expect(decodeCsvBytes(Buffer.from([0xe3, 0xcd, 0xe3, 0xcf]))).toBe('محمد'); // cp1256 bytes of "محمد"
  });
  it('reads a CSV into a table and rejects empty or oversized ones', () => {
    const t = ok(readCsv(Buffer.from('الاسم;اللقب\nأحمد;بوعلام\n', 'utf8'))).table; expect(t.headers).toEqual(['الاسم', 'اللقب']); expect(t.rows).toEqual([['أحمد', 'بوعلام']]); expect(t.format).toBe('csv');
    expect(readCsv(Buffer.from('a,b\n'))).toEqual({ ok: false, error: 'empty' }); expect(readCsv(Buffer.alloc(LIMITS.maxBytes + 1))).toEqual({ ok: false, error: 'too_large' });
    expect(ok(readCsv(Buffer.from('a,b\n1,2', 'utf8'))).table.rows).toEqual([['1', '2']]);
  });
});

describe('xlsx writing', () => {
  it('round-trips Arabic data and sets a right-to-left sheet with a frozen header', async () => {
    const buf = await writeXlsx({ name: 'الطلاب', title: 'جمعية علماء المسلمين في سيدي عون', headers: ['رقم', 'الاسم'], rows: [['0001', 'مُحَمَّد بن عمر'], ['0002', 'فاطمة']] });
    const t = ok(await readXlsx(buf)).table; expect(t.headers).toEqual(['رقم', 'الاسم']); expect(t.rows).toEqual([['0001', 'مُحَمَّد بن عمر'], ['0002', 'فاطمة']]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.views[0]).toMatchObject({ rightToLeft: true, state: 'frozen' });
  });
  it('never writes user text as a formula (spreadsheet injection)', async () => {
    const buf = await writeXlsx({ name: 's', headers: ['x'], rows: [['=1+1'], ['+SUM(A1)'], ['@cmd'], ['-2+3']] });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    for (let r = 2; r <= 5; r++) { const v = ws.getCell(r, 1).value as unknown; expect(typeof v === 'object' ? (v as { formula?: string }).formula : undefined).toBeUndefined(); expect(ws.getCell(r, 1).type).not.toBe(ExcelJS.ValueType.Formula); }
    expect(ok(await readXlsx(buf)).table.rows.map((r) => r[0])).toEqual(['=1+1', '+SUM(A1)', '@cmd', '-2+3']);
  });
  it('keeps leading zeros of text values and sanitizes the sheet name', async () => {
    const buf = await writeXlsx({ name: 'a/b*c?:[d]', headers: ['n'], rows: [['0007']] });
    const t = ok(await readXlsx(buf)).table; expect(t.rows[0]![0]).toBe('0007'); expect(t.sheetName).not.toMatch(/[\\/*?:[\]]/);
  });
});

describe('XML export', () => {
  it('escapes markup and quotes and strips characters XML forbids', () => {
    expect(xmlEscape(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;'); expect(xmlEscape('x\u0000y\u0008z\u000B')).toBe('xyz');
  });
  it('produces a well-formed document with Arabic content and empty elements for blanks', () => {
    const xml = toXml({ root: 'students', item: 'student', attributes: { association: 'جمعية "النور" & أصدقاؤها', count: '2' }, records: [{ studentNo: '0001', name: 'مُحَمَّد <بن> عمر', phone: null }, { studentNo: '0002', name: 'فاطمة', phone: '' }] });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('association="جمعية &quot;النور&quot; &amp; أصدقاؤها"'); expect(xml).toContain('<name>مُحَمَّد &lt;بن&gt; عمر</name>'); expect(xml).toContain('<phone/>');
    expect((xml.match(/<student>/g) ?? []).length).toBe(2); expect(xml.endsWith('</students>\n')).toBe(true);
  });
  it('refuses unsafe element or attribute names and handles zero records', () => {
    expect(() => toXml({ root: 'a b', item: 'x', records: [] })).toThrow(); expect(() => toXml({ root: 'a', item: 'x', records: [{ 'bad name': 'v' }] })).toThrow();
    expect(() => toXml({ root: 'a', item: 'x', attributes: { 'x"y': '1' }, records: [] })).toThrow();
    expect(toXml({ root: 'students', item: 'student', records: [] })).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<students>\n</students>\n');
  });
});

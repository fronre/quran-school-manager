// Generates a realistic, slightly messy student list for trying the import (title row, Arabic-Indic dates, mixed branch names, a few bad rows).
// Usage: node scripts/make-sample-xlsx.mjs <output.xlsx>
import ExcelJS from 'exceljs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const out = process.argv[2]; if (!out) throw new Error('output path required');
mkdirSync(dirname(out), { recursive: true });
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('الطلاب 2026', { views: [{ rightToLeft: true }] });
ws.mergeCells('A1:F1'); ws.getCell('A1').value = 'جمعية علماء المسلمين في سيدي عون - قائمة الطلاب'; ws.getCell('A1').font = { bold: true, size: 14 };
ws.addRow([]);
ws.addRow(['الرقم', 'الاسم واللقب', 'تاريخ الازدياد', 'الفرع', 'الهاتف', 'الحالة']);
const given = ['محمد', 'أحمد', 'يوسف', 'إبراهيم', 'عبد الله', 'عمر', 'بلال', 'ياسين'];
const girls = ['فاطمة', 'عائشة', 'خديجة', 'مريم', 'آمنة', 'سمية', 'هاجر', 'أسماء'];
const fam = ['بوعلام', 'بن عمر', 'الجزائري', 'بلقاسم', 'مسعودي', 'حمداني', 'بلعيد', 'قدور'];
const ar = (s) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
let n = 0;
for (let i = 0; i < 30; i++) {
  const male = i % 3 !== 2; const name = `${(male ? given : girls)[i % 8]} ${fam[(i * 3) % 8]}`;
  const y = 2010 + (i % 8), m = 1 + (i % 12), d = 1 + ((i * 7) % 28);
  const dob = i % 4 === 0 ? ar(`${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`) : i % 4 === 1 ? new Date(Date.UTC(y, m - 1, d)) : `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  ws.addRow([++n, name, dob, male ? (i % 2 ? 'رجال' : 'فرع الرجال') : 'النساء', `05${50 + (i % 40)} ${10 + i} ${20 + i} ${30 + i}`, i % 10 === 9 ? 'موقوف' : '']);
}
// rows with problems: unreadable date, unknown branch, missing name, repeated number, same child twice
ws.addRow([31, 'عمر الأخضر', '31/02/2012', 'رجال', '0550000000', '']);
ws.addRow([32, 'سلمى بوزيد', '05/05/2012', 'فرع الأطفال', '', '']);
ws.addRow([33, '', '', 'رجال', '', '']);
ws.addRow([5, 'مكرر الرقم', '', 'رجال', '', '']);
ws.addRow([35, 'محمد بوعلام', '2010-01-01', 'رجال', '', '']);
ws.addRow([36, 'مُحَمَّد بوعلام', '01/01/2010', 'رجال', '', '']);
await wb.xlsx.writeFile(out);
console.log('wrote', out, 'data rows:', n + 6);

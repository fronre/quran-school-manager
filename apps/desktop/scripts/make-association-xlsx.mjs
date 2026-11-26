// Generates a realistic, slightly messy Excel file for trying the whole import flow (students first, then guardians from the same file).
// Usage: node scripts/make-association-xlsx.mjs <output.xlsx>
import ExcelJS from 'exceljs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const out = process.argv[2]; if (!out) throw new Error('output path required');
mkdirSync(dirname(out), { recursive: true });
let seed = 77; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; const pick = (a) => a[Math.floor(rnd() * a.length)];
const MALE = ['محمد', 'أحمد', 'يوسف', 'عبد الرحمن', 'إبراهيم', 'عمر', 'بلال', 'حمزة', 'أنس', 'ياسين', 'سليمان', 'عبد القادر', 'مصطفى', 'إلياس', 'خالد', 'أيوب', 'عثمان', 'طه', 'معاذ', 'ريان'];
const FEMALE = ['فاطمة', 'خديجة', 'عائشة', 'مريم', 'آسية', 'سمية', 'هاجر', 'إيمان', 'سارة', 'أميرة', 'رقية', 'زينب', 'حفصة', 'أسماء', 'ليلى', 'سلمى', 'ياسمين', 'رحمة'];
const FAM = ['بن علي', 'بوعلام', 'مسعودي', 'قاسمي', 'زيداني', 'حمادي', 'بلقاسم', 'بوزيد', 'شريف', 'عمراني', 'سعدي', 'خليفي', 'بن عمر', 'بوقرة', 'مداني', 'طالبي'];
const GM = ['محمد', 'علي', 'أحمد', 'عبد الحميد', 'الطاهر', 'بشير', 'رابح', 'جمال', 'نور الدين'];
const GF = ['فتيحة', 'نادية', 'سعاد', 'ليلى', 'حورية', 'زهرة', 'كريمة', 'سميرة'];
const ar = (s) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const two = (n) => String(n).padStart(2, '0');
const phone = (i) => { const p = `0${pick([5, 6, 7])}${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`; return i % 5 === 0 ? Number(p.slice(1)) : i % 5 === 1 ? p.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4') : i % 5 === 2 ? ar(p) : i % 5 === 3 ? '+213' + p.slice(1) : p; };

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('الطلاب 2026-2027', { views: [{ rightToLeft: true }] });
ws.mergeCells('A1:I1'); ws.getCell('A1').value = 'جمعية علماء المسلمين في سيدي عون — قائمة الطلاب'; ws.getCell('A1').font = { bold: true, size: 14 };
ws.addRow([]);
ws.addRow(['الرقم', 'الاسم واللقب', 'تاريخ الازدياد', 'الفرع', 'هاتف الطالب', 'اسم الولي', 'هاتف الولي', 'صلة القرابة', 'الحالة']);
let n = 0; const rows = [];
for (let i = 0; i < 64; i++) {
  const male = i % 5 !== 3 && i % 5 !== 4; const family = i > 3 && i % 9 === 0 ? rows[i - 1].family : pick(FAM); const given = pick(male ? MALE : FEMALE);
  const y = 2008 + Math.floor(rnd() * 11), m = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * 28);
  const dob = i % 4 === 0 ? ar(`${two(d)}/${two(m)}/${y}`) : i % 4 === 1 ? new Date(Date.UTC(y, m - 1, d)) : i % 4 === 2 ? `${two(d)}/${two(m)}/${y}` : `${y}-${two(m)}-${two(d)}`;
  const sibling = i > 3 && i % 9 === 0; const gName = sibling ? rows[i - 1].gName : `${male ? pick(GM) : pick(GF)} ${family}`; const gPhone = sibling ? rows[i - 1].gPhone : phone(i);
  const r = { family, gName, gPhone };
  rows.push(r);
  ws.addRow([++n, `${given} ${family}`, dob, male ? (i % 2 ? 'رجال' : 'فرع الرجال') : (i % 2 ? 'النساء' : 'فرع النساء'), i % 6 === 0 ? phone(i + 1) : '', i % 11 === 10 ? '' : gName, i % 11 === 10 ? '' : gPhone, male ? 'الأب' : (i % 2 ? 'الأم' : 'الأب'), i % 17 === 16 ? 'موقوف' : '']);
}
// rows that SHOULD be caught, so you can see how the program reports problems
ws.addRow([65, 'عمر الأخضر', '31/02/2012', 'رجال', '', 'علي الأخضر', '0550000000', 'الأب', '']);      // impossible date
ws.addRow([66, 'سلمى بوزيد', '05/05/2012', 'فرع الأطفال', '', 'أحمد بوزيد', '0661234567', 'الأب', '']); // unknown branch
ws.addRow([67, '', '', 'رجال', '', '', '', '', '']);                                                       // no name
ws.addRow([5, 'مكرر الرقم', '', 'رجال', '', '', '', '', '']);                                              // number already used in this file
ws.addRow([69, 'يوسف بن علي', '2012-03-04', 'رجال', '', 'علي بن علي', '12ab', 'الأب', '']);               // bad guardian phone
ws.addRow([70, 'طفل من المستقبل', '2099-01-01', 'رجال', '', '', '', '', '']);                               // future birth date
const w2 = wb.addWorksheet('ملاحظات'); w2.addRow(['هذا الملف تجريبي: كل الأسماء والأرقام مولَّدة ولا تخص أحداً.']); w2.addRow(['الصفوف 65 إلى 70 فيها مشاكل مقصودة لترون كيف يعرضها البرنامج.']);
await wb.xlsx.writeFile(out);
console.log('written', out, 'rows', n + 6);

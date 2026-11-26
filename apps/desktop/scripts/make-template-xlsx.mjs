// Generates an EMPTY Excel template the association can fill with its real students and guardians,
// with headers the importers recognise automatically (students first, then guardians from the same file).
// Usage: node scripts/make-template-xlsx.mjs <output.xlsx> [--filled]   (--filled adds 4 fake rows, for testing only)
import ExcelJS from 'exceljs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const out = process.argv[2]; if (!out) throw new Error('output path required');
const filled = process.argv.includes('--filled');
mkdirSync(dirname(out), { recursive: true });

const ROWS = 400; // rows prepared with formats and drop-down lists
const cols = [
  { h: 'الرقم', w: 9, note: 'اختياري. اتركوه فارغاً ليعطي البرنامج رقماً تلقائياً. لا يتكرر.', text: true },
  { h: 'الاسم واللقب', w: 28, note: 'مطلوب. الاسم ثم اللقب: محمد بن علي.' },
  { h: 'تاريخ الازدياد', w: 15, note: 'يوم/شهر/سنة: 20/07/2013', date: true },
  { h: 'الفرع', w: 12, note: 'اختاروا من القائمة: رجال أو نساء.', list: '"رجال,نساء"' },
  { h: 'هاتف الطالب', w: 16, note: 'اختياري. 10 أرقام تبدأ بـ 05 أو 06 أو 07.', text: true },
  { h: 'الحالة', w: 12, note: 'اتركوها فارغة = نشط. أو اختاروا من القائمة.', list: '"نشط,موقوف,منسحب,متخرج"' },
  { h: 'تاريخ الانضمام', w: 15, note: 'اختياري. يوم/شهر/سنة.', date: true },
  { h: 'اسم الولي', w: 24, note: 'للأولياء: الاسم واللقب.' },
  { h: 'هاتف الولي', w: 16, note: 'رقم نقال للولي (لواتساب).', text: true },
  { h: 'صلة القرابة', w: 13, note: 'اختاروا من القائمة.', list: '"الأب,الأم,الأخ,الأخت,العم,الخال,العمة,الخالة,الجد,الجدة"' },
];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('الطلاب', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
ws.columns = cols.map((c) => ({ header: c.h, width: c.w }));
const head = ws.getRow(1);
head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.height = 22;
head.eachCell((cell, i) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 2 ? 'FF003527' : 'FF064E3B' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.note = cols[i - 1].note;
});
for (let r = 2; r <= ROWS + 1; r++) {
  cols.forEach((c, i) => {
    const cell = ws.getCell(r, i + 1);
    if (c.text) cell.numFmt = '@'; // keeps the leading 0 of phone numbers and numbers like 0012
    if (c.date) cell.numFmt = 'dd/mm/yyyy';
    if (c.list) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [c.list], showErrorMessage: true, errorTitle: 'قيمة غير معروفة', error: 'اختاروا من القائمة.' };
  });
}
if (filled) { // fake rows to check that the template imports cleanly; never shipped
  const d = (y, m, dd) => new Date(Date.UTC(y, m - 1, dd));
  ws.getRow(2).values = ['', 'تجربة أولى', d(2014, 3, 5), 'رجال', '', '', '', 'ولي تجربة', '0550000001', 'الأب'];
  ws.getRow(3).values = ['', 'تجربة ثانية', d(2015, 9, 20), 'نساء', '0660000002', 'نشط', d(2025, 9, 1), 'ولية تجربة', '0770000003', 'الأم'];
  ws.getRow(4).values = ['0099', 'تجربة ثالثة', '12/01/2013', 'رجال', '', 'موقوف', '', 'ولي ثالث', '0550000004', 'العم'];
  ws.getRow(5).values = ['', 'تجربة رابعة', '', 'نساء', '', '', '', '', '', ''];
}

const g = wb.addWorksheet('طريقة الملء', { views: [{ rightToLeft: true }] });
g.getColumn(1).width = 110;
const lines = [
  ['طريقة ملء ورقة «الطلاب»', true],
  ['• كل طالب في سطر واحد. لا تغيّروا أسماء الأعمدة في السطر الأول، ولا تتركوا أسطراً فارغة بين الطلاب.'],
  ['• المطلوب فقط: «الاسم واللقب». كل الباقي اختياري، لكن «الفرع» يُستحسن جداً (وإلا يُختار فرع واحد لكل الملف عند الاستيراد).'],
  ['• «الفرع»: رجال أو نساء، كما في البرنامج. إن غيّرتم أسماء الفروع في البرنامج فاكتبوا الاسم الجديد.'],
  ['• التواريخ: يوم/شهر/سنة، مثل 20/07/2013. الأرقام العربية ٢٠/٠٧/٢٠١٣ مقبولة أيضاً.'],
  ['• الهواتف: 10 أرقام تبدأ بـ 05 أو 06 أو 07 (أو +213). أعمدة الهاتف مهيّأة كنص حتى لا يحذف Excel الصفر الأول.'],
  ['• الأخوة: إن كان للطالبين نفس الولي فاكتبوا نفس اسم الولي ونفس رقمه في السطرين؛ يُحفظ ولياً واحداً لهما.'],
  ['• احفظوا الملف بصيغة ‎.xlsx‎ (ليس ‎.xls‎ القديمة).'],
  [''],
  ['في البرنامج', true],
  ['1) «الطلاب» ← «استيراد من Excel» ← هذا الملف ← راجعوا ربط الأعمدة ← راجعوا الصفوف المعلَّمة ← استيراد.'],
  ['2) ثم «الطلاب» ← «استيراد الأولياء» ← الملف نفسه ← معاينة ← استيراد.'],
  ['يأخذ البرنامج نسخة احتياطية قبل كل استيراد. الصفوف التي فيها مشكلة لا تُستورد، ويمكن تنزيلها في «ملف الأخطاء» لتصحيحها وإعادة استيرادها.'],
  [''],
  ['تنبيه: هذا الملف سيحمل بيانات أطفال وأرقام أوليائهم. احفظوه في مكان آمن ولا ترسلوه إلا لمن يحتاجه.', true],
];
for (const [t, b] of lines) { const row = g.addRow([t]); row.getCell(1).alignment = { wrapText: true, vertical: 'top' }; if (b) row.font = { bold: true, size: 12, color: { argb: 'FF064E3B' } }; }

await wb.xlsx.writeFile(out);
console.log('written', out, filled ? '(with 4 fake test rows)' : '(empty template)');

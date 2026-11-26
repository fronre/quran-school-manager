// Smoke test on the BUILT app: guardians (manual + Excel import), update-existing import, year close + carry-over, evaluation settings, home "today", backups screen.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const ExcelJS = require('exceljs');
const base = path.join(__dirname, '..', 'out', 'batch2');
for (const d of ['userdata', 'backups']) fs.rmSync(path.join(base, d), { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups');
const report = { checks: {} }; const C = report.checks; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 240000);
require('../dist/main.cjs');
async function xlsx(file, headers, rows) { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.addRow(headers); rows.forEach((r) => ws.addRow(r)); await wb.xlsx.writeFile(file); }
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (n) => { wc.invalidate(); await sleep(450); fs.writeFileSync(path.join(base, n), (await wc.capturePage()).toPNG()); };
  const setv = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;const P=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(P,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return true})()`);
  const click = (text) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const nav = (t) => js(`[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()===${JSON.stringify(t)}).click()`);
  const q = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const id = (i, v) => setv('#' + i, v);
  const setCheck = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(el.checked!==${v})el.click();return el.checked})()`);

  await click('ابدؤوا'); await sleep(300); await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await id('k1', key[0]); await id('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await id('yn', '2026-2027'); await id('ys', '2026-09-01'); await id('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000); await id('fp', 'عبارة سر طويلة 2026'); await id('fp2', 'عبارة سر طويلة 2026'); await sleep(200); await click('حفظ ومتابعة'); await sleep(3500);

  await js(`(async()=>{const f=await window.mishkat.invoke('students.form');const m=f.branches[0].id;const ids=[];
    for (const [g,fam] of [['أحمد','بن علي'],['يوسف','بن علي'],['عمر','كريم']]) { const r=await window.mishkat.invoke('students.create',{input:{givenName:g,familyName:fam,birthDate:null,phone:null,branchId:m,status:'active',joinedOn:'2026-09-05',studentNo:String(ids.length+1)}}); ids.push(r.id); }
    const g=await window.mishkat.invoke('groups.create',{branchId:m,name:'فوج الفجر',level:null,capacity:10});
    for (const s of ids) await window.mishkat.invoke('groups.enroll',{groupId:g.id,studentId:s});})()`);
  await sleep(500);

  // ---- home "today"
  await nav('الطلاب'); await sleep(500); await nav('الرئيسية'); await sleep(1200); await shot('00-home.png'); C.homeToday = await q('.home-aside'); C.homeActions = await js('[...document.querySelectorAll(".actions b")].map(b=>b.textContent)');

  // ---- guardians: manual
  await nav('الطلاب'); await sleep(800); await js('document.querySelector(".grid tbody tr").click()'); await sleep(800); await click('الأولياء'); await sleep(500); C.guardiansEmpty = await q('.empty');
  await click('إضافة ولي'); await sleep(300); await id('gn', 'علي بن محمد'); await id('gp', '0550 12 34 56'); await sleep(200); C.phoneHint = await q('.helper'); await click('حفظ'); await sleep(800); C.guardianTable = await q('table[aria-label="أولياء الطالب"]'); await shot('01-guardians.png');
  C.printButton = await js('!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="طباعة كشف الطالب")');

  // ---- guardians: Excel import (matches by number; one row by name; one bad)
  const gfile = path.join(base, 'guardians.xlsx'); await xlsx(gfile, ['رقم الطالب', 'اسم الطالب', 'اسم الولي', 'رقم الهاتف', 'صلة القرابة'], [['2', '', 'علي بن محمد', 550123456, 'الأب'], ['', 'عمر كريم', 'خالد كريم', '0661234567', 'الأب'], ['77', '', 'مجهول', '0661234567', null]]);
  process.env.MISHKAT_TEST_IMPORT_FILE = gfile;
  await click('→ كل الطلاب'); await sleep(500); await click('استيراد الأولياء'); await sleep(500); await click('اختيار ملف Excel'); await sleep(1200); C.gMapping = await js('[...document.querySelectorAll(".inline-panel select")].map(s=>s.selectedOptions[0].textContent)');
  await click('معاينة'); await sleep(900); C.gPreview = await q('.inline-panel:nth-of-type(2)'); await setCheck('.check input', true); await sleep(200); await click('استيراد الأولياء'); await sleep(1000); C.gDone = await q('.banner.info'); await shot('02-guardian-import.png');

  // ---- update existing students from Excel
  const ufile = path.join(base, 'update.xlsx'); await xlsx(ufile, ['رقم الطالب', 'تاريخ الميلاد', 'الهاتف'], [['1', '2014-05-06', '0771234567'], ['2', '2013-01-02', null]]); process.env.MISHKAT_TEST_IMPORT_FILE = ufile;
  await js('[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()==="الطلاب").click()'); await sleep(700); await click('تحديث طلاب من Excel'); await sleep(500); await click('اختيار ملف Excel'); await sleep(1200); await click('معاينة'); await sleep(900); C.uPreview = await q('.inline-panel:nth-of-type(2)'); await click('تحديث الطلاب'); await sleep(1000); C.uDone = await q('.banner.info');
  C.updatedStudent = await js(`(async()=>{const l=await window.mishkat.invoke('students.list',{search:'أحمد'});return l.rows.map(r=>[r.givenName,r.birthDate,r.phone])})()`);

  // ---- settings: evaluation labels + year close + carry over
  await nav('الإعدادات'); await sleep(900); C.settingsSections = await js('[...document.querySelectorAll(".step-box h2")].map(h=>h.textContent)');
  await id('ml1', 'ضعيف'); await click('حفظ التقديرات'); await sleep(900); C.memoSaved = await q('.banner.info');
  await click('إقفال العام وفتح عام جديد'); await sleep(400); C.yearForm = await js('[document.querySelector("#yn").value, document.querySelector("#ys").value, document.querySelector("#ye").value]'); await id('yw', 'إقفال'); await sleep(200); await shot('03-year.png'); await click('إقفال العام وفتح الجديد'); await sleep(1500);
  C.yearNote = await q('.banner.info'); C.sidebarYear = await q('.scope-label'); C.carryTable = await q('table[aria-label="نقل الطلاب"]');
  await js(`(function(){const s=document.querySelector('select[aria-label^="فوج"]');if(s&&!s.value){s.selectedIndex=1;s.dispatchEvent(new Event('change',{bubbles:true}))}})()`); await sleep(300); await click('نقل'); await sleep(1200); C.carryDone = await q('.banner.info'); C.carryAfter = await q('table[aria-label="نقل الطلاب"]');
  C.membersNow = await js(`(async()=>{const g=(await window.mishkat.invoke('groups.list',{status:'active'})).rows;return g.map(x=>[x.name,x.yearName,x.members])})()`);

  // ---- backups screen
  await nav('النسخ الاحتياطي'); await sleep(900); C.backupButtons = await js('[...document.querySelectorAll(".suggest-row button")].map(b=>b.textContent.trim())'); C.backupSecond = await q('.folder-box:nth-of-type(2)'); C.backupNote = await q('.step-box p'); await shot('04-backups.png');
  C.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

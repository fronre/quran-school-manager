// Smoke test on the BUILT app: attendance — sheet, save, correction, no-class day, history, student profile totals.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'out', 'attendance');
for (const d of ['userdata', 'backups']) fs.rmSync(path.join(base, d), { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups');
const report = { checks: {} }; const C = report.checks; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 150000);
require('../dist/main.cjs');
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
  const inRow = (row, sel, label) => js(`(function(){const tr=document.querySelectorAll('table[aria-label="ورقة الحضور"] tbody tr')[${row}];const b=[...tr.querySelectorAll(${JSON.stringify(sel)})].find(x=>${label === null ? 'true' : `x.textContent.trim()===${JSON.stringify(label)}`});if(!b)return false;b.click();return true})()`);
  const setInRow = (row, sel, v) => js(`(function(){const tr=document.querySelectorAll('table[aria-label="ورقة الحضور"] tbody tr')[${row}];const el=tr.querySelector(${JSON.stringify(sel)});if(!el)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);

  await click('ابدؤوا'); await sleep(300); await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await id('k1', key[0]); await id('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await id('yn', '2026-2027'); await id('ys', '2026-09-01'); await id('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000); await id('fp', 'عبارة سر طويلة 2026'); await id('fp2', 'عبارة سر طويلة 2026'); await sleep(200); await click('حفظ ومتابعة'); await sleep(3500);

  C.today = await js('new Date().toISOString().slice(0,10)');
  await js(`(async()=>{const f=await window.mishkat.invoke('students.form');const [m]=f.branches.map(b=>b.id);let n=0;const ids=[];
    for (const g of ['أحمد','يوسف','عمر']) { const r=await window.mishkat.invoke('students.create',{input:{givenName:g,familyName:'اختبار',birthDate:null,phone:null,branchId:m,status:'active',joinedOn:'2026-09-05',studentNo:String(++n)}}); ids.push(r.id); }
    const g=await window.mishkat.invoke('groups.create',{branchId:m,name:'فوج الفجر',level:null,capacity:10});
    for (const s of ids) await window.mishkat.invoke('groups.enroll',{groupId:g.id,studentId:s});})()`);
  await sleep(500);

  C.nav = await js('[...document.querySelectorAll(".nav a, .nav span")].map(a=>a.textContent.trim())');
  await nav('الحضور'); await sleep(900); C.sheetInitial = await q('table[aria-label="ورقة الحضور"]'); C.saveDisabledAtStart = await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="حفظ الحضور")?.disabled');
  C.togglesAtStart = await js('[...document.querySelectorAll(".att-toggle")].map(b=>b.textContent.trim())'); // everyone starts present
  // row 0: present, left early at 17:30 with a note; row 1: late 10 min; row 2: tap the name -> absent
  await inRow(0, '.att-more', null); await sleep(150); await setInRow(0, 'input[type="time"]', '17:30'); await setInRow(0, 'input[aria-label^="ملاحظة"]', 'موعد طبيب'); await sleep(150);
  await inRow(1, '.att-more', null); await sleep(150); await inRow(1, '.att-other button', 'متأخر'); await sleep(150); await setInRow(1, 'input[aria-label="دقائق التأخر"]', '10');
  await inRow(2, '.att-name', null); await sleep(200);
  C.togglesBeforeSave = await js('[...document.querySelectorAll(".att-toggle")].map(b=>b.textContent.trim())'); C.counts = await q('.att-count');
  C.saveDisabledPartial = await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="حفظ الحضور")?.disabled'); await shot('01-sheet.png');
  await click('حفظ الحضور'); await sleep(900);
  C.afterSave = await q('table[aria-label="ورقة الحضور"]'); C.note = await q('.banner.info'); await shot('02-saved.png');
  await click('تصحيح'); await sleep(300); await click('بعذر'); await id('fr', 'أحضر شهادة'); await click('حفظ التصحيح'); await sleep(900); C.afterFix = await q('table[aria-label="ورقة الحضور"]'); C.fixNote = await q('.banner.info');
  await click('السجل'); await sleep(900); C.history = await q('table[aria-label="حضور الطلاب"]'); C.days = await q('table[aria-label="أيام الحصص"]'); await shot('03-history.png');
  await nav('الطلاب'); await sleep(800); await js('document.querySelector(".grid tbody tr").click()'); await sleep(900); C.studentFacts = await q('.profile-aside');
  C.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

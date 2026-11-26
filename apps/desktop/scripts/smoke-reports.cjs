// Smoke test on the BUILT app: reports - enrollment, attendance, activity, paper sheet, Excel export.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'out', 'reports');
for (const d of ['userdata', 'backups']) fs.rmSync(path.join(base, d), { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups'); process.env.MISHKAT_TEST_EXPORT_DIR = path.join(base, 'exports'); fs.mkdirSync(path.join(base, 'exports'), { recursive: true });
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
  const pick = (row, label) => js(`(function(){const tr=document.querySelectorAll('table[aria-label="ورقة الحضور"] tbody tr')[${row}];const b=[...tr.querySelectorAll('.att-seg button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`);

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

  const tabs = () => js('[...document.querySelectorAll(".filters .seg button")].map(b=>b.textContent.trim())');
  await js(`(async()=>{const g=(await window.mishkat.invoke('groups.list',{status:'active'})).rows[0];const m=(await window.mishkat.invoke('groups.get',{id:g.id})).found.members;
    await window.mishkat.invoke('attendance.save',{groupId:g.id,date:new Date().toISOString().slice(0,10),startTime:'16:00',endTime:'17:00',entries:[{studentId:m[0].studentId,status:'present'},{studentId:m[1].studentId,status:'late',lateMinutes:5},{studentId:m[2].studentId,status:'absent'}]});})()`);
  C.nav = await js('[...document.querySelectorAll(".nav a, .nav span")].map(a=>a.textContent.trim())');
  await nav('التقارير'); await sleep(900); C.tabs = await tabs();
  C.attReport = await q('table[aria-label="تقرير الحضور"]'); C.attFoot = await q('.grid-foot'); await shot('01-attendance-report.png');
  await click('التسجيل'); await sleep(800); C.enrollReport = await q('table[aria-label="تقرير التسجيل"]'); C.enrollFoot = await q('.grid-foot');
  await click('نشاط الأفواج'); await sleep(800); C.actReport = await q('table[aria-label="نشاط الأفواج"]');
  await click('الحضور'); await sleep(800); await click('تصدير Excel'); await sleep(1500); C.exportNote = await q('.banner.info'); C.exportedFiles = fs.readdirSync(path.join(base, 'exports'));
  await click('ورقة حضور للطباعة'); await sleep(800); C.paperHelp = await q('.helper');
  C.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

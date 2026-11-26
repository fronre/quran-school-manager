// Smoke test on the BUILT app: the sidebar branch switch (both / men / women) drives students, teachers and home.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'out', 'scope');
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
  const setv = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const click = (text) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const nav = (t) => js(`[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()===${JSON.stringify(t)}).click()`);
  const scope = (t) => js(`[...document.querySelectorAll(".scope-switch button")].find(b=>b.textContent.trim()===${JSON.stringify(t)}).click()`);
  const q = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const id = (i, v) => setv('#' + i, v);

  await click('ابدؤوا'); await sleep(300); await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await id('k1', key[0]); await id('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await id('yn', '2026-2027'); await id('ys', '2026-09-01'); await id('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000); await id('fp', 'عبارة سر طويلة 2026'); await id('fp2', 'عبارة سر طويلة 2026'); await sleep(200); await click('حفظ ومتابعة'); await sleep(3500);

  await js(`(async()=>{const f=await window.mishkat.invoke('students.form');const [m,w]=f.branches.map(b=>b.id);let n=0;
    for (const [g,b] of [['أحمد',m],['يوسف',m],['عمر',m],['فاطمة',w],['مريم',w]]) await window.mishkat.invoke('students.create',{input:{givenName:g,familyName:'اختبار',birthDate:null,phone:null,branchId:b,status:'active',joinedOn:'2026-09-05',studentNo:String(++n)}});
    const sf=await window.mishkat.invoke('staff.form');const [sm,sw]=sf.branches.map(b=>b.id);
    for (const [g,b] of [['عبد الرحمن',sm],['خديجة',sw],['سمية',sw]]) await window.mishkat.invoke('staff.create',{input:{givenName:g,familyName:'معلم',birthDate:null,phone:null,branchId:b,position:'teacher',kind:'employee'}});})()`);
  await sleep(500);

  C.sidebarScope = await q('.scope'); C.switchButtons = await js('[...document.querySelectorAll(".scope-switch button")].map(b=>b.textContent+(b.getAttribute("aria-pressed")==="true"?" *":""))'); await shot('01-sidebar.png');
  C.homeBoth = await q('.ledger'); await scope('الرجال'); await sleep(900); C.homeMen = await q('.ledger'); await scope('النساء'); await sleep(900); C.homeWomen = await q('.ledger');

  await nav('الطلاب'); await sleep(900); C.studentsHasLocalBranchButtons = await js('document.querySelectorAll(".filters .seg").length');
  await scope('الفرعان'); await sleep(900); C.studentsBoth = await q('.grid-foot');
  await scope('الرجال'); await sleep(900); C.studentsMen = await q('.grid-foot'); C.studentsMenNames = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.children[1].innerText.trim())'); await shot('02-students-men.png');
  await scope('النساء'); await sleep(900); C.studentsWomen = await q('.grid-foot'); C.studentsWomenNames = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.children[1].innerText.trim())');

  await nav('المعلمون'); await sleep(900); C.teachersWomen = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.children[1].innerText.trim())');
  await scope('الرجال'); await sleep(900); C.teachersMen = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.children[1].innerText.trim())');
  await scope('الفرعان'); await sleep(900); C.teachersBoth = await js('document.querySelectorAll(".grid tbody tr").length');

  // new student defaults to the branch shown
  await scope('النساء'); await nav('الطلاب'); await sleep(700); await click('إضافة طالب'); await sleep(600); C.newStudentBranch = await js('document.getElementById("sb").selectedOptions[0].textContent');
  C.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

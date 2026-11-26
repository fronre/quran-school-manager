// Smoke test of the Finance section on the BUILT app: wizard -> students -> password gate -> rate -> payment + receipt -> cancel -> arrears -> lock.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'out', 'finance');
for (const d of ['userdata', 'exports', 'backups']) fs.rmSync(path.join(base, d), { recursive: true, force: true });
fs.mkdirSync(path.join(base, 'exports'), { recursive: true });
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups'); process.env.MISHKAT_TEST_EXPORT_DIR = path.join(base, 'exports');
const report = { checks: {} }; const C = report.checks; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 170000);
require('../dist/main.cjs');
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (n) => { wc.invalidate(); await sleep(400); fs.writeFileSync(path.join(base, n), (await wc.capturePage()).toPNG()); };
  const setv = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);
  const click = (text) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const tab = (t) => js(`(function(){const b=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()===${JSON.stringify(t)});if(!b)return false;b.click();return true})()`);
  const nav = (t) => js(`[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()===${JSON.stringify(t)}).click()`);
  const q = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const id = (i, v) => setv('#' + i, v);

  // wizard
  await click('ابدؤوا'); await sleep(300);
  await id('gn', 'علي'); await id('fn', 'الجزائري'); await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await id('k1', key[0]); await id('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await id('yn', '2026-2027'); await id('ys', '2026-09-01'); await id('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000); await id('fp', 'عبارة سر طويلة 2026'); await id('fp2', 'عبارة سر طويلة 2026'); await sleep(200); await click('حفظ ومتابعة'); await sleep(3500);

  // students through the real IPC
  C.studentsCreated = await js(`(async()=>{const f=await window.mishkat.invoke('students.form');let ok=0;const rows=[['1','أحمد','بن عمر',0],['2','فاطمة','بلقاسم',1],['3','يوسف','حمداني',0],['4','مريم','مسعودي',1]];
    for(const [no,g,fm,b] of rows){const r=await window.mishkat.invoke('students.create',{input:{givenName:g,familyName:fm,birthDate:null,phone:null,branchId:f.branches[b].id,status:'active',joinedOn:'2026-09-05',studentNo:no}});if(r.ok)ok++}return ok})()`);

  // gate
  await nav('المال'); await sleep(800); C.gateTitle = await q('.gate h2'); await shot('01-gate-create.png');
  await id('fp', '123'); await id('fp2', '123'); await click('إنشاء وفتح'); await sleep(600); C.weakError = await q('.gate .banner');
  await id('fp', 'صندوق-2026'); await id('fp2', 'صندوق-2027'); await click('إنشاء وفتح'); await sleep(600); C.mismatchError = await q('.gate .banner');
  await id('fp2', 'صندوق-2026'); await click('إنشاء وفتح'); await sleep(1500); C.afterCreate = await q('.tabs');

  // settings: rate + free month
  await tab('الإعدادات'); await sleep(900); C.noRateBanner = await q('.settings .banner.warn');
  await setv('.settings input.num', '1000'); await sleep(150); await click('حفظ المبلغ'); await sleep(900); C.rateSaved = await q('.settings .banner'); C.ratesList = await q('.rates'); await shot('02-settings.png');
  await js(`[...document.querySelectorAll('.chip-btn')].find(b=>b.textContent.includes('جانفي')).click()`); await sleep(800); C.freeChip = await js(`[...document.querySelectorAll('.chip-btn.on')].map(b=>b.innerText.replace(/\\s+/g,' '))`);

  // collect + receipt
  await tab('التحصيل'); await sleep(700);
  await js('(() => { window.print = () => { window.__printed = document.querySelector(".print-sheet")?.innerText ?? null; }; return true; })()');
  C.payButtonsBeforeSearch = await js('document.querySelectorAll(".statement").length');
  await setv('input[aria-label="بحث عن طالب"]', 'احمد'); await sleep(900); C.searchResults = await js('[...document.querySelectorAll(".picklist button")].map(b=>b.innerText.replace(/\\s+/g," "))');
  await js('document.querySelector(".picklist button").click()'); await sleep(1000); C.statementHead = await q('.st-head');
  C.payDisabledWithoutCollector = await js('[...document.querySelectorAll(".statement button")].find(b=>b.textContent.trim()==="تسجيل دفعة").disabled');
  await setv('input[aria-label="اسم القابض"]', 'أمين الصندوق'); await sleep(200); await shot('03-statement.png');
  await js('[...document.querySelectorAll(".statement button")].find(b=>b.textContent.trim()==="تسجيل دفعة").click()'); await sleep(1800);
  C.afterPayBanner = await q('.collect .banner'); C.printedReceipt = await js('window.__printed'); C.statementAfter = await js('[...document.querySelectorAll(".statement tbody tr")].slice(0,4).map(r=>r.innerText.replace(/\\s+/g," "))');
  C.summary = await q('.ledger.compact'); await shot('04-after-payment.png');

  // register + cancel
  await tab('سجل الدفعات'); await sleep(900); C.registerRows = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.innerText.replace(/\\s+/g," "))');
  await click('إلغاء'); await sleep(300); C.cancelNeedsReason = await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="إلغاء الوصل").disabled');
  await id('cr', 'أُدخل لطالب آخر'); await sleep(150); await click('إلغاء الوصل'); await sleep(1000);
  C.registerAfterCancel = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.innerText.replace(/\\s+/g," "))'); await shot('05-register.png');

  // arrears + export
  await tab('المتأخرات'); await sleep(1200); C.arrearsRows = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.innerText.replace(/\\s+/g," "))'); C.arrearsTotal = await q('.total-pill'); await shot('06-arrears.png');
  await click('تصدير Excel'); await sleep(1500); C.exportFiles = fs.readdirSync(path.join(base, 'exports')); C.exportNote = await q('.banner.info');

  // lock / unlock
  await click('قفل القسم'); await sleep(900); C.lockedTitle = await q('.gate h2');
  await id('fp', 'كلمة-خاطئة'); await click('فتح'); await sleep(900); C.wrongUnlock = await q('.gate .banner'); await shot('07-gate-locked.png');
  await id('fp', 'صندوق-2026'); await click('فتح'); await sleep(1500); C.unlocked = await q('.tabs');
  C.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

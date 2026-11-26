// End-to-end smoke test on the BUILT app: wizard -> import a messy Excel file -> export Excel/XML -> print sheet.
// Needs: node scripts/make-sample-xlsx.mjs out/import/sample.xlsx first. Results: out/import/report.json + screenshots.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'out', 'import'); fs.rmSync(path.join(base, 'userdata'), { recursive: true, force: true }); fs.rmSync(path.join(base, 'exports'), { recursive: true, force: true }); fs.rmSync(path.join(base, 'backups'), { recursive: true, force: true });
fs.mkdirSync(path.join(base, 'exports'), { recursive: true });
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups');
process.env.MISHKAT_TEST_IMPORT_FILE = path.join(base, 'sample.xlsx');
process.env.MISHKAT_TEST_EXPORT_DIR = path.join(base, 'exports');
const report = { checks: {} }; const C = report.checks; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 170000);
require('../dist/main.cjs');
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (n) => { wc.invalidate(); await sleep(400); fs.writeFileSync(path.join(base, n), (await wc.capturePage()).toPNG()); };
  const setv = (id, v) => js(`(function(){const el=document.getElementById(${JSON.stringify(id)});if(!el)return false;const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);
  const click = (text) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const clickStarts = (text) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const nav = (t) => js(`[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()===${JSON.stringify(t)}).click()`);
  const q = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);

  // ---- wizard (association name must come prefilled) ----
  await click('ابدؤوا'); await sleep(300);
  await setv('gn', 'علي'); await setv('fn', 'الجزائري'); await setv('un', 'ali.director'); await setv('pw', 'عبارة سر طويلة 2026'); await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await setv('k1', key[0]); await setv('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300);
  C.associationPrefill = await js('document.getElementById("an").value'); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await setv('yn', '2026-2027'); await setv('ys', '2026-09-01'); await setv('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000);
  C.sidebarAssociation = await q('.brand-assoc'); await shot('01-home-empty.png');
  C.homeButtons = await js('[...document.querySelectorAll(".empty button")].map(b=>b.textContent)');

  // ---- import ----
  await clickStarts('استيراد من Excel'); await sleep(600); C.importTitle = await q('.topbar h1');
  await click('اختيار ملف'); await sleep(1500);
  C.fileLine = await q('.file-line');
  C.mappedColumns = await js('[...document.querySelectorAll("table.map tbody tr")].map(r=>[r.querySelector("th").childNodes[0].textContent, r.querySelector("select").selectedOptions[0].textContent])');
  await sleep(800); C.summary = await q('.sum'); C.banner = await q('.step-box .banner.warn'); await shot('02-import-preview.png');
  C.previewFirstRows = await js('[...document.querySelectorAll("table.grid tbody tr")].slice(0,8).map(r=>r.innerText.replace(/\\s+/g," "))');
  C.commitButtonLabel = await js('[...document.querySelectorAll(".row-actions .btn")].map(b=>b.textContent.trim())');
  C.errorFileClicked = await click('تنزيل ملف الأخطاء'); await sleep(1200);
  C.exportsAfterErrors = fs.readdirSync(path.join(base, 'exports'));
  await js('document.querySelector(".row-actions .btn.primary").click()'); await sleep(400); await shot('03-import-confirm.png');
  C.confirmText = await q('.confirm');
  await js('[...document.querySelectorAll(".confirm .btn.primary")][0].click()'); await sleep(4500);
  C.resultTitle = await q('.empty h2'); C.resultText = await q('.empty p'); await shot('04-import-done.png');
  C.backupFiles = fs.readdirSync(path.join(base, 'backups'));

  // ---- students list, export, print ----
  await click('عرض الطلاب'); await sleep(1200);
  C.listFooter = await q('.grid-foot'); await shot('05-students.png');
  await clickStarts('تصدير Excel'); await sleep(1500); await clickStarts('تصدير XML'); await sleep(1500);
  C.exportFiles = fs.readdirSync(path.join(base, 'exports'));
  await js('(() => { window.print = () => { window.__printLen = document.querySelector(".print-sheet")?.innerText.length ?? -1; window.__printHeader = document.querySelector(".print-sheet h1")?.textContent; }; return true; })()');
  await clickStarts('طباعة'); await sleep(1500);
  C.printed = await js('({len: window.__printLen, header: window.__printHeader})');
  await nav('الرئيسية'); await sleep(1500); await shot('06-home.png'); C.homeLedger = await q('.ledger'); C.homeActions = await js('[...document.querySelectorAll(".actions b")].map(b=>b.textContent)');
  C.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

// Smoke test on the BUILT app: settings (association, branches, login password) and backups (list, now, restore with re-authentication).
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'out', 'settings');
for (const d of ['userdata', 'backups']) fs.rmSync(path.join(base, d), { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups'); process.env.MISHKAT_TEST_NO_RESTART = '1';
const report = { checks: {} }; const C = report.checks; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 170000);
require('../dist/main.cjs');
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (n) => { wc.invalidate(); await sleep(450); fs.writeFileSync(path.join(base, n), (await wc.capturePage()).toPNG()); };
  const setv = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);
  const click = (text) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const nav = (t) => js(`[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()===${JSON.stringify(t)}).click()`);
  const q = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const id = (i, v) => setv('#' + i, v);
  const PW = 'عبارة سر طويلة 2026';

  await click('ابدؤوا'); await sleep(300); await id('un', 'user1'); await id('pw', PW); await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await id('k1', key[0]); await id('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await id('yn', '2026-2027'); await id('ys', '2026-09-01'); await id('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000);
  C.navItems = await js('[...document.querySelectorAll(".nav a, .nav span")].map(e=>e.textContent.trim().replace(/قريباً$/,"")+(e.tagName==="SPAN"?" (soon)":""))');

  // settings
  await nav('الإعدادات'); await sleep(900); C.settingsSections = await js('[...document.querySelectorAll(".settings h2")].map(h=>h.textContent)'); await shot('01-settings.png');
  await id('an', 'جمعية علماء المسلمين في سيدي عون'); await id('aa', 'سيدي عون'); await sleep(150); await click('حفظ'); await sleep(1500);
  C.associationSaved = await q('.settings .banner'); C.sidebarName = await q('.brand-assoc');
  await setv('input[aria-label="اسم فرع الرجال"]', 'فرع الذكور'); await sleep(200); await click('تغيير الاسم'); await sleep(1200); C.branchRenamed = await q('.settings .banner');
  C.branchesAfter = await js('[...document.querySelectorAll(".settings table tbody tr")].map(r=>r.querySelector("input").value+" | "+[...r.querySelectorAll("td.num")].map(t=>t.textContent).join("/"))');
  await id('nb', 'فرع الأطفال'); await sleep(150); await click('إضافة فرع'); await sleep(1200); C.branchCount = await js('document.querySelectorAll(".settings table tbody tr").length');
  await id('nb', 'فرع النساء'); await sleep(150); await click('إضافة فرع'); await sleep(800); C.duplicateBranch = await q('.settings .banner');
  await id('op', 'كلمة-خاطئة-1'); await id('np', 'كلمة جديدة طويلة 2027'); await id('np2', 'كلمة جديدة طويلة 2027'); await sleep(150); await click('تغيير كلمة المرور'); await sleep(1500); C.wrongOldPassword = await q('.settings .banner');
  await id('op', PW); await id('np', 'قصيرة'); await id('np2', 'قصيرة'); await sleep(150); await click('تغيير كلمة المرور'); await sleep(1500); C.weakNewPassword = await q('.settings .banner');
  await id('op', PW); await id('np', 'كلمة جديدة طويلة 2027'); await id('np2', 'كلمة جديدة طويلة 2027'); await sleep(150); await click('تغيير كلمة المرور'); await sleep(2000); C.passwordChanged = await q('.settings .banner');

  // backups
  await nav('النسخ الاحتياطي'); await sleep(1200); C.backupStatus = await q('.backups .step-box'); C.filesBefore = await js('document.querySelectorAll(".backups table tbody tr").length'); await shot('02-backups.png');
  await js('[...document.querySelectorAll(".backups .row-actions button")].find(b=>b.textContent.trim()==="نسخ احتياطي الآن").click()'); await sleep(2500); C.nowMessage = await q('.backups .banner'); C.filesAfter = await js('document.querySelectorAll(".backups table tbody tr").length');
  await click('عرض السجل'); await sleep(600); C.history = await js('[...document.querySelectorAll(".backups table")].pop().innerText.replace(/\\s+/g," ")');
  // change something AFTER the backups, then restore the OLDEST backup (the one taken at setup)
  await nav('الإعدادات'); await sleep(700); await id('an', 'اسم تغيّر بعد النسخة'); await sleep(150); await click('حفظ'); await sleep(1200);
  await nav('النسخ الاحتياطي'); await sleep(1000);
  await js('(() => { const rows = [...document.querySelectorAll(".backups table")][0].querySelectorAll("tbody tr"); rows[rows.length - 1].querySelector("button").click(); })()'); await sleep(500); C.restoreWarning = await q('.confirm');
  C.restoreDisabledEarly = await js('[...document.querySelectorAll(".confirm button")].find(b=>b.textContent.trim()==="استعادة هذه النسخة").disabled');
  await id('rp', 'كلمة-خاطئة-1'); await id('rw', 'استعادة'); await sleep(200); await click('استعادة هذه النسخة'); await sleep(2000); C.restoreWrongPassword = await q('.backups .banner'); await shot('03-restore-confirm.png');
  await id('rp', 'كلمة جديدة طويلة 2027'); await sleep(200); await click('استعادة هذه النسخة'); await sleep(4000); C.afterRestoreScreen = await q('.empty h2'); C.afterRestoreText = (await js('document.body.innerText')).slice(0, 400); await shot('04-after-restore.png');
  const Database = require('../../../node_modules/better-sqlite3'); const dbp = path.join(base, 'userdata', 'data-dev', 'mishkat.db');
  const db = new Database(dbp, { readonly: true }); C.associationInDbAfterRestore = db.prepare('SELECT name FROM association').get().name; C.branchesInDbAfterRestore = db.prepare('SELECT name FROM branch ORDER BY position').all().map((r) => r.name); db.close();
  C.beforeRestoreCopy = fs.existsSync(path.join(base, 'backups', 'before-restore')) ? fs.readdirSync(path.join(base, 'backups', 'before-restore')).length : 0;
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

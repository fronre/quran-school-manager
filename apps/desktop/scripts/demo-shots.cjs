// Opens the DEMO data in the built app, signs in, visits every screen, saves screenshots and a report of what each screen shows.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'out'); const src = path.join(out, 'demo'); const base = path.join(out, 'demo-shots');
fs.rmSync(base, { recursive: true, force: true }); fs.mkdirSync(base, { recursive: true });
for (const f of ['Local State']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(base, f));
fs.cpSync(path.join(src, 'data'), path.join(base, 'data-dev'), { recursive: true }); fs.cpSync(path.join(src, 'backups'), path.join(base, 'backups'), { recursive: true });
fs.writeFileSync(path.join(base, 'data-dev', 'settings.json'), JSON.stringify({ backupFolder: path.join(base, 'backups'), secondFolder: null }));
app.setPath('userData', base);
const PW = 'sidi-aoun-test-2026-pass'; const report = { screens: {} }; const R = report.screens; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 200000);
require('../dist/main.cjs');
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1500);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (n) => { wc.invalidate(); await sleep(500); fs.writeFileSync(path.join(base, n + '.png'), (await wc.capturePage()).toPNG()); };
  const setv = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;const P=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(P,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return true})()`);
  const click = (t) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const nav = (t) => js(`[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()===${JSON.stringify(t)}).click()`);
  const q = (sel, n = 700) => js(`(document.querySelector(${JSON.stringify(sel)})?.innerText ?? null)`).then((t) => (t && t.length > n ? t.slice(0, n) + '…' : t));
  const rows = (sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

  // ---- sign in
  R.login = { before: await q('body', 200) }; await setv('#u', 'demo'); await setv('#p', PW); await sleep(200);
  await js(`(function(){const i=[...document.querySelectorAll('input')];const u=i.find(x=>x.type==='text'||x.autocomplete==='username');const p=i.find(x=>x.type==='password');const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};set(u,'demo');set(p,${JSON.stringify(PW)});})()`);
  await sleep(200); await js(`[...document.querySelectorAll('button')].find(b=>/دخول/.test(b.textContent))?.click()`); await sleep(3500); R.login.after = await q('.who', 100); await shot('01-home');
  R.home = { ledger: await q('.ledger'), today: await q('.home-aside', 900) };

  await nav('الطلاب'); await sleep(1200); R.students = { footer: await q('.grid-foot'), firstRows: await js('[...document.querySelectorAll(".grid tbody tr")].slice(0,4).map(r=>r.innerText.replace(/\\s+/g," "))') }; await shot('02-students');
  await js('document.querySelector(".grid tbody tr").click()'); await sleep(900); R.studentProfile = { aside: await q('.profile-aside', 500) };
  await click('الأولياء'); await sleep(600); R.studentGuardians = await q('.guardians', 500); await shot('03-student-guardians');
  await click('الحفظ'); await sleep(800); R.studentMemo = { summary: await q('.memo-sum', 300), history: await q('table[aria-label="سجل الحفظ"]', 600) }; await shot('04-student-memo');

  await nav('المعلمون'); await sleep(1000); R.teachers = { footer: await q('.grid-foot'), rows: await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.innerText.replace(/\\s+/g," "))') };
  await nav('الأفواج'); await sleep(1000); R.groups = await js('[...document.querySelectorAll("table[aria-label=\\"قائمة الأفواج\\"] tbody tr")].map(r=>r.innerText.replace(/\\s+/g," "))'); await shot('05-groups');
  await nav('الحضور'); await sleep(1200); R.attendanceToday = await q('table[aria-label="ورقة الحضور"]', 300); await shot('06-attendance-today');
  await js(`(function(){const el=document.querySelector('input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'2026-11-17');el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(900);
  R.attendancePastDay = await q('table[aria-label="ورقة الحضور"]', 500); R.attendancePastFooter = await q('.grid-foot'); await shot('07-attendance-past');
  await click('السجل'); await sleep(900); R.attendanceHistory = await q('table[aria-label="حضور الطلاب"]', 500);

  await nav('الحفظ والتقييم'); await sleep(1200); R.memoGroup = await q('table[aria-label="تقدم الحفظ"]', 700); await shot('08-memo-group');
  await nav('التقارير'); await sleep(1200); R.reportAttendance = { table: await q('table[aria-label="تقرير الحضور"]', 500), foot: await q('.grid-foot') }; await shot('09-report-attendance');
  await click('التسجيل'); await sleep(800); R.reportEnrollment = { table: await q('table[aria-label="تقرير التسجيل"]', 900), foot: await q('.grid-foot') };
  await click('نشاط الأفواج'); await sleep(800); R.reportActivity = await q('table[aria-label="نشاط الأفواج"]', 900); await shot('10-report-activity');

  const unlock = await js(`window.mishkat.invoke('finance.unlock',{password:${JSON.stringify(PW)}})`); R.financeUnlock = unlock;
  await nav('المال'); await sleep(1500); R.finance = { page: await q('.content', 600) }; await shot('11-finance');
  R.financeData = await js(`(async()=>{const s=await window.mishkat.invoke('finance.summary',{});const a=await window.mishkat.invoke('finance.arrears',{limit:500});return {summary:s.summary,arrearsRows:a.rows?.length,arrearsTotal:a.totalAmount}})()`);

  await nav('النسخ الاحتياطي'); await sleep(1000); R.backups = { text: await q('.step-box', 600), files: await rows('table[aria-label="النسخ الاحتياطية"] tbody tr') }; await shot('12-backups');
  await nav('الإعدادات'); await sleep(1000); R.settings = await js('[...document.querySelectorAll(".step-box h2")].map(h=>h.textContent)'); await shot('13-settings');
  R.overflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

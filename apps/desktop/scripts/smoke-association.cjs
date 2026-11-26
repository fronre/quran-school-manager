// Tries the association sample file end to end on a clean profile of the BUILT app: students import, then guardians import from the same file.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'out', 'association');
for (const d of ['userdata', 'backups']) fs.rmSync(path.join(base, d), { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups');
process.env.MISHKAT_TEST_IMPORT_FILE = path.join(__dirname, '..', '..', '..', 'docs', 'samples', 'بيانات-الجمعية-تجريبي.xlsx');
const report = { steps: {} }; const R = report.steps; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 200000);
require('../dist/main.cjs');
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const setv = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const click = (t) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const id = (i, v) => setv('#' + i, v);
  await click('ابدؤوا'); await sleep(300); await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await id('k1', key[0]); await id('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await id('yn', '2026-2027'); await id('ys', '2026-09-01'); await id('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000); await id('fp', 'عبارة سر طويلة 2026'); await id('fp2', 'عبارة سر طويلة 2026'); await sleep(200); await click('حفظ ومتابعة'); await sleep(3500);
  const call = (ch, p) => js(`window.mishkat.invoke(${JSON.stringify(ch)}, ${JSON.stringify(p ?? {})})`);

  // ---- students
  const f = await call('import.pickFile', { sheetIndex: 0 }); R.pick = { rows: f.rowCount, headers: f.headers, suggestedMapping: f.mapping };
  const branches = f.branches; const opts = { mapping: f.mapping, nameOrder: 'given-first', defaultBranchId: branches[0].id, defaultStatus: 'active' };
  const prev = await call('import.preview', opts); R.studentPreview = { total: prev.total, valid: prev.valid, withIssues: prev.withIssues, issueCounts: prev.issueCounts };
  const done = await call('import.commit', { ...opts, skipInvalid: true }); R.studentCommit = done;
  R.studentsNow = await js(`(async()=>{const l=await window.mishkat.invoke('students.list',{limit:3});return {total:l.total,counts:l.counts,sample:l.rows.map(r=>[r.studentNo,r.givenName+' '+r.familyName,r.birthDate,r.branchName,r.status,r.phone])}})()`);

  // ---- guardians from the same file
  const g = await call('guardians.pickFile', { sheetIndex: 0 }); R.guardianPick = { suggestedMapping: g.mapping, fields: g.fields };
  const gp = await call('guardians.preview', { mapping: g.mapping }); R.guardianPreview = gp.ok ? { total: gp.total, valid: gp.valid, withIssues: gp.withIssues, issueCounts: gp.issueCounts, badRows: gp.rows.filter((r) => r.issues.length).map((r) => [r.row, r.guardianName, r.phone, r.issues]) } : gp;
  if (gp.ok) { const gc = await call('guardians.commit', { mapping: g.mapping, skipInvalid: true }); R.guardianCommit = gc; }
  R.guardiansSample = await js(`(async()=>{const l=await window.mishkat.invoke('students.list',{limit:6});const out=[];for(const s of l.rows){const r=await window.mishkat.invoke('guardians.list',{studentId:s.id});out.push([s.studentNo,s.givenName+' '+s.familyName,(r.rows||[]).map(x=>[x.name,x.phone,x.relation,x.isPrimary,x.whatsapp,x.siblings])])}return out})()`);
  R.guardianTotals = await js(`(async()=>{const l=await window.mishkat.invoke('students.list',{limit:500});let withG=0,total=0,shared=0;for(const s of l.rows){const r=await window.mishkat.invoke('guardians.list',{studentId:s.id});total++;if((r.rows||[]).length){withG++;if(r.rows.some(x=>x.siblings>0))shared++}}return {students:total,withGuardian:withG,withSharedGuardian:shared}})()`);
  // ---- same file again: must add nothing
  await call('guardians.pickFile', { sheetIndex: 0 }); const again = await call('guardians.commit', { mapping: g.mapping, skipInvalid: true }); R.guardianSecondRun = again;
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

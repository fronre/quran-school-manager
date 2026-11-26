// End-to-end smoke test of the first-run wizard on the BUILT app, with real Windows DPAPI (safeStorage).
// Phase 1: run the whole wizard. Phase 2 (separate process, same data): restart, log in, take another backup.
// Usage: MISHKAT_SMOKE_PHASE=1 npx electron scripts/smoke-wizard.cjs ; then MISHKAT_SMOKE_PHASE=2 ...
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const phase = process.env.MISHKAT_SMOKE_PHASE || '1';
const base = path.join(__dirname, '..', 'out', 'wizard');
const userData = path.join(base, 'userdata'), backups = path.join(base, 'backups'), shots = path.join(base, 'shots');
if (phase === '1') fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });
app.setPath('userData', userData);
process.env.MISHKAT_TEST_PICK_FOLDER = backups;
const reportFile = path.join(base, `report-${phase}.json`);
const report = { phase, checks: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); app.exit(2); }, 120000);
require('../dist/main.cjs');

app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (n) => fs.writeFileSync(path.join(shots, n), (await wc.capturePage()).toPNG());
  const setv = (id, v) => js(`(function(){const el=document.getElementById(${JSON.stringify(id)});if(!el)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const click = (text) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`);
  const h1 = () => js('document.querySelector("h1")?.textContent ?? document.querySelector("h2")?.textContent');

  if (phase === '1') {
    report.checks.startsInWizard = await h1(); await shot('01-welcome.png');
    await click('ابدؤوا'); await sleep(300);
    // validation: next with empty form must stay on the step and show errors
    await click('التالي'); await sleep(300);
    report.checks.emptyAccountStays = await h1(); report.checks.accountErrors = await js('[...document.querySelectorAll(".field-error")].map(e=>e.textContent)'); await shot('02-account-errors.png');
    await setv('gn', 'علي'); await setv('fn', 'الجزائري'); await setv('un', 'ali.director'); await setv('pw', 'short'); await sleep(400);
    report.checks.weakPasswordMessage = await js('document.querySelector("#pw-err")?.textContent ?? null');
    await setv('pw', 'عبارة سر طويلة 2026'); await sleep(500);
    report.checks.strongPasswordAccepted = await js('!!document.querySelector(".ok-line")'); await shot('03-account-ok.png');
    await click('التالي'); await sleep(400);
    report.checks.keyStep = await h1();
    report.checks.keyText = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent).join("-")');
    report.checks.keyGroups = await js('document.querySelectorAll(".key-grid span").length'); await shot('04-key.png');
    const groups = report.checks.keyText.split('-');
    await click('التالي'); await sleep(300); report.checks.confirmStep = await h1();
    await setv('k1', 'ZZZZ'); await setv('k2', 'ZZZZ'); await sleep(150);
    await click('التالي'); await sleep(300); report.checks.associationStep = await h1();
    await click('التالي'); await sleep(300); report.checks.associationNameRequired = await js('[...document.querySelectorAll(".field-error")].map(e=>e.textContent)');
    await setv('an', 'جمعية النور القرآنية'); await setv('ad', 'الجزائر'); await setv('ac', '0550 12 34 56'); await shot('05-association.png');
    await click('التالي'); await sleep(300); report.checks.branchesStep = await h1(); report.checks.branchInputs = await js('[...document.querySelectorAll(".branch-row input")].map(i=>i.value)'); await shot('06-branches.png');
    await click('التالي'); await sleep(300); report.checks.yearStep = await h1();
    await click('التالي'); await sleep(300); report.checks.yearErrorsShown = await js('[...document.querySelectorAll(".field-error")].map(e=>e.textContent)');
    await setv('yn', '2026-2027'); await setv('ys', '2027-06-30'); await setv('ye', '2026-09-01'); await sleep(150);
    await click('التالي'); await sleep(300); report.checks.dateOrderError = await js('[...document.querySelectorAll(".field-error")].map(e=>e.textContent)');
    // a year that does not contain today (the mistake seen in a real test: 2029-06-22 .. 2030-06-22) warns and needs an explicit tick
    await setv('yn', '2029'); await setv('ys', '2029-06-22'); await setv('ye', '2030-06-22'); await sleep(150);
    report.checks.yearWarning = await js('document.querySelector(".year-warn")?.innerText ?? null');
    await click('التالي'); await sleep(300); report.checks.blockedUntilTicked = await h1();
    await js('document.querySelector(".year-ok input").click()'); await sleep(150); await shot('07b-year-warning.png');
    await click('التالي'); await sleep(300); report.checks.afterTick = await h1();
    await click('رجوع'); await sleep(300);
    await setv('yn', '2026-2027'); await setv('ys', '2026-09-01'); await setv('ye', '2027-06-30'); await sleep(150);
    report.checks.noWarningForCurrentYear = await js('document.querySelector(".year-warn") === null'); await shot('07-year.png'); await sleep(150);
    await click('التالي'); await sleep(300); report.checks.backupStep = await h1(); report.checks.folderShown = await js('document.querySelector(".path")?.textContent');
    await click('اختيار مجلد آخر'); await sleep(400); report.checks.folderAfterPick = await js('document.querySelector(".path")?.textContent'); await shot('08-backup.png');
    await click('إنهاء الإعداد'); await sleep(2500);
    report.checks.afterWrongKey = { heading: await h1(), banner: await js('document.querySelector(".banner.error")?.textContent ?? null') }; await shot('09-wrong-key.png');
    await setv('k1', groups[0].toLowerCase()); await setv('k2', groups[groups.length - 1].toLowerCase()); await sleep(200);
    await click('التالي'); await sleep(300); await click('التالي'); await sleep(200); await click('التالي'); await sleep(200); await click('التالي'); await sleep(200);
    report.checks.backOnBackupStep = await h1();
    await click('إنهاء الإعداد'); await sleep(6000);
    report.checks.afterFinishHome = await h1(); await shot('10-home-after-setup.png');
    report.checks.whoText = await js('document.querySelector(".who")?.innerText ?? null');
    report.checks.branchChips = await js('[...document.querySelectorAll(".chip")].map(c=>c.textContent)');
    report.checks.backupChip = await js('document.querySelector(".status")?.innerText ?? null');
    report.checks.backupFiles = fs.existsSync(backups) ? fs.readdirSync(backups) : [];
    const keyFile = path.join(userData, 'data-dev', 'recovery.key.bin');
    report.checks.keyFileExists = fs.existsSync(keyFile);
    if (report.checks.keyFileExists) { const raw = fs.readFileSync(keyFile); report.checks.keyFileSize = raw.length; report.checks.keyFileHasDisplayText = raw.toString('latin1').includes(groups[0]) ; }
    report.checks.dbFilePresent = fs.existsSync(path.join(userData, 'data-dev', 'mishkat.db'));
    report.checks.settingsFile = fs.existsSync(path.join(userData, 'data-dev', 'settings.json')) ? fs.readFileSync(path.join(userData, 'data-dev', 'settings.json'), 'utf8') : null;
    await js('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("تسجيل الخروج")).click()'); await sleep(600);
    report.checks.afterLogoutHasLogin = await js('!!document.getElementById("u")');
  } else {
    report.checks.startsOnLogin = await js('!!document.getElementById("u")'); await shot('11-login-after-restart.png');
    await setv('u', 'ali.director'); await setv('p', 'عبارة سر طويلة 2026'); await sleep(200);
    await click('دخول'); await sleep(3000);
    report.checks.homeAfterRestart = await h1(); report.checks.chipBefore = await js('document.querySelector(".status")?.innerText ?? null');
    const before = fs.readdirSync(backups).length;
    await sleep(20); await click('نسخ احتياطي الآن'); await sleep(5000);
    report.checks.backupCountBeforeAfter = [before, fs.readdirSync(backups).length];
    report.checks.chipAfter = await js('document.querySelector(".status")?.innerText ?? null'); await shot('12-home-after-backup.png');
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  app.exit(0);
});

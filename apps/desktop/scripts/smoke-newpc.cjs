// Smoke test on the BUILT app: moving the association to another computer (first-run restore), with real Windows protection.
// Three separate runs, each its own process:
//   MISHKAT_SMOKE_PHASE=old   -> "old computer": set up, choose a password, take a backup, copy it to a "USB stick" folder
//   MISHKAT_SMOKE_PHASE=new   -> "new computer" (other user-data folder): choose «نقل البيانات من حاسوب آخر», wrong key, then the right key
//   MISHKAT_SMOKE_PHASE=login -> "new computer" after the restart: sign in with the OLD password, check the data and a new backup
// Usage: set MISHKAT_SMOKE_PHASE=old && npx electron scripts/smoke-newpc.cjs   (then new, then login)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const phase = process.env.MISHKAT_SMOKE_PHASE || 'old';
const base = path.join(__dirname, '..', 'out', 'newpc');
const oldData = path.join(base, 'old-computer'), newData = path.join(base, 'new-computer'), usb = path.join(base, 'usb'), shots = path.join(base, 'shots');
if (phase === 'old') fs.rmSync(base, { recursive: true, force: true });
for (const d of [shots, usb]) fs.mkdirSync(d, { recursive: true });
const PW = 'عبارة سر طويلة للنقل 2026'; const ASSOC = 'جمعية تجربة النقل';
const stateFile = path.join(base, 'state.json'); const st = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
if (phase === 'old') { app.setPath('userData', oldData); process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'old-backups'); }
else {
  app.setPath('userData', newData);
  if (phase === 'new') { // the new computer already has its backup folder chosen, so the test never writes to the real Documents folder
    fs.mkdirSync(path.join(newData, 'data-dev'), { recursive: true });
    fs.writeFileSync(path.join(newData, 'data-dev', 'settings.json'), JSON.stringify({ backupFolder: path.join(base, 'new-backups') }));
    process.env.MISHKAT_TEST_RESTORE_FILE = st.usbFile; process.env.MISHKAT_TEST_NO_RESTART = '1';
  }
}
const reportFile = path.join(base, `report-${phase}.json`); const report = { phase, checks: {} }; const C = report.checks;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A correctly formed recovery key of ANOTHER association (same format and checksum as packages/db/src/recovery.ts). */
function otherValidKey() {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; const enc = (bytes) => { let bits = 0, v = 0, o = ''; for (const b of bytes) { v = (v << 8) | b; bits += 8; while (bits >= 5) { o += A[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) o += A[(v << (5 - bits)) & 31]; return o; };
  const c = require('crypto'); const k = c.randomBytes(32); const body = enc(k) + enc(c.createHash('sha256').update('mishkat-recovery-check').update(k).digest()).slice(0, 4);
  return body.match(/.{1,4}/g).join('-');
}
setTimeout(() => { report.timeout = true; fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); app.exit(2); }, 150000);
require('../dist/main.cjs');

app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1500);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (n) => { wc.invalidate(); await sleep(400); fs.writeFileSync(path.join(shots, `${phase}-${n}.png`), (await wc.capturePage()).toPNG()); };
  const setv = (id, v) => js(`(function(){const el=document.getElementById(${JSON.stringify(id)});if(!el)return false;const P=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(P,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const click = (t) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const q = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const h1 = () => js('document.querySelector("h1")?.textContent ?? null');

  if (phase === 'old') {
    C.welcome = await h1(); C.offersMove = await js('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="نقل البيانات من حاسوب آخر")'); await shot('01-welcome');
    await click('ابدؤوا'); await sleep(300); await click('التالي'); await sleep(300);
    const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
    await setv('k1', key[0]); await setv('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300);
    await setv('an', ASSOC); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
    await setv('yn', '2026-2027'); await setv('ys', '2026-09-01'); await setv('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
    await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(6000);
    await setv('fp', PW); await setv('fp2', PW); await sleep(200); await click('حفظ ومتابعة'); await sleep(2500);
    C.signedIn = await q('.brand-assoc');
    C.backupNow = await js("window.mishkat.invoke('backup.now', {})"); await sleep(500);
    const folder = path.join(base, 'old-backups'); const newest = fs.readdirSync(folder).filter((f) => f.endsWith('.mshkbk')).sort().pop();
    st.usbFile = path.join(usb, newest); fs.copyFileSync(path.join(folder, newest), st.usbFile); st.key = key.join('-'); fs.writeFileSync(stateFile, JSON.stringify(st, null, 2));
    C.copiedToUsb = newest;
  }

  if (phase === 'new') {
    C.startsInWizard = await h1();
    C.clickedMove = await click('نقل البيانات من حاسوب آخر'); await sleep(400); C.panel = await h1(); await shot('01-panel');
    C.moveDisabledBeforeFile = await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="نقل البيانات").disabled');
    await click('اختيار ملف النسخة'); await sleep(800); C.fileBox = await q('.folder-box');
    await setv('rk', 'AAAA-'.repeat(13) + 'AAAA'); await sleep(200); await click('نقل البيانات'); await sleep(1500); C.mistyped = await q('.banner.error');
    await setv('rk', otherValidKey()); await sleep(200); await click('نقل البيانات'); await sleep(1500); C.wrongKey = await q('.banner.error'); await shot('02-wrong-key');
    await setv('rk', st.key.toLowerCase().replace(/-/g, ' ')); await sleep(200); await click('نقل البيانات'); await sleep(6000);
    C.done = await h1(); C.doneText = await q('.wiz-main'); await shot('03-done');
  }

  if (phase === 'login') {
    C.loginScreen = await js('document.querySelector(".login-form h2")?.textContent ?? null'); C.noDefaultHint = await js('!document.querySelector(".login-form .banner.info")');
    await setv('u', 'admin'); await setv('p', PW); await sleep(200); await click('دخول'); await sleep(4000);
    C.association = await q('.brand-assoc'); await shot('01-home');
    const nb = path.join(base, 'new-backups'); C.backupsOnNewComputer = fs.existsSync(nb) ? fs.readdirSync(nb).filter((f) => f.endsWith('.mshkbk')).length : 0;
    C.history = await js("window.mishkat.invoke('backup.list', {}).then(r => r.history.map(h => h.kind))");
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); app.exit(0);
});

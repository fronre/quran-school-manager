// Opens the DEMO data in the built app, signs in, visits every screen, saves screenshots and a report of what each screen shows.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'out'); const src = path.join(out, 'demo'); const base = path.join(out, 'print-check');
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


  // print() is replaced: the sheet being printed is copied into a persistent node, then saved as PDF with print styles
  await js(`window.print=function(){const s=document.querySelector('.print-sheet');if(!s)return;document.querySelectorAll('.__keep').forEach(n=>n.remove());const c=s.cloneNode(true);c.classList.add('__keep');c.removeAttribute('hidden');document.body.appendChild(c);window.__printed=(window.__printed||0)+1;};0`);
  wc.debugger.attach('1.3'); const size0 = win.getSize();
  const png = async (name) => { await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' }); win.setSize(900, 1300); await sleep(700); wc.invalidate(); await sleep(400);
    fs.writeFileSync(path.join(base, name + '.png'), (await wc.capturePage()).toPNG()); await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: '' }); win.setSize(size0[0], size0[1]); await sleep(300); };
  const pdf = async (name) => { await sleep(900); const has = await js('!!document.querySelector(".__keep")'); if (!has) { report[name] = 'no sheet'; return; }
    const b = await wc.printToPDF({ preferCSSPageSize: true, printBackground: true }); fs.writeFileSync(path.join(base, name + '.pdf'), b); report[name] = b.length; await png(name); await js('document.querySelectorAll(".__keep").forEach(n=>n.remove())'); };
  await nav('الطلاب'); await sleep(1200); const btnTxt = await js('[...document.querySelectorAll("button")].map(b=>b.textContent.trim()).filter(t=>/طباعة|تصدير/.test(t))'); report.studentBtns = btnTxt;
  await js('[...document.querySelectorAll("button")].find(b=>/^طباعة/.test(b.textContent.trim()))?.click()'); await pdf('students');
  await js('document.querySelector(".grid tbody tr").click()'); await sleep(900); await click('طباعة كشف الطالب'); await pdf('student-card');
  await nav('التقارير'); await sleep(1200); await click('طباعة'); await pdf('report-attendance');
  await click('ورقة حضور للطباعة'); await sleep(500); await js('(function(){const s=document.querySelector("select");if(s&&s.options.length>1){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,s.options[1].value);s.dispatchEvent(new Event("change",{bubbles:true}))}})()'); await sleep(900); await click('طباعة'); await pdf('paper-sheet');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

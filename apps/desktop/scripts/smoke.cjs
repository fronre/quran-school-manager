// Smoke test: runs the BUILT app under Electron with a throwaway dev database, drives the UI, takes screenshots and checks hardening.
// Usage: npx electron scripts/smoke.cjs   (after npm run build). Results: out/smoke/report.json + PNGs.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const out = path.join(__dirname, '..', 'out', 'smoke');
fs.mkdirSync(out, { recursive: true });
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'mishkat-smoke-'));
app.setPath('userData', tmpData);
process.env.MISHKAT_DEV_SEED = '1';
const report = { checks: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 90000);

require('../dist/main.cjs');

app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents;
  await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (name) => fs.writeFileSync(path.join(out, name), (await wc.capturePage()).toPNG());
  win.setSize(1440, 900); await sleep(400);
  await shot('1-login.png');

  report.checks.noNodeInPage = await js('typeof require === "undefined" && typeof process === "undefined" && typeof module === "undefined"');
  report.checks.bridgeKeys = await js('Object.keys(window.mishkat).join(",")');
  report.checks.unknownChannelRejected = await js('window.mishkat.invoke("fs.readFile", {path:"C:/x"}).then(()=>false, e=>String(e.message))');
  report.checks.badPayloadRejected = JSON.stringify(await js('window.mishkat.invoke("auth.login", {username:1, extra:true})'));
  report.checks.networkBlockedByCsp = await js('fetch("https://example.com").then(()=>"REACHED", ()=>"blocked")');
  report.checks.inlineScriptBlocked = await js('(()=>{try{return String(eval("1+1"))}catch(e){return "blocked"}})()');
  report.checks.dirRtl = await js('document.documentElement.dir + "/" + document.documentElement.lang');
  report.checks.fontLoaded = await js('document.fonts.ready.then(()=>[...document.fonts].filter(f=>f.status==="loaded").map(f=>f.family+" "+f.weight).join("; "))');

  const fill = `(function(){
    const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
    set('u','dev.director'); set('p','WRONG-password-xx');
  })()`;
  await js(fill); await sleep(150);
  await js('document.querySelector("button[type=submit]").click()'); await sleep(2500);
  report.checks.wrongPasswordMessage = await js('document.querySelector("[role=alert]")?.textContent ?? null');
  await shot('2-login-error.png');

  await js(`(function(){const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};set('u','dev.director');set('p','dev-only-password-123');})()`);
  await sleep(150);
  await js('document.querySelector("button[type=submit]").click()'); await sleep(2500);
  report.checks.loggedInText = await js('document.querySelector(".who")?.innerText ?? null');
  report.checks.branches = await js('[...document.querySelectorAll(".chip")].map(c=>c.textContent)');
  report.checks.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  await shot('3-shell.png');

  await js('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("تسجيل الخروج")).click()'); await sleep(800);
  report.checks.afterLogoutShowsLogin = await js('!!document.getElementById("u")');
  report.checks.sessionClearedInMain = JSON.stringify(await js('window.mishkat.invoke("session.current")'));

  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  app.exit(0);
});

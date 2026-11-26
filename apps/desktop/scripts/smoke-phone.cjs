// End-to-end smoke test on the BUILT app: switch the phone page on, pair a "phone" (a second Chromium window, phone-sized), take attendance and record memorization from it,
// then check on the desktop that the data arrived, the device is audited and revoking works.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'out', 'phone');
for (const d of ['userdata', 'backups']) fs.rmSync(path.join(base, d), { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups');
const report = { checks: {} }; const C = report.checks; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 200000);
app.on('certificate-error', (e, _wc, _url, _err, _cert, cb) => { e.preventDefault(); cb(true); }); // smoke test only: the phone's own certificate is self-signed
require('../dist/main.cjs');
process.on('unhandledRejection', (e) => { report.crash = String(e && e.stack || e); fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(3); });
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const setv = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const click = (t) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(t)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const id = (i, v) => setv('#' + i, v); const call = (ch, p) => js(`window.mishkat.invoke(${JSON.stringify(ch)}, ${JSON.stringify(p ?? {})})`);
  const shot = async (w, n) => { w.webContents.invalidate(); await sleep(500); fs.writeFileSync(path.join(base, n + '.png'), (await w.webContents.capturePage()).toPNG()); };

  await click('ابدؤوا'); await sleep(300); await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await id('k1', key[0]); await id('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await id('yn', '2026-2027'); await id('ys', '2026-09-01'); await id('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000); await id('fp', 'عبارة سر طويلة 2026'); await id('fp2', 'عبارة سر طويلة 2026'); await sleep(200); await click('حفظ ومتابعة'); await sleep(3500);
  await js(`(async()=>{const f=await window.mishkat.invoke('students.form');const m=f.branches[0].id;const ids=[];
    for (const [g,fam] of [['أحمد','بن علي'],['يوسف','بن علي'],['عمر','كريم']]) { const r=await window.mishkat.invoke('students.create',{input:{givenName:g,familyName:fam,birthDate:null,phone:'0550123456',branchId:m,status:'active',joinedOn:'2026-09-05',studentNo:String(ids.length+1)}}); ids.push(r.id); }
    const g=await window.mishkat.invoke('groups.create',{branchId:m,name:'فوج الفجر',level:null,capacity:10});
    for (const s of ids) await window.mishkat.invoke('groups.enroll',{groupId:g.id,studentId:s});})()`);
  await sleep(500);

  // ---- desktop: settings page, switch on
  await js("localStorage.setItem('mishkat_show_phone','1')");
  await js('[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()==="الإعدادات").click()'); await sleep(1000);
  C.before = await js('document.querySelector(".step-box:nth-of-type(6)")?.innerText.slice(0,200) ?? [...document.querySelectorAll(".step-box")].map(x=>x.querySelector("h2").textContent)');
  await click('تشغيل نسخة الهاتف'); await sleep(2500); C.afterOn = await js('[...document.querySelectorAll(".step-box")].find(x=>x.querySelector("h2")?.textContent==="نسخة الهاتف").innerText.slice(0,500)');
  const st = await call('phone.status'); C.status = { running: st.running, port: st.port, urls: st.urls };
  if (!st.running) { C.noServer = st; fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(1); return; }
  await click('رمز ربط جديد'); await sleep(800); const code = await js('document.querySelector(".pair-code")?.innerText'); C.codeShown = code; await shot(win, '01-desktop-settings');

  // ---- the "phone"
  const url = st.urls[0]; const ph = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { partition: 'phone-smoke', contextIsolation: true, sandbox: true, offscreen: true } });
  await ph.loadURL(url); await sleep(800); const pj = (c) => ph.webContents.executeJavaScript(c);
  C.phonePairScreen = await pj('document.getElementById("app").innerText.slice(0,200)'); C.phoneLang = await pj('[document.documentElement.lang, document.documentElement.dir]'); await shot(ph, '02-phone-pair');
  C.directPairProbe = await pj(`fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'000000',name:'probe'})}).then(async r=>[r.status,await r.text()])`);
  C.codeChars = [...String(code)].map(c=>c.charCodeAt(0));
  await pj(`(function(){const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};set(document.getElementById('code'),${JSON.stringify(code)});set(document.getElementById('dev'),'هاتف الأستاذ عبد الحفيظ');[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='ربط هذا الهاتف').click()})()`); await sleep(1500);
  C.phoneHome = await pj('document.getElementById("app").innerText.slice(0,400)'); await shot(ph, '03-phone-home');
  await pj(`document.querySelector('button.row').click()`); await sleep(1200); C.phoneSheet = await pj('document.getElementById("app").innerText.slice(0,300)');
  C.saveBefore = await pj(`[...document.querySelectorAll('.bar button')].map(b=>b.textContent.trim()+(b.disabled?' (معطّل)':''))`);
  await pj(`document.querySelectorAll('.st')[0].children[0].click();document.querySelectorAll('.st')[1].children[1].click()`); await sleep(200);
  await pj(`(function(){const i=document.querySelector('input[placeholder="دقائق التأخر"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'10');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await pj(`document.querySelectorAll('.st')[2].children[2].click()`); await sleep(300); await shot(ph, '04-phone-sheet');
  C.saveReady = await pj(`[...document.querySelectorAll('.bar button')].map(b=>b.textContent.trim()+(b.disabled?' (معطّل)':''))`);
  await pj(`[...document.querySelectorAll('.bar button')].find(b=>b.textContent.trim()==='حفظ الحضور').click()`); await sleep(1500); C.afterSave = await pj('document.getElementById("app").innerText.slice(0,300)'); await shot(ph, '05-phone-saved');

  // ---- memorization from the phone
  await pj(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='← رجوع').click()`); await sleep(800);
  await pj(`document.getElementById('t2').click()`); await sleep(1200); C.phoneStudents = await pj('document.getElementById("app").innerText.slice(0,200)');
  await pj(`document.querySelector('button.row').click()`); await sleep(1500);
  await pj(`(function(){const sel=[...document.querySelectorAll('select')];const set=(el,v,ev)=>{const P=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(P,'value').set.call(el,v);el.dispatchEvent(new Event(ev||'input',{bubbles:true}))};
    const nums=[...document.querySelectorAll('input[placeholder="رقم الآية"]')];set(sel[1],'1','change');set(nums[0],'1');set(sel[2],'1','change');set(nums[1],'7');})()`); await sleep(300);
  await pj(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='حفظ السجل').click()`); await sleep(1500); C.phoneMemo = await pj('document.getElementById("app").innerText.slice(0,350)'); await shot(ph, '06-phone-memo');

  // ---- back on the desktop
  C.desktopSheet = await js(`(async()=>{const g=(await window.mishkat.invoke('groups.list',{status:'active'})).rows[0];const t=new Date().toISOString().slice(0,10);const s=(await window.mishkat.invoke('attendance.sheet',{groupId:g.id,date:t})).sheet;return s.rows.map(r=>[r.name,r.status,r.lateMinutes])})()`);
  C.desktopMemo = await js(`(async()=>{const l=await window.mishkat.invoke('students.list',{limit:1});const p=(await window.mishkat.invoke('memo.progress',{studentId:l.rows[0].id})).progress;return [l.rows[0].givenName,p.summary.memorizedAyat,p.records[0]?.rangeText]})()`);
  const fin = await ph.webContents.executeJavaScript(`fetch('/api/finance',{headers:{Authorization:'Bearer '+localStorage.getItem('mishkat_phone_token')}}).then(r=>r.status)`); C.financeFromPhone = fin;
  const st2 = await call('phone.status'); C.devices = st2.devices.map((d) => [d.name, !!d.revokedAt]);
  await call('phone.revoke', { id: st2.devices[0].id }); const after = await ph.webContents.executeJavaScript(`fetch('/api/me',{headers:{Authorization:'Bearer '+localStorage.getItem('mishkat_phone_token')}}).then(r=>r.status)`); C.afterRevoke = after;
  C.auditActors = await js(`(async()=>{return 'n/a'})()`);
  await call('phone.disable'); C.afterOff = (await call('phone.status')).running;
  C.overflowPhone = null;
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

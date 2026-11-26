// Smoke test of the Students screen on the BUILT app (dev seed, throwaway database).
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const out = path.join(__dirname, '..', 'out', 'students'); fs.mkdirSync(out, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mishkat-stu-')));
process.env.MISHKAT_DEV_SEED = '1';
const report = { checks: {} }; const C = report.checks;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report.timeout = true; fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); app.exit(2); }, 150000);
require('../dist/main.cjs');
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); await sleep(1200);
  const js = (c) => wc.executeJavaScript(c);
  const shot = async (n) => { wc.invalidate(); await sleep(350); fs.writeFileSync(path.join(out, n), (await wc.capturePage()).toPNG()); };
  const setv = (id, v) => js(`(function(){const el=document.getElementById(${JSON.stringify(id)});if(!el)return false;const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);
  const click = (text) => js(`(function(){const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.disabled);if(!b)return false;b.click();return true})()`);
  const rows = () => js('[...document.querySelectorAll("table.grid tbody tr")].map(r=>[...r.children].map(c=>c.textContent.trim()).join(" | "))');

  await setv('u', 'dev.director'); await setv('p', 'dev-only-password-123'); await sleep(150); await click('دخول'); await sleep(2500);
  await click('الطلاب'); await js('[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()==="الطلاب").click()'); await sleep(800);
  C.emptyState = await js('document.querySelector(".empty h2")?.textContent'); await shot('01-empty.png');

  await click('إضافة طالب'); await sleep(600);
  C.panelTitle = await js('document.querySelector(".panel h2")?.textContent'); C.suggestedNo = await js('document.getElementById("sn").value');
  await click('إضافة الطالب'); await sleep(300); C.requiredErrors = await js('[...document.querySelectorAll(".panel .field-error")].map(e=>e.textContent)'); await shot('02-form-errors.png');
  await setv('sg', 'أَحْمَدُ'); await setv('sf', 'بن عمر'); await setv('sd', '2015-03-10'); await setv('sp', '0550 12 34 56'); await sleep(200);
  await click('إضافة الطالب'); await sleep(800);
  C.toast1 = await js('document.querySelector(".toast")?.textContent'); C.afterFirst = await rows(); await shot('03-one-student.png');

  await click('إضافة طالب'); await sleep(600);
  await setv('sg', 'احمد'); await setv('sf', 'بن عُمَر'); await setv('sd', '2015-03-10'); await sleep(150); C.secondNo = await js('document.getElementById("sn").value');
  await click('إضافة الطالب'); await sleep(800);
  C.duplicateBanner = await js('document.querySelector(".panel .banner")?.innerText ?? null'); await shot('04-duplicate-warning.png');
  await click('تعديل البيانات'); await sleep(200); await setv('sd', '2014-01-01'); await sleep(150);
  await click('إضافة الطالب'); await sleep(800);
  C.afterSecondDifferentBirth = (await rows()).length;

  // bulk-load 120 more through the real IPC to check paging and search
  const bulk = await js(`(async()=>{const f=await window.mishkat.invoke('students.form');const br=f.branches;let ok=0;
    const names=['محمد','أحمد','يوسف','إبراهيم','فاطمة','عائشة','خديجة','مريم'];const fam=['بوعلام','الجزائري','بلقاسم','مسعودي','حمداني'];
    for(let i=0;i<120;i++){const r=await window.mishkat.invoke('students.create',{input:{givenName:names[i%8],familyName:fam[i%5]+' '+i,birthDate:null,phone:null,branchId:br[i%2].id,status:i%17===0?'suspended':'active',joinedOn:null,studentNo:String(100+i)}});if(r.ok)ok++}
    return ok})()`);
  C.bulkCreated = bulk;
  await js('[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()==="الرئيسية").click()'); await sleep(300);
  await js('[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()==="الطلاب").click()'); await sleep(1000);
  C.footer = await js('document.querySelector(".grid-foot")?.innerText'); C.firstPageRows = (await rows()).length; await shot('05-list-page1.png');
  await click('التالي'); await sleep(700); C.footerPage2 = await js('document.querySelector(".grid-foot")?.innerText'); await click('السابق'); await sleep(500);

  await setv('x', ''); await js(`(function(){const el=document.querySelector('.search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'ابراهيم');el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(900);
  C.searchHamza = (await rows()).length; C.searchSample = (await rows())[0];
  await js(`(function(){const el=document.querySelector('.search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'zzzz');el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(900);
  C.noResults = await js('document.querySelector(".empty h2")?.textContent'); await shot('06-no-results.png');
  await click('مسح التصفية'); await sleep(900);

  await js('[...document.querySelectorAll(".seg")][0].querySelectorAll("button")[1].click()'); await sleep(900); C.branchFilterRows = (await rows()).length; C.branchFooter = await js('document.querySelector(".grid-foot")?.innerText');
  await js('[...document.querySelectorAll(".seg")][0].querySelectorAll("button")[0].click()'); await sleep(500);
  await setv('x', ''); await js(`document.querySelector('select[aria-label="الحالة"]').value='suspended'`);
  await js(`(function(){const el=document.querySelector('select[aria-label="الحالة"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'suspended');el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(900);
  C.suspendedRows = await js('document.querySelector(".grid-foot")?.innerText');
  await js(`(function(){const el=document.querySelector('select[aria-label="الحالة"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'');el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(700);

  await js('document.querySelector("table.grid tbody tr").click()'); await sleep(600); C.editTitle = await js('document.querySelector(".panel h2")?.textContent'); await shot('07-edit-panel.png');
  await setv('sp', '0661 00 00 00'); await click('حفظ التعديلات'); await sleep(900); C.toast2 = await js('document.querySelector(".toast")?.textContent');
  await js('document.querySelector("table.grid tbody tr").click()'); await sleep(600);
  await click('أرشفة'); await sleep(300); await click('أرشفة الطالب'); await sleep(200); C.archiveNeedsReason = await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="أرشفة الطالب")?.disabled');
  await setv('ar', 'انتقل إلى مدينة أخرى'); await sleep(150); await shot('08-archive-confirm.png'); await click('أرشفة الطالب'); await sleep(900);
  C.toast3 = await js('document.querySelector(".toast")?.textContent'); C.countsAfterArchive = await js('[...document.querySelectorAll(".seg")][1].innerText');
  await js('[...document.querySelectorAll(".seg")][1].querySelectorAll("button")[1].click()'); await sleep(900); C.archiveRows = await rows(); await shot('09-archive-view.png');
  await js('document.querySelector("table.grid tbody tr").click()'); await sleep(500); C.archivedPanelReadOnly = await js('document.getElementById("sg").disabled'); C.archivedBanner = await js('document.querySelector(".panel .banner")?.textContent');
  C.restoreClicked = await click('استعادة الطالب'); await sleep(900); C.toast4 = (await js('document.querySelector(".toast")?.textContent')) ?? null; C.countsAfterRestore = await js('[...document.querySelectorAll(".seg")][1].innerText'); await shot('10-after-restore.png');
  C.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

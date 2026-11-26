// Smoke test on the BUILT app: shared login wording, teachers page (men/women), profile pages with photos, edit, archive and activity.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const base = path.join(__dirname, '..', 'out', 'profiles');
for (const d of ['userdata', 'backups']) fs.rmSync(path.join(base, d), { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });

// a 600x400 test picture (gradient) written as a PNG without any library
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 6 + (x * 200) / w; raw[o + 1] = 78 + (y * 120) / h; raw[o + 2] = 59 + ((x + y) * 100) / (w + h); } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const photoFile = path.join(base, 'photo.png'); fs.writeFileSync(photoFile, png(600, 400));
app.setPath('userData', path.join(base, 'userdata'));
process.env.MISHKAT_TEST_PICK_FOLDER = path.join(base, 'backups'); process.env.MISHKAT_TEST_PHOTO_FILE = photoFile;
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
  const tab = (t) => js(`(function(){const b=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()===${JSON.stringify(t)});if(!b)return false;b.click();return true})()`);
  const nav = (t) => js(`[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()===${JSON.stringify(t)}).click()`);
  const q = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const id = (i, v) => setv('#' + i, v);

  // wizard: only the login account is asked for (no names, no "manager")
  await click('ابدؤوا'); await sleep(300);
  C.accountStepTitle = await q('h1'); C.accountStepFields = await js('[...document.querySelectorAll(".wiz-main label")].map(l=>l.textContent)'); C.stepsList = await js('[...document.querySelectorAll(".steps li")].map(l=>l.textContent.replace(/^\\d+/,""))');
  await sleep(500); await click('التالي'); await sleep(400);
  const key = await js('[...document.querySelectorAll(".key-grid span")].map(s=>s.textContent)'); await click('التالي'); await sleep(300);
  await id('k1', key[0]); await id('k2', key[key.length - 1]); await sleep(150); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300); await click('التالي'); await sleep(300);
  await id('yn', '2026-2027'); await id('ys', '2026-09-01'); await id('ye', '2027-06-30'); await sleep(150); await click('التالي'); await sleep(300);
  await click('اختيار مجلد آخر'); await sleep(300); await click('إنهاء الإعداد'); await sleep(7000); await id('fp', 'عبارة سر طويلة 2026'); await id('fp2', 'عبارة سر طويلة 2026'); await sleep(200); await click('حفظ ومتابعة'); await sleep(3500);
  C.sidebarUser = await q('.who'); C.noManagerWord = !(await js('document.body.innerText.includes("المدير")')); await shot('01-home.png');

  // teachers page: empty state, add a teacher, profile
  await nav('المعلمون'); await sleep(800); C.teachersEmpty = await q('.empty h2');
  await click('إضافة معلم'); await sleep(500); C.newTitle = await q('.profile-head h2');
  await click('إضافة المعلم'); await sleep(300); C.requiredErrors = await js('[...document.querySelectorAll(".field-error")].map(e=>e.textContent)');
  await setv('#sg', 'عبد الرحمن'); await setv('#sf', 'بوعلام'); await setv('#sh', '0550 12 34 56'); await setv('#sd', '1985-04-12'); await sleep(200); await click('إضافة المعلم'); await sleep(1500);
  C.profileHeadline = await q('.profile-head h2'); C.profileFacts = await q('.facts'); await shot('02-teacher-profile.png');

  // photo with consent
  await click('إضافة صورة'); await sleep(300); C.consentPrompt = await q('.photo-consent');
  C.pickDisabledWithoutConsent = await js('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="اختيار صورة").disabled');
  await setv('.photo-consent input', 'صاحب الصورة'); await sleep(200); await click('اختيار صورة'); await sleep(2500);
  C.photoShown = await js('(() => { const i = document.querySelector(".photo-frame img"); return i ? { w: i.naturalWidth, h: i.naturalHeight, src: i.src.slice(0, 30) } : null })()'); await shot('03-teacher-photo.png');
  const dbCheck = await js('window.mishkat.invoke("staff.list", {}).then(r=>r.rows.map(x=>({hasPhoto:x.hasPhoto})))'); C.listHasPhoto = dbCheck;

  // edit + activity
  await click('تعديل البيانات'); await sleep(300); await setv('#sh', '0661 00 00 00'); await sleep(150); await click('حفظ التعديلات'); await sleep(1500);
  C.afterEditDisabled = await js('document.getElementById("sh").disabled'); await tab('السجل'); await sleep(900); C.activity = await js('[...document.querySelectorAll(".timeline li")].map(l=>l.innerText.replace(/\\s+/g," "))'); await shot('04-activity.png');

  // list with avatar, men/women pages
  await js('[...document.querySelectorAll(".back")][0].click()'); await sleep(900); C.listRows = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.innerText.replace(/\\s+/g," "))'); C.listAvatarImg = await js('document.querySelectorAll(".grid tbody img.avatar").length');
  await js(`window.mishkat.invoke('staff.form').then(f=>window.mishkat.invoke('staff.create',{input:{givenName:'فاطمة',familyName:'بلقاسم',birthDate:null,phone:null,branchId:f.branches[1].id,position:'teacher',kind:'volunteer'}}))`); await sleep(500);
  await nav('الطلاب'); await sleep(300); await nav('المعلمون'); await sleep(1000); C.bothBranches = await js('document.querySelectorAll(".grid tbody tr").length');
  await js('[...document.querySelectorAll(".seg")][0].querySelectorAll("button")[2].click()'); await sleep(900); C.womenOnly = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.innerText.replace(/\\s+/g," "))');
  await js('[...document.querySelectorAll(".seg")][0].querySelectorAll("button")[1].click()'); await sleep(900); C.menOnly = await js('[...document.querySelectorAll(".grid tbody tr")].map(r=>r.innerText.replace(/\\s+/g," "))'); await shot('05-teachers-men.png');

  // student profile with photo, edit and archive
  await js(`window.mishkat.invoke('students.form').then(f=>window.mishkat.invoke('students.create',{input:{givenName:'أحمد',familyName:'بن عمر',birthDate:'2015-03-10',phone:null,branchId:f.branches[0].id,status:'active',joinedOn:'2026-09-05',studentNo:'1'}}))`); await sleep(500);
  await nav('الطلاب'); await sleep(1200); await js('document.querySelector(".grid tbody tr").click()'); await sleep(1200);
  C.studentProfile = await q('.profile-head h2'); C.studentTabs = await q('.tabs');
  await click('إضافة صورة'); await sleep(300); await setv('.photo-consent input', 'ولي الأمر'); await sleep(150); await click('اختيار صورة'); await sleep(2500); C.studentPhoto = await js('!!document.querySelector(".photo-frame img")'); await shot('06-student-profile.png');
  await click('تعديل البيانات'); await sleep(300); await setv('#pp', '0770 11 22 33'); await sleep(150); await click('حفظ التعديلات'); await sleep(1500);
  await click('أرشفة'); await sleep(300); await setv('#par', 'انتقل إلى مدينة أخرى'); await sleep(150); await click('أرشفة الطالب'); await sleep(1500); C.archivedBanner = await q('.banner.info'); C.archivedBadge = await q('.profile-head .badge');
  await tab('السجل'); await sleep(900); C.studentActivity = await js('[...document.querySelectorAll(".timeline li")].map(l=>l.innerText.replace(/\\s+/g," "))'); await shot('07-student-activity.png');
  C.pageOverflowX = await js('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2)); app.exit(0);
});

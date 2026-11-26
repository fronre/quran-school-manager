// Walks the BUILT app on the DEMO data (fake people), screen by screen, saving a numbered screenshot per step plus manifest.json (chapter, caption, errors).
// Used to make the client showcase. Every step is isolated: a failing step is recorded, never hidden.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
const out = path.join(__dirname, '..', 'out'); const src = path.join(out, 'demo'); const base = path.join(out, 'showcase-run'); const shots = path.join(out, 'showcase');
fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(shots, { recursive: true, force: true }); fs.mkdirSync(base, { recursive: true }); fs.mkdirSync(shots, { recursive: true });
for (const f of ['Local State']) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(base, f));
fs.cpSync(path.join(src, 'data'), path.join(base, 'data-dev'), { recursive: true }); fs.cpSync(path.join(src, 'backups'), path.join(base, 'backups'), { recursive: true });
fs.writeFileSync(path.join(base, 'data-dev', 'settings.json'), JSON.stringify({ backupFolder: path.join(base, 'backups'), secondFolder: null }));
app.setPath('userData', base);
app.on('certificate-error', (e, _wc, _url, _err, _cert, cb) => { e.preventDefault(); cb(true); }); // only for the program's own self-signed phone page, in this script
const PW = 'sidi-aoun-test-2026-pass'; const manifest = { shots: [], errors: [] }; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = () => fs.writeFileSync(path.join(shots, 'manifest.json'), JSON.stringify(manifest, null, 2));
setTimeout(() => { manifest.timeout = true; save(); app.exit(2); }, 420000);
process.on('unhandledRejection', (e) => { manifest.errors.push('unhandled: ' + String((e && e.stack) || e)); save(); });
require('../dist/main.cjs');
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await sleep(100);
  const wc = win.webContents; await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  win.setSize(1440, 900); win.show(); await sleep(1800);
  const js = (c) => wc.executeJavaScript(c);
  let n = 0;
  const shot = async (name, chapter, caption, w = wc) => { await sleep(700); w.invalidate(); await sleep(400); const f = String(++n).padStart(2, '0') + '-' + name + '.png'; let img; for (let t = 0; t < 4 && !img; t++) { try { img = await w.capturePage(); } catch (e) { await sleep(900); w.invalidate(); } } if (!img) throw new Error('capture failed: ' + name); fs.writeFileSync(path.join(shots, f), img.toPNG()); manifest.shots.push({ file: f, chapter, caption }); save(); };
  const step = async (label, fn) => { try { await fn(); } catch (e) { manifest.errors.push(label + ': ' + String((e && e.message) || e)); save(); } };
  const setv = (sel, v) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;const P=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(P,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const click = async (t) => { const ok = await js(`(function(){const b=[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${JSON.stringify(t)}&&!x.disabled);if(!b)return false;b.click();return true})()`); if (!ok) throw new Error('button not found: ' + t); };
  const nav = async (t) => { const ok = await js(`(function(){const a=[...document.querySelectorAll(".nav a")].find(a=>a.textContent.trim()===${JSON.stringify(t)});if(!a)return false;a.click();return true})()`); if (!ok) throw new Error('nav not found: ' + t); await sleep(1100); };
  const firstRow = () => js('(function(){const r=document.querySelector(".grid tbody tr");if(!r)return false;r.click();return true})()');
  const call = (ch, p) => js(`window.mishkat.invoke(${JSON.stringify(ch)}, ${JSON.stringify(p ?? {})})`);

  // ---------- 1. login
  await step('login', async () => { await shot('login', 'الدخول', 'شاشة الدخول: الاسم والدعاء، ودخول بحساب شخصي'); });
  await step('sign-in', async () => {
    await js(`(function(){const i=[...document.querySelectorAll('input')];const u=i.find(x=>x.type==='text'||x.autocomplete==='username');const p=i.find(x=>x.type==='password');const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};set(u,'demo');set(p,${JSON.stringify(PW)})})()`);
    await sleep(200); await js(`[...document.querySelectorAll('button')].find(b=>/دخول/.test(b.textContent))?.click()`); await sleep(3800);
  });
  // logo (association emblem) on the demo copy only
  await step('logo', async () => { const f = path.join(os.homedir(), 'Desktop', 'logo-association.png'); if (fs.existsSync(f)) { const d = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); if (d.length <= 400000) { await call('settings.logoSet', { dataUrl: d }); await js('location.reload()'); await sleep(2500); } } });
  await step('re-login', async () => { const need = await js('!!document.querySelector("input[type=password]")'); if (need) { await js(`(function(){const i=[...document.querySelectorAll('input')];const u=i.find(x=>x.type==='text'||x.autocomplete==='username');const p=i.find(x=>x.type==='password');const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};set(u,'demo');set(p,${JSON.stringify(PW)})})()`); await js(`[...document.querySelectorAll('button')].find(b=>/دخول/.test(b.textContent))?.click()`); await sleep(3800); } });

  // ---------- 2. home
  await step('home', async () => { await nav('الرئيسية'); await sleep(1200); await shot('home', 'الرئيسية', 'عدد الطلاب في كل فرع، وحالة حضور أفواج اليوم'); });

  // ---------- 3. students
  await step('students', async () => { await nav('الطلاب'); await shot('students', 'الطلاب', 'قائمة الطلاب: بحث وتصفية وتصدير وطباعة'); });
  await step('students-add', async () => { await click('إضافة طالب'); await sleep(700); await shot('student-add', 'الطلاب', 'إضافة طالب جديد في ثوانٍ مع تنبيه من التكرار'); await click('إلغاء').catch(() => undefined); });
  await step('student-profile', async () => { await nav('الطلاب'); await firstRow(); await sleep(1000); await shot('student-profile', 'الطلاب', 'ملف الطالب: البيانات والفوج والحضور'); });
  await step('student-guardians', async () => { await click('الأولياء'); await sleep(700); await shot('student-guardians', 'الطلاب', 'أولياء الطالب وهواتفهم، ورسالة واتساب جاهزة، ورمز تطبيق الأولياء'); });
  await step('student-memo', async () => { await click('الحفظ'); await sleep(1500); await shot('student-memo', 'الحفظ والتقييم', 'خريطة الحفظ سورة سورة، وتسجيل حفظ جديد أو مراجعة بآية دقيقة'); });
  await step('student-log', async () => { await click('السجل'); await sleep(700); await shot('student-log', 'الطلاب', 'سجل كل تغيير على الطالب: من غيّر ومتى'); });

  // ---------- 4. teachers
  await step('teachers', async () => { await nav('المعلمون'); await shot('teachers', 'المعلمون', 'قائمة المعلمين والمتطوعين مع الفرع والوظيفة'); });
  await step('teacher-profile', async () => { await firstRow(); await sleep(1000); await shot('teacher-profile', 'المعلمون', 'ملف المعلم: أفواجه، وزر إنشاء فوج له'); });

  // ---------- 5. groups
  await step('groups', async () => { await nav('الأفواج'); await shot('groups', 'الأفواج', 'الأفواج مع معلميها وعدد طلابها وسعتها'); });
  await step('group-new', async () => { await click('إضافة فوج'); await sleep(900); await shot('group-new', 'الأفواج', 'فوج جديد: اختيار المعلم من نفس الفرع'); await click('إلغاء').catch(() => undefined); });
  await step('group-page', async () => { await js('document.querySelector(".grid tbody tr")?.click()'); await sleep(1200); await shot('group-page', 'الأفواج', 'صفحة الفوج: طلابه ومعلموه، وتسجيل الطلاب بلا فوج'); });

  // ---------- 6. attendance
  await step('attendance', async () => { await nav('الحضور'); await sleep(900); await shot('attendance-today', 'الحضور', 'ورقة حضور اليوم: حاضر/متأخر/غائب/بعذر بضغطة'); });
  await step('attendance-history', async () => { await click('السجل'); await sleep(900); await shot('attendance-history', 'الحضور', 'سجل حضور الطلاب عبر الأيام'); });

  // ---------- 7. memorization
  await step('memo-group', async () => { await nav('الحفظ والتقييم'); await sleep(1100); await shot('memo-group', 'الحفظ والتقييم', 'تقدم حفظ كل طلاب الفوج: الآيات والنسبة والسور الكاملة'); });

  // ---------- 8. reports
  await step('reports', async () => { await nav('التقارير'); await sleep(900); await shot('report-attendance', 'التقارير', 'تقرير الحضور: نسبة الحضور لكل طالب'); });
  await step('report-enroll', async () => { await click('التسجيل'); await sleep(800); await shot('report-enroll', 'التقارير', 'تقرير التسجيل: الأفواج والمعلمون والسعة'); });
  await step('report-activity', async () => { await click('نشاط الأفواج'); await sleep(800); await shot('report-activity', 'التقارير', 'نشاط الأفواج: الحصص المعقودة والتسجيلات'); });

  // ---------- 9. finance
  await step('finance', async () => { await call('finance.unlock', { password: PW }); await nav('المال'); await sleep(1300); await shot('finance', 'المال', 'الاشتراكات الشهرية والمتأخرات ووصل الاستلام'); });

  // ---------- 10. backups, accounts, settings
  await step('backups', async () => { await nav('النسخ الاحتياطي'); await sleep(1000); await shot('backups', 'الأمان والنسخ الاحتياطي', 'نسخ احتياطية مشفّرة وموثّقة، واستعادة آمنة'); });
  await step('demo-accounts', async () => { const f = await call('students.form'); const [men, women] = f.branches.map((b) => b.id);
    await call('accounts.create', { givenName: 'عبد الحفيظ', familyName: 'بوزيد', username: 'abdelhafid', role: 'branch_supervisor', branchId: men });
    await call('accounts.create', { givenName: 'خديجة', familyName: 'مداني', username: 'khadija', role: 'registrar', branchId: women });
    await call('accounts.create', { givenName: 'ياسين', familyName: 'حمادي', username: 'yassine', role: 'director', branchId: null }); });
  await step('accounts', async () => { await nav('الحسابات'); await sleep(1000); await shot('accounts', 'الحسابات', 'حساب لكل شخص: أكثر من مدير، وصلاحيات حسب الدور والفرع'); });
  await step('accounts-activity', async () => { await click('سجل النشاط'); await sleep(1000); await shot('accounts-activity', 'الحسابات', 'سجل النشاط: من فعل ماذا ومتى، لا يمكن تعديله'); });
  await step('settings', async () => { await nav('الإعدادات'); await sleep(900); await shot('settings', 'الإعدادات', 'بيانات الجمعية والشعار والفروع والعام الدراسي'); });
  await step('settings-bottom', async () => { await js('document.querySelector(".content")?.scrollTo(0, 99999); window.scrollTo(0, 99999)'); await sleep(600); await shot('settings-more', 'الإعدادات', 'الحفظ: سلّم التقييم، وتحديث البيانات، ونسخة الهاتف'); });

  // ---------- 11. printing (print media emulated, paper width)
  await step('print', async () => {
    await js(`window.print=function(){const s=document.querySelector('.print-sheet');if(!s)return;document.querySelectorAll('.__keep').forEach(n=>n.remove());const c=s.cloneNode(true);c.classList.add('__keep');document.body.appendChild(c)};0`);
    wc.debugger.attach('1.3'); const size0 = win.getSize();
    const paper = async (name, caption) => { await sleep(900); if (!(await js('!!document.querySelector(".__keep")'))) throw new Error('no sheet for ' + name);
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' }); win.setSize(900, 1300); await shot(name, 'الطباعة', caption); await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: '' }); win.setSize(size0[0], size0[1]); await sleep(400); await js('document.querySelectorAll(".__keep").forEach(n=>n.remove())'); };
    await nav('الطلاب'); await js('[...document.querySelectorAll("button")].find(b=>/^طباعة/.test(b.textContent.trim()))?.click()'); await paper('print-students', 'قائمة الطلاب مطبوعة بترويسة الجمعية وشعارها');
    await firstRow(); await sleep(900); await click('طباعة كشف الطالب'); await paper('print-student-card', 'كشف الطالب: بياناته وحضوره وخريطة حفظه على ورقة واحدة');
    await nav('التقارير'); await click('ورقة حضور للطباعة'); await sleep(500);
    await js('(function(){const s=document.querySelector("select");if(s&&s.options.length>1){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,s.options[1].value);s.dispatchEvent(new Event("change",{bubbles:true}))}})()'); await sleep(900);
    await click('طباعة'); await paper('print-paper-sheet', 'ورقة حضور فارغة لكل فوج بأسماء طلابه');
  });

  // ---------- 12. guardian app (real server + real code), phone-sized window
  await step('guardian-app', async () => {
    const st = await call('phone.enable'); if (!st.running) throw new Error('phone service did not start: ' + JSON.stringify(st.error));
    const port = st.port; const rows = await call('students.list', { search: '', limit: 40 });
    let code = null, phone = null;
    for (const s of rows.rows) { const g = await call('guardians.list', { studentId: s.id }); const gr = (g.rows || [])[0]; if (gr) { const r = await call('guardians.codeIssue', { guardianId: gr.guardianId }); if (r.ok) { code = r.code; phone = gr.phone; break; } } }
    if (!code) throw new Error('no guardian found in demo data');
    const pw = new BrowserWindow({ show: true, width: 390, height: 800, webPreferences: { backgroundThrottling: false, partition: 'guardian-phone-test' } });
    pw.webContents.on('console-message', (_e, lvl, msg) => { manifest.errors.push('guardian console[' + lvl + ']: ' + msg); });
    await pw.loadURL(`https://127.0.0.1:${port}/g`); await sleep(1500);
    await shot('guardian-login', 'تطبيق الأولياء', 'الولي يدخل برقم هاتفه ورمز سلّمته إياه الجمعية', pw.webContents);
    await pw.webContents.executeJavaScript(`(function(){const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};set(document.getElementById('ph'),${JSON.stringify(phone)});set(document.getElementById('cd'),${JSON.stringify(code)});[...document.querySelectorAll('button')].find(b=>b.textContent==='دخول').click()})()`); await sleep(1800);
    await shot('guardian-app', 'تطبيق الأولياء', 'الولي يرى ابنه فقط: كم حفظ، وحضوره، وآخر تسميعه', pw.webContents);
    pw.close(); await call('phone.disable');
  });

  manifest.done = true; save(); app.exit(0);
});

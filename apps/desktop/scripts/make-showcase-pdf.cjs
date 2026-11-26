// Builds the client showcase booklet (A4 landscape, chapters, one screenshot per screen with a caption) from out/showcase/manifest.json.
// Run: npx electron scripts/make-showcase-pdf.cjs   (after scripts/showcase-shots.cjs)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.disableHardwareAcceleration();
const root = path.join(__dirname, '..', '..', '..'); const shots = path.join(__dirname, '..', 'out', 'showcase');
const outPdf = path.join(root, 'docs', 'handoff', 'SHOWCASE_AR.pdf'); const tmp = path.join(shots, '.showcase.tmp.html');
const fontDir = path.join(root, 'node_modules', '@fontsource', 'noto-sans-arabic', 'files').replace(/\\/g, '/') + '/';
const font = (w) => 'file:///' + encodeURI(fontDir) + `noto-sans-arabic-arabic-${w}-normal.woff2`;
const m = JSON.parse(fs.readFileSync(path.join(shots, 'manifest.json'), 'utf8'));
const dims = (f) => { const b = fs.readFileSync(path.join(shots, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (f) => 'file:///' + encodeURI(path.join(shots, f).replace(/\\/g, '/'));
const logoFile = path.join(os.homedir(), 'Desktop', 'logo-association.png');
const logo = fs.existsSync(logoFile) ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64') : '';
// chapters in order of first appearance
const chapters = []; for (const s of m.shots) { let c = chapters.find((x) => x.name === s.chapter); if (!c) chapters.push(c = { name: s.chapter, shots: [] }); c.shots.push(s); }
const page = (s) => `<figure class="shot"><img src="${img(s.file)}"><figcaption>${esc(s.caption)}</figcaption></figure>`;
let body = '';
chapters.forEach((c, i) => {
  body += `<section class="chap"><div class="chap-head"><span class="no">${i + 1}</span><h2>${esc(c.name)}</h2></div>`;
  // consecutive portrait images share a row (phone and paper shots)
  for (let k = 0; k < c.shots.length;) {
    const d = dims(c.shots[k].file);
    if (d.h > d.w) { const row = []; while (k < c.shots.length && dims(c.shots[k].file).h > dims(c.shots[k].file).w && row.length < 3) row.push(c.shots[k++]); body += `<div class="row">${row.map(page).join('')}</div>`; }
    else body += page(c.shots[k++]);
  }
  body += '</section>';
});
const toc = chapters.map((c, i) => `<li><b>${i + 1}</b> ${esc(c.name)}</li>`).join('');
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>الشهاب — عرض البرنامج</title><style>
@font-face{font-family:N;font-weight:400;src:url('${font(400)}')}@font-face{font-family:N;font-weight:600;src:url('${font(600)}')}@font-face{font-family:N;font-weight:700;src:url('${font(700)}')}
@page{size:A4 landscape;margin:10mm 12mm}
:root{--em:#064E3B;--deep:#003527;--brass:#8A6A2B;--brass2:#B48E43;--ink:#0F172A;--ink2:#334155;--line:#DADDD0;--ivory:#F4F5F0}
*{box-sizing:border-box}body{font-family:N,'Segoe UI',Tahoma,sans-serif;color:var(--ink);font-size:12pt;line-height:1.7;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover{height:188mm;background:var(--deep);color:#fff;border-radius:6px;display:flex;flex-direction:column;justify-content:center;padding:0 22mm;break-after:page;position:relative}
.cover img{width:34mm;height:34mm;object-fit:contain;background:#fff;border-radius:50%;padding:1.5mm;margin-bottom:8mm}
.cover h1{font-size:46pt;margin:0;line-height:1.1}.cover .sub{font-size:16pt;color:#CFE3DA;margin-top:3mm}.cover .meta{margin-top:10mm;color:#C9A55B;font-size:12pt}.cover .rule{width:40mm;height:1.2mm;background:var(--brass2);margin:7mm 0}
.cover .dua{position:absolute;inset-inline:22mm;bottom:12mm;color:#C9A55B;font-size:12pt}
.sheet{break-after:page;padding-top:4mm}.sheet h2{font-size:22pt;color:var(--em);margin:0 0 6mm;border-bottom:2px solid var(--brass2);padding-bottom:2mm}
.sheet ul{list-style:none;padding:0;margin:0;columns:2;column-gap:14mm}.sheet li{padding:2mm 0;font-size:14pt;break-inside:avoid}.sheet li b{display:inline-block;width:9mm;height:9mm;line-height:9mm;text-align:center;border-radius:50%;background:var(--em);color:#fff;margin-inline-end:3mm;font-size:12pt}
.sheet p,.sheet li.p{font-size:13pt;color:var(--ink2)}
.chap{break-before:page}.chap-head{display:flex;align-items:center;gap:4mm;margin-bottom:4mm;border-bottom:2px solid var(--brass2);padding-bottom:2mm}
.chap-head .no{width:11mm;height:11mm;line-height:11mm;text-align:center;border-radius:50%;background:var(--em);color:#fff;font-size:15pt;font-weight:700}.chap-head h2{margin:0;font-size:22pt;color:var(--em)}
figure.shot{margin:0 0 6mm;break-inside:avoid;text-align:center}
figure.shot img{max-width:100%;max-height:150mm;border:1px solid var(--line);border-radius:3px;box-shadow:0 1mm 3mm rgba(0,0,0,.12)}
figcaption{margin-top:2.5mm;font-size:13pt;color:var(--ink2)}
.row{display:flex;gap:8mm;justify-content:center;align-items:flex-start;break-inside:avoid}.row figure.shot{flex:1;margin:0}.row figure.shot img{max-height:150mm;max-width:100%}
.note{border:1px solid var(--line);border-inline-start:4px solid var(--brass2);background:var(--ivory);padding:4mm 6mm;border-radius:3px;margin:4mm 0;font-size:12.5pt}
.n{direction:ltr;unicode-bidi:isolate}
</style></head><body>
<div class="cover">${logo ? `<img src="${logo}">` : ''}<h1>الشهاب</h1><div class="sub">برنامج إدارة الجمعية القرآنية</div><div class="rule"></div><div class="sub">الطلاب · الأفواج · الحضور · الحفظ والتقييم · الأولياء · التقارير</div><div class="meta">عرض مصوَّر للبرنامج — كل الأسماء والبيانات فيه تجريبية</div><div class="dua">ادعوا لوالدي بالرحمة والمغفرة</div></div>
<div class="sheet"><h2>فصول العرض</h2><ul>${toc}</ul>
<div class="note"><b>ملاحظة:</b> هذه الصور مأخوذة من البرنامج نفسه وهو يعمل على بيانات تجريبية (74 طالباً وهميّاً في فرعين). يعمل البرنامج على حاسوب الجمعية دون إنترنت، وبياناته محفوظة على الجهاز مع نسخ احتياطية مشفّرة.</div></div>
${body}
<div class="sheet" style="break-before:page"><h2>ما هو جاهز وما هو قيد التجربة</h2>
<ul><li class="p"><b>✓</b> الطلاب والمعلمون والأفواج والحضور والحفظ والتقارير والطباعة</li><li class="p"><b>✓</b> حسابات شخصية بصلاحيات حسب الدور والفرع، وسجل نشاط لا يُعدَّل</li><li class="p"><b>✓</b> نسخ احتياطي تلقائي مشفّر مع استعادة آمنة</li><li class="p"><b>✓</b> الأولياء وأرقامهم، ورسالة واتساب جاهزة يرسلها الموظف بنفسه</li><li class="p"><b>…</b> تطبيق الأولياء: نموذج تجريبي داخل شبكة الجمعية فقط، ونشره على الإنترنت يحتاج استضافة ومراجعة قانونية لبيانات الأطفال</li><li class="p"><b>…</b> نسخة الهاتف للأساتذة عبر واي فاي الجمعية: تحتاج تجربة على أجهزة الجمعية</li><li class="p"><b>…</b> التثبيت على حواسيب أخرى وبرنامج التوقيع الرقمي ما زالا قيد الاختبار</li></ul></div>
</body></html>`;
fs.writeFileSync(tmp, html);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { webSecurity: false } });
  await w.loadFile(tmp); await w.webContents.executeJavaScript('document.fonts.ready.then(()=>document.fonts.size)'); await new Promise((r) => setTimeout(r, 1500));
  const pdf = await w.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#555"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  fs.writeFileSync(outPdf, pdf); fs.rmSync(tmp, { force: true });
  console.log('showcase pdf bytes', pdf.length, 'pages', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 'chapters', chapters.length); app.quit();
});

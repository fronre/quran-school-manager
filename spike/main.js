// THROWAWAY spike. S1 (Arabic table), S2 (SQLite WAL backup/restore), S3 (Arabic PDF), S4 inputs.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const OUT = app.isPackaged ? app.getPath('userData') : path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
if (process.env.SPIKE_NOGPU==='1') app.disableHardwareAcceleration();
const LOG=(m)=>{try{fs.appendFileSync(path.join(OUT,'log.txt'),m+'\n')}catch{}};
const report = { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome };

const names = ['مُحَمَّدٌ','عَبْدُ الرَّحْمَٰنِ','أَحْمَدُ','يُوسُفُ','إِبْرَاهِيمُ','فَاطِمَةُ','عَائِشَةُ','خَدِيجَةُ','مَرْيَمُ','سُمَيَّةُ'];
const fam = ['بن عمر','الجزائري','بوعلام','Benali','مَسْعُودِي','بلقاسم'];

function s2() {
  const Database = require('better-sqlite3');
  const f = path.join(OUT, 'main.db');
  for (const x of fs.readdirSync(OUT)) if (/^(main|restored)\.db/.test(x)) fs.rmSync(path.join(OUT, x));
  const db = new Database(f);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE students(id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT) STRICT;`);
  const ins = db.prepare('INSERT INTO students VALUES (?,?,?)');
  db.transaction(() => { for (let i = 0; i < 2000; i++) ins.run(`id-${i}`, `${names[i%10]} ${fam[i%6]}`, `رقم ${i} — Level ${i%7}`); })();
  report.s2 = { journal: db.pragma('journal_mode', { simple: true }), rows: db.prepare('select count(*) c from students').get().c };
  return db.backup(path.join(OUT, 'backup.db')).then(() => {
    fs.copyFileSync(path.join(OUT, 'backup.db'), path.join(OUT, 'restored.db'));
    const r = new Database(path.join(OUT, 'restored.db'), { readonly: true });
    report.s2.restored_rows = r.prepare('select count(*) c from students').get().c;
    report.s2.integrity = r.pragma('integrity_check', { simple: true });
    report.s2.sample = r.prepare('select name from students where id=?').get('id-3').name;
    r.close(); db.close();
  });
}

function rows() {
  let h = '';
  for (let i = 0; i < 2000; i++) h += `<tr><td class="num">${i+1}</td><td>${names[i%10]} ${fam[i%6]}</td><td>${['حاضر','غائب','متأخر','بعذر'][i%4]}</td><td class="num">${(i%114)+1}:${(i%7)+1}–${(i%7)+5}</td></tr>`;
  return h;
}
const css = `body{font-family:'Segoe UI','Tahoma',sans-serif;margin:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:4px 8px;text-align:start}.num{direction:ltr;unicode-bidi:isolate;text-align:end}thead{display:table-header-group}tr{break-inside:avoid}`;
const page = (n) => `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>${css}</style><h2>سجل الحضور — فرع الرجال</h2><p>Tashkeel + Latin Benali + digits 123</p><table><thead><tr><th>#</th><th>الاسم</th><th>الحالة</th><th>الآيات</th></tr></thead><tbody>${rows().split('</tr>').slice(0,n).join('</tr>')}</tbody></table></html>`;

app.whenReady().then(async () => {
  try {
    LOG('s2 start');report.s2err = null; await s2();LOG('s2 done');
  } catch (e) { report.s2err = String(e); }
  const win = new BrowserWindow({ width: 1200, height: 800, show: false });
  fs.writeFileSync(path.join(OUT, 's1.html'), page(2000));
  const t0 = Date.now();
  LOG('load start');await win.loadFile(path.join(OUT, 's1.html'));LOG('load done');
  report.s1 = { load_ms: Date.now() - t0, fonts: await win.webContents.executeJavaScript('document.fonts.size') };
  LOG('capture start');const img = await win.webContents.capturePage();LOG('capture done');
  fs.writeFileSync(path.join(OUT, 's1.png'), img.toPNG());
  const t1 = Date.now();
  LOG('pdf start');const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
  fs.writeFileSync(path.join(OUT, 's3.pdf'), pdf);
  report.s3 = { pdf_bytes: pdf.length, pdf_ms: Date.now() - t1, pages: (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
});

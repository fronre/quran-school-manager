// THROWAWAY S1/S3b: Plex Arabic embedded, PDF visual check
const { app, BrowserWindow } = require('electron'); const fs=require('fs'), path=require('path');
const fd=path.join(__dirname,'node_modules/@fontsource/ibm-plex-sans-arabic/files/').split(path.sep).join('/');
const names=['مُحَمَّدٌ','عَبْدُ الرَّحْمَٰنِ','أَحْمَدُ','يُوسُفُ','فَاطِمَةُ'];
let rows=''; for(let i=0;i<120;i++) rows+=`<tr><td class="n">${i+1}</td><td>${names[i%5]} ${i%3?'بن عمر':'Benali'}</td><td></td><td></td><td></td></tr>`;
const html=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
@font-face{font-family:P;font-weight:400;src:url(file:///${encodeURI(fd)}ibm-plex-sans-arabic-arabic-400-normal.woff2)}
@font-face{font-family:P;font-weight:700;src:url(file:///${encodeURI(fd)}ibm-plex-sans-arabic-arabic-700-normal.woff2)}
@page{size:A4;margin:14mm}body{font-family:P,sans-serif;font-size:11pt}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #555;padding:3px 6px;text-align:start}.n{direction:ltr;unicode-bidi:isolate;text-align:center}
thead{display:table-header-group}tr{break-inside:avoid}</style>
<h2>كشف الحضور — فرع الرجال — الأحد <bdi dir="ltr">2026-11-22</bdi></h2><table><thead><tr><th>#</th><th>الاسم</th><th>حاضر</th><th>غائب</th><th>ملاحظة</th></tr></thead><tbody>${rows}</tbody></table></html>`;
const L=m=>fs.appendFileSync(path.join(__dirname,'out','log.txt'),m+'\n');setTimeout(()=>{L('TIMEOUT');app.exit(2)},60000);
app.whenReady().then(async()=>{L('ready');
  const out=path.join(__dirname,'out'); fs.writeFileSync(path.join(out,'s3b.html'),html);
  const w=new BrowserWindow({show:false,webPreferences:{webSecurity:false}});
  await w.loadFile(path.join(out,'s3b.html'));L('loaded');
  const fonts=await w.webContents.executeJavaScript('document.fonts.ready.then(()=>document.fonts.check("400 12px P")+" size="+document.fonts.size+" computed="+getComputedStyle(document.body).fontFamily)');
  const pdf=await w.webContents.printToPDF({preferCSSPageSize:true,printBackground:true,displayHeaderFooter:true,
    headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
  fs.writeFileSync(path.join(out,'s3b.pdf'),pdf);L('pdf'); console.log('fonts:',fonts,'pdf bytes',pdf.length);
  const v=new BrowserWindow({width:900,height:1200,show:true}); await v.loadFile(path.join(out,'s3b.pdf'));
  await new Promise(r=>setTimeout(r,2500));
  fs.writeFileSync(path.join(out,'s3b.png'),(await v.webContents.capturePage()).toPNG()); app.quit();
});

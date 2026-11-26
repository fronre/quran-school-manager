// Renders docs/handoff/TRIAL_GUIDE_AR.html to a PDF (A4, embedded Arabic font, page numbers). Run: npx electron scripts/make-guide-pdf.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
app.disableHardwareAcceleration();
const root = path.join(__dirname, '..', '..', '..'); const srcHtml = path.join(root, 'docs', 'handoff', 'TRIAL_GUIDE_AR.html'); const out = path.join(root, 'docs', 'handoff', 'TRIAL_GUIDE_AR.pdf');
const fontDir = path.join(root, 'node_modules', '@fontsource', 'noto-sans-arabic', 'files').replace(/\\/g, '/') + '/';
const url = (w) => 'file:///' + encodeURI(fontDir) + `noto-sans-arabic-arabic-${w}-normal.woff2`;
let html = fs.readFileSync(srcHtml, 'utf8'); for (const w of [400, 600, 700]) html = html.replace(`FONT${w}`, url(w));
const tmp = path.join(path.dirname(srcHtml), '.guide.tmp.html'); fs.writeFileSync(tmp, html);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { webSecurity: false } });
  await w.loadFile(tmp); await w.webContents.executeJavaScript('document.fonts.ready.then(()=>document.fonts.size)'); await new Promise((r) => setTimeout(r, 800));
  const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#555"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  fs.writeFileSync(out, pdf); fs.rmSync(tmp, { force: true });
  console.log('guide pdf bytes', pdf.length, 'pages', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length); app.quit();
});

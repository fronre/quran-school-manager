// Renders the app icon (brand mark on an emerald rounded square) to build/icon.png using Electron itself. Usage: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
app.disableHardwareAcceleration();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
  <rect width="64" height="64" rx="12" fill="#003527"/>
  <g transform="translate(8 7) scale(0.75)">
    <path fill="#F4F5F0" fill-rule="evenodd" d="M10 60V27C10 13.2 20 4 32 4s22 9.2 22 23v33zM19 60V29c0-8 5.5-15 13-15s13 7 13 15v31z"/>
    <path fill="#C9A55B" d="M32 24c3.6 4.4 5.6 7.4 5.6 10.6a5.6 5.6 0 0 1-11.2 0c0-3.2 2-6.2 5.6-10.6z"/>
    <rect x="31" y="39" width="2" height="7" fill="#F4F5F0"/>
    <path fill="#F4F5F0" d="M24.5 46h15c0 4.4-3.4 7.4-7.5 7.4s-7.5-3-7.5-7.4z"/>
  </g></svg>`;
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 512, height: 512, show: false, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: false } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>html,body{margin:0;background:transparent}</style>${svg}`));
  await new Promise((r) => setTimeout(r, 600));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), img.toPNG()); console.log('icon', img.getSize()); app.quit();
});

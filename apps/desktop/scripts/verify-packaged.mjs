// Launches the PACKAGED app (out/installer/win-unpacked/Mishkat.exe) with a throwaway profile and checks it through the DevTools protocol.
// Nothing is installed on the machine and the real profile is not touched.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = join(root, 'out/installer/win-unpacked/Mishkat.exe');
const profile = mkdtempSync(join(tmpdir(), 'mishkat-pkg-')); const PORT = 9333;
const report = { exe, checks: {} }; const C = report.checks;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });
let exited = null; child.on('exit', (c) => { exited = c; });
try {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500); if (exited !== null) break;
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = list.find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  C.startedAndStayedAlive = exited === null && !!target;
  if (target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    const evalJs = (expression) => new Promise((res) => { const i = ++id; pending.set(i, (d) => res(d.result?.result?.value ?? d.result?.exceptionDetails?.text ?? null)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
    await sleep(2500);
    C.title = await evalJs('document.title');
    C.firstHeading = await evalJs('document.querySelector("h1,h2")?.textContent');
    C.noNodeInPage = await evalJs('typeof require === "undefined" && typeof process === "undefined"');
    C.bridge = await evalJs('Object.keys(window.mishkat).join(",")');
    C.appInfo = await evalJs('window.mishkat.invoke("app.info").then(JSON.stringify)'); // opens SQLite + runs migrations inside the package
    C.unknownChannelRejected = await evalJs('window.mishkat.invoke("fs.readFile").then(()=>"NO", e=>String(e.message))');
    C.passwordCheck = await evalJs('window.mishkat.invoke("setup.checkPassword",{username:"a",password:"short"}).then(JSON.stringify)'); // domain code inside the package
    C.networkBlocked = await evalJs('fetch("https://example.com").then(()=>"REACHED", ()=>"blocked")');
    C.fontsLoaded = await evalJs('document.fonts.ready.then(()=>[...document.fonts].filter(f=>f.status==="loaded").length)');
    ws.close();
  }
  const dataDir = join(profile, 'data');
  C.databaseCreated = existsSync(join(dataDir, 'mishkat.db'));
  C.dataFolder = existsSync(dataDir) ? readdirSync(dataDir) : null;
} finally {
  child.kill(); await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still releasing files */ }
}
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/verify-packaged.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

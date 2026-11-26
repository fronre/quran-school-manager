import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, session, shell } from 'electron';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { folderSuggestions } from './autosave';
import { createPhoneControl } from './phone/control';
import { LIMITS } from '@mishkat/files';
import { PHOTO } from '@mishkat/domain';
import { openDb, type Protector } from '@mishkat/db';
import { safeMigrate } from './startup';
import { CSP, webPreferences, isAllowedNavigation, allowPermission } from './security';
import { createDispatcher, IpcError, type SessionUser, type Settings } from './ipc';
import { IPC_ENVELOPE } from './channels';
import { devSeed } from './devseed';

// The UI is tables and forms; hardware acceleration was unstable in spike S4 (ADR-003 addendum).
app.disableHardwareAcceleration();

const INDEX = join(__dirname, 'renderer', 'index.html');
const INDEX_URL = pathToFileURL(INDEX).toString();

if (!app.requestSingleInstanceLock()) app.quit();

/** Windows DPAPI through Electron safeStorage (SEC-041). */
const protector: Protector = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (b) => safeStorage.encryptString(b.toString('base64')),
  decrypt: (b) => Buffer.from(safeStorage.decryptString(b), 'base64'),
};

function fileSettings(file: string): Settings {
  return {
    get: () => { try { const j = JSON.parse(readFileSync(file, 'utf8')) as { backupFolder?: string; secondFolder?: string | null; phoneEnabled?: boolean }; return { backupFolder: j.backupFolder ?? null, secondFolder: j.secondFolder ?? null, phoneEnabled: !!j.phoneEnabled }; } catch { return { backupFolder: null, secondFolder: null, phoneEnabled: false }; } },
    set: (v) => { let cur: Record<string, unknown> = {}; try { cur = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* first write */ } writeFileSync(file, JSON.stringify({ ...cur, ...v })); },
  };
}

app.whenReady().then(async () => {
  const dataDir = join(app.getPath('userData'), app.isPackaged ? 'data' : 'data-dev');
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(join(dataDir, 'mishkat.db'));
  const settings = fileSettings(join(dataDir, 'settings.json'));
  // BR-043: an existing installation is backed up (verified) before any schema upgrade; without that backup we do not touch the data.
  const m = await safeMigrate({ db, migrationsDir: join(__dirname, 'migrations'), dataDir, protector, backupFolder: settings.get().backupFolder });
  if (!m.ok) {
    dialog.showErrorBox('الشهاب', m.error === 'backup_not_configured'
      ? 'يحتاج هذا التحديث إلى ترقية بيانات البرنامج، ولم تُضبط النسخة الاحتياطية. لم تُمسّ بياناتكم. شغّلوا النسخة السابقة وأنشئوا نسخة احتياطية ثم أعيدوا المحاولة.'
      : 'تعذّر إنشاء النسخة الاحتياطية قبل ترقية البيانات، لذلك لم تُمسّ بياناتكم. تأكدوا أن مجلد النسخ الاحتياطية متاح ثم شغّلوا البرنامج من جديد.');
    app.exit(1); return;
  }
  if (!app.isPackaged && process.env.MISHKAT_DEV_SEED === '1') devSeed(db);

  const state: { current: SessionUser | null } = { current: null };
  const phone = createPhoneControl({ db, dataDir, protector, tenantId: () => (db.prepare('SELECT id FROM association LIMIT 1').get() as { id: string } | undefined)?.id ?? null, settings });
  let win: BrowserWindow | null = null;
  const dispatch = createDispatcher({
    db, version: app.getVersion(), session: state, dataDir, protector, settings, phone,
    defaultBackupFolder: join(app.getPath('documents'), 'Mishkat-Backups'),
    openExternal: async (url) => { if (url.startsWith('https://wa.me/')) await shell.openExternal(url); },
    suggestions: () => folderSuggestions({ home: homedir(), desktop: app.getPath('desktop'), documents: app.getPath('documents'), exists: existsSync }),
    wizard: { key: null, backupFolder: null }, importJob: { current: null }, finance: { lastActive: null },
    dbPath: join(dataDir, 'mishkat.db'), migrationsDir: join(__dirname, 'migrations'), restart: () => { if (!app.isPackaged && process.env.MISHKAT_TEST_NO_RESTART === '1') return; /* automated smoke test only */ app.relaunch(); app.exit(0); }, autoBackup: true,
    pickImage: async () => {
      let file = !app.isPackaged ? process.env.MISHKAT_TEST_PHOTO_FILE : undefined; // automated smoke test only
      if (!file) {
        const r = await dialog.showOpenDialog(win!, { title: 'اختيار صورة', properties: ['openFile'], filters: [{ name: 'صور', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] });
        if (r.canceled || !r.filePaths[0]) return null; file = r.filePaths[0];
      }
      if (statSync(file).size > PHOTO.maxInputBytes) return { error: 'too_large' as const };
      return { data: readFileSync(file) };
    },
    processImage: (data) => {
      const img = nativeImage.createFromBuffer(data); if (img.isEmpty()) return null; // not a decodable image
      const { width, height } = img.getSize(); if (width < 16 || height < 16 || width > 20000 || height > 20000) return null;
      const side = Math.min(width, height); // centred square crop, then a fixed small size, re-encoded: nothing from the original file survives (EXIF/GPS included)
      const out = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side }).resize({ width: PHOTO.side, height: PHOTO.side, quality: 'best' });
      return { jpeg: out.toJPEG(PHOTO.quality), width: PHOTO.side, height: PHOTO.side };
    },
    pickOpenFile: async () => {
      let file = !app.isPackaged ? process.env.MISHKAT_TEST_IMPORT_FILE : undefined; // automated smoke test only
      if (!file) {
        const r = await dialog.showOpenDialog(win!, { title: 'اختيار ملف الطلاب', properties: ['openFile'], filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xlsm', 'csv', 'xls'] }] });
        if (r.canceled || !r.filePaths[0]) return null; file = r.filePaths[0];
      }
      if (statSync(file).size > LIMITS.maxBytes) return { error: 'too_large' as const };
      return { name: basename(file), data: readFileSync(file) };
    },
    saveFile: async (suggestedName, data, kind) => {
      let target = !app.isPackaged && process.env.MISHKAT_TEST_EXPORT_DIR ? join(process.env.MISHKAT_TEST_EXPORT_DIR, suggestedName) : undefined; // automated smoke test only
      if (!target) {
        const r = await dialog.showSaveDialog(win!, { title: 'حفظ الملف', defaultPath: join(app.getPath('documents'), suggestedName), filters: [{ name: kind === 'xlsx' ? 'Excel' : 'XML', extensions: [kind] }] });
        if (r.canceled || !r.filePath) return null; target = r.filePath;
      }
      writeFileSync(target, data); return basename(target);
    },
    pickBackupFile: async () => {
      if (!app.isPackaged && process.env.MISHKAT_TEST_RESTORE_FILE) return process.env.MISHKAT_TEST_RESTORE_FILE; // automated smoke test only
      const r = await dialog.showOpenDialog(win!, { title: 'اختيار ملف النسخة الاحتياطية', properties: ['openFile'], filters: [{ name: 'نسخة احتياطية', extensions: ['mshkbk'] }] });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    tenantId: () => (db.prepare('SELECT id FROM association LIMIT 1').get() as { id: string } | undefined)?.id ?? null,
    pickFolder: async () => {
      if (!app.isPackaged && process.env.MISHKAT_TEST_PICK_FOLDER) return process.env.MISHKAT_TEST_PICK_FOLDER; // automated smoke test only
      const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'اختيار مجلد النسخ الاحتياطية' });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
  });

  ipcMain.handle(IPC_ENVELOPE, async (event, channel: unknown, payload: unknown) => {
    // Only our own page may call (SEC-033); the renderer never supplies identity.
    if (!isAllowedNavigation(event.senderFrame?.url ?? '', INDEX_URL)) return { error: 'forbidden' };
    try { return await dispatch(channel, payload); }
    catch (e) {
      if (!(e instanceof IpcError)) console.error('[ipc] unexpected failure in', String(channel), e); // internal details go to the log only, never to the UI
      return { error: e instanceof IpcError ? e.code : 'failed' };
    } // no internal details leak to the UI
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowPermission(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowPermission(permission));
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });

  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680, show: false, backgroundColor: '#F4F5F0', title: 'الشهاب',
    autoHideMenuBar: true,
    webPreferences: webPreferences({ preloadPath: join(__dirname, 'preload.cjs'), packaged: app.isPackaged }),
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!isAllowedNavigation(url, INDEX_URL)) e.preventDefault(); });
  win.once('ready-to-show', () => win!.show());
  win.loadFile(INDEX);

  // Automatic saving: every 10 minutes while someone is signed in (only if something changed), and once more when the program closes.
  setInterval(() => { if (state.current) void dispatch.autoSave(); }, 10 * 60 * 1000);
  void phone.restore(); // the phone page starts again only if it was switched on when the program closed
  let closing = false;
  app.on('before-quit', (e) => {
    if (closing) return; e.preventDefault(); closing = true;
    const limit = new Promise<void>((r) => setTimeout(r, 20_000)); // never keep the program from closing for long
    void Promise.race([phone.stop().then(() => dispatch.autoSave()).then(() => undefined), limit]).finally(() => { try { db.close(); } catch { /* already closed */ } app.quit(); });
  });
  app.on('window-all-closed', () => { app.quit(); });
});

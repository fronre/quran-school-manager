/** Electron hardening decisions as pure, testable data (SEC-030..036). main.ts only applies them. */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

export function webPreferences(opts: { preloadPath: string; packaged: boolean }) {
  return {
    preload: opts.preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    devTools: !opts.packaged,
    spellcheck: false,
  } as const;
}

/** Only the app's own bundled page may be loaded; everything else is blocked (no remote content, SEC-032). */
export function isAllowedNavigation(targetUrl: string, appIndexUrl: string): boolean {
  try {
    const t = new URL(targetUrl), a = new URL(appIndexUrl);
    return t.protocol === 'file:' && a.protocol === 'file:' && t.pathname === a.pathname;
  } catch { return false; }
}

/** The app needs no browser permissions (camera, location, notifications, ...). */
export const allowPermission = (_permission: string): boolean => false;

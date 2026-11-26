import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { Db, Protector } from '@mishkat/db';
import { makePhoneCert, certCovers, keyMatchesCert, type PhoneCert } from './cert';
import { createPhoneService, isPrivateAddress, type PhoneService, type DeviceRow } from './server';

/** Switches the phone page on and off and keeps its certificate. Off by default; the choice is remembered in settings.json. */
export interface PhoneStatus { enabled: boolean; running: boolean; port: number; urls: string[]; devices: DeviceRow[]; error?: 'no_network' | 'start_failed' }
export interface PhoneControlDeps {
  db: Db; dataDir: string; protector: Protector; tenantId: () => string | null; now?: () => string;
  settings: { get(): { phoneEnabled?: boolean }; set(v: { phoneEnabled?: boolean }): void }; listIps?: () => string[]; startPort?: number;
}
/** Private IPv4 addresses of this PC (Wi-Fi / Ethernet). */
export function lanAddresses(): string[] {
  const out: string[] = []; for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && isPrivateAddress(i.address)) out.push(i.address);
  return [...new Set(out)].sort();
}

export function createPhoneControl(d: PhoneControlDeps) {
  const file = join(d.dataDir, 'phone-tls.json'); let svc: PhoneService | null = null; let lastError: PhoneStatus['error'];
  const ips = () => (d.listIps ?? lanAddresses)();
  function loadTls(current: string[]): PhoneCert {
    if (existsSync(file)) {
      try {
        const j = JSON.parse(readFileSync(file, 'utf8')) as { certPem: string; keyEnc: string; ips: string[]; notAfter: string };
        const c: PhoneCert = { certPem: j.certPem, keyPem: d.protector.decrypt(Buffer.from(j.keyEnc, 'base64')).toString('utf8'), ips: j.ips, notAfter: j.notAfter };
        if (keyMatchesCert(c) && certCovers(c, current)) return c; // same certificate while the addresses stay the same: phones accept it once
      } catch { /* damaged or unreadable: make a new one */ }
    }
    const c = makePhoneCert(current);
    writeFileSync(file, JSON.stringify({ certPem: c.certPem, keyEnc: d.protector.encrypt(Buffer.from(c.keyPem, 'utf8')).toString('base64'), ips: c.ips, notAfter: c.notAfter })); // the private key is stored protected by Windows (DPAPI)
    return c;
  }
  function service(current: string[]): PhoneService {
    if (svc && !svc.running()) svc = null; // a stopped service is rebuilt so it always carries the certificate for the current addresses
    return svc ??= createPhoneService({ db: d.db, tenantId: d.tenantId, now: d.now, tls: { key: loadTls(current).keyPem, cert: loadTls(current).certPem } });
  }
  function status(): PhoneStatus {
    const cur = ips(); const running = !!svc && svc.running(); const port = running ? svc!.port() : 0;
    const devices = (() => { try { return (svc ?? createPhoneService({ db: d.db, tenantId: d.tenantId, now: d.now, tls: { key: '', cert: '' } })).listDevices(); } catch { return []; } })();
    return { enabled: !!d.settings.get().phoneEnabled && running, running, port, urls: running ? cur.map((ip) => `https://${ip}:${port}`) : [], devices, ...(lastError ? { error: lastError } : {}) };
  }
  async function enable(): Promise<PhoneStatus> {
    lastError = undefined; const cur = ips(); if (cur.length === 0) { lastError = 'no_network'; return status(); }
    try { const s = service(cur); await s.start(d.startPort ?? 8443); d.settings.set({ phoneEnabled: true }); } catch { lastError = 'start_failed'; }
    return status();
  }
  async function disable(): Promise<PhoneStatus> { lastError = undefined; if (svc) await svc.stop(); svc = null; d.settings.set({ phoneEnabled: false }); return status(); }
  /** At program start: turn it on again only if it was on when the program closed. Failures are silent (the settings page shows the state). */
  async function restore(): Promise<void> { if (d.settings.get().phoneEnabled) await enable(); }
  return { status, enable, disable, restore, newCode: (b: string[] | 'all') => (svc?.running() ? svc.newPairingCode(b) : ({ ok: false, error: 'not_running' } as const)), revoke: (id: string, by: string) => (svc ? svc.revoke(id, by) : false), stop: async () => { if (svc) await svc.stop(); } };
}
export type PhoneControl = ReturnType<typeof createPhoneControl>;

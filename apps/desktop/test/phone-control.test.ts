import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';
import { openDb, migrate, runSetup, generateRecoveryKey, type Protector } from '@mishkat/db';
import { createPhoneControl, lanAddresses, type PhoneControl } from '../src/main/phone/control';
import { certInfo } from '../src/main/phone/cert';

const FAST = { memoryKiB: 8, passes: 1, parallelism: 1 };
const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a)); const prot: Protector = { available: () => true, encrypt: xor, decrypt: xor };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'mishkat-ph-')); const db = openDb(':memory:'); migrate(db);
  const { tenantId } = runSetup(db, { admin: { givenName: 'م', familyName: 'ب', username: 'user1', password: 'a-long-test-password' }, association: { name: 'ج' }, branches: [{ name: 'فرع' }], year: { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-06-30' } }, generateRecoveryKey().key, { argon2: FAST });
  let saved: { phoneEnabled?: boolean } = {}; let ips = ['127.0.0.1'];
  const c = createPhoneControl({ db, dataDir: dir, protector: prot, tenantId: () => tenantId, settings: { get: () => saved, set: (v) => { saved = { ...saved, ...v }; } }, listIps: () => ips, startPort: 0 });
  return { dir, c, saved: () => saved, setIps: (x: string[]) => { ips = x; } };
}
const get = (port: number) => new Promise<number>((res, rej) => { const q = request({ host: '127.0.0.1', port, path: '/', rejectUnauthorized: false }, (r) => { r.resume(); r.on('end', () => res(r.statusCode ?? 0)); }); q.on('error', rej); q.end(); });

describe('switching the phone page on and off', () => {
  let s: ReturnType<typeof setup>; let c: PhoneControl; beforeEach(() => { s = setup(); c = s.c; }); afterEach(async () => { await c.stop(); });
  it('is off by default', () => { expect(c.status()).toMatchObject({ enabled: false, running: false, port: 0, urls: [], devices: [] }); });
  it('turns on, serves the page on the LAN addresses, remembers the choice, and turns off', async () => {
    const st = await c.enable(); expect(st).toMatchObject({ enabled: true, running: true }); expect(st.port).toBeGreaterThan(0); expect(st.urls).toEqual([`https://127.0.0.1:${st.port}`]); expect(s.saved().phoneEnabled).toBe(true);
    expect(await get(st.port)).toBe(200); const off = await c.disable(); expect(off).toMatchObject({ enabled: false, running: false }); expect(s.saved().phoneEnabled).toBe(false); await expect(get(st.port)).rejects.toBeTruthy();
  });
  it('keeps the same certificate while the addresses are unchanged (a phone accepts it once), and makes a new one when they change; the private key is stored protected', async () => {
    await c.enable(); const f = () => JSON.parse(readFileSync(join(s.dir, 'phone-tls.json'), 'utf8')) as { certPem: string; keyEnc: string }; const a = f(); await c.disable(); await c.enable(); expect(f().certPem).toBe(a.certPem);
    expect(a.keyEnc).not.toContain('PRIVATE KEY'); expect(Buffer.from(a.keyEnc, 'base64').toString('utf8')).not.toContain('PRIVATE'); expect(readFileSync(join(s.dir, 'phone-tls.json'), 'utf8')).not.toContain('PRIVATE KEY');
    await c.disable(); s.setIps(['127.0.0.1', '192.168.1.9']); await c.enable(); expect(f().certPem).not.toBe(a.certPem); expect(certInfo(f().certPem).san).toContain('192.168.1.9');
  });
  it('says so when there is no network, and does not start', async () => { s.setIps([]); expect(await c.enable()).toMatchObject({ enabled: false, running: false, error: 'no_network' }); });
  it('pairing codes exist only while it runs; restore() turns it on again only if it was on', async () => {
    expect(c.newCode('all')).toEqual({ ok: false, error: 'not_running' }); await c.restore(); expect(c.status().running).toBe(false);
    await c.enable(); expect(c.newCode('all')).toMatchObject({ ok: true }); await c.stop();
  });
  it('lists the private IPv4 addresses of this PC without throwing', () => { expect(Array.isArray(lanAddresses())).toBe(true); for (const ip of lanAddresses()) expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/); });
});

describe('restoring after a restart', () => {
  it('starts again by itself only when it was on', async () => {
    const s = setup(); await s.c.enable(); await s.c.stop(); expect(s.saved().phoneEnabled).toBe(true); await s.c.restore(); expect(s.c.status().running).toBe(true); await s.c.disable(); await s.c.restore(); expect(s.c.status().running).toBe(false);
  });
});

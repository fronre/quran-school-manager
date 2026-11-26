import { describe, it, expect } from 'vitest';
import { createServer, request } from 'node:https';
import { once } from 'node:events';
import { makePhoneCert, certCovers, certInfo, keyMatchesCert } from '../src/main/phone/cert';

describe('phone certificate (built with Node crypto only)', () => {
  const c = makePhoneCert(['192.168.1.20', '10.0.0.5']);
  it('is a valid X.509 certificate that matches its private key and is self-signed', () => {
    const i = certInfo(c.certPem); expect(i.selfSigned).toBe(true); expect(i.subject).toContain('Mishkat local'); expect(keyMatchesCert(c)).toBe(true); expect(i.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
  it('lists localhost and the LAN addresses as subject alternative names', () => {
    const san = certInfo(c.certPem).san; expect(san).toContain('DNS:localhost'); expect(san).toContain('IP Address:192.168.1.20'); expect(san).toContain('IP Address:10.0.0.5'); expect(san).toContain('IP Address:127.0.0.1');
  });
  it('is valid for about three years and is not a CA', () => {
    const d = (Date.parse(certInfo(c.certPem).validTo) - Date.now()) / 86400000; expect(d).toBeGreaterThan(1090); expect(d).toBeLessThan(1100); expect(certInfo(c.certPem).san).not.toContain('CA');
  });
  it('decides when it must be regenerated: new address, or about to expire', () => {
    expect(certCovers(c, ['192.168.1.20'])).toBe(true); expect(certCovers(c, ['192.168.1.20', '10.0.0.5'])).toBe(true); expect(certCovers(c, ['192.168.1.99'])).toBe(false);
    expect(certCovers(c, ['192.168.1.20'], new Date(Date.now() + 1090 * 86400000))).toBe(false); expect(certCovers({ ...c, ips: [] }, [])).toBe(true);
  });
  it('ignores values that are not IPv4 addresses, and every certificate has a different key and serial', () => {
    const x = makePhoneCert(['not-an-ip', '192.168.0.2']); expect(certInfo(x.certPem).san).not.toContain('not-an-ip'); expect(certInfo(x.certPem).fingerprint).not.toBe(certInfo(c.certPem).fingerprint);
  });
  it('really works for a TLS handshake: a client connects and reads the page', async () => {
    const s = createServer({ key: c.keyPem, cert: c.certPem }, (_q, r) => { r.end('hello'); }); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const port = (s.address() as { port: number }).port;
    const body = await new Promise<string>((res, rej) => { const q = request({ host: '127.0.0.1', port, ca: c.certPem, servername: 'localhost', checkServerIdentity: () => undefined }, (r) => { let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => res(t)); }); q.on('error', rej); q.end(); });
    expect(body).toBe('hello'); s.close();
  });
});

import { phonePage } from '../src/main/phone/page';
import { Script } from 'node:vm';
describe('the phone page script', () => {
  it('is syntactically valid JavaScript and only talks to this server', () => {
    const html = phonePage('abc'); const js = html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1]!; expect(() => new Script(js)).not.toThrow();
    for (const url of js.match(/'\/api\/[^']*'/g) ?? []) expect(url).toMatch(/^'\/api\//); expect(js).not.toMatch(/\beval\b|new Function|document\.write|innerHTML|outerHTML/); expect(js).not.toMatch(/https?:\/\//);
  });
});

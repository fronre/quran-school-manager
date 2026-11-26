import { generateKeyPairSync, createPublicKey, createPrivateKey, sign, randomBytes, X509Certificate } from 'node:crypto';

/** A self-signed TLS certificate for the phone page, built with Node's own crypto (no extra package).
 *  ECDSA P-256 + SHA-256, valid for the LAN addresses of this PC. A phone shows a one-time "not secure" warning for a self-signed certificate; the traffic is still encrypted. */
const len = (n: number): Buffer => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag: number, ...parts: Buffer[]): Buffer => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p: Buffer[]) => tlv(0x30, ...p); const set = (...p: Buffer[]) => tlv(0x31, ...p);
const oid = (dotted: string): Buffer => {
  const a = dotted.split('.').map(Number); const out: number[] = [a[0]! * 40 + a[1]!];
  for (const n of a.slice(2)) { const b: number[] = [n & 0x7f]; let v = n >> 7; while (v > 0) { b.unshift((v & 0x7f) | 0x80); v >>= 7; } out.push(...b); }
  return tlv(0x06, Buffer.from(out));
};
const int = (b: Buffer): Buffer => { let x = b; while (x.length > 1 && x[0] === 0 && x[1]! < 0x80) x = x.subarray(1); if (x[0]! >= 0x80) x = Buffer.concat([Buffer.from([0]), x]); return tlv(0x02, x); };
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const octets = (b: Buffer) => tlv(0x04, b);
const bits = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const utc = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return tlv(0x17, Buffer.from(`${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`)); };
const ECDSA_SHA256 = '1.2.840.10045.4.3.2';

export interface PhoneCert { certPem: string; keyPem: string; ips: string[]; notAfter: string }
const pem = (der: Buffer, label: string) => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END ${label}-----\n`;

/** Makes a certificate for these IPv4 addresses (plus localhost). `now` is injectable for tests. */
export function makePhoneCert(ips: string[], now = new Date(), years = 3): PhoneCert {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const name = seq(set(seq(oid('2.5.4.3'), utf8('Mishkat local'))));
  const ipv4 = (s: string) => Buffer.from(s.split('.').map(Number));
  const san = seq(tlv(0x82, Buffer.from('localhost')), tlv(0x87, Buffer.from([127, 0, 0, 1])), ...ips.filter((x) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x)).map((x) => tlv(0x87, ipv4(x))));
  const ext = (id: string, critical: boolean, value: Buffer) => seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), octets(value));
  const extensions = tlv(0xa3, seq(
    ext('2.5.29.19', true, seq()),                                  // basicConstraints: not a CA
    ext('2.5.29.15', true, bits(Buffer.from([0x80]))),              // keyUsage: digitalSignature
    ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),         // extendedKeyUsage: serverAuth
    ext('2.5.29.17', false, san),                                   // subjectAltName
  ));
  const notBefore = new Date(now.getTime() - 3600_000); const notAfter = new Date(now.getTime() + years * 365 * 86400_000);
  const tbs = seq(tlv(0xa0, int(Buffer.from([2]))), int(Buffer.concat([Buffer.from([0x01]), randomBytes(15)])), seq(oid(ECDSA_SHA256)), name, seq(utc(notBefore), utc(notAfter)), name, spki, extensions);
  const sig = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const cert = seq(tbs, seq(oid(ECDSA_SHA256)), bits(sig));
  return { certPem: pem(cert, 'CERTIFICATE'), keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, ips: [...ips].sort(), notAfter: notAfter.toISOString() };
}

/** True when the certificate is still valid for a month and covers every current address of this PC. */
export function certCovers(c: PhoneCert, ips: string[], now = new Date()): boolean {
  if (Date.parse(c.notAfter) - now.getTime() < 30 * 86400_000) return false;
  return ips.every((ip) => c.ips.includes(ip));
}
export function certInfo(certPem: string): { fingerprint: string; subject: string; san: string; validTo: string; selfSigned: boolean } {
  const x = new X509Certificate(certPem); return { fingerprint: x.fingerprint256, subject: x.subject, san: x.subjectAltName ?? '', validTo: x.validTo, selfSigned: x.verify(x.publicKey) && x.subject === x.issuer };
}
export const keyMatchesCert = (c: PhoneCert): boolean => { try { return new X509Certificate(c.certPem).checkPrivateKey(createPrivateKey(c.keyPem)) && !!createPublicKey(c.certPem); } catch { return false; } };

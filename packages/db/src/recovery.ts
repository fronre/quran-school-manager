import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendAudit, nowIso, type Db } from './index';

/** Recovery key: 32 random bytes shown once as Crockford base32 in groups of 4, with a 4-character checksum
 *  that catches typing errors. The key is never stored; only a verifier (SEC-014, SEC-041, SEC-042). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode32(bytes: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function decode32(s: string): Buffer | null {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch); if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const checksum = (key: Buffer): string => encode32(createHash('sha256').update('mishkat-recovery-check').update(key).digest()).slice(0, 4);

export function generateRecoveryKey(rand: Buffer = randomBytes(32)): { key: Buffer; display: string } {
  if (rand.length !== 32) throw new Error('recovery key must be 32 bytes');
  const body = encode32(rand) + checksum(rand); // 52 + 4 = 56 chars
  return { key: rand, display: body.match(/.{1,4}/g)!.join('-') };
}

export type ParseResult = { ok: true; key: Buffer } | { ok: false; error: 'bad_format' | 'bad_checksum' };
export function parseRecoveryKey(input: string): ParseResult {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 56) return { ok: false, error: 'bad_format' };
  const key = decode32(s.slice(0, 52));
  if (!key || key.length < 32) return { ok: false, error: 'bad_format' };
  const k = key.subarray(0, 32);
  return checksum(k) === s.slice(52) ? { ok: true, key: Buffer.from(k) } : { ok: false, error: 'bad_checksum' };
}

export const recoveryVerifier = (key: Buffer): string => createHash('sha256').update('mishkat-recovery-verifier').update(key).digest('hex');

export function storeRecoveryVerifier(db: Db, tenantId: string, key: Buffer, now = nowIso()): void {
  db.prepare('INSERT INTO key_material(tenant_id, recovery_verifier, created_at) VALUES (?,?,?)').run(tenantId, recoveryVerifier(key), now);
}
export function checkRecoveryKey(db: Db, tenantId: string, key: Buffer): boolean {
  const r = db.prepare('SELECT recovery_verifier v FROM key_material WHERE tenant_id=?').get(tenantId) as { v: string } | undefined;
  if (!r) return false;
  const a = Buffer.from(r.v, 'hex'), b = Buffer.from(recoveryVerifier(key), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Setup cannot finish until the user confirms the key is stored (SEC-043). */
export function acknowledgeRecoveryKey(db: Db, tenantId: string, actorId: string, now = nowIso()): void {
  const info = db.prepare('UPDATE key_material SET acknowledged_at=? WHERE tenant_id=? AND acknowledged_at IS NULL').run(now, tenantId);
  if (info.changes !== 1) throw new Error('no unacknowledged recovery key');
  appendAudit(db, { tenant_id: tenantId, at: now, actor_id: actorId, actor_role: 'director', branch_id: null, action: 'recovery_key.acknowledged', entity_type: 'key_material', entity_id: tenantId, before_json: null, after_json: null, reason: null });
}
export function isSetupKeyComplete(db: Db, tenantId: string): boolean {
  const r = db.prepare('SELECT acknowledged_at a FROM key_material WHERE tenant_id=?').get(tenantId) as { a: string | null } | undefined;
  return !!r && r.a !== null;
}

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { uuidv7, UUID_RE, computeHash, verifyChain, GENESIS_HASH, type AuditEntry, type StoredAuditEntry } from '../src';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const rnd = (n: number) => Uint8Array.from({ length: 10 }, (_, i) => (i * 37 + n) % 256);

describe('uuidv7', () => {
  it('is well formed (version 7, variant 10)', () => expect(uuidv7(1_700_000_000_000, rnd(1))).toMatch(UUID_RE));
  it('sorts by time', () => {
    const a = uuidv7(1_700_000_000_000, rnd(9)), b = uuidv7(1_700_000_000_001, rnd(1));
    expect(a < b).toBe(true);
  });
  it('rejects bad input', () => {
    expect(() => uuidv7(-1, rnd(1))).toThrow();
    expect(() => uuidv7(1, new Uint8Array(3))).toThrow();
  });
});

function chain(n: number): StoredAuditEntry[] {
  const out: StoredAuditEntry[] = []; let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const e: AuditEntry = { id: `id-${i}`, tenant_id: 't', at: `2026-01-0${i}T00:00:00.000Z`, actor_id: 'u', actor_role: 'director',
      branch_id: null, action: 'x', entity_type: 'student', entity_id: `s${i}`, before_json: null, after_json: '{"a":1}', reason: null };
    const hash = computeHash(prev, e, sha); out.push({ ...e, seq: i, prev_hash: prev, hash }); prev = hash;
  }
  return out;
}
describe('audit chain', () => {
  it('accepts an intact chain and an empty chain', () => {
    expect(verifyChain(chain(5), sha)).toEqual({ ok: true });
    expect(verifyChain([], sha)).toEqual({ ok: true });
  });
  it('detects an edited entry', () => {
    const c = chain(5); c[2]!.after_json = '{"a":2}';
    expect(verifyChain(c, sha)).toEqual({ ok: false, seq: 3, problem: 'hash_mismatch' });
  });
  it('detects a removed middle entry', () => {
    const c = chain(5); c.splice(2, 1);
    expect(verifyChain(c, sha)).toMatchObject({ ok: false, problem: 'seq_gap' });
  });
  it('detects a removed first entry', () => {
    const c = chain(3); c.shift();
    expect(verifyChain(c, sha)).toMatchObject({ ok: false, problem: 'prev_hash_mismatch' });
  });
  it('detects reordering', () => {
    const c = chain(4); [c[1], c[2]] = [c[2]!, c[1]!];
    expect(verifyChain(c, sha).ok).toBe(false);
  });
});

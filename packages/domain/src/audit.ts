/** Tamper-evident audit chain (BR-047). hash = H(prev_hash + "\n" + canonical(entry)). Hash function is injected. */
export type Hasher = (input: string) => string;

export interface AuditEntry {
  id: string; tenant_id: string; at: string; actor_id: string; actor_role: string;
  branch_id: string | null; action: string; entity_type: string; entity_id: string;
  before_json: string | null; after_json: string | null; reason: string | null;
}
export interface StoredAuditEntry extends AuditEntry { seq: number; prev_hash: string; hash: string }

export const GENESIS_HASH = '0'.repeat(64);

/** Fixed key order so the same entry always serializes identically. */
export function canonicalize(e: AuditEntry): string {
  return JSON.stringify([e.id, e.tenant_id, e.at, e.actor_id, e.actor_role, e.branch_id, e.action,
    e.entity_type, e.entity_id, e.before_json, e.after_json, e.reason]);
}
export function computeHash(prevHash: string, e: AuditEntry, hash: Hasher): string {
  return hash(`${prevHash}\n${canonicalize(e)}`);
}

export type ChainVerdict = { ok: true } | { ok: false; seq: number; problem: 'prev_hash_mismatch' | 'hash_mismatch' | 'seq_gap' };

/** Entries must be ordered by seq. Detects edited rows, removed rows (gap or broken link) and reordering. */
export function verifyChain(entries: StoredAuditEntry[], hash: Hasher): ChainVerdict {
  let prev = GENESIS_HASH; let expectedSeq: number | null = null;
  for (const e of entries) {
    if (expectedSeq !== null && e.seq !== expectedSeq) return { ok: false, seq: e.seq, problem: 'seq_gap' };
    if (e.prev_hash !== prev) return { ok: false, seq: e.seq, problem: 'prev_hash_mismatch' };
    if (computeHash(prev, e, hash) !== e.hash) return { ok: false, seq: e.seq, problem: 'hash_mismatch' };
    prev = e.hash; expectedSeq = e.seq + 1;
  }
  return { ok: true };
}

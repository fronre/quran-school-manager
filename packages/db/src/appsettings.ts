import { authorize, EVAL_SCALE, EVAL_SCALE_VERSION, PASS_RANK } from '@mishkat/domain';
import { appendAudit, nowIso } from './index';
import type { Ctx } from './students';

/** Association-level settings stored in the database (so backups carry them). Today: the memorization evaluation scale and pass mark (OD-021, OD-024). */
export interface MemoSettings { passRank: number; labels: Record<number, string>; version: number }
const KEY = 'memo.scale';
const clock = (c: Ctx) => (c.now ?? nowIso)();
const defaults = (): MemoSettings => ({ passRank: PASS_RANK, labels: Object.fromEntries(EVAL_SCALE.map((e) => [e.rank, e.label])), version: EVAL_SCALE_VERSION });

/** Readable by anyone (the entry form needs it); falls back to the built-in default scale. */
export function getMemoSettings(c: Ctx): MemoSettings {
  const r = c.db.prepare('SELECT value, version FROM app_setting WHERE tenant_id = ? AND key = ?').get(c.tenantId, KEY) as { value: string; version: number } | undefined;
  if (!r) return defaults();
  try {
    const j = JSON.parse(r.value) as { passRank: number; labels: Record<string, string> }; const d = defaults();
    const labels = Object.fromEntries([1, 2, 3, 4, 5].map((k) => [k, typeof j.labels?.[String(k)] === 'string' && j.labels[String(k)]!.trim() ? j.labels[String(k)]!.trim() : d.labels[k]!]));
    return { passRank: Number.isInteger(j.passRank) && j.passRank >= 1 && j.passRank <= 5 ? j.passRank : d.passRank, labels, version: r.version + 1 }; // version 1 is the built-in scale; each saved change is one more
  } catch { return defaults(); }
}
export const scaleList = (s: MemoSettings): { rank: number; label: string }[] => [5, 4, 3, 2, 1].map((rank) => ({ rank, label: s.labels[rank]! }));

export type MemoSettingsFail = 'forbidden' | 'invalid' | 'duplicate_labels' | 'conflict';
/** Changing the scale never rewrites old records: each record keeps the label, rank and scale version it was entered with (BR-036). A new pass mark does change what counts as memorized from now on. */
export function saveMemoSettings(c: Ctx, input: { passRank: number; labels: Record<number, string>; expectedVersion: number }): { ok: true } | { ok: false; error: MemoSettingsFail } {
  if (!authorize(c.assignments, 'settings.manage', null).allowed) return { ok: false, error: 'forbidden' };
  const cur = getMemoSettings(c); if (cur.version !== input.expectedVersion) return { ok: false, error: 'conflict' };
  if (!Number.isInteger(input.passRank) || input.passRank < 1 || input.passRank > 5) return { ok: false, error: 'invalid' };
  const labels: Record<string, string> = {};
  for (const k of [1, 2, 3, 4, 5]) { const v = (input.labels[k] ?? '').trim(); if (!v || [...v].length > 30) return { ok: false, error: 'invalid' }; labels[String(k)] = v; }
  if (new Set(Object.values(labels)).size !== 5) return { ok: false, error: 'duplicate_labels' };
  const now = clock(c); const same = JSON.stringify(labels) === JSON.stringify(Object.fromEntries(Object.entries(cur.labels).map(([k, v]) => [k, v]))) && input.passRank === cur.passRank; if (same) return { ok: true };
  c.db.transaction(() => {
    c.db.prepare('INSERT INTO app_setting(tenant_id,key,value,version,updated_at,updated_by) VALUES (?,?,?,1,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value = excluded.value, version = version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .run(c.tenantId, KEY, JSON.stringify({ passRank: input.passRank, labels }), now, c.actorId);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: c.assignments.map((a) => a.role).join(',') || 'none', branch_id: null, action: 'settings.memo_scale', entity_type: 'app_setting', entity_id: KEY,
      before_json: JSON.stringify({ passRank: cur.passRank, labels: cur.labels }), after_json: JSON.stringify({ passRank: input.passRank, labels }), reason: null });
  })();
  return { ok: true };
}

/** Association logo: a small PNG/JPEG kept as a data URL in app_setting, so it travels with backups. Not sensitive; shown on the login screen too. */
const LOGO_KEY = 'brand.logo';
export const LOGO_MAX_CHARS = 400_000;
const LOGO_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export function readLogo(db: Ctx['db'], tenantId: string): string | null {
  const r = db.prepare('SELECT value FROM app_setting WHERE tenant_id = ? AND key = ?').get(tenantId, LOGO_KEY) as { value: string } | undefined;
  return r && r.value ? r.value : null;
}
export type LogoFail = 'forbidden' | 'invalid' | 'too_big';
/** dataUrl = null removes the logo. */
export function saveLogo(c: Ctx, dataUrl: string | null): { ok: true } | { ok: false; error: LogoFail } {
  if (!authorize(c.assignments, 'settings.manage', null).allowed) return { ok: false, error: 'forbidden' };
  if (dataUrl !== null) { if (dataUrl.length > LOGO_MAX_CHARS) return { ok: false, error: 'too_big' }; if (!LOGO_RE.test(dataUrl)) return { ok: false, error: 'invalid' }; }
  const now = clock(c); const value = dataUrl ?? '';
  c.db.transaction(() => {
    c.db.prepare('INSERT INTO app_setting(tenant_id,key,value,version,updated_at,updated_by) VALUES (?,?,?,1,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value = excluded.value, version = version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .run(c.tenantId, LOGO_KEY, value, now, c.actorId);
    appendAudit(c.db, { tenant_id: c.tenantId, at: now, actor_id: c.actorId, actor_role: c.assignments.map((a) => a.role).join(',') || 'none', branch_id: null, action: dataUrl === null ? 'settings.logo_removed' : 'settings.logo_set', entity_type: 'app_setting', entity_id: LOGO_KEY,
      before_json: null, after_json: JSON.stringify({ chars: value.length }), reason: null });
  })();
  return { ok: true };
}

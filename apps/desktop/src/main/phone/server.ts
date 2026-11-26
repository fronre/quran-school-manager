import { createServer, type Server as HttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { SURAHS, MEMO_TYPES, type MemoType, type Assignment } from '@mishkat/domain';
import {
  newId, nowIso, appendAudit, listGroups, getSheet, saveSheet, todayOverview, listStudents, studentProgress, recordMemorization, getMemoSettings, scaleList, guardianSignIn, guardianChildren, type Db, type Ctx,
} from '@mishkat/db';
import { phonePage } from './page';
import { guardianPage } from './guardianpage';

/** The Wi-Fi phone page (OD-049). The desktop program stays the only database; a phone is a thin client that talks to this small HTTPS server.
 *  Security model: off by default; pairing with a 6-digit code that expires and works once; per-device token (only its hash is stored); each device is limited to chosen branches;
 *  only the private network may connect; a FIXED list of actions is exposed (attendance, memorization, student search) and nothing else: no money, no corrections, no deletions, no photos, no guardians' phones. */
export interface PhoneDeps { db: Db; tenantId: () => string | null; now?: () => string; tls: { key: string; cert: string }; maxDevices?: number }
export interface DeviceRow { id: string; name: string; branchIds: string[]; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^127\./, /^169\.254\./];
/** Only devices on the local network may connect (the program is not meant to be reachable from the internet). */
export function isPrivateAddress(addr: string | undefined): boolean {
  if (!addr) return false; const a = addr.replace(/^::ffff:/, ''); if (a === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a)) return true; // IPv6 unique-local and link-local
  return PRIVATE.some((r) => r.test(a));
}

export function createPhoneService(d: PhoneDeps) {
  const clock = () => (d.now ?? nowIso)();
  const codes = new Map<string, { branchIds: string[]; expires: number }>();
  const fails = new Map<string, { n: number; until: number }>();
  let server: HttpsServer | null = null; let port = 0;
  const seen = new Map<string, number>();
  const gSessions = new Map<string, { guardianId: string; expires: number }>(); // guardian app sessions: in memory only, 30 minutes, gone when the program stops
  const gFails = new Map<string, { n: number; until: number }>();

  const branchesOf = (ids: string[]) => (d.db.prepare(`SELECT id, name FROM branch WHERE deleted_at IS NULL AND active = 1 AND id IN (${ids.map(() => '?').join(',') || "''"}) ORDER BY position`).all(...ids) as { id: string; name: string }[]);
  const allBranchIds = () => (d.db.prepare('SELECT id FROM branch WHERE deleted_at IS NULL AND active = 1').all() as { id: string }[]).map((b) => b.id);

  // ---------------- pairing codes (desktop side) ----------------
  function newPairingCode(branchIds: string[] | 'all', ttlMs = 5 * 60_000): { ok: true; code: string; expiresAt: string } | { ok: false; error: 'no_branch' | 'too_many_devices' } {
    const ids = branchIds === 'all' ? allBranchIds() : branchesOf(branchIds).map((b) => b.id); if (ids.length === 0) return { ok: false, error: 'no_branch' };
    const active = (d.db.prepare('SELECT count(*) n FROM phone_device WHERE revoked_at IS NULL').get() as { n: number }).n; if (active >= (d.maxDevices ?? 20)) return { ok: false, error: 'too_many_devices' };
    for (const [c, v] of codes) if (v.expires < Date.now()) codes.delete(c);
    let code = ''; do code = String(randomInt(0, 1_000_000)).padStart(6, '0'); while (codes.has(code));
    codes.set(code, { branchIds: ids, expires: Date.now() + ttlMs }); return { ok: true, code, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  }
  const clearCodes = () => codes.clear();
  function listDevices(): DeviceRow[] {
    return (d.db.prepare('SELECT id, name, branch_ids AS b, created_at AS createdAt, last_seen_at AS lastSeenAt, revoked_at AS revokedAt FROM phone_device WHERE tenant_id = ? ORDER BY created_at DESC').all(d.tenantId() ?? '') as (Omit<DeviceRow, 'branchIds'> & { b: string })[])
      .map(({ b, ...r }) => ({ ...r, branchIds: JSON.parse(b) as string[] }));
  }
  function revoke(id: string, by: string): boolean {
    const r = d.db.prepare('UPDATE phone_device SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL').run(clock(), by, id).changes; if (!r) return false;
    appendAudit(d.db, { tenant_id: d.tenantId() ?? '', at: clock(), actor_id: by, actor_role: 'desktop', branch_id: null, action: 'phone.revoke', entity_type: 'phone_device', entity_id: id, before_json: null, after_json: null, reason: null }); return true;
  }

  // ---------------- HTTP ----------------
  const json = (res: ServerResponse, status: number, body: unknown) => { const t = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(t); };
  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > 64 * 1024) throw new Error('too_large'); chunks.push(c as Buffer); }
    if (!chunks.length) return {}; return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  interface Device { id: string; name: string; branchIds: string[] }
  function auth(req: IncomingMessage): Device | null {
    const h = req.headers.authorization; if (!h || !h.startsWith('Bearer ')) return null; const t = h.slice(7).trim(); if (!/^[A-Za-z0-9_-]{40,64}$/.test(t)) return null;
    const r = d.db.prepare('SELECT id, name, branch_ids AS b FROM phone_device WHERE token_hash = ? AND revoked_at IS NULL').get(sha(t)) as { id: string; name: string; b: string } | undefined; if (!r) return null;
    const now = Date.now(); if ((seen.get(r.id) ?? 0) < now - 60_000) { seen.set(r.id, now); d.db.prepare('UPDATE phone_device SET last_seen_at = ? WHERE id = ?').run(clock(), r.id); }
    return { id: r.id, name: r.name, branchIds: JSON.parse(r.b) as string[] };
  }
  const ctxOf = (dev: Device): Ctx => ({ db: d.db, tenantId: d.tenantId() ?? '', actorId: 'phone:' + dev.id, assignments: dev.branchIds.map((b): Assignment => ({ role: 'branch_supervisor', branchId: b })), now: d.now });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'https://phone.local'); const method = req.method ?? 'GET'; const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!isPrivateAddress(req.socket.remoteAddress)) { res.writeHead(403).end(); return; }
    const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) { res.writeHead(403).end(); return; } // same-site requests only
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const nonce = randomBytes(16).toString('base64');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` });
      res.end(phonePage(nonce)); return;
    }
    if (method === 'GET' && url.pathname === '/g') {
      const nonce = randomBytes(16).toString('base64');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` });
      res.end(guardianPage(nonce)); return;
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404).end(); return; }
    try {
      // ---- pairing (no token yet)
      if (method === 'POST' && url.pathname === '/api/pair') {
        const f = fails.get(ip); if (f && f.until > Date.now()) return json(res, 429, { error: 'too_many_attempts' });
        const b = (await readBody(req)) as { code?: unknown; name?: unknown }; const code = typeof b.code === 'string' ? b.code.replace(/\s/g, '') : ''; const name = typeof b.name === 'string' ? b.name.trim().slice(0, 40) : '';
        const c = /^\d{6}$/.test(code) ? codes.get(code) : undefined;
        if (!c || c.expires < Date.now() || !name) { const n = (f?.n ?? 0) + 1; fails.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 }); return json(res, 400, { error: !name && c ? 'name_required' : 'bad_code' }); }
        codes.delete(code); fails.delete(ip);
        const token = randomBytes(32).toString('base64url'); const id = newId(); const now = clock();
        d.db.transaction(() => {
          d.db.prepare('INSERT INTO phone_device(id,tenant_id,name,token_hash,branch_ids,created_at) VALUES (?,?,?,?,?,?)').run(id, d.tenantId() ?? '', name, sha(token), JSON.stringify(c.branchIds), now);
          appendAudit(d.db, { tenant_id: d.tenantId() ?? '', at: now, actor_id: 'phone:' + id, actor_role: 'phone', branch_id: null, action: 'phone.pair', entity_type: 'phone_device', entity_id: id, before_json: null, after_json: JSON.stringify({ name, branches: c.branchIds }), reason: null });
        })();
        return json(res, 200, { token, device: { id, name } });
      }
      // ---- guardian app (read-only; own children only)
      if (method === 'POST' && url.pathname === '/api/g/login') {
        const f = gFails.get(ip); if (f && f.until > Date.now()) return json(res, 429, { error: 'too_many_attempts' });
        const b = (await readBody(req)) as { phone?: unknown; code?: unknown }; const r = guardianSignIn(d.db, d.tenantId() ?? '', typeof b.phone === 'string' ? b.phone.slice(0, 30) : '', typeof b.code === 'string' ? b.code.slice(0, 20) : '', d.now);
        if (!r.ok) { const n = (f?.n ?? 0) + 1; gFails.set(ip, { n, until: n >= 10 ? Date.now() + 5 * 60_000 : 0 }); return json(res, r.error === 'locked' ? 429 : 400, { error: r.error === 'locked' ? 'locked' : 'bad_login' }); }
        gFails.delete(ip); for (const [k, v] of gSessions) if (v.expires < Date.now()) gSessions.delete(k);
        const token = randomBytes(32).toString('base64url'); gSessions.set(sha(token), { guardianId: r.guardianId, expires: Date.now() + 30 * 60_000 }); return json(res, 200, { token });
      }
      if (url.pathname === '/api/g/me' || url.pathname === '/api/g/logout') {
        const h = req.headers.authorization ?? ''; const key = h.startsWith('Bearer ') ? sha(h.slice(7).trim()) : ''; const gs = gSessions.get(key);
        if (!gs || gs.expires < Date.now()) { gSessions.delete(key); return json(res, 401, { error: 'unauthorized' }); }
        if (url.pathname === '/api/g/logout') { gSessions.delete(key); return json(res, 200, { ok: true }); }
        const v = guardianChildren(d.db, d.tenantId() ?? '', gs.guardianId, d.now); if (!v) { gSessions.delete(key); return json(res, 401, { error: 'unauthorized' }); }
        return json(res, 200, v);
      }
      const dev = auth(req); if (!dev) return json(res, 401, { error: 'unauthorized' });
      const c = ctxOf(dev); const today = clock().slice(0, 10);
      if (method === 'GET' && url.pathname === '/api/me') {
        const assoc = (d.db.prepare('SELECT name FROM association LIMIT 1').get() as { name: string } | undefined)?.name ?? '';
        return json(res, 200, { device: { id: dev.id, name: dev.name }, association: assoc, today, branches: branchesOf(dev.branchIds) });
      }
      if (method === 'GET' && url.pathname === '/api/groups') return json(res, 200, { today, groups: todayOverview(c, today), all: listGroups(c).map((g) => ({ id: g.id, name: g.name, branchName: g.branchName, members: g.members })) });
      if (method === 'GET' && url.pathname === '/api/sheet') {
        const s = getSheet(c, url.searchParams.get('group') ?? '', url.searchParams.get('date') ?? today); if (!s) return json(res, 404, { error: 'not_found' });
        return json(res, 200, { group: { id: s.group.id, name: s.group.name, branchName: s.group.branchName, status: s.group.status }, date: s.date, session: s.session && { startTime: s.session.startTime, endTime: s.session.endTime, status: s.session.status, cancelReason: s.session.cancelReason },
          rows: s.rows.map((r) => ({ studentId: r.studentId, studentNo: r.studentNo, name: r.name, recorded: r.recordId !== null, status: r.status, lateMinutes: r.lateMinutes, note: r.note })) });
      }
      if (method === 'POST' && url.pathname === '/api/attendance') {
        const b = (await readBody(req)) as { groupId?: string; date?: string; startTime?: string; endTime?: string; entries?: never[] };
        if (typeof b.groupId !== 'string' || typeof b.date !== 'string' || typeof b.startTime !== 'string' || typeof b.endTime !== 'string' || !Array.isArray(b.entries)) return json(res, 400, { error: 'invalid' });
        const r = saveSheet(c, b.groupId, b.date, { startTime: b.startTime, endTime: b.endTime }, b.entries); return json(res, r.ok ? 200 : 400, r);
      }
      if (method === 'GET' && url.pathname === '/api/students') {
        const q = listStudents(c, { search: (url.searchParams.get('search') ?? '').slice(0, 100), limit: 30 });
        return json(res, 200, { total: q.total, rows: q.rows.map((s) => ({ id: s.id, studentNo: s.studentNo, name: `${s.givenName} ${s.familyName}`, branchName: s.branchName })) });
      }
      if (method === 'GET' && url.pathname === '/api/quran') { const m = getMemoSettings(c); return json(res, 200, { surahs: SURAHS.map((s) => [s.no, s.name, s.ayahCount]), scale: scaleList(m), passRank: m.passRank, types: MEMO_TYPES }); }
      if (method === 'GET' && url.pathname === '/api/memo') {
        const p = studentProgress(c, url.searchParams.get('student') ?? '', 8); if (!p) return json(res, 404, { error: 'not_found' });
        return json(res, 200, { summary: { memorizedAyat: p.summary.memorizedAyat, totalAyat: p.summary.totalAyat, wholeSurahs: p.summary.wholeSurahs, counts: p.summary.counts, lastDate: p.summary.lastDate },
          records: p.records.map((r) => ({ id: r.id, date: r.date, type: r.type, rangeText: r.rangeText, evalLabel: r.evalLabel, voided: r.voided })) });
      }
      if (method === 'POST' && url.pathname === '/api/memo') {
        const b = (await readBody(req)) as { studentId?: string; date?: string; type?: string; start?: { surah?: number; ayah?: number }; end?: { surah?: number; ayah?: number }; evalRank?: number | null; comment?: string | null };
        if (typeof b.studentId !== 'string' || typeof b.date !== 'string' || !(MEMO_TYPES as readonly string[]).includes(b.type ?? '') || !b.start || !b.end) return json(res, 400, { error: 'invalid' });
        const r = recordMemorization(c, { studentId: b.studentId, date: b.date, type: b.type as MemoType, range: { start: { surah: Number(b.start.surah), ayah: Number(b.start.ayah) }, end: { surah: Number(b.end.surah), ayah: Number(b.end.ayah) } }, evalRank: b.evalRank === null || b.evalRank === undefined ? null : Number(b.evalRank), comment: typeof b.comment === 'string' ? b.comment.slice(0, 300) : null });
        return json(res, r.ok ? 200 : 400, r.ok ? { ok: true } : r);
      }
      return json(res, 404, { error: 'not_found' });
    } catch (e) { return json(res, e instanceof SyntaxError || (e instanceof Error && e.message === 'too_large') ? 400 : 500, { error: 'failed' }); }
  }

  function start(preferredPort = 8443): Promise<number> {
    if (server) return Promise.resolve(port);
    return new Promise((resolve, reject) => {
      const tryPort = (p: number, left: number) => {
        const s = createServer({ key: d.tls.key, cert: d.tls.cert, minVersion: 'TLSv1.2' }, (q, r) => { void route(q, r); });
        s.requestTimeout = 15_000; s.headersTimeout = 10_000; s.maxHeadersCount = 40;
        s.once('error', (err: NodeJS.ErrnoException) => { s.close(); if (err.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1); else reject(err); });
        s.listen(p, '0.0.0.0', () => { server = s; port = (s.address() as { port: number }).port; resolve(port); });
      }; tryPort(preferredPort, 9);
    });
  }
  function stop(): Promise<void> { clearCodes(); gSessions.clear(); const s = server; server = null; port = 0; return new Promise((r) => { if (!s) return r(); s.closeAllConnections(); s.close(() => r()); }); }
  return { start, stop, newPairingCode, clearCodes, listDevices, revoke, running: () => server !== null, port: () => port };
}
export type PhoneService = ReturnType<typeof createPhoneService>;

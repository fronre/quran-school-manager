/** First-run setup input validation (WF-01, REQ-001..004). Pure. Returns issue codes; the UI maps them to Arabic text. */
import { checkPassword } from './authpolicy';

export interface SetupInput {
  admin: { givenName: string; familyName: string; username: string; password: string };
  association: { name: string; address?: string; contact?: string };
  branches: { name: string; label?: string }[];
  year: { name: string; startDate: string; endDate: string };
}
export type SetupIssueCode = 'required' | 'too_long' | 'duplicate' | 'bad_date' | 'date_order' | 'weak_password' | 'bad_username' | 'too_many';
export interface SetupIssue { field: string; code: SetupIssueCode; detail?: string }

export const MAX_BRANCHES = 10;
const NAME_MAX = 100, TEXT_MAX = 300;
const USERNAME_RE = /^[\p{L}\p{N}._-]{3,40}$/u;

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateSetup(i: SetupInput, ctx: { blocked?: ReadonlySet<string> } = {}): SetupIssue[] {
  const out: SetupIssue[] = [];
  const req = (field: string, v: string, max = NAME_MAX) => {
    if (v.trim().length === 0) out.push({ field, code: 'required' });
    else if ([...v].length > max) out.push({ field, code: 'too_long' });
  };
  const opt = (field: string, v: string | undefined) => { if (v && [...v].length > TEXT_MAX) out.push({ field, code: 'too_long' }); };

  req('admin.givenName', i.admin.givenName); req('admin.familyName', i.admin.familyName);
  if (!USERNAME_RE.test(i.admin.username)) out.push({ field: 'admin.username', code: i.admin.username.trim() ? 'bad_username' : 'required' });
  for (const p of checkPassword(i.admin.password, { username: i.admin.username, blocked: ctx.blocked })) out.push({ field: 'admin.password', code: 'weak_password', detail: p });

  req('association.name', i.association.name); opt('association.address', i.association.address); opt('association.contact', i.association.contact);

  if (i.branches.length === 0) out.push({ field: 'branches', code: 'required' });
  if (i.branches.length > MAX_BRANCHES) out.push({ field: 'branches', code: 'too_many' });
  const seen = new Set<string>();
  i.branches.forEach((b, n) => {
    req(`branches.${n}.name`, b.name); opt(`branches.${n}.label`, b.label);
    const k = b.name.trim().toLowerCase();
    if (k) { if (seen.has(k)) out.push({ field: `branches.${n}.name`, code: 'duplicate' }); seen.add(k); }
  });

  req('year.name', i.year.name);
  const s = isValidIsoDate(i.year.startDate), e = isValidIsoDate(i.year.endDate);
  if (!s) out.push({ field: 'year.startDate', code: i.year.startDate ? 'bad_date' : 'required' });
  if (!e) out.push({ field: 'year.endDate', code: i.year.endDate ? 'bad_date' : 'required' });
  if (s && e && i.year.startDate >= i.year.endDate) out.push({ field: 'year.endDate', code: 'date_order' });
  return out;
}

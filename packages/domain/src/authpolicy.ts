/** Password policy (SEC-011) and login backoff (SEC-012). Pure; block lists are injected. */
export const MIN_PASSWORD_LENGTH = 10;

export type PasswordProblem = 'too_short' | 'common' | 'contains_username' | 'blank';
export function checkPassword(password: string, ctx: { username?: string; blocked?: ReadonlySet<string> } = {}): PasswordProblem[] {
  if (password.trim().length === 0) return ['blank'];
  const p: PasswordProblem[] = [];
  if ([...password].length < MIN_PASSWORD_LENGTH) p.push('too_short'); // code points, so Arabic passphrases count fairly
  const lower = password.toLowerCase();
  if (ctx.blocked?.has(lower)) p.push('common');
  if (ctx.username && ctx.username.length >= 3 && lower.includes(ctx.username.toLowerCase())) p.push('contains_username');
  return p; // deliberately no composition rules
}

/** Seconds of delay after N consecutive failures: 4 free tries, then 30 s, 1 min, 5 min, 15 min (cap). */
export function backoffSeconds(failedAttempts: number): number {
  if (failedAttempts < 5) return 0;
  const steps = [30, 60, 300, 900];
  return steps[Math.min(failedAttempts - 5, steps.length - 1)]!;
}
export function isLocked(lockedUntilIso: string | null, nowIso: string): boolean {
  return lockedUntilIso !== null && lockedUntilIso > nowIso;
}
